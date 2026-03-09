import type { ProviderError } from './types.js';

/**
 * Factory function to create a ProviderError with structured fields.
 *
 * Extracted from duplicated implementations in openrouter-provider.ts
 * and zen-mcp-provider.ts into this shared module.
 *
 * @param code - Error code (e.g., PROVIDER_ERROR_CODES.RATE_LIMIT_EXCEEDED)
 * @param message - Human-readable error message
 * @param retryable - Whether the operation can be retried
 * @param severity - Error severity level (defaults to 'medium')
 * @param context - Optional structured metadata (e.g., request IDs, model names)
 * @param retryAfter - Optional delay in ms before retrying (e.g., from HTTP 429 Retry-After)
 */
export function createProviderError(
  code: string,
  message: string,
  retryable: boolean,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  context?: Record<string, unknown>,
  retryAfter?: number,
): ProviderError {
  const error = new Error(message) as ProviderError;
  error.code = code;
  error.retryable = retryable;
  error.severity = severity;
  if (context !== undefined) error.context = context;
  if (retryAfter !== undefined) error.retryAfter = retryAfter;
  return error;
}

/**
 * Type guard: distinguish ProviderError from plain Error.
 *
 * Checks 'severity' in addition to 'code' and 'retryable' to reduce
 * false positives from Node.js system errors that may coincidentally
 * have 'code' and 'retryable' properties.
 *
 * Used by ProviderHealthTracker.recordFailure() (Story 9-3 Task 3)
 * to check the retryable flag -- non-retryable ProviderErrors are NOT
 * counted toward the circuit breaker threshold.
 */
export function isProviderError(err: unknown): err is ProviderError {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof (err as ProviderError).code === 'string' &&
    'retryable' in err &&
    typeof (err as ProviderError).retryable === 'boolean' &&
    'severity' in err
  );
}
