/**
 * Provider Error Sanitization for Diagnostics
 *
 * Higher-level utility that takes an arbitrary error value (as thrown
 * by provider implementations) and produces a sanitized representation
 * suitable for inclusion in diagnostics events.
 *
 * - Strips stack traces to prevent internal code paths from leaking
 * - Strips API key patterns and Bearer tokens from error messages
 * - Truncates error messages to a safe maximum length
 * - Extracts typed error codes from ProviderError instances
 * - Handles non-Error thrown values (strings, objects, etc.)
 */

import { sanitizeErrorMessage } from '@tamma/shared/telemetry';
import type { DiagnosticsErrorCode } from '@tamma/shared/telemetry';

/**
 * Provider error codes that map to DiagnosticsErrorCode values.
 * Used to translate ProviderError.code strings into typed error codes.
 */
const ERROR_CODE_MAP: Readonly<Record<string, DiagnosticsErrorCode>> = {
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TIMEOUT: 'TIMEOUT',
  INVALID_API_KEY: 'AUTH_FAILED',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TASK_FAILED: 'TASK_FAILED',
  SERVICE_UNAVAILABLE: 'NETWORK_ERROR',
  PROVIDER_ERROR: 'UNKNOWN',
};

/**
 * Result of sanitizing a provider error for diagnostics.
 * Contains only safe, redacted fields suitable for telemetry storage.
 */
export interface SanitizedDiagnosticsError {
  /** Typed error code for categorization */
  errorCode: DiagnosticsErrorCode;
  /** Sanitized error message (API keys stripped, truncated to 500 chars) */
  errorMessage: string;
  /** Whether the original error was marked as retryable */
  retryable: boolean;
}

/**
 * Checks if an error-like object has a `code` property.
 */
function _hasCode(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>)['code'] === 'string'
  );
}

/**
 * Checks if an error-like object has a `retryable` property.
 */
function _hasRetryable(err: unknown): err is { retryable: boolean } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'retryable' in err &&
    typeof (err as Record<string, unknown>)['retryable'] === 'boolean'
  );
}

/**
 * Sanitize a provider error for diagnostics event inclusion.
 *
 * Accepts any thrown value and produces a safe, typed representation:
 * - Error instances: extracts message, code, retryable status
 * - String values: uses the string as the error message
 * - Other values: converts to string via String()
 *
 * The error message is always sanitized via `sanitizeErrorMessage()` to
 * strip API key patterns and enforce length limits. Stack traces are
 * never included in the output.
 *
 * @param error - The error value to sanitize (typically from a catch block)
 * @returns A sanitized error representation safe for diagnostics storage
 */
export function sanitizeErrorForDiagnostics(error: unknown): SanitizedDiagnosticsError {
  // Extract the raw message
  let rawMessage: string;
  if (error instanceof Error) {
    rawMessage = error.message;
  } else if (typeof error === 'string') {
    rawMessage = error;
  } else {
    rawMessage = String(error);
  }

  // Map error code to DiagnosticsErrorCode
  let errorCode: DiagnosticsErrorCode = 'UNKNOWN';
  if (_hasCode(error)) {
    const mapped = ERROR_CODE_MAP[error.code];
    if (mapped !== undefined) {
      errorCode = mapped;
    }
  }

  // Extract retryable status
  const retryable = _hasRetryable(error) ? error.retryable : false;

  return {
    errorCode,
    errorMessage: sanitizeErrorMessage(rawMessage),
    retryable,
  };
}

/**
 * Extract just the sanitized error message from an error value.
 * Convenience wrapper for cases where only the message is needed.
 *
 * @param error - The error value to extract and sanitize the message from
 * @returns A sanitized error message string
 */
export function extractSanitizedMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  if (typeof error === 'string') {
    return sanitizeErrorMessage(error);
  }
  return sanitizeErrorMessage(String(error));
}

/**
 * Extract a typed DiagnosticsErrorCode from an error value.
 * Returns 'UNKNOWN' if the error does not have a recognized code.
 *
 * @param error - The error value to extract the error code from
 * @returns A typed DiagnosticsErrorCode
 */
export function extractDiagnosticsErrorCode(error: unknown): DiagnosticsErrorCode {
  if (_hasCode(error)) {
    const mapped = ERROR_CODE_MAP[error.code];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return 'UNKNOWN';
}
