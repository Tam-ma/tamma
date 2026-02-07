import { describe, it, expect, beforeEach } from 'vitest';
import { TaskSupervisor, createTaskSupervisor } from './task-supervisor.js';
import { ScrumMasterState } from '../types.js';
import type { TaskLoopContext, Task } from '../types.js';

describe('TaskSupervisor', () => {
  let supervisor: TaskSupervisor;
  let mockContext: TaskLoopContext;

  const createMockTask = (): Task => ({
    id: 'task-1',
    projectId: 'project-1',
    title: 'Test task',
    description: 'Test description',
    type: 'feature',
    priority: 'medium',
    labels: [],
    createdAt: new Date(),
  });

  const createMockContext = (): TaskLoopContext => ({
    task: createMockTask(),
    learnings: [],
    blockers: [],
    retryCount: 0,
    maxRetries: 3,
    startTime: new Date(),
    errors: [],
    costBudgetUsd: 10,
    currentCostUsd: 0,
  });

  beforeEach(() => {
    supervisor = new TaskSupervisor();
    mockContext = createMockContext();
  });

  describe('startMonitoring', () => {
    it('should initialize monitoring state', () => {
      supervisor.startMonitoring(mockContext);
      const status = supervisor.getStatus();

      expect(status.isMonitoring).toBe(true);
      expect(status.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(status.unresolvedBlockers).toBe(0);
    });

    it('should copy existing blockers', () => {
      mockContext.blockers = [
        {
          id: 'blocker-1',
          type: 'permission_denied',
          message: 'Test blocker',
          taskId: 'task-1',
          timestamp: new Date(),
          resolved: false,
          escalated: false,
        },
      ];
      supervisor.startMonitoring(mockContext);

      expect(supervisor.getBlockers().length).toBe(1);
    });
  });

  describe('stopMonitoring', () => {
    it('should clear monitoring state', () => {
      supervisor.startMonitoring(mockContext);
      supervisor.stopMonitoring();
      const status = supervisor.getStatus();

      expect(status.isMonitoring).toBe(false);
      expect(status.unresolvedBlockers).toBe(0);
    });
  });

  describe('addBlocker', () => {
    it('should add a blocker with generated ID', () => {
      supervisor.startMonitoring(mockContext);
      const blocker = supervisor.addBlocker(
        'permission_denied',
        'Test blocker',
        'task-1'
      );

      expect(blocker.id).toBeDefined();
      expect(blocker.type).toBe('permission_denied');
      expect(blocker.message).toBe('Test blocker');
      expect(blocker.resolved).toBe(false);
      expect(blocker.escalated).toBe(false);
    });

    it('should track unresolved blockers', () => {
      supervisor.startMonitoring(mockContext);
      supervisor.addBlocker('permission_denied', 'Blocker 1', 'task-1');
      supervisor.addBlocker('timeout', 'Blocker 2', 'task-1');

      expect(supervisor.getUnresolvedBlockers().length).toBe(2);
    });
  });

  describe('resolveBlocker', () => {
    it('should mark blocker as resolved', () => {
      supervisor.startMonitoring(mockContext);
      const blocker = supervisor.addBlocker(
        'permission_denied',
        'Test blocker',
        'task-1'
      );

      supervisor.resolveBlocker(blocker.id, 'Fixed the issue');

      const resolved = supervisor.getBlockers().find((b) => b.id === blocker.id);
      expect(resolved?.resolved).toBe(true);
      expect(resolved?.resolution).toBe('Fixed the issue');
      expect(resolved?.resolvedAt).toBeDefined();
    });

    it('should reduce unresolved blocker count', () => {
      supervisor.startMonitoring(mockContext);
      const blocker = supervisor.addBlocker(
        'permission_denied',
        'Test blocker',
        'task-1'
      );

      expect(supervisor.getUnresolvedBlockers().length).toBe(1);

      supervisor.resolveBlocker(blocker.id, 'Fixed');

      expect(supervisor.getUnresolvedBlockers().length).toBe(0);
    });
  });

  describe('checkForStall', () => {
    it('should return false when activity is recent', () => {
      supervisor.startMonitoring(mockContext);
      supervisor.recordActivity();

      expect(supervisor.checkForStall()).toBe(false);
    });

    it('should return false when not monitoring', () => {
      expect(supervisor.checkForStall()).toBe(false);
    });
  });

  describe('shouldEscalate', () => {
    it('should not escalate initially', () => {
      supervisor.startMonitoring(mockContext);

      expect(supervisor.shouldEscalate()).toBe(false);
    });

    it('should escalate after too many failures', () => {
      supervisor = new TaskSupervisor({
        escalation: {
          escalateAfterFailures: 2,
          escalateAfterBlockers: 5,
          escalateAfterTimeoutMs: 3600000,
        },
      });
      supervisor.startMonitoring(mockContext);

      supervisor.recordFailure();
      supervisor.recordFailure();

      expect(supervisor.shouldEscalate()).toBe(true);
    });

    it('should escalate after too many unresolved blockers', () => {
      supervisor = new TaskSupervisor({
        escalation: {
          escalateAfterFailures: 5,
          escalateAfterBlockers: 2,
          escalateAfterTimeoutMs: 3600000,
        },
      });
      supervisor.startMonitoring(mockContext);

      supervisor.addBlocker('permission_denied', 'Blocker 1', 'task-1');
      supervisor.addBlocker('timeout', 'Blocker 2', 'task-1');

      expect(supervisor.shouldEscalate()).toBe(true);
    });
  });

  describe('getEscalationReason', () => {
    it('should return null when no escalation needed', () => {
      supervisor.startMonitoring(mockContext);

      expect(supervisor.getEscalationReason()).toBeNull();
    });

    it('should return reason for failures', () => {
      supervisor = new TaskSupervisor({
        escalation: {
          escalateAfterFailures: 1,
          escalateAfterBlockers: 5,
          escalateAfterTimeoutMs: 3600000,
        },
      });
      supervisor.startMonitoring(mockContext);
      supervisor.recordFailure();

      expect(supervisor.getEscalationReason()).toContain('consecutive failures');
    });
  });

  describe('getTimeoutStatus', () => {
    it('should return timeout status', () => {
      supervisor.startMonitoring(mockContext);
      const status = supervisor.getTimeoutStatus();

      expect(status.timedOut).toBe(false);
      expect(status.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(status.remainingMs).toBeGreaterThan(0);
    });
  });

  describe('shouldRetry', () => {
    it('should return true when retries available', () => {
      supervisor.startMonitoring(mockContext);

      expect(supervisor.shouldRetry()).toBe(true);
    });

    it('should return false when retries exhausted', () => {
      mockContext.retryCount = 3;
      mockContext.maxRetries = 3;
      supervisor.startMonitoring(mockContext);

      expect(supervisor.shouldRetry()).toBe(false);
    });
  });

  describe('analyzeStateTransition', () => {
    beforeEach(() => {
      supervisor.startMonitoring(mockContext);
    });

    it('should validate valid transitions', () => {
      const result = supervisor.analyzeStateTransition(
        ScrumMasterState.IDLE,
        ScrumMasterState.PLANNING
      );

      expect(result.valid).toBe(true);
    });

    it('should invalidate invalid transitions', () => {
      const result = supervisor.analyzeStateTransition(
        ScrumMasterState.IDLE,
        ScrumMasterState.COMPLETED
      );

      expect(result.valid).toBe(false);
      expect(result.warning).toContain('Invalid transition');
    });

    it('should warn on blocked state', () => {
      const result = supervisor.analyzeStateTransition(
        ScrumMasterState.PLANNING,
        ScrumMasterState.BLOCKED
      );

      expect(result.valid).toBe(true);
      expect(result.warning).toContain('blocked');
    });

    it('should validate planning to approval', () => {
      const result = supervisor.analyzeStateTransition(
        ScrumMasterState.PLANNING,
        ScrumMasterState.AWAITING_APPROVAL
      );

      expect(result.valid).toBe(true);
    });

    it('should validate review to learning', () => {
      const result = supervisor.analyzeStateTransition(
        ScrumMasterState.REVIEWING,
        ScrumMasterState.LEARNING
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return comprehensive status', () => {
      supervisor.startMonitoring(mockContext);
      supervisor.addBlocker('timeout', 'Test', 'task-1');
      supervisor.recordFailure();

      const status = supervisor.getStatus();

      expect(status.isMonitoring).toBe(true);
      expect(status.unresolvedBlockers).toBe(1);
      expect(status.consecutiveFailures).toBe(1);
      expect(status.isStalled).toBe(false);
      expect(status.timeoutStatus).toBeDefined();
    });
  });
});

describe('createTaskSupervisor', () => {
  it('should create a supervisor with default config', () => {
    const supervisor = createTaskSupervisor();
    expect(supervisor).toBeInstanceOf(TaskSupervisor);
  });

  it('should create a supervisor with custom config', () => {
    const supervisor = createTaskSupervisor({
      taskLoop: {
        maxRetries: 5,
        autoApproveLowRisk: false,
        requireApprovalHighRisk: true,
        timeoutMs: 1800000,
        progressUpdateIntervalMs: 10000,
        stallDetectionThresholdMs: 60000,
      },
    });
    expect(supervisor).toBeInstanceOf(TaskSupervisor);
  });
});
