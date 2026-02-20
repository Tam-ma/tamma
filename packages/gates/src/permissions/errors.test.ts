import { describe, it, expect } from 'vitest';
import {
  PermissionDeniedError,
  PermissionApprovalRequiredError,
  ResourceLimitExceededError,
} from './errors.js';
import { TammaError } from '@tamma/shared';

describe('PermissionDeniedError', () => {
  it('should set message and code', () => {
    const error = new PermissionDeniedError('Access denied');

    expect(error.message).toBe('Access denied');
    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.name).toBe('PermissionDeniedError');
  });

  it('should not be retryable', () => {
    const error = new PermissionDeniedError('Access denied');
    expect(error.retryable).toBe(false);
  });

  it('should accept suggestedAlternative', () => {
    const error = new PermissionDeniedError('Cannot use Write', {
      suggestedAlternative: 'Use Edit instead',
    });

    expect(error.suggestedAlternative).toBe('Use Edit instead');
  });

  it('should accept violation details', () => {
    const violation = {
      id: 'v-1',
      agentType: 'researcher' as const,
      projectId: 'project-1',
      action: { type: 'tool' as const, toolName: 'Write' },
      deniedPermission: {
        id: 'p-1',
        category: 'tool' as const,
        resource: 'Write',
        action: 'deny' as const,
      },
      reason: 'Not allowed',
      timestamp: new Date(),
      severity: 'medium' as const,
      repeated: false,
    };

    const error = new PermissionDeniedError('Access denied', { violation });

    expect(error.violation).toEqual(violation);
  });

  it('should be an instance of TammaError', () => {
    const error = new PermissionDeniedError('Access denied');
    expect(error).toBeInstanceOf(TammaError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PermissionApprovalRequiredError', () => {
  it('should set message and requestId', () => {
    const error = new PermissionApprovalRequiredError('Approval needed', 'req-123');

    expect(error.message).toBe('Approval needed');
    expect(error.requestId).toBe('req-123');
    expect(error.code).toBe('PERMISSION_APPROVAL_REQUIRED');
    expect(error.name).toBe('PermissionApprovalRequiredError');
  });

  it('should be retryable', () => {
    const error = new PermissionApprovalRequiredError('Approval needed', 'req-123');
    expect(error.retryable).toBe(true);
  });

  it('should include requestId in context', () => {
    const error = new PermissionApprovalRequiredError('Approval needed', 'req-123');
    expect(error.context).toEqual({ requestId: 'req-123' });
  });

  it('should be an instance of TammaError', () => {
    const error = new PermissionApprovalRequiredError('Approval needed', 'req-123');
    expect(error).toBeInstanceOf(TammaError);
  });
});

describe('ResourceLimitExceededError', () => {
  it('should set message and resource details', () => {
    const error = new ResourceLimitExceededError(
      'Exceeded file limit',
      'maxFilesModified',
      20,
      50,
    );

    expect(error.message).toBe('Exceeded file limit');
    expect(error.resource).toBe('maxFilesModified');
    expect(error.limit).toBe(20);
    expect(error.current).toBe(50);
    expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(error.name).toBe('ResourceLimitExceededError');
  });

  it('should not be retryable', () => {
    const error = new ResourceLimitExceededError(
      'Exceeded limit',
      'maxBudgetPerTask',
      10,
      15,
    );
    expect(error.retryable).toBe(false);
  });

  it('should include resource details in context', () => {
    const error = new ResourceLimitExceededError(
      'Exceeded limit',
      'maxTokensPerTask',
      100000,
      150000,
    );

    expect(error.context).toEqual({
      resource: 'maxTokensPerTask',
      limit: 100000,
      current: 150000,
    });
  });

  it('should be an instance of TammaError', () => {
    const error = new ResourceLimitExceededError(
      'Exceeded limit',
      'maxDurationMinutes',
      60,
      90,
    );
    expect(error).toBeInstanceOf(TammaError);
  });
});
