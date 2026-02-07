/**
 * Scrum Master Error Types
 * @module @tamma/scrum-master/errors
 */

import type { ScrumMasterState, BlockerType } from './types.js';

/**
 * Base error for Scrum Master operations
 */
export class ScrumMasterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ScrumMasterError';
  }
}

/**
 * Error thrown when a state transition is invalid
 */
export class InvalidStateTransitionError extends ScrumMasterError {
  constructor(
    public readonly fromState: ScrumMasterState,
    public readonly toState: ScrumMasterState,
    public readonly reason?: string
  ) {
    super(
      `Invalid state transition from ${fromState} to ${toState}${reason ? `: ${reason}` : ''}`,
      'INVALID_STATE_TRANSITION',
      false,
      { fromState, toState, reason }
    );
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Error thrown when task execution is blocked
 */
export class TaskBlockedError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly blockerType: BlockerType,
    message: string
  ) {
    super(message, 'TASK_BLOCKED', true, { taskId, blockerType });
    this.name = 'TaskBlockedError';
  }
}

/**
 * Error thrown when approval is denied
 */
export class ApprovalDeniedError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly reason: string
  ) {
    super(`Approval denied for task ${taskId}: ${reason}`, 'APPROVAL_DENIED', false, {
      taskId,
      reason,
    });
    this.name = 'ApprovalDeniedError';
  }
}

/**
 * Error thrown when max retries exceeded
 */
export class MaxRetriesExceededError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly retryCount: number,
    public readonly maxRetries: number
  ) {
    super(
      `Max retries (${maxRetries}) exceeded for task ${taskId}`,
      'MAX_RETRIES_EXCEEDED',
      false,
      { taskId, retryCount, maxRetries }
    );
    this.name = 'MaxRetriesExceededError';
  }
}

/**
 * Error thrown when task times out
 */
export class TaskTimeoutError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number
  ) {
    super(
      `Task ${taskId} timed out after ${elapsedMs}ms (limit: ${timeoutMs}ms)`,
      'TASK_TIMEOUT',
      true,
      { taskId, timeoutMs, elapsedMs }
    );
    this.name = 'TaskTimeoutError';
  }
}

/**
 * Error thrown when cost limit is exceeded
 */
export class CostLimitExceededError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly currentCostUsd: number,
    public readonly limitUsd: number
  ) {
    super(
      `Cost limit exceeded for task ${taskId}: $${currentCostUsd.toFixed(4)} (limit: $${limitUsd.toFixed(2)})`,
      'COST_LIMIT_EXCEEDED',
      false,
      { taskId, currentCostUsd, limitUsd }
    );
    this.name = 'CostLimitExceededError';
  }
}

/**
 * Error thrown when implementation fails
 */
export class ImplementationFailedError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    message: string,
    public readonly output?: string
  ) {
    super(`Implementation failed for task ${taskId}: ${message}`, 'IMPLEMENTATION_FAILED', true, {
      taskId,
      output,
    });
    this.name = 'ImplementationFailedError';
  }
}

/**
 * Error thrown when review fails
 */
export class ReviewFailedError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly issues: string[],
    public readonly score: number
  ) {
    super(
      `Review failed for task ${taskId} (score: ${score}): ${issues.join(', ')}`,
      'REVIEW_FAILED',
      true,
      { taskId, issues, score }
    );
    this.name = 'ReviewFailedError';
  }
}

/**
 * Error thrown when no engine is available
 */
export class NoEngineAvailableError extends ScrumMasterError {
  constructor(public readonly projectId: string) {
    super(
      `No engine available for project ${projectId}`,
      'NO_ENGINE_AVAILABLE',
      true,
      { projectId }
    );
    this.name = 'NoEngineAvailableError';
  }
}

/**
 * Error thrown when permission is denied
 */
export class PermissionDeniedError extends ScrumMasterError {
  constructor(
    public readonly agentType: string,
    public readonly resource: string,
    public readonly action: string
  ) {
    super(
      `Permission denied: ${agentType} cannot ${action} ${resource}`,
      'PERMISSION_DENIED',
      false,
      { agentType, resource, action }
    );
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Error thrown when task is cancelled
 */
export class TaskCancelledError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly reason: string
  ) {
    super(`Task ${taskId} was cancelled: ${reason}`, 'TASK_CANCELLED', false, {
      taskId,
      reason,
    });
    this.name = 'TaskCancelledError';
  }
}

/**
 * Error thrown when task escalation is required
 */
export class EscalationRequiredError extends ScrumMasterError {
  constructor(
    public readonly taskId: string,
    public readonly reason: string
  ) {
    super(`Task ${taskId} requires escalation: ${reason}`, 'ESCALATION_REQUIRED', false, {
      taskId,
      reason,
    });
    this.name = 'EscalationRequiredError';
  }
}
