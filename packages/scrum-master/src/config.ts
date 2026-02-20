/**
 * Scrum Master Configuration
 * @module @tamma/scrum-master/config
 */

import type { RiskLevel } from './types.js';

// ============================================
// Configuration Types
// ============================================

export interface TaskLoopConfig {
  /** Maximum retry attempts for failed tasks */
  maxRetries: number;
  /** Auto-approve low risk tasks without human intervention */
  autoApproveLowRisk: boolean;
  /** Always require approval for high risk tasks */
  requireApprovalHighRisk: boolean;
  /** Maximum time for task execution (ms) */
  timeoutMs: number;
  /** Interval for progress updates (ms) */
  progressUpdateIntervalMs: number;
  /** Stall detection threshold (ms) */
  stallDetectionThresholdMs: number;
}

export interface RiskThreshold {
  maxFiles: number;
  maxComplexity: 'low' | 'medium' | 'high';
  maxEstimatedCostUsd: number;
  maxLinesChanged: number;
}

export interface RiskThresholdConfig {
  low: RiskThreshold;
  medium: RiskThreshold;
}

export interface LearningCaptureConfig {
  /** Capture learnings from successful tasks */
  captureSuccess: boolean;
  /** Capture learnings from failed tasks */
  captureFailure: boolean;
  /** Require human approval for captured learnings */
  requireApproval: boolean;
  /** Minimum relevance score for learning capture */
  minRelevanceScore: number;
}

export type AlertChannelType = 'cli' | 'webhook' | 'slack' | 'email';

export interface AlertChannel {
  type: AlertChannelType;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface AlertConfig {
  /** Alert on task blocked */
  onBlock: boolean;
  /** Alert on max retries exceeded */
  onMaxRetries: boolean;
  /** Alert on approval needed */
  onApprovalNeeded: boolean;
  /** Alert on review failed */
  onReviewFailed: boolean;
  /** Alert on cost limit warning */
  onCostLimitWarning: boolean;
  /** Configured alert channels */
  channels: AlertChannel[];
}

export interface UserInteractionConfig {
  /** Send proactive status updates */
  proactiveUpdates: boolean;
  /** Interval between status updates (seconds) */
  updateIntervalSeconds: number;
  /** Timeout for waiting for user response (minutes) */
  autoTimeoutMinutes: number;
}

export interface CostConfig {
  /** Default budget per task (USD) */
  defaultTaskBudgetUsd: number;
  /** Warning threshold percentage */
  warningThresholdPercent: number;
}

export interface EscalationConfig {
  /** Escalate after this many consecutive failures */
  escalateAfterFailures: number;
  /** Escalate after this many blockers */
  escalateAfterBlockers: number;
  /** Escalate after this timeout (ms) */
  escalateAfterTimeoutMs: number;
}

// ============================================
// Main Configuration
// ============================================

export interface ScrumMasterConfig {
  taskLoop: TaskLoopConfig;
  riskThresholds: RiskThresholdConfig;
  learningCapture: LearningCaptureConfig;
  alerts: AlertConfig;
  userInteraction: UserInteractionConfig;
  cost: CostConfig;
  escalation: EscalationConfig;
}

// ============================================
// Default Configuration
// ============================================

export const DEFAULT_SCRUM_MASTER_CONFIG: ScrumMasterConfig = {
  taskLoop: {
    maxRetries: 3,
    autoApproveLowRisk: true,
    requireApprovalHighRisk: true,
    timeoutMs: 3600000, // 1 hour
    progressUpdateIntervalMs: 30000, // 30 seconds
    stallDetectionThresholdMs: 300000, // 5 minutes
  },
  riskThresholds: {
    low: {
      maxFiles: 5,
      maxComplexity: 'low',
      maxEstimatedCostUsd: 1.0,
      maxLinesChanged: 200,
    },
    medium: {
      maxFiles: 10,
      maxComplexity: 'medium',
      maxEstimatedCostUsd: 5.0,
      maxLinesChanged: 500,
    },
  },
  learningCapture: {
    captureSuccess: true,
    captureFailure: true,
    requireApproval: true,
    minRelevanceScore: 0.7,
  },
  alerts: {
    onBlock: true,
    onMaxRetries: true,
    onApprovalNeeded: true,
    onReviewFailed: true,
    onCostLimitWarning: true,
    channels: [{ type: 'cli', enabled: true }],
  },
  userInteraction: {
    proactiveUpdates: true,
    updateIntervalSeconds: 30,
    autoTimeoutMinutes: 60,
  },
  cost: {
    defaultTaskBudgetUsd: 10.0,
    warningThresholdPercent: 80,
  },
  escalation: {
    escalateAfterFailures: 3,
    escalateAfterBlockers: 2,
    escalateAfterTimeoutMs: 1800000, // 30 minutes
  },
};

// ============================================
// Configuration Helpers
// ============================================

/**
 * Merge partial config with defaults
 */
export function mergeConfig(
  partial?: Partial<ScrumMasterConfig>
): ScrumMasterConfig {
  if (!partial) {
    return DEFAULT_SCRUM_MASTER_CONFIG;
  }

  return {
    taskLoop: { ...DEFAULT_SCRUM_MASTER_CONFIG.taskLoop, ...partial.taskLoop },
    riskThresholds: {
      low: {
        ...DEFAULT_SCRUM_MASTER_CONFIG.riskThresholds.low,
        ...partial.riskThresholds?.low,
      },
      medium: {
        ...DEFAULT_SCRUM_MASTER_CONFIG.riskThresholds.medium,
        ...partial.riskThresholds?.medium,
      },
    },
    learningCapture: {
      ...DEFAULT_SCRUM_MASTER_CONFIG.learningCapture,
      ...partial.learningCapture,
    },
    alerts: { ...DEFAULT_SCRUM_MASTER_CONFIG.alerts, ...partial.alerts },
    userInteraction: {
      ...DEFAULT_SCRUM_MASTER_CONFIG.userInteraction,
      ...partial.userInteraction,
    },
    cost: { ...DEFAULT_SCRUM_MASTER_CONFIG.cost, ...partial.cost },
    escalation: {
      ...DEFAULT_SCRUM_MASTER_CONFIG.escalation,
      ...partial.escalation,
    },
  };
}

/**
 * Get risk level based on config thresholds
 */
export function getRiskLevelFromConfig(
  config: ScrumMasterConfig,
  fileCount: number,
  complexity: 'low' | 'medium' | 'high',
  estimatedCostUsd: number,
  linesChanged: number
): RiskLevel {
  const { low, medium } = config.riskThresholds;

  // Check if within low risk thresholds
  if (
    fileCount <= low.maxFiles &&
    (complexity === 'low' ||
      (complexity === 'medium' && low.maxComplexity !== 'low')) &&
    estimatedCostUsd <= low.maxEstimatedCostUsd &&
    linesChanged <= low.maxLinesChanged
  ) {
    return 'low';
  }

  // Check if within medium risk thresholds
  if (
    fileCount <= medium.maxFiles &&
    complexity !== 'high' &&
    estimatedCostUsd <= medium.maxEstimatedCostUsd &&
    linesChanged <= medium.maxLinesChanged
  ) {
    return 'medium';
  }

  return 'high';
}
