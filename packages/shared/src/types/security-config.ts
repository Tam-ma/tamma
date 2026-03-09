/**
 * Security configuration for the Tamma platform.
 *
 * Controls content sanitization, URL validation, action gating,
 * fetch size limits, and blocked command patterns.
 */

export interface SecurityConfig {
  /** Whether to sanitize content before passing to agents */
  sanitizeContent?: boolean;
  /** Whether to validate URLs before fetching */
  validateUrls?: boolean;
  /** Whether to gate actions requiring approval */
  gateActions?: boolean;
  /** Maximum fetch size in bytes (0 to 1 GiB) */
  maxFetchSizeBytes?: number;
  /** Regex patterns for commands that should be blocked */
  blockedCommandPatterns?: string[];
}
