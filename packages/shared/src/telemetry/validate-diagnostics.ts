/**
 * Value Validation Utilities for Diagnostics Events
 *
 * Provides bounds checking for numeric and string diagnostics fields
 * to prevent corrupt data from entering the telemetry pipeline.
 */

/**
 * Maximum allowed token count for a single diagnostics event.
 * Values exceeding this are clamped to the maximum.
 */
export const MAX_TOKEN_COUNT = 10_000_000;

/**
 * Maximum allowed length for error code strings.
 * Values exceeding this length are truncated.
 */
export const MAX_ERROR_CODE_LENGTH = 100;

/**
 * Validate and clamp costUsd to a non-negative value.
 * Returns undefined if the input is undefined (preserves optionality).
 *
 * @param value - The cost value to validate
 * @returns The clamped value (>= 0) or undefined
 */
export function validateCostUsd(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(0, value);
}

/**
 * Validate and clamp a token count to the valid range [0, MAX_TOKEN_COUNT].
 *
 * @param value - The token count to validate
 * @returns The clamped value within [0, 10_000_000]
 */
export function validateTokenCount(value: number): number {
  return Math.max(0, Math.min(MAX_TOKEN_COUNT, value));
}

/**
 * Validate and truncate an error code string to MAX_ERROR_CODE_LENGTH characters.
 * Returns undefined if the input is undefined (preserves optionality).
 *
 * @param value - The error code string to validate
 * @returns The truncated string or undefined
 */
export function validateErrorCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > MAX_ERROR_CODE_LENGTH
    ? value.slice(0, MAX_ERROR_CODE_LENGTH)
    : value;
}
