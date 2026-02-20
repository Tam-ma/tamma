/**
 * Task Supervisor Service
 *
 * Monitors agent state transitions, detects stalls and blockers,
 * handles escalation rules and timeout handling.
 *
 * @module @tamma/scrum-master/services/task-supervisor
 */

import { nanoid } from 'nanoid';
import { ScrumMasterState } from '../types.js';
import type {
  TaskLoopContext,
  Blocker,
  BlockerType,
  ITaskSupervisor,
} from '../types.js';
import type { ScrumMasterConfig } from '../config.js';
import { DEFAULT_SCRUM_MASTER_CONFIG } from '../config.js';

export class TaskSupervisor implements ITaskSupervisor {
  private context: TaskLoopContext | null = null;
  private lastActivityTime: Date | null = null;
  private blockers: Blocker[] = [];
  private consecutiveFailures = 0;
  private config: ScrumMasterConfig;

  constructor(config?: Partial<ScrumMasterConfig>) {
    this.config = { ...DEFAULT_SCRUM_MASTER_CONFIG, ...config };
  }

  /**
   * Start monitoring a task
   */
  startMonitoring(context: TaskLoopContext): void {
    this.context = context;
    this.lastActivityTime = new Date();
    this.blockers = [...context.blockers];
    this.consecutiveFailures = 0;
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.context = null;
    this.lastActivityTime = null;
    this.blockers = [];
    this.consecutiveFailures = 0;
  }

  /**
   * Record activity (resets stall detection)
   */
  recordActivity(): void {
    this.lastActivityTime = new Date();
  }

  /**
   * Record a failure (for escalation tracking)
   */
  recordFailure(): void {
    this.consecutiveFailures++;
  }

  /**
   * Reset failure counter
   */
  resetFailures(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Check if the task has stalled
   */
  checkForStall(): boolean {
    if (!this.lastActivityTime) {
      return false;
    }

    const elapsed = Date.now() - this.lastActivityTime.getTime();
    return elapsed > this.config.taskLoop.stallDetectionThresholdMs;
  }

  /**
   * Get elapsed time since monitoring started
   */
  getElapsedMs(): number {
    if (!this.context) {
      return 0;
    }
    return Date.now() - this.context.startTime.getTime();
  }

  /**
   * Add a blocker
   */
  addBlocker(
    type: BlockerType,
    message: string,
    taskId: string
  ): Blocker {
    const blocker: Blocker = {
      id: nanoid(),
      type,
      message,
      taskId,
      timestamp: new Date(),
      resolved: false,
      escalated: false,
    };
    this.blockers.push(blocker);
    return blocker;
  }

  /**
   * Get all detected blockers
   */
  getBlockers(): Blocker[] {
    return [...this.blockers];
  }

  /**
   * Get unresolved blockers
   */
  getUnresolvedBlockers(): Blocker[] {
    return this.blockers.filter((b) => !b.resolved);
  }

  /**
   * Resolve a blocker
   */
  resolveBlocker(blockerId: string, resolution: string): void {
    const blocker = this.blockers.find((b) => b.id === blockerId);
    if (blocker) {
      blocker.resolved = true;
      blocker.resolvedAt = new Date();
      blocker.resolution = resolution;
    }
  }

  /**
   * Mark a blocker as escalated
   */
  escalateBlocker(blockerId: string): void {
    const blocker = this.blockers.find((b) => b.id === blockerId);
    if (blocker) {
      blocker.escalated = true;
    }
  }

  /**
   * Check if escalation is needed
   */
  shouldEscalate(): boolean {
    // Escalate after too many consecutive failures
    if (this.consecutiveFailures >= this.config.escalation.escalateAfterFailures) {
      return true;
    }

    // Escalate after too many unresolved blockers
    const unresolvedBlockers = this.getUnresolvedBlockers();
    if (unresolvedBlockers.length >= this.config.escalation.escalateAfterBlockers) {
      return true;
    }

    // Escalate after timeout
    const elapsed = this.getElapsedMs();
    if (elapsed >= this.config.escalation.escalateAfterTimeoutMs) {
      return true;
    }

    return false;
  }

  /**
   * Get escalation reason
   */
  getEscalationReason(): string | null {
    if (this.consecutiveFailures >= this.config.escalation.escalateAfterFailures) {
      return `Too many consecutive failures: ${this.consecutiveFailures}`;
    }

    const unresolvedBlockers = this.getUnresolvedBlockers();
    if (unresolvedBlockers.length >= this.config.escalation.escalateAfterBlockers) {
      return `Too many unresolved blockers: ${unresolvedBlockers.length}`;
    }

    const elapsed = this.getElapsedMs();
    if (elapsed >= this.config.escalation.escalateAfterTimeoutMs) {
      return `Task running too long: ${Math.round(elapsed / 1000)}s`;
    }

    return null;
  }

  /**
   * Get timeout status
   */
  getTimeoutStatus(): {
    timedOut: boolean;
    elapsedMs: number;
    remainingMs: number;
  } {
    const elapsedMs = this.getElapsedMs();
    const timeoutMs = this.config.taskLoop.timeoutMs;
    const remainingMs = Math.max(0, timeoutMs - elapsedMs);
    const timedOut = elapsedMs >= timeoutMs;

    return { timedOut, elapsedMs, remainingMs };
  }

  /**
   * Check if the task should be retried
   */
  shouldRetry(): boolean {
    if (!this.context) {
      return false;
    }
    return this.context.retryCount < this.context.maxRetries;
  }

  /**
   * Get retry info
   */
  getRetryInfo(): { current: number; max: number; remaining: number } {
    if (!this.context) {
      return { current: 0, max: 0, remaining: 0 };
    }
    return {
      current: this.context.retryCount,
      max: this.context.maxRetries,
      remaining: this.context.maxRetries - this.context.retryCount,
    };
  }

  /**
   * Analyze state transition for issues
   */
  analyzeStateTransition(
    fromState: ScrumMasterState,
    toState: ScrumMasterState
  ): {
    valid: boolean;
    warning?: string;
  } {
    // Record activity on any state transition
    this.recordActivity();

    // Define valid transitions
    const validTransitions: Record<ScrumMasterState, ScrumMasterState[]> = {
      [ScrumMasterState.IDLE]: [ScrumMasterState.PLANNING, ScrumMasterState.CANCELLED],
      [ScrumMasterState.PLANNING]: [
        ScrumMasterState.AWAITING_APPROVAL,
        ScrumMasterState.BLOCKED,
        ScrumMasterState.FAILED,
        ScrumMasterState.CANCELLED,
      ],
      [ScrumMasterState.AWAITING_APPROVAL]: [
        ScrumMasterState.IMPLEMENTING,
        ScrumMasterState.PLANNING, // Revision requested
        ScrumMasterState.BLOCKED,
        ScrumMasterState.CANCELLED,
      ],
      [ScrumMasterState.IMPLEMENTING]: [
        ScrumMasterState.REVIEWING,
        ScrumMasterState.BLOCKED,
        ScrumMasterState.FAILED,
        ScrumMasterState.CANCELLED,
      ],
      [ScrumMasterState.REVIEWING]: [
        ScrumMasterState.LEARNING,
        ScrumMasterState.PLANNING, // Review failed, retry
        ScrumMasterState.BLOCKED,
        ScrumMasterState.FAILED,
        ScrumMasterState.CANCELLED,
      ],
      [ScrumMasterState.LEARNING]: [
        ScrumMasterState.COMPLETED,
        ScrumMasterState.BLOCKED,
        ScrumMasterState.CANCELLED,
      ],
      [ScrumMasterState.BLOCKED]: [
        ScrumMasterState.PLANNING,
        ScrumMasterState.IMPLEMENTING,
        ScrumMasterState.ESCALATED,
        ScrumMasterState.CANCELLED,
        ScrumMasterState.FAILED,
      ],
      [ScrumMasterState.ESCALATED]: [
        ScrumMasterState.PLANNING,
        ScrumMasterState.CANCELLED,
        ScrumMasterState.FAILED,
      ],
      [ScrumMasterState.COMPLETED]: [],
      [ScrumMasterState.CANCELLED]: [],
      [ScrumMasterState.FAILED]: [],
    };

    const allowedStates = validTransitions[fromState];
    if (!allowedStates) {
      return { valid: false, warning: `Unknown state: ${fromState}` };
    }

    const valid = allowedStates.includes(toState);

    let warning: string | undefined;
    if (!valid) {
      warning = `Invalid transition from ${fromState} to ${toState}`;
    } else if (toState === ScrumMasterState.BLOCKED) {
      warning = 'Task entering blocked state';
    } else if (toState === ScrumMasterState.ESCALATED) {
      warning = 'Task being escalated';
    }

    return { valid, warning };
  }

  /**
   * Get supervisor status summary
   */
  getStatus(): {
    isMonitoring: boolean;
    elapsedMs: number;
    unresolvedBlockers: number;
    consecutiveFailures: number;
    isStalled: boolean;
    shouldEscalate: boolean;
    timeoutStatus: {
      timedOut: boolean;
      elapsedMs: number;
      remainingMs: number;
    };
  } {
    return {
      isMonitoring: this.context !== null,
      elapsedMs: this.getElapsedMs(),
      unresolvedBlockers: this.getUnresolvedBlockers().length,
      consecutiveFailures: this.consecutiveFailures,
      isStalled: this.checkForStall(),
      shouldEscalate: this.shouldEscalate(),
      timeoutStatus: this.getTimeoutStatus(),
    };
  }
}

/**
 * Create a task supervisor with optional config
 */
export function createTaskSupervisor(
  config?: Partial<ScrumMasterConfig>
): TaskSupervisor {
  return new TaskSupervisor(config);
}
