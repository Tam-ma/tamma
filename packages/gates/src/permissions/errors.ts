/**
 * Custom error types for the permission system
 * @module @tamma/gates/permissions/errors
 */

import { TammaError } from '@tamma/shared';
import type { PermissionViolation, ResourceLimits } from './types.js';

/**
 * Error thrown when a permission check fails
 */
export class PermissionDeniedError extends TammaError {
  public readonly suggestedAlternative?: string;
  public readonly violation?: PermissionViolation;

  constructor(
    message: string,
    options?: {
      suggestedAlternative?: string;
      violation?: PermissionViolation;
      context?: Record<string, unknown>;
    },
  ) {
    super(message, 'PERMISSION_DENIED', {
      retryable: false,
      context: options?.context ?? {},
    });
    this.name = 'PermissionDeniedError';
    this.suggestedAlternative = options?.suggestedAlternative;
    this.violation = options?.violation;
  }
}

/**
 * Error thrown when an action requires approval before proceeding
 */
export class PermissionApprovalRequiredError extends TammaError {
  public readonly requestId: string;

  constructor(message: string, requestId: string) {
    super(message, 'PERMISSION_APPROVAL_REQUIRED', {
      retryable: true,
      context: { requestId },
    });
    this.name = 'PermissionApprovalRequiredError';
    this.requestId = requestId;
  }
}

/**
 * Error thrown when a resource limit is exceeded
 */
export class ResourceLimitExceededError extends TammaError {
  public readonly resource: keyof ResourceLimits;
  public readonly limit: number;
  public readonly current: number;

  constructor(
    message: string,
    resource: keyof ResourceLimits,
    limit: number,
    current: number,
  ) {
    super(message, 'RESOURCE_LIMIT_EXCEEDED', {
      retryable: false,
      context: { resource, limit, current },
    });
    this.name = 'ResourceLimitExceededError';
    this.resource = resource;
    this.limit = limit;
    this.current = current;
  }
}
