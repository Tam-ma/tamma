/**
 * Unit tests for provider-specific error sanitization utilities.
 *
 * Tests cover:
 * - sanitizeErrorForDiagnostics(): Error instances, string errors, unknown values
 * - Error code mapping from ProviderError codes to DiagnosticsErrorCode
 * - Retryable status extraction
 * - Stack trace exclusion from output
 * - API key pattern stripping (delegated to sanitizeErrorMessage)
 * - extractSanitizedMessage(): convenience wrapper
 * - extractDiagnosticsErrorCode(): code extraction
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeErrorForDiagnostics,
  extractSanitizedMessage,
  extractDiagnosticsErrorCode,
} from './sanitize-error.js';
import type { SanitizedDiagnosticsError } from './sanitize-error.js';

// Helper: create a ProviderError-like object
function makeProviderError(
  message: string,
  code: string,
  retryable: boolean,
): Error & { code: string; retryable: boolean } {
  const err = new Error(message) as Error & { code: string; retryable: boolean };
  err.code = code;
  err.retryable = retryable;
  return err;
}

describe('sanitizeErrorForDiagnostics', () => {
  it('returns sanitized error from an Error instance', () => {
    const error = new Error('Something went wrong');
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorMessage).toBe('Something went wrong');
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });

  it('maps RATE_LIMIT_EXCEEDED code correctly', () => {
    const error = makeProviderError('Rate limited', 'RATE_LIMIT_EXCEEDED', true);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.retryable).toBe(true);
  });

  it('maps QUOTA_EXCEEDED code correctly', () => {
    const error = makeProviderError('Quota exceeded', 'QUOTA_EXCEEDED', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('QUOTA_EXCEEDED');
    expect(result.retryable).toBe(false);
  });

  it('maps TIMEOUT code correctly', () => {
    const error = makeProviderError('Request timed out', 'TIMEOUT', true);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('TIMEOUT');
  });

  it('maps INVALID_API_KEY to AUTH_FAILED', () => {
    const error = makeProviderError('Invalid key', 'INVALID_API_KEY', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('AUTH_FAILED');
  });

  it('maps AUTH_FAILED code directly', () => {
    const error = makeProviderError('Auth failed', 'AUTH_FAILED', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('AUTH_FAILED');
  });

  it('maps NETWORK_ERROR code correctly', () => {
    const error = makeProviderError('Network error', 'NETWORK_ERROR', true);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('NETWORK_ERROR');
  });

  it('maps TASK_FAILED code correctly', () => {
    const error = makeProviderError('Task failed', 'TASK_FAILED', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('TASK_FAILED');
  });

  it('maps SERVICE_UNAVAILABLE to NETWORK_ERROR', () => {
    const error = makeProviderError('Service unavailable', 'SERVICE_UNAVAILABLE', true);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('NETWORK_ERROR');
  });

  it('maps PROVIDER_ERROR to UNKNOWN', () => {
    const error = makeProviderError('Provider error', 'PROVIDER_ERROR', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('UNKNOWN');
  });

  it('maps unrecognized error codes to UNKNOWN', () => {
    const error = makeProviderError('Weird error', 'SOME_RANDOM_CODE', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorCode).toBe('UNKNOWN');
  });

  it('handles string errors', () => {
    const result = sanitizeErrorForDiagnostics('plain string error');

    expect(result.errorMessage).toBe('plain string error');
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });

  it('handles non-Error non-string values', () => {
    const result = sanitizeErrorForDiagnostics(42);

    expect(result.errorMessage).toBe('42');
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });

  it('handles null error', () => {
    const result = sanitizeErrorForDiagnostics(null);

    expect(result.errorMessage).toBe('null');
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });

  it('handles undefined error', () => {
    const result = sanitizeErrorForDiagnostics(undefined);

    expect(result.errorMessage).toBe('undefined');
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.retryable).toBe(false);
  });

  it('does NOT include stack traces in output', () => {
    const error = new Error('Something went wrong');
    // Error.stack always includes the message + stack frames
    expect(error.stack).toBeDefined();

    const result = sanitizeErrorForDiagnostics(error);

    // The result should only contain the message, not the stack
    expect(result.errorMessage).not.toContain('at ');
    expect(result.errorMessage).not.toContain('.ts:');
    expect(result.errorMessage).toBe('Something went wrong');
  });

  it('strips API key patterns from error messages', () => {
    const error = new Error(
      'Failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw and sk-abcdefghij1234567890abcdefghij',
    );
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.errorMessage).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result.errorMessage).not.toContain('sk-abcdefghij1234567890abcdefghij');
    expect(result.errorMessage).toContain('[REDACTED]');
  });

  it('truncates long error messages to 500 chars', () => {
    const longMessage = 'error at step '.repeat(50); // ~700 chars
    const error = new Error(longMessage);
    const result = sanitizeErrorForDiagnostics(error);

    // 500 chars + '...' suffix = 503
    expect(result.errorMessage.length).toBeLessThanOrEqual(503);
    expect(result.errorMessage.endsWith('...')).toBe(true);
  });

  it('extracts retryable=true from error', () => {
    const error = makeProviderError('Retry me', 'TIMEOUT', true);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.retryable).toBe(true);
  });

  it('extracts retryable=false from error', () => {
    const error = makeProviderError('No retry', 'AUTH_FAILED', false);
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.retryable).toBe(false);
  });

  it('defaults retryable to false when not present on error', () => {
    const error = new Error('plain error');
    const result = sanitizeErrorForDiagnostics(error);

    expect(result.retryable).toBe(false);
  });

  it('returns correct SanitizedDiagnosticsError shape', () => {
    const error = makeProviderError('Test', 'TIMEOUT', true);
    const result: SanitizedDiagnosticsError = sanitizeErrorForDiagnostics(error);

    expect(result).toHaveProperty('errorCode');
    expect(result).toHaveProperty('errorMessage');
    expect(result).toHaveProperty('retryable');
    // Should only have these 3 properties
    expect(Object.keys(result)).toHaveLength(3);
  });
});

describe('extractSanitizedMessage', () => {
  it('extracts and sanitizes message from Error instance', () => {
    const error = new Error('API call failed with key-abcdef1234567890abcdef');
    const message = extractSanitizedMessage(error);

    expect(message).not.toContain('key-abcdef1234567890abcdef');
    expect(message).toContain('[REDACTED]');
  });

  it('sanitizes string errors', () => {
    const message = extractSanitizedMessage('Bearer token123abc456def789ghi error');
    expect(message).toContain('[REDACTED]');
  });

  it('handles non-string non-Error values', () => {
    const message = extractSanitizedMessage(12345);
    expect(message).toBe('12345');
  });
});

describe('extractDiagnosticsErrorCode', () => {
  it('returns mapped code for known ProviderError codes', () => {
    const error = makeProviderError('Rate limited', 'RATE_LIMIT_EXCEEDED', true);
    expect(extractDiagnosticsErrorCode(error)).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('maps INVALID_API_KEY to AUTH_FAILED', () => {
    const error = makeProviderError('Bad key', 'INVALID_API_KEY', false);
    expect(extractDiagnosticsErrorCode(error)).toBe('AUTH_FAILED');
  });

  it('returns UNKNOWN for unrecognized codes', () => {
    const error = makeProviderError('Something', 'NOT_A_REAL_CODE', false);
    expect(extractDiagnosticsErrorCode(error)).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for errors without code property', () => {
    const error = new Error('plain error');
    expect(extractDiagnosticsErrorCode(error)).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for non-Error values', () => {
    expect(extractDiagnosticsErrorCode('just a string')).toBe('UNKNOWN');
    expect(extractDiagnosticsErrorCode(null)).toBe('UNKNOWN');
    expect(extractDiagnosticsErrorCode(42)).toBe('UNKNOWN');
  });

  it('handles object with code property', () => {
    const error = { code: 'TIMEOUT', message: 'Timed out' };
    expect(extractDiagnosticsErrorCode(error)).toBe('TIMEOUT');
  });
});
