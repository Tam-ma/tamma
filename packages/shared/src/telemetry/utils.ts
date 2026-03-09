/**
 * Bridge Wiring Utilities for Diagnostics
 *
 * Provides argument truncation and sensitive key redaction
 * for use in the bridge pattern that connects MCPClient events
 * to the DiagnosticsQueue.
 *
 * These utilities are used at the application wiring level
 * (CLI start.tsx or server.ts), not inside MCPClient or
 * DiagnosticsQueue directly.
 */

/**
 * Default maximum serialized size for tool arguments in diagnostics events.
 * Arguments exceeding this limit are truncated (F06).
 */
export const MAX_DIAGNOSTICS_ARG_SIZE = 10_240; // 10KB

/**
 * Default set of sensitive keys to redact from tool arguments (F07).
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  'password',
  'token',
  'apiKey',
  'secret',
  'authorization',
] as const;

/**
 * Redaction placeholder for sensitive values.
 */
const REDACTED = '[REDACTED]';

/**
 * Redact sensitive keys from a tool arguments object (F07).
 *
 * Performs a shallow clone of the input object and replaces
 * values of keys matching the sensitive key list with `[REDACTED]`.
 * Key matching is case-insensitive.
 *
 * Does NOT mutate the input object.
 *
 * @param args - The tool arguments to redact
 * @param sensitiveKeys - Keys to redact (case-insensitive matching)
 * @returns A new object with sensitive values replaced
 */
export function redactSensitiveKeys(
  args: Record<string, unknown>,
  sensitiveKeys: readonly string[] = DEFAULT_SENSITIVE_KEYS,
): Record<string, unknown> {
  const lowerSensitiveKeys = new Set(sensitiveKeys.map((k) => k.toLowerCase()));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (lowerSensitiveKeys.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Truncate tool arguments to a maximum serialized size (F06).
 *
 * Serializes the args object with `JSON.stringify()` and checks
 * the length against `maxSize`. If the serialized form exceeds
 * the limit, the args are replaced with a truncation marker object.
 *
 * Does NOT mutate the input object.
 *
 * @param args - The tool arguments to truncate
 * @param maxSize - Maximum serialized size in bytes (default: MAX_DIAGNOSTICS_ARG_SIZE)
 * @returns The original args if within size, or a truncation marker
 */
export function truncateArgs(
  args: Record<string, unknown>,
  maxSize: number = MAX_DIAGNOSTICS_ARG_SIZE,
): Record<string, unknown> {
  let serialized: string;
  try {
    serialized = JSON.stringify(args);
  } catch {
    // If JSON.stringify fails (circular refs, etc.), return a safe marker
    return { _truncated: true, _reason: 'serialization_failed' };
  }

  if (serialized.length <= maxSize) {
    return args;
  }

  return {
    _truncated: true,
    _originalSize: serialized.length,
    _maxSize: maxSize,
    _preview: serialized.slice(0, 200),
  };
}
