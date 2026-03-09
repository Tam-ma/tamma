/**
 * Error Message Sanitization for Diagnostics
 *
 * Strips API key patterns and truncates error messages before
 * they are stored in diagnostics events. Prevents credential
 * leakage into telemetry storage.
 */

/**
 * Maximum length for sanitized error messages.
 * Messages exceeding this length are truncated with a '...' suffix.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Patterns that match common API key formats.
 * Order matters: more specific patterns are matched first to avoid
 * the generic long-alphanumeric pattern from partially matching them.
 */
const API_KEY_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,     // Bearer tokens
  /sk-[A-Za-z0-9]{20,}/g,                   // OpenAI-style keys
  /key-[A-Za-z0-9]{20,}/g,                  // Generic key-* patterns
  /[A-Za-z0-9]{32,}/g,                      // Long alphanumeric strings (potential keys)
];

/**
 * Sanitize an error message for inclusion in diagnostics events.
 *
 * 1. Replaces patterns matching API keys with `[REDACTED]`
 * 2. Truncates to MAX_ERROR_MESSAGE_LENGTH characters with `...` suffix
 *
 * @param message - The raw error message to sanitize
 * @returns A sanitized message safe for diagnostics storage
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of API_KEY_PATTERNS) {
    // Reset lastIndex for global regexps to ensure consistent matching
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  if (sanitized.length > MAX_ERROR_MESSAGE_LENGTH) {
    sanitized = sanitized.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '...';
  }
  return sanitized;
}
