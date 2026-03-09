/**
 * URL validation with numeric octet parsing for private IP detection.
 *
 * Generalizes the existing `mcp-client/src/security/validator.ts` logic
 * (`validateTransportUrl`, inline `isPrivateIP`) with these improvements:
 *
 * - Numeric octet parsing (parseInt + integer comparison) instead of regex
 *   for RFC 1918 range detection. Eliminates regex bypass risks and is
 *   clearer to audit.
 * - IPv6-mapped IPv4 support (`[::ffff:x.x.x.x]`)
 * - Bracketed IPv6 notation (`[::1]`, `[fc00::]`, `[fe80::]`)
 * - Cloud metadata hostname blocking
 * - URL truncation in error messages (max 200 chars)
 *
 * Migration note: After Story 9-7, `mcp-client/src/security/validator.ts`
 * should be updated to import from `@tamma/shared/security` and delete
 * its local `validateTransportUrl` / inline `isPrivateIP` logic.
 * That migration is tracked separately.
 *
 * @module
 */

/** Maximum length for URLs included in error/warning messages. */
const MAX_URL_DISPLAY_LENGTH = 200;

/**
 * Module-scope blocked hostname set (avoids per-call allocation).
 *
 * Contains literal hostnames that should always be blocked:
 * - Loopback addresses in various formats
 * - Cloud metadata endpoints (SSRF targets)
 * - Docker host access
 */
const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  '0.0.0.0',
  '[::]',
  '[::1]',
  '127.0.0.1',
  'localhost',
  'metadata.google.internal',  // GCP metadata endpoint
  'host.docker.internal',      // Docker host access
]);

/**
 * Allowed URL protocols for outbound requests.
 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'ws:',
  'wss:',
]);

/**
 * Check if a hostname is a private/reserved IP address.
 *
 * Uses numeric octet parsing (not regex) for RFC 1918 ranges.
 * Handles IPv6-mapped IPv4 (`::ffff:x.x.x.x`), bracketed IPv6,
 * and IPv6 private ranges (`fc00::/7`, `fe80::/10`).
 *
 * Non-IPv4 hostnames (e.g. `evil.com`) pass through and return `false`.
 * DNS resolution to a private IP is a separate concern (TOCTOU)
 * handled at the fetch layer.
 *
 * @param hostname - The hostname to check (may include IPv6 brackets)
 * @returns `true` if the hostname is a private/reserved address
 */
export function isPrivateHost(hostname: string): boolean {
  // Fast path: known blocked literals
  if (BLOCKED_HOSTS.has(hostname)) return true;

  // Handle bracketed IPv6 (URL notation)
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const inner = hostname.slice(1, -1);

    // Check common blocked IPv6 addresses
    if (inner === '::1' || inner === '::') return true;

    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const v4MappedPrefix = '::ffff:';
    if (inner.toLowerCase().startsWith(v4MappedPrefix)) {
      return isPrivateHost(inner.slice(v4MappedPrefix.length));
    }

    // fc00::/7 (unique local: fc and fd prefixes) and fe80::/10 (link-local)
    const lc = inner.toLowerCase();
    if (lc.startsWith('fc') || lc.startsWith('fd') || lc.startsWith('fe80')) {
      return true;
    }

    return false;
  }

  // Parse IPv4 octets as integers for range comparison
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;

  const octets: number[] = [];
  for (const p of parts) {
    // Require non-empty string that is purely numeric digits
    if (p === '') return false;
    const n = parseInt(p, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) return false;
    // Reject strings that parseInt parses but contain non-digit chars
    // (e.g. "12abc" parses to 12)
    if (String(n) !== p) return false;
    octets.push(n);
  }

  // At this point octets has exactly 4 valid values [0-255]
  const a = octets[0]!;
  const b = octets[1]!;

  // 0.0.0.0/8 (this network)
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback range)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Validate a URL for safe outbound use.
 *
 * Checks:
 * 1. URL is parseable
 * 2. Protocol is in the allowlist (http:, https:, ws:, wss:)
 * 3. Hostname is not a private/reserved address
 *
 * Never throws. Returns `{ valid: false, warnings }` for any issue.
 * Truncates URL in error messages to max 200 chars to prevent
 * information leakage of potentially sensitive URL content.
 *
 * @param url - The URL string to validate
 * @returns Validation result with `valid` flag and `warnings` array
 */
export function validateUrl(url: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  try {
    const parsed = new URL(url);

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return {
        valid: false,
        warnings: [`Blocked protocol: ${parsed.protocol}`],
      };
    }

    if (isPrivateHost(parsed.hostname)) {
      return {
        valid: false,
        warnings: [`Blocked private host: ${parsed.hostname}`],
      };
    }

    return { valid: true, warnings };
  } catch {
    const truncatedUrl = url.length > MAX_URL_DISPLAY_LENGTH
      ? url.slice(0, MAX_URL_DISPLAY_LENGTH)
      : url;
    return {
      valid: false,
      warnings: [`Invalid URL: ${truncatedUrl}`],
    };
  }
}
