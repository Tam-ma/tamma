/**
 * Usage Tracker Service
 * Records and queries LLM usage data
 */

import { nanoid } from 'nanoid';
import type {
  ICostStorage,
  UsageRecord,
  UsageRecordInput,
  UsageFilter,
  UsageAggregate,
  GroupByDimension,
} from './types.js';
import { CostCalculator } from './cost-calculator.js';

/**
 * Options for the usage tracker
 */
export interface UsageTrackerOptions {
  storage: ICostStorage;
  calculator?: CostCalculator;
}

/**
 * Usage Tracker for recording and querying LLM usage
 */
export class UsageTracker {
  private readonly storage: ICostStorage;
  private readonly calculator: CostCalculator;

  constructor(options: UsageTrackerOptions) {
    this.storage = options.storage;
    this.calculator = options.calculator ?? new CostCalculator();
  }

  /**
   * Record a new usage event
   */
  async recordUsage(input: UsageRecordInput): Promise<UsageRecord> {
    // Calculate costs
    const costs = this.calculator.calculate(
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cacheReadTokens,
      input.cacheWriteTokens
    );

    // Create the full record
    const record: UsageRecord = {
      ...input,
      id: nanoid(),
      timestamp: new Date(),
      inputCostUsd: costs.inputCostUsd,
      outputCostUsd: costs.outputCostUsd,
      totalCostUsd: costs.totalCostUsd,
    };

    // Validate the record
    this.validateRecord(record);

    // Save to storage
    await this.storage.saveUsageRecord(record);

    return record;
  }

  /**
   * Get usage records matching the filter
   */
  async getUsage(filter: UsageFilter = {}): Promise<UsageRecord[]> {
    return this.storage.getUsageRecords(filter);
  }

  /**
   * Get aggregated usage data
   */
  async getAggregate(
    filter: UsageFilter,
    groupBy: GroupByDimension[]
  ): Promise<UsageAggregate[]> {
    return this.storage.aggregateUsage(filter, groupBy);
  }

  /**
   * Get total cost for a time period
   */
  async getTotalCost(filter: UsageFilter = {}): Promise<number> {
    const records = await this.storage.getUsageRecords(filter);
    const total = records.reduce((sum, record) => sum + record.totalCostUsd, 0);
    return Number(total.toFixed(6));
  }

  /**
   * Get usage summary for a project
   */
  async getProjectSummary(
    projectId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalCostUsd: number;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    byModel: UsageAggregate[];
    byAgentType: UsageAggregate[];
  }> {
    const filter: UsageFilter = {
      projectId,
    };
    if (startDate) {
      filter.startDate = startDate;
    }
    if (endDate) {
      filter.endDate = endDate;
    }

    const records = await this.storage.getUsageRecords(filter);

    const totalCostUsd = records.reduce((sum, r) => sum + r.totalCostUsd, 0);
    const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);

    const byModel = await this.storage.aggregateUsage(filter, ['model']);
    const byAgentType = await this.storage.aggregateUsage(filter, ['agent_type']);

    return {
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalCalls: records.length,
      totalInputTokens,
      totalOutputTokens,
      byModel,
      byAgentType,
    };
  }

  /**
   * Get usage for the current period (day, week, or month)
   */
  async getCurrentPeriodUsage(
    period: 'daily' | 'weekly' | 'monthly',
    projectId?: string
  ): Promise<number> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const filter: UsageFilter = {
      startDate,
      endDate: now,
      ...(projectId && { projectId }),
    };

    return this.getTotalCost(filter);
  }

  /**
   * Validate a usage record
   */
  private validateRecord(record: UsageRecord): void {
    if (!record.id) {
      throw new Error('UsageRecord must have an id');
    }
    if (!record.projectId) {
      throw new Error('UsageRecord must have a projectId');
    }
    if (!record.engineId) {
      throw new Error('UsageRecord must have an engineId');
    }
    if (!record.taskId) {
      throw new Error('UsageRecord must have a taskId');
    }
    if (record.inputTokens < 0) {
      throw new Error('inputTokens cannot be negative');
    }
    if (record.outputTokens < 0) {
      throw new Error('outputTokens cannot be negative');
    }
    if (record.latencyMs < 0) {
      throw new Error('latencyMs cannot be negative');
    }
  }

  /**
   * Get the cost calculator
   */
  getCalculator(): CostCalculator {
    return this.calculator;
  }
}
