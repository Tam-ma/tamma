/**
 * Violation recorder for permission audit logging
 * @module @tamma/gates/violations/violation-recorder
 */

import { nanoid } from 'nanoid';
import type {
  AgentType,
  PermissionViolation,
  ViolationFilter,
  IViolationRecorder,
} from '../permissions/types.js';
import type { ILogger } from '@tamma/shared';

/**
 * Options for the violation recorder
 */
export interface ViolationRecorderOptions {
  logger?: ILogger;
  /**
   * Maximum number of violations to store in memory
   */
  maxViolations?: number;
  /**
   * Threshold for considering a violation as repeated (same agent, same action type)
   */
  repeatThresholdMinutes?: number;
}

/**
 * Records and tracks permission violations
 */
export class ViolationRecorder implements IViolationRecorder {
  private readonly violations: PermissionViolation[] = [];
  private readonly logger?: ILogger;
  private readonly maxViolations: number;
  private readonly repeatThresholdMs: number;

  constructor(options?: ViolationRecorderOptions) {
    this.logger = options?.logger;
    this.maxViolations = options?.maxViolations ?? 10000;
    this.repeatThresholdMs = (options?.repeatThresholdMinutes ?? 5) * 60 * 1000;
  }

  /**
   * Record a new violation
   */
  async record(
    violation: Omit<PermissionViolation, 'id' | 'timestamp' | 'repeated' | 'repeatCount'>,
  ): Promise<PermissionViolation> {
    // Check for repeated violations
    const recentSimilar = this.findRecentSimilarViolations(
      violation.agentType,
      violation.action.type,
      violation.projectId,
    );

    const isRepeated = recentSimilar.length > 0;
    const repeatCount = isRepeated ? recentSimilar.length + 1 : undefined;

    const fullViolation: PermissionViolation = {
      ...violation,
      id: nanoid(),
      timestamp: new Date(),
      repeated: isRepeated,
      repeatCount,
    };

    // Add to storage
    this.violations.push(fullViolation);

    // Trim if exceeding max
    if (this.violations.length > this.maxViolations) {
      this.violations.splice(0, this.violations.length - this.maxViolations);
    }

    this.logger?.warn(`Violation recorded: ${fullViolation.id}`, {
      agentType: violation.agentType,
      projectId: violation.projectId,
      actionType: violation.action.type,
      severity: violation.severity,
      repeated: isRepeated,
      repeatCount,
    });

    return fullViolation;
  }

  /**
   * Get violations with optional filtering
   */
  async getViolations(filter?: ViolationFilter): Promise<PermissionViolation[]> {
    let results = [...this.violations];

    if (filter?.agentType) {
      results = results.filter((v) => v.agentType === filter.agentType);
    }

    if (filter?.projectId) {
      results = results.filter((v) => v.projectId === filter.projectId);
    }

    if (filter?.fromDate) {
      results = results.filter((v) => v.timestamp >= filter.fromDate!);
    }

    if (filter?.toDate) {
      results = results.filter((v) => v.timestamp <= filter.toDate!);
    }

    if (filter?.severity && filter.severity.length > 0) {
      results = results.filter((v) => filter.severity?.includes(v.severity));
    }

    // Sort by timestamp descending (most recent first), with ID tiebreaker for stability
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id.localeCompare(a.id));

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get the count of violations for an agent in a project within a time window
   */
  async getViolationCount(
    agentType: AgentType,
    projectId: string,
    hours = 1,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.violations.filter(
      (v) =>
        v.agentType === agentType &&
        v.projectId === projectId &&
        v.timestamp >= cutoff,
    ).length;
  }

  /**
   * Find recent similar violations (for detecting repeated offenses)
   */
  private findRecentSimilarViolations(
    agentType: AgentType,
    actionType: string,
    projectId: string,
  ): PermissionViolation[] {
    const cutoff = new Date(Date.now() - this.repeatThresholdMs);

    return this.violations.filter(
      (v) =>
        v.agentType === agentType &&
        v.action.type === actionType &&
        v.projectId === projectId &&
        v.timestamp >= cutoff,
    );
  }

  /**
   * Get violations by severity
   */
  async getViolationsBySeverity(
    severity: PermissionViolation['severity'],
  ): Promise<PermissionViolation[]> {
    return this.violations.filter((v) => v.severity === severity);
  }

  /**
   * Get violation statistics
   */
  getStats(): {
    total: number;
    bySeverity: Record<PermissionViolation['severity'], number>;
    byAgentType: Record<string, number>;
    repeated: number;
  } {
    const stats = {
      total: this.violations.length,
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      } as Record<PermissionViolation['severity'], number>,
      byAgentType: {} as Record<string, number>,
      repeated: 0,
    };

    for (const v of this.violations) {
      stats.bySeverity[v.severity]++;
      stats.byAgentType[v.agentType] = (stats.byAgentType[v.agentType] ?? 0) + 1;
      if (v.repeated) {
        stats.repeated++;
      }
    }

    return stats;
  }

  /**
   * Clear all violations (for testing)
   */
  clear(): void {
    this.violations.length = 0;
  }

  /**
   * Get the most recent violations
   */
  async getRecentViolations(count = 10): Promise<PermissionViolation[]> {
    return this.violations
      .slice()
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, count);
  }
}

/**
 * Create a violation recorder with the given options
 */
export function createViolationRecorder(
  options?: ViolationRecorderOptions,
): ViolationRecorder {
  return new ViolationRecorder(options);
}
