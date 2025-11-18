/**
 * Crypto utilities using Web Crypto API (Cloudflare Workers compatible)
 */

/**
 * Hash a password using SHA-256
 * Note: For production, consider using Argon2 via WebAssembly or a third-party service
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const hashedInput = await hashPassword(password)
  return hashedInput === hash
}

/**
 * Generate a random token
 */
export function generateToken(length: number = 32): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a random UUID
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Generate API key with prefix
 * Returns the key and prefix (hash should be generated separately using hashPassword)
 */
export function generateAPIKey(prefix: string = 'ak'): { key: string; prefix: string } {
  const randomPart = generateToken(24)
  const key = prefix + '_' + randomPart
  const keyPrefix = prefix + '_' + randomPart.slice(0, 8)

  return {
    key,
    prefix: keyPrefix
  }
}
