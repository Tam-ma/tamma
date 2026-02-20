/**
 * Limit Manager Service
 * Manages usage limits and enforcement
 */

import { nanoid } from 'nanoid';
import type {
  ICostStorage,
  UsageLimit,
  UsageLimitInput,
  LimitContext,
  LimitCheckResult,
  CostAlert,
  CostAlertType,
  AlertSeverity,
} from './types.js';
import { UsageTracker } from './usage-tracker.js';

/**
 * Options for the limit manager
 */
export interface LimitManagerOptions {
  storage: ICostStorage;
  usageTracker: UsageTracker;
  onAlert?: (alert: CostAlert) => void;
}

/**
 * Limit Manager for checking and enforcing usage limits
 */
export class LimitManager {
  private readonly storage: ICostStorage;
  private readonly usageTracker: UsageTracker;
  private readonly onAlert: ((alert: CostAlert) => void) | undefined;

  constructor(options: LimitManagerOptions) {
    this.storage = options.storage;
    this.usageTracker = options.usageTracker;
    if (options.onAlert) {
      this.onAlert = options.onAlert;
    }
  }

  /**
   * Create a new usage limit
   */
  async setLimit(input: UsageLimitInput): Promise<UsageLimit> {
    const now = new Date();
    const limit: UsageLimit = {
      ...input,
      id: nanoid(),
      createdAt: now,
      updatedAt: now,
    };

    // Validate thresholds
    if (limit.softThreshold < 0 || limit.softThreshold > 1) {
      throw new Error('softThreshold must be between 0 and 1');
    }
    if (limit.hardThreshold < 0 || limit.hardThreshold > 1) {
      throw new Error('hardThreshold must be between 0 and 1');
    }
    if (limit.softThreshold > limit.hardThreshold) {
      throw new Error('softThreshold cannot be greater than hardThreshold');
    }
    if (limit.limitUsd <= 0) {
      throw new Error('limitUsd must be positive');
    }

    await this.storage.saveLimitConfig(limit);
    return limit;
  }

  /**
   * Update an existing limit
   */
  async updateLimit(id: string, updates: Partial<UsageLimit>): Promise<UsageLimit> {
    const limits = await this.storage.getLimitConfigs();
    const existing = limits.find((l) => l.id === id);

    if (!existing) {
      throw new Error(`Limit with id ${id} not found`);
    }

    const updated: UsageLimit = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent id from being changed
      createdAt: existing.createdAt, // Prevent createdAt from being changed
      updatedAt: new Date(),
    };

    await this.storage.saveLimitConfig(updated);
    return updated;
  }

  /**
   * Delete a limit
   */
  async deleteLimit(id: string): Promise<void> {
    await this.storage.deleteLimitConfig(id);
  }

  /**
   * Get all limits
   */
  async getLimits(): Promise<UsageLimit[]> {
    return this.storage.getLimitConfigs();
  }

  /**
   * Get a limit by ID
   */
  async getLimit(id: string): Promise<UsageLimit | undefined> {
    const limits = await this.storage.getLimitConfigs();
    return limits.find((l) => l.id === id);
  }

  /**
   * Check if an action would exceed limits
   */
  async checkLimit(context: LimitContext): Promise<LimitCheckResult> {
    const limits = await this.getApplicableLimits(context);
    const warnings: string[] = [];
    const triggeredLimits: UsageLimit[] = [];
    let blocked = false;

    for (const limit of limits) {
      if (!limit.enabled) continue;

      const currentUsage = await this.getCurrentUsageForLimit(limit, context);

      // Check if adding estimated cost would exceed limits
      const projectedUsage = currentUsage + (context.estimatedCostUsd ?? 0);
      const projectedPercent = limit.limitUsd > 0 ? projectedUsage / limit.limitUsd : 0;

      // Check soft threshold
      if (projectedPercent >= limit.softThreshold && projectedPercent < limit.hardThreshold) {
        warnings.push(
          `Approaching ${limit.name} limit: ${(projectedPercent * 100).toFixed(1)}% of $${limit.limitUsd}`
        );
        triggeredLimits.push(limit);
        await this.triggerAlert(limit, 'limit_approaching', 'info', currentUsage);
      }

      // Check hard threshold
      if (projectedPercent >= limit.hardThreshold) {
        triggeredLimits.push(limit);

        if (limit.action === 'block') {
          blocked = true;
          warnings.push(
            `Blocked by ${limit.name}: ${(projectedPercent * 100).toFixed(1)}% of $${limit.limitUsd}`
          );
          await this.triggerAlert(limit, 'limit_exceeded', 'critical', currentUsage);
        } else if (limit.action === 'warn') {
          warnings.push(
            `Warning from ${limit.name}: ${(projectedPercent * 100).toFixed(1)}% of $${limit.limitUsd}`
          );
          await this.triggerAlert(limit, 'limit_warning', 'warning', currentUsage);
        }
      }
    }

    // Calculate overall status
    const totalLimit = limits.reduce((sum, l) => sum + (l.enabled ? l.limitUsd : 0), 0);
    const totalUsage = await this.usageTracker.getCurrentPeriodUsage('monthly', context.projectId);
    const percentUsed = totalLimit > 0 ? totalUsage / totalLimit : 0;

    // Determine recommended action
    let recommendedAction: 'proceed' | 'use_cheaper_model' | 'wait' | 'abort' = 'proceed';
    if (blocked) {
      recommendedAction = 'abort';
    } else if (warnings.length > 0 && percentUsed > 0.8) {
      recommendedAction = 'use_cheaper_model';
    }

    // Find cheaper alternatives if needed
    const result: LimitCheckResult = {
      allowed: !blocked,
      currentUsageUsd: totalUsage,
      limitUsd: totalLimit,
      percentUsed,
      warnings,
      triggeredLimits,
      recommendedAction,
    };

    if (recommendedAction === 'use_cheaper_model' && context.model) {
      result.suggestedAlternatives = this.getSuggestedAlternatives(context);
    }

    return result;
  }

  /**
   * Get limits that apply to the given context
   */
  private async getApplicableLimits(context: LimitContext): Promise<UsageLimit[]> {
    const allLimits = await this.storage.getLimitConfigs();
    const applicable: UsageLimit[] = [];

    for (const limit of allLimits) {
      if (this.limitAppliesTo(limit, context)) {
        applicable.push(limit);
      }
    }

    return applicable;
  }

  /**
   * Check if a limit applies to the given context
   */
  private limitAppliesTo(limit: UsageLimit, context: LimitContext): boolean {
    switch (limit.scope) {
      case 'global':
        return true;
      case 'project':
        return limit.scopeId === context.projectId;
      case 'provider':
        return limit.scopeId === context.provider;
      case 'agent_type':
        return limit.scopeId === context.agentType;
      case 'model':
        return limit.scopeId === context.model;
      default:
        return false;
    }
  }

  /**
   * Get current usage for a specific limit
   */
  private async getCurrentUsageForLimit(
    limit: UsageLimit,
    context: LimitContext
  ): Promise<number> {
    const filter = this.buildFilterForLimit(limit, context);
    return this.usageTracker.getCurrentPeriodUsage(limit.period, filter.projectId);
  }

  /**
   * Build a filter for the given limit and context
   */
  private buildFilterForLimit(
    limit: UsageLimit,
    context: LimitContext
  ): { projectId?: string; provider?: string; agentType?: string; model?: string } {
    const filter: { projectId?: string; provider?: string; agentType?: string; model?: string } = {};

    switch (limit.scope) {
      case 'project': {
        const projectId = limit.scopeId ?? context.projectId;
        if (projectId) filter.projectId = projectId;
        break;
      }
      case 'provider': {
        const provider = limit.scopeId ?? context.provider;
        if (provider) filter.provider = provider;
        break;
      }
      case 'agent_type': {
        const agentType = limit.scopeId ?? context.agentType;
        if (agentType) filter.agentType = agentType;
        break;
      }
      case 'model': {
        const model = limit.scopeId ?? context.model;
        if (model) filter.model = model;
        break;
      }
    }

    return filter;
  }

  /**
   * Trigger an alert for a limit
   */
  private async triggerAlert(
    limit: UsageLimit,
    type: CostAlertType,
    severity: AlertSeverity,
    currentValue: number
  ): Promise<void> {
    const alert: CostAlert = {
      id: nanoid(),
      type,
      severity,
      scope: limit.scope,
      message: this.buildAlertMessage(limit, type, currentValue),
      currentValue,
      threshold: limit.limitUsd * (type === 'limit_approaching' ? limit.softThreshold : limit.hardThreshold),
      status: 'active',
      createdAt: new Date(),
      deliveredTo: [],
    };

    if (limit.scopeId) {
      alert.scopeId = limit.scopeId;
    }

    await this.storage.saveAlert(alert);

    if (this.onAlert) {
      this.onAlert(alert);
    }
  }

  /**
   * Build an alert message
   */
  private buildAlertMessage(limit: UsageLimit, type: CostAlertType, currentValue: number): string {
    const percent = ((currentValue / limit.limitUsd) * 100).toFixed(1);

    switch (type) {
      case 'limit_approaching':
        return `Approaching ${limit.name}: ${percent}% of $${limit.limitUsd} ${limit.period} budget used`;
      case 'limit_warning':
        return `Warning for ${limit.name}: ${percent}% of $${limit.limitUsd} ${limit.period} budget used`;
      case 'limit_exceeded':
        return `Exceeded ${limit.name}: ${percent}% of $${limit.limitUsd} ${limit.period} budget used`;
      default:
        return `Alert for ${limit.name}: ${percent}% of budget used`;
    }
  }

  /**
   * Get suggested cheaper alternatives
   */
  private getSuggestedAlternatives(
    context: LimitContext
  ): { model: string; estimatedSavings: number }[] {
    // Simple suggestions - in a real implementation, this would use the cost calculator
    const suggestions: { model: string; estimatedSavings: number }[] = [];

    if (context.model?.includes('opus') || context.model?.includes('gpt-4')) {
      suggestions.push(
        { model: 'claude-3-5-sonnet-20241022', estimatedSavings: 0.5 },
        { model: 'gpt-4o-mini', estimatedSavings: 0.8 }
      );
    } else if (context.model?.includes('sonnet')) {
      suggestions.push(
        { model: 'claude-3-5-haiku-20241022', estimatedSavings: 0.6 },
        { model: 'gpt-3.5-turbo', estimatedSavings: 0.9 }
      );
    }

    return suggestions;
  }
}
