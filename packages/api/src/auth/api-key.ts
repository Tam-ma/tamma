/**
 * API Key generation, hashing, and prefix extraction utilities.
 *
 * Keys follow the format: tamma_sk_ + 32 random bytes encoded as base64url.
 */

import { randomBytes, createHash } from 'node:crypto';

/** Prefix prepended to all generated API keys. */
const API_KEY_PREFIX = 'tamma_sk_';

/** Number of random bytes used for key generation. */
const KEY_BYTES = 32;

/** Number of characters from the full key to use as a display prefix. */
const DISPLAY_PREFIX_LENGTH = 12;

/**
 * Generate a new API key.
 *
 * Format: `tamma_sk_<32 random bytes base64url>`
 * Example: `tamma_sk_a1b2c3d4e5f6...`
 */
export function generateApiKey(): string {
  const random = randomBytes(KEY_BYTES).toString('base64url');
  return `${API_KEY_PREFIX}${random}`;
}

/**
 * Compute the SHA-256 hex digest of an API key.
 * Used for storage and lookup (never store the raw key).
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Extract the first 12 characters of the key for safe display.
 * Example: `tamma_sk_a1b2` (enough to identify, not enough to use).
 */
export function getApiKeyPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}
