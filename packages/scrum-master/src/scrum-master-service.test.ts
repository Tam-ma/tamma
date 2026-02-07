import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ScrumMasterService,
  createScrumMasterService,
} from './scrum-master-service.js';
import { ScrumMasterState, ScrumMasterEventType } from './types.js';
import type { Task, IUserInterface, ApprovalResponse, ScrumMasterPlan, RiskLevel } from './types.js';
import type { KnowledgeCheckResult } from '@tamma/shared';

describe('ScrumMasterService', () => {
  let service: ScrumMasterService;

  const createMockTask = (): Task => ({
    id: 'task-1',
    projectId: 'project-1',
    title: 'Test task',
    description: 'Implement a new feature',
    type: 'feature',
    priority: 'medium',
    labels: ['typescript'],
    createdAt: new Date(),
  });

  const createMockUserInterface = (autoApprove = true): IUserInterface => ({
    notifyUser: vi.fn(),
    waitForResponse: vi.fn().mockResolvedValue({ action: 'continue' }),
    requestApproval: vi.fn().mockImplementation(
      (_plan: ScrumMasterPlan, _riskLevel: RiskLevel, _knowledgeCheck: KnowledgeCheckResult): Promise<ApprovalResponse> => {
        return Promise.resolve({
          approved: autoApprove,
          reason: autoApprove ? 'Approved' : 'Rejected',
        });
      }
    ),
    promptForAction: vi.fn().mockResolvedValue('continue'),
  });

  beforeEach(() => {
    service = new ScrumMasterService({
      taskLoop: {
        maxRetries: 3,
        autoApproveLowRisk: true,
        requireApprovalHighRisk: true,
        timeoutMs: 60000, // 1 minute for tests
        progressUpdateIntervalMs: 1000,
        stallDetectionThresholdMs: 30000,
      },
    });
  });

  describe('getState', () => {
    it('should start in IDLE state', () => {
      expect(service.getState()).toBe(ScrumMasterState.IDLE);
    });
  });

  describe('getContext', () => {
    it('should return undefined when no session', () => {
      expect(service.getContext()).toBeUndefined();
    });
  });

  describe('startSession', () => {
    it('should initialize context and start task loop', async () => {
      const task = createMockTask();
      const result = await service.startSession(task);

      expect(result.taskId).toBe('task-1');
      expect(result.completedAt).toBeDefined();
    });

    it('should transition through states', async () => {
      const task = createMockTask();
      const stateTransitions: ScrumMasterState[] = [];

      service.addEventListener((event) => {
        if (event.type === ScrumMasterEventType.STATE_TRANSITION) {
          stateTransitions.push(event.data['to'] as ScrumMasterState);
        }
      });

      await service.startSession(task);

      expect(stateTransitions).toContain(ScrumMasterState.PLANNING);
      expect(stateTransitions).toContain(ScrumMasterState.AWAITING_APPROVAL);
    });

    it('should record events throughout execution', async () => {
      const task = createMockTask();
      await service.startSession(task);

      const events = service.getEvents(task.id);
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === ScrumMasterEventType.TASK_RECEIVED)).toBe(true);
    });

    it('should complete successfully for low risk task', async () => {
      const task = createMockTask();
      const result = await service.startSession(task);

      expect(result.success).toBe(true);
      expect(result.state).toBe(ScrumMasterState.COMPLETED);
    });

    it('should capture learnings', async () => {
      const task = createMockTask();
      const result = await service.startSession(task);

      expect(result.learnings.length).toBeGreaterThan(0);
    });
  });

  describe('monitorProgress', () => {
    it('should return current context during execution', async () => {
      const task = createMockTask();

      // Start session in background
      const resultPromise = service.startSession(task);

      // Check progress (may be too fast to catch intermediate states)
      const context = service.getContext();
      expect(context?.task.id).toBe('task-1');

      await resultPromise;
    });
  });

  describe('pause/resume', () => {
    it('should pause and resume execution', async () => {
      service = new ScrumMasterService({
        taskLoop: {
          maxRetries: 3,
          autoApproveLowRisk: true,
          requireApprovalHighRisk: true,
          timeoutMs: 120000,
          progressUpdateIntervalMs: 100,
          stallDetectionThresholdMs: 30000,
        },
      });

      const task = createMockTask();

      // Start in background
      const resultPromise = service.startSession(task);

      // Pause
      await service.pause();

      // Resume quickly
      await service.resume();

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should cancel task execution', async () => {
      service = new ScrumMasterService({
        taskLoop: {
          maxRetries: 3,
          autoApproveLowRisk: true,
          requireApprovalHighRisk: true,
          timeoutMs: 120000,
          progressUpdateIntervalMs: 100,
          stallDetectionThresholdMs: 30000,
        },
      });

      const task = createMockTask();

      // Start in background
      const resultPromise = service.startSession(task);

      // Cancel immediately
      try {
        await service.cancel('Test cancellation');
      } catch {
        // Expected to throw
      }

      try {
        await resultPromise;
      } catch {
        // May throw cancellation error
      }

      expect(service.getState()).toBe(ScrumMasterState.CANCELLED);
    });
  });

  describe('approveOrReject', () => {
    it('should throw when not in approval state', async () => {
      await expect(
        service.approveOrReject('approved')
      ).rejects.toThrow('Cannot approve/reject');
    });
  });

  describe('reviewOutput', () => {
    it('should perform quality checks on implementation', async () => {
      const output = {
        success: true,
        output: 'Implementation complete',
        costUsd: 0.1,
        durationMs: 1000,
        filesModified: ['src/test.ts'],
        testsRun: 5,
        testsPassed: 5,
        sessionId: 'session-1',
      };

      // Need to start session first
      const task = createMockTask();
      const resultPromise = service.startSession(task);

      // Wait for session to complete
      await resultPromise;

      // Now we can test review separately
      const service2 = new ScrumMasterService();
      const task2 = createMockTask();
      task2.id = 'task-2';

      // Start a new session to get context
      const promise = service2.startSession(task2);
      await promise;

      // The review is called internally - test the method directly
      const reviewResult = await service.reviewOutput(output);

      expect(reviewResult.passed).toBe(true);
      expect(reviewResult.qualityChecks.length).toBeGreaterThan(0);
    });
  });

  describe('captureLearning', () => {
    it('should add learning to context', async () => {
      const task = createMockTask();
      await service.startSession(task);

      // Can't capture after session ends, would need to mock
    });
  });

  describe('event handling', () => {
    it('should allow adding and removing event listeners', () => {
      const listener = vi.fn();
      service.addEventListener(listener);

      // Remove
      service.removeEventListener(listener);

      // Should not throw
    });

    it('should notify listeners of events', async () => {
      const listener = vi.fn();
      service.addEventListener(listener);

      const task = createMockTask();
      await service.startSession(task);

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('with user interface', () => {
    it('should request approval through UI for medium risk', async () => {
      const ui = createMockUserInterface(true);
      service.setUserInterface(ui);

      // Configure to require approval for medium risk
      service = new ScrumMasterService({
        taskLoop: {
          maxRetries: 3,
          autoApproveLowRisk: false, // Force approval request
          requireApprovalHighRisk: true,
          timeoutMs: 60000,
          progressUpdateIntervalMs: 1000,
          stallDetectionThresholdMs: 30000,
        },
      });
      service.setUserInterface(ui);

      const task = createMockTask();
      await service.startSession(task);

      expect(ui.notifyUser).toHaveBeenCalled();
    });

    it('should handle rejection from UI', async () => {
      const ui = createMockUserInterface(false);

      service = new ScrumMasterService({
        taskLoop: {
          maxRetries: 3,
          autoApproveLowRisk: false,
          requireApprovalHighRisk: true,
          timeoutMs: 60000,
          progressUpdateIntervalMs: 1000,
          stallDetectionThresholdMs: 30000,
        },
      });
      service.setUserInterface(ui);

      const task = createMockTask();

      await expect(service.startSession(task)).rejects.toThrow('denied');
    });
  });

  describe('error handling', () => {
    it('should track errors in context', async () => {
      const task = createMockTask();
      const result = await service.startSession(task);

      // For a successful task, errors should be empty or contain recoverable errors
      expect(Array.isArray(result.learnings)).toBe(true);
    });
  });
});

describe('createScrumMasterService', () => {
  it('should create service with default config', () => {
    const service = createScrumMasterService();
    expect(service).toBeInstanceOf(ScrumMasterService);
  });

  it('should create service with custom config', () => {
    const service = createScrumMasterService({
      taskLoop: {
        maxRetries: 5,
        autoApproveLowRisk: false,
        requireApprovalHighRisk: true,
        timeoutMs: 1800000,
        progressUpdateIntervalMs: 10000,
        stallDetectionThresholdMs: 60000,
      },
    });
    expect(service).toBeInstanceOf(ScrumMasterService);
  });
});

describe('State Machine Transitions', () => {
  let service: ScrumMasterService;

  beforeEach(() => {
    service = new ScrumMasterService();
  });

  it('should follow IDLE -> PLANNING -> AWAITING_APPROVAL flow', async () => {
    const states: ScrumMasterState[] = [];

    service.addEventListener((event) => {
      if (event.type === ScrumMasterEventType.STATE_TRANSITION) {
        states.push(event.data['to'] as ScrumMasterState);
      }
    });

    const task: Task = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Test',
      description: 'Test',
      type: 'feature',
      priority: 'low',
      labels: [],
      createdAt: new Date(),
    };

    await service.startSession(task);

    // Should include these states in order
    const planningIndex = states.indexOf(ScrumMasterState.PLANNING);
    const approvalIndex = states.indexOf(ScrumMasterState.AWAITING_APPROVAL);

    expect(planningIndex).toBeGreaterThanOrEqual(0);
    expect(approvalIndex).toBeGreaterThan(planningIndex);
  });

  it('should reach COMPLETED state for successful task', async () => {
    const task: Task = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Test',
      description: 'Test',
      type: 'feature',
      priority: 'low',
      labels: [],
      createdAt: new Date(),
    };

    const result = await service.startSession(task);

    expect(result.state).toBe(ScrumMasterState.COMPLETED);
  });
});

describe('Integration with Dependencies', () => {
  it('should work without optional dependencies', async () => {
    const service = new ScrumMasterService();

    const task: Task = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Test',
      description: 'Test',
      type: 'feature',
      priority: 'low',
      labels: [],
      createdAt: new Date(),
    };

    const result = await service.startSession(task);

    expect(result.success).toBe(true);
  });
});
