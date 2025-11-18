/**
 * Validation utilities for input validation
 * Provides email, password, and API key validation functions
 */

/**
 * Validate email address according to RFC 5322
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
  // RFC 5322 compliant email regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

  if (!email) {
    return { valid: false, error: 'Email is required' }
  }

  if (email.length > 254) {
    return { valid: false, error: 'Email address is too long' }
  }

  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' }
  }

  // Check for common typos in popular domains
  const domain = email.split('@')[1]?.toLowerCase()
  const commonDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com']
  const typos = ['gmial.com', 'gmai.com', 'yahooo.com', 'hotmial.com', 'outlok.com']

  if (domain && typos.includes(domain)) {
    const suggestion = commonDomains[typos.indexOf(domain)]
    return { valid: false, error: `Did you mean ${email.split('@')[0]}@${suggestion}?` }
  }

  return { valid: true }
}

/**
 * Validate password strength
 * Requirements:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!password) {
    return { valid: false, errors: ['Password is required'] }
  }

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long')
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number')
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  // Check for common weak passwords
  const commonPasswords = [
    'password123!',
    'Password123!',
    'Admin123!@#',
    'Welcome123!',
    'Qwerty123!',
  ]

  if (commonPasswords.includes(password)) {
    errors.push('This password is too common. Please choose a stronger password')
  }

  // Check for sequential characters
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password should not contain more than 2 repeated characters in a row')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Calculate password strength score (0-100)
 */
export function calculatePasswordStrength(password: string): number {
  let score = 0

  // Length scoring
  if (password.length >= 8) score += 10
  if (password.length >= 12) score += 10
  if (password.length >= 16) score += 10
  if (password.length >= 20) score += 10

  // Character variety
  if (/[a-z]/.test(password)) score += 10
  if (/[A-Z]/.test(password)) score += 10
  if (/\d/.test(password)) score += 10
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 15

  // Additional complexity
  if (/[^a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 5 // Unicode chars

  // Entropy approximation
  const charsets = [
    /[a-z]/.test(password) ? 26 : 0,
    /[A-Z]/.test(password) ? 26 : 0,
    /\d/.test(password) ? 10 : 0,
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) ? 32 : 0,
  ].reduce((a, b) => a + b, 0)

  const entropy = password.length * Math.log2(charsets || 1)
  if (entropy >= 60) score += 10

  return Math.min(score, 100)
}

/**
 * Validate API key format
 */
export function validateAPIKey(apiKey: string): { valid: boolean; error?: string } {
  if (!apiKey) {
    return { valid: false, error: 'API key is required' }
  }

  // Check for expected format: prefix_randomstring
  const keyRegex = /^[a-z]+_[a-zA-Z0-9]{24,}$/

  if (!keyRegex.test(apiKey)) {
    return { valid: false, error: 'Invalid API key format' }
  }

  return { valid: true }
}

/**
 * Validate API key name
 */
export function validateAPIKeyName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'API key name is required' }
  }

  if (name.length < 3) {
    return { valid: false, error: 'API key name must be at least 3 characters' }
  }

  if (name.length > 100) {
    return { valid: false, error: 'API key name must be less than 100 characters' }
  }

  // Allow alphanumeric, spaces, hyphens, and underscores
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return { valid: false, error: 'API key name contains invalid characters' }
  }

  return { valid: true }
}

/**
 * Validate API scopes
 */
export function validateScopes(scopes: string[]): { valid: boolean; error?: string } {
  const validScopes = [
    'read:benchmarks',
    'write:benchmarks',
    'delete:benchmarks',
    'read:results',
    'write:results',
    'delete:results',
    'read:api_keys',
    'write:api_keys',
    'delete:api_keys',
    'read:profile',
    'write:profile',
    'admin:all'
  ]

  if (!scopes || !Array.isArray(scopes)) {
    return { valid: false, error: 'Scopes must be an array' }
  }

  if (scopes.length === 0) {
    return { valid: false, error: 'At least one scope is required' }
  }

  const invalidScopes = scopes.filter(scope => !validScopes.includes(scope))

  if (invalidScopes.length > 0) {
    return {
      valid: false,
      error: `Invalid scopes: ${invalidScopes.join(', ')}`
    }
  }

  return { valid: true }
}

/**
 * Validate IP address (IPv4 or IPv6)
 */
export function validateIPAddress(ip: string): { valid: boolean; error?: string } {
  // IPv4 regex
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

  // IPv6 regex (simplified)
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/

  if (!ip) {
    return { valid: false, error: 'IP address is required' }
  }

  if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
    return { valid: false, error: 'Invalid IP address format' }
  }

  return { valid: true }
}

/**
 * Validate rate limit value
 */
export function validateRateLimit(limit: number): { valid: boolean; error?: string } {
  if (limit === undefined || limit === null) {
    return { valid: false, error: 'Rate limit is required' }
  }

  if (!Number.isInteger(limit)) {
    return { valid: false, error: 'Rate limit must be an integer' }
  }

  if (limit < 0) {
    return { valid: false, error: 'Rate limit cannot be negative' }
  }

  if (limit > 1000000) {
    return { valid: false, error: 'Rate limit cannot exceed 1,000,000 requests' }
  }

  return { valid: true }
}