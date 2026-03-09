/**
 * Test suite for shared error factory and type guard.
 *
 * Tests createProviderError() and isProviderError() extracted from
 * openrouter-provider.ts and zen-mcp-provider.ts.
 */

import { describe, it, expect } from 'vitest';
import { createProviderError, isProviderError } from './errors.js';
import type { ProviderError } from './types.js';

describe('createProviderError', () => {
  it('should return an Error instance with code, retryable, and severity set', () => {
    const error = createProviderError('RATE_LIMIT_EXCEEDED', 'Rate limited', true, 'high');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.retryable).toBe(true);
    expect(error.severity).toBe('high');
  });

  it('should use the provided severity value', () => {
    const low = createProviderError('TEST', 'test', false, 'low');
    expect(low.severity).toBe('low');

    const high = createProviderError('TEST', 'test', false, 'high');
    expect(high.severity).toBe('high');

    const critical = createProviderError('TEST', 'test', false, 'critical');
    expect(critical.severity).toBe('critical');
  });

  it('should default severity to "medium" when omitted', () => {
    const error = createProviderError('TEST', 'test', false);

    expect(error.severity).toBe('medium');
  });

  it('should set message accessible via .message', () => {
    const error = createProviderError('TEST', 'Something went wrong', false);

    expect(error.message).toBe('Something went wrong');
  });

  it('should set context when provided', () => {
    const context = { requestId: 'req-123', model: 'gpt-4' };
    const error = createProviderError('TEST', 'test', false, 'medium', context);

    expect(error.context).toEqual({ requestId: 'req-123', model: 'gpt-4' });
  });

  it('should NOT set context property when not provided (property absent)', () => {
    const error = createProviderError('TEST', 'test', false);

    // The property should not exist at all, not just be undefined
    expect('context' in error).toBe(false);
  });

  it('should set retryAfter when provided', () => {
    const error = createProviderError('RATE_LIMIT', 'rate limited', true, 'medium', undefined, 5000);

    expect(error.retryAfter).toBe(5000);
  });

  it('should NOT set retryAfter property when not provided (property absent)', () => {
    const error = createProviderError('TEST', 'test', false);

    // The property should not exist at all, not just be undefined
    expect('retryAfter' in error).toBe(false);
  });

  it('should set both context and retryAfter together when both provided', () => {
    const context = { provider: 'openrouter', model: 'z-ai/z1-mini' };
    const error = createProviderError(
      'RATE_LIMIT_EXCEEDED',
      'Too many requests',
      true,
      'medium',
      context,
      30000,
    );

    expect(error.context).toEqual({ provider: 'openrouter', model: 'z-ai/z1-mini' });
    expect(error.retryAfter).toBe(30000);
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.message).toBe('Too many requests');
    expect(error.retryable).toBe(true);
    expect(error.severity).toBe('medium');
  });

  it('should produce an error compatible with the ProviderError interface', () => {
    const error: ProviderError = createProviderError(
      'PROVIDER_ERROR',
      'Provider failed',
      true,
      'high',
      { key: 'value' },
      1000,
    );

    // Verifies the returned error satisfies the ProviderError type
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.retryable).toBe(true);
    expect(error.severity).toBe('high');
    expect(error.context).toEqual({ key: 'value' });
    expect(error.retryAfter).toBe(1000);
    expect(error.name).toBe('Error');
    expect(error.message).toBe('Provider failed');
  });

  it('should have a proper stack trace', () => {
    const error = createProviderError('TEST', 'test', false);

    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });
});

describe('isProviderError', () => {
  it('should return true for a ProviderError created by createProviderError()', () => {
    const error = createProviderError('TEST', 'test error', true, 'high');

    expect(isProviderError(error)).toBe(true);
  });

  it('should return true for a ProviderError with all optional fields', () => {
    const error = createProviderError(
      'RATE_LIMIT',
      'rate limited',
      true,
      'medium',
      { provider: 'test' },
      5000,
    );

    expect(isProviderError(error)).toBe(true);
  });

  it('should return false for a plain new Error("test")', () => {
    const error = new Error('test');

    expect(isProviderError(error)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isProviderError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isProviderError(undefined)).toBe(false);
  });

  it('should return false for a string', () => {
    expect(isProviderError('some error message')).toBe(false);
  });

  it('should return false for a number', () => {
    expect(isProviderError(42)).toBe(false);
  });

  it('should return false for an object with code but no retryable', () => {
    const obj = { code: 'SOME_CODE', message: 'test' };

    expect(isProviderError(obj)).toBe(false);
  });

  it('should return false for an Error with code as number (not string)', () => {
    const error = new Error('test') as Error & { code: number; retryable: boolean; severity: string };
    error.code = 42 as unknown as number;
    error.retryable = true;
    error.severity = 'medium';

    expect(isProviderError(error)).toBe(false);
  });

  it('should return false for an Error with code (string) and retryable (boolean) but NO severity (Node.js system error false positive)', () => {
    // This simulates a Node.js system error like ECONNREFUSED that has
    // code (string) and might coincidentally have retryable (boolean),
    // but does NOT have severity. The isProviderError check for 'severity'
    // prevents this false positive.
    const error = new Error('connect ECONNREFUSED') as Error & { code: string; retryable: boolean };
    error.code = 'ECONNREFUSED';
    error.retryable = true;

    expect(isProviderError(error)).toBe(false);
  });

  it('should return true for a manually constructed Error with all required fields', () => {
    // If someone manually creates an Error and adds code, retryable, AND severity,
    // isProviderError should still return true (duck typing).
    const error = new Error('manual error') as Error & {
      code: string;
      retryable: boolean;
      severity: string;
    };
    error.code = 'CUSTOM_ERROR';
    error.retryable = false;
    error.severity = 'low';

    expect(isProviderError(error)).toBe(true);
  });

  it('should return false for an Error with retryable but no code', () => {
    const error = new Error('test') as Error & { retryable: boolean; severity: string };
    error.retryable = true;
    error.severity = 'medium';

    expect(isProviderError(error)).toBe(false);
  });

  it('should return false for a plain object (not instanceof Error)', () => {
    const obj = {
      code: 'TEST',
      message: 'test',
      retryable: true,
      severity: 'medium',
    };

    expect(isProviderError(obj)).toBe(false);
  });

  it('should return false for an Error with retryable as string (not boolean)', () => {
    const error = new Error('test') as Error & {
      code: string;
      retryable: string;
      severity: string;
    };
    error.code = 'TEST';
    error.retryable = 'true' as unknown as string;
    error.severity = 'medium';

    expect(isProviderError(error)).toBe(false);
  });
});
