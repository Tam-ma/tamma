/**
 * Generate unique identifiers for database records
 */

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a timestamp-based ID (for sorting by creation time)
 */
export function generateTimestampId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}

/**
 * Generate a session ID
 */
export function generateSessionId(): string {
  return `sess_${generateId()}`;
}

/**
 * Generate a search query ID
 */
export function generateSearchId(): string {
  return `search_${generateId()}`;
}