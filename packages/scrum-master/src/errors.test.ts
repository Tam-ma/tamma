import { describe, it, expect } from 'vitest';
import {
  ScrumMasterError,
  InvalidStateTransitionError,
  TaskBlockedError,
  ApprovalDeniedError,
  MaxRetriesExceededError,
  TaskTimeoutError,
  CostLimitExceededError,
  ImplementationFailedError,
  ReviewFailedError,
  NoEngineAvailableError,
  PermissionDeniedError,
  TaskCancelledError,
  EscalationRequiredError,
} from './errors.js';
import { ScrumMasterState } from './types.js';

describe('ScrumMasterError', () => {
  it('should create error with code and context', () => {
    const error = new ScrumMasterError(
      'Test error',
      'TEST_ERROR',
      true,
      { key: 'value' }
    );

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ key: 'value' });
    expect(error.name).toBe('ScrumMasterError');
  });
});

describe('InvalidStateTransitionError', () => {
  it('should create error with state info', () => {
    const error = new InvalidStateTransitionError(
      ScrumMasterState.IDLE,
      ScrumMasterState.COMPLETED,
      'Not allowed'
    );

    expect(error.fromState).toBe(ScrumMasterState.IDLE);
    expect(error.toState).toBe(ScrumMasterState.COMPLETED);
    expect(error.message).toContain('IDLE');
    expect(error.message).toContain('COMPLETED');
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect(error.recoverable).toBe(false);
  });

  it('should work without reason', () => {
    const error = new InvalidStateTransitionError(
      ScrumMasterState.IDLE,
      ScrumMasterState.COMPLETED
    );

    expect(error.message).not.toContain(':');
  });
});

describe('TaskBlockedError', () => {
  it('should create error with blocker info', () => {
    const error = new TaskBlockedError(
      'task-1',
      'permission_denied',
      'Access denied'
    );

    expect(error.taskId).toBe('task-1');
    expect(error.blockerType).toBe('permission_denied');
    expect(error.code).toBe('TASK_BLOCKED');
    expect(error.recoverable).toBe(true);
  });
});

describe('ApprovalDeniedError', () => {
  it('should create error with denial info', () => {
    const error = new ApprovalDeniedError('task-1', 'Too risky');

    expect(error.taskId).toBe('task-1');
    expect(error.reason).toBe('Too risky');
    expect(error.message).toContain('Too risky');
    expect(error.code).toBe('APPROVAL_DENIED');
    expect(error.recoverable).toBe(false);
  });
});

describe('MaxRetriesExceededError', () => {
  it('should create error with retry info', () => {
    const error = new MaxRetriesExceededError('task-1', 3, 3);

    expect(error.taskId).toBe('task-1');
    expect(error.retryCount).toBe(3);
    expect(error.maxRetries).toBe(3);
    expect(error.message).toContain('3');
    expect(error.code).toBe('MAX_RETRIES_EXCEEDED');
  });
});

describe('TaskTimeoutError', () => {
  it('should create error with timeout info', () => {
    const error = new TaskTimeoutError('task-1', 60000, 65000);

    expect(error.taskId).toBe('task-1');
    expect(error.timeoutMs).toBe(60000);
    expect(error.elapsedMs).toBe(65000);
    expect(error.message).toContain('65000');
    expect(error.code).toBe('TASK_TIMEOUT');
    expect(error.recoverable).toBe(true);
  });
});

describe('CostLimitExceededError', () => {
  it('should create error with cost info', () => {
    const error = new CostLimitExceededError('task-1', 15.5, 10.0);

    expect(error.taskId).toBe('task-1');
    expect(error.currentCostUsd).toBe(15.5);
    expect(error.limitUsd).toBe(10.0);
    expect(error.message).toContain('$15.5');
    expect(error.code).toBe('COST_LIMIT_EXCEEDED');
    expect(error.recoverable).toBe(false);
  });
});

describe('ImplementationFailedError', () => {
  it('should create error with implementation info', () => {
    const error = new ImplementationFailedError(
      'task-1',
      'Build failed',
      'Error output here'
    );

    expect(error.taskId).toBe('task-1');
    expect(error.output).toBe('Error output here');
    expect(error.message).toContain('Build failed');
    expect(error.code).toBe('IMPLEMENTATION_FAILED');
    expect(error.recoverable).toBe(true);
  });
});

describe('ReviewFailedError', () => {
  it('should create error with review info', () => {
    const error = new ReviewFailedError(
      'task-1',
      ['Issue 1', 'Issue 2'],
      45
    );

    expect(error.taskId).toBe('task-1');
    expect(error.issues).toEqual(['Issue 1', 'Issue 2']);
    expect(error.score).toBe(45);
    expect(error.message).toContain('45');
    expect(error.code).toBe('REVIEW_FAILED');
    expect(error.recoverable).toBe(true);
  });
});

describe('NoEngineAvailableError', () => {
  it('should create error with project info', () => {
    const error = new NoEngineAvailableError('project-1');

    expect(error.projectId).toBe('project-1');
    expect(error.message).toContain('project-1');
    expect(error.code).toBe('NO_ENGINE_AVAILABLE');
    expect(error.recoverable).toBe(true);
  });
});

describe('PermissionDeniedError', () => {
  it('should create error with permission info', () => {
    const error = new PermissionDeniedError(
      'implementer',
      '/etc/passwd',
      'read'
    );

    expect(error.agentType).toBe('implementer');
    expect(error.resource).toBe('/etc/passwd');
    expect(error.action).toBe('read');
    expect(error.message).toContain('implementer');
    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.recoverable).toBe(false);
  });
});

describe('TaskCancelledError', () => {
  it('should create error with cancellation info', () => {
    const error = new TaskCancelledError('task-1', 'User requested');

    expect(error.taskId).toBe('task-1');
    expect(error.reason).toBe('User requested');
    expect(error.message).toContain('User requested');
    expect(error.code).toBe('TASK_CANCELLED');
    expect(error.recoverable).toBe(false);
  });
});

describe('EscalationRequiredError', () => {
  it('should create error with escalation info', () => {
    const error = new EscalationRequiredError('task-1', 'Too many failures');

    expect(error.taskId).toBe('task-1');
    expect(error.reason).toBe('Too many failures');
    expect(error.message).toContain('Too many failures');
    expect(error.code).toBe('ESCALATION_REQUIRED');
    expect(error.recoverable).toBe(false);
  });
});
