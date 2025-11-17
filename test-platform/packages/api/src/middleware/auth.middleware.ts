/**
 * Authentication middleware for protecting routes
 * Verifies JWT tokens and API keys
 */

import type { Context, Next } from 'hono'
import { extractTokenFromHeader, verifyToken, type DecodedToken } from '../utils/jwt'
import { APIKeyService } from '../services/api-key.service'
import type { HonoContext } from '../index'

// Extend context with user information
declare module 'hono' {
  interface ContextVariableMap {
    user?: DecodedToken
    apiKey?: any
  }
}

/**
 * Require authentication via JWT token
 * Verifies the access token and attaches user to context
 */
export async function requireAuth(c: HonoContext, next: Next) {
  try {
    const authHeader = c.req.header('Authorization')
    const token = extractTokenFromHeader(authHeader)

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const decoded = await verifyToken(token, c.env.JWT_SECRET)

    if (!decoded) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Check token type
    if (decoded.type !== 'access') {
      return c.json({ error: 'Invalid token type. Access token required' }, 401)
    }

    // Attach user to context for use in routes
    c.set('user', decoded)

    await next()
  } catch (error) {
    console.error('Authentication error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}

/**
 * Optional authentication
 * Tries to authenticate but allows access even if no token is provided
 */
export async function optionalAuth(c: HonoContext, next: Next) {
  try {
    const authHeader = c.req.header('Authorization')
    const token = extractTokenFromHeader(authHeader)

    if (token) {
      const decoded = await verifyToken(token, c.env.JWT_SECRET)

      if (decoded && decoded.type === 'access') {
        // Attach user to context if valid token
        c.set('user', decoded)
      }
    }

    await next()
  } catch (error) {
    // Log error but continue without authentication
    console.error('Optional auth error:', error)
    await next()
  }
}

/**
 * API Key authentication middleware
 * Validates API key from X-API-Key header
 */
export async function requireAPIKey(c: HonoContext, next: Next) {
  try {
    const apiKey = c.req.header('X-API-Key')

    if (!apiKey) {
      return c.json({ error: 'API key required' }, 401)
    }

    const apiKeyService = new APIKeyService({
      db: c.get('db'),
    })

    const result = await apiKeyService.validateKey(apiKey)

    if (!result.valid || !result.key) {
      return c.json({ error: result.error || 'Invalid API key' }, 401)
    }

    // Check IP whitelist if configured
    const clientIP = c.req.header('CF-Connecting-IP') ||
                     c.req.header('X-Forwarded-For')?.split(',')[0] ||
                     c.req.header('X-Real-IP') ||
                     'unknown'

    if (result.key.ipWhitelist && !apiKeyService.checkIPWhitelist(result.key, clientIP)) {
      return c.json({ error: 'IP address not whitelisted' }, 403)
    }

    // Check rate limit
    const rateLimitResult = await apiKeyService.checkRateLimit(result.key.id)

    if (!rateLimitResult.allowed) {
      // Set rate limit headers
      c.header('X-RateLimit-Limit', result.key.rateLimit.toString())
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', new Date(Date.now() + 60 * 60 * 1000).toISOString())

      return c.json({ error: 'Rate limit exceeded' }, 429)
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', result.key.rateLimit.toString())
    c.header('X-RateLimit-Remaining', rateLimitResult.remaining.toString())
    c.header('X-RateLimit-Reset', new Date(Date.now() + 60 * 60 * 1000).toISOString())

    // Track API usage
    const startTime = Date.now()

    // Attach API key to context
    c.set('apiKey', result.key)

    // Continue to the route handler
    await next()

    // After response, track usage
    const responseTime = Date.now() - startTime
    const status = c.res.status

    await apiKeyService.trackUsage({
      keyId: result.key.id,
      endpoint: c.req.path,
      method: c.req.method,
      statusCode: status,
      responseTime,
      ipAddress: clientIP,
    })

  } catch (error) {
    console.error('API key authentication error:', error)
    return c.json({ error: 'API key authentication failed' }, 401)
  }
}

/**
 * Combined authentication middleware
 * Accepts either JWT token or API key
 */
export async function requireAuthOrAPIKey(c: HonoContext, next: Next) {
  const authHeader = c.req.header('Authorization')
  const apiKey = c.req.header('X-API-Key')

  if (authHeader) {
    // Try JWT authentication
    return requireAuth(c, next)
  } else if (apiKey) {
    // Try API key authentication
    return requireAPIKey(c, next)
  } else {
    return c.json({ error: 'Authentication required. Provide either Bearer token or API key' }, 401)
  }
}

/**
 * Check if user has required scope
 * Must be used after requireAuth or requireAPIKey
 */
export function requireScope(scope: string) {
  return async (c: HonoContext, next: Next) => {
    const user = c.get('user')
    const apiKey = c.get('apiKey')

    if (user) {
      // For JWT auth, we might store scopes in the token or fetch from DB
      // For now, we'll assume all authenticated users have access
      await next()
    } else if (apiKey) {
      // Check if API key has the required scope
      const apiKeyService = new APIKeyService({
        db: c.get('db'),
      })

      if (!apiKeyService.hasScope(apiKey, scope)) {
        return c.json({ error: `Insufficient permissions. Required scope: ${scope}` }, 403)
      }

      await next()
    } else {
      return c.json({ error: 'Authentication required' }, 401)
    }
  }
}

/**
 * Rate limiting middleware
 * Can be used independently or with authentication
 */
export function rateLimit(options: {
  windowMs?: number
  max?: number
  keyGenerator?: (c: Context) => string
} = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // 100 requests per window
    keyGenerator = (c) => {
      // Default key generator uses IP address
      return c.req.header('CF-Connecting-IP') ||
             c.req.header('X-Forwarded-For')?.split(',')[0] ||
             c.req.header('X-Real-IP') ||
             'unknown'
    }
  } = options

  // In-memory store for rate limit tracking (consider using KV for production)
  const requestCounts = new Map<string, { count: number; resetTime: number }>()

  return async (c: Context, next: Next) => {
    const key = keyGenerator(c)
    const now = Date.now()

    let record = requestCounts.get(key)

    if (!record || now > record.resetTime) {
      // Create new record or reset expired one
      record = {
        count: 0,
        resetTime: now + windowMs
      }
      requestCounts.set(key, record)
    }

    record.count++

    // Set rate limit headers
    c.header('X-RateLimit-Limit', max.toString())
    c.header('X-RateLimit-Remaining', Math.max(0, max - record.count).toString())
    c.header('X-RateLimit-Reset', new Date(record.resetTime).toISOString())

    if (record.count > max) {
      return c.json({
        error: 'Too many requests. Please try again later.'
      }, 429)
    }

    await next()
  }
}