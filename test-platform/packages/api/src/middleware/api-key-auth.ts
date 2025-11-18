/**
 * API Key Authentication Middleware
 * Handles API key authentication and authorization
 */

import { Context, Next } from 'hono';
import { apiKeyService, ApiKeyData } from '../services/api-key-service';
import { logger } from '../../../../src/observability/logger';
import { ApiError } from '../utils/api-error';

export interface ApiKeyAuthOptions {
  required?: boolean;
  checkPermissions?: string[];
  checkScopes?: string[];
  rateLimitPerHour?: number;
}

// Extend Hono Context to include API key data
declare module 'hono' {
  interface ContextVariableMap {
    apiKey?: {
      id: string;
      keyId: string;
      userId: string;
      organizationId?: string;
      permissions: string[];
      scopes: string[];
      keyType: string;
    };
    user?: {
      sub: string;
      email?: string;
      organizationId?: string;
      permissions?: string[];
    };
  }
}

/**
 * Main API key authentication middleware
 */
export function apiKeyAuth(options: ApiKeyAuthOptions = {}) {
  return async (c: Context, next: Next) => {
    try {
      const apiKey = extractApiKey(c);

      if (!apiKey) {
        if (options.required) {
          return c.json(
            { error: 'API key is required' },
            401
          );
        }
        return next();
      }

      // Get client context for validation
      const context = {
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
        userAgent: c.req.header('user-agent'),
        domain: getDomainFromRequest(c),
      };

      // Validate API key
      const validation = await apiKeyService.validateApiKey(apiKey, context);

      if (!validation.isValid) {
        return c.json(
          { error: validation.error || 'Invalid API key' },
          401
        );
      }

      const keyData = validation.keyData!;

      // Check permissions if required
      if (options.checkPermissions && options.checkPermissions.length > 0) {
        const hasPermissions = checkKeyPermissions(keyData, options.checkPermissions);
        if (!hasPermissions) {
          return c.json(
            { error: 'Insufficient permissions' },
            403
          );
        }
      }

      // Check scopes if required
      if (options.checkScopes && options.checkScopes.length > 0) {
        const hasScopes = checkKeyScopes(keyData, options.checkScopes);
        if (!hasScopes) {
          return c.json(
            { error: 'Insufficient scopes' },
            403
          );
        }
      }

      // Apply rate limiting if configured
      if (options.rateLimitPerHour) {
        const withinLimit = await checkRateLimit(keyData.id, options.rateLimitPerHour);
        if (!withinLimit) {
          return c.json(
            { error: 'Rate limit exceeded' },
            429
          );
        }
      }

      // Add API key info to context
      c.set('apiKey', {
        id: keyData.id,
        keyId: keyData.key_id,
        userId: keyData.user_id,
        organizationId: keyData.organization_id,
        permissions: keyData.permissions || [],
        scopes: keyData.scopes || [],
        keyType: keyData.key_type,
      });

      // Add user info to context for compatibility with JWT auth
      c.set('user', {
        sub: keyData.user_id,
        organizationId: keyData.organization_id,
        permissions: keyData.permissions || [],
      });

      logger.debug('API key authentication successful', {
        keyId: keyData.key_id,
        userId: keyData.user_id,
        organizationId: keyData.organization_id,
        ipAddress: context.ipAddress,
      });

      return next();
    } catch (error) {
      logger.error('API key authentication error', { error });
      return c.json(
        { error: 'Authentication failed' },
        500
      );
    }
  };
}

/**
 * Middleware to require specific API key permissions
 */
export function requirePermissions(permissions: string[]) {
  return apiKeyAuth({
    required: true,
    checkPermissions: permissions,
  });
}

/**
 * Middleware to require specific API key scopes
 */
export function requireScopes(scopes: string[]) {
  return apiKeyAuth({
    required: true,
    checkScopes: scopes,
  });
}

/**
 * Middleware with rate limiting
 */
export function withRateLimit(requestsPerHour: number) {
  return apiKeyAuth({
    required: true,
    rateLimitPerHour: requestsPerHour,
  });
}

/**
 * Optional API key authentication (doesn't fail if no key provided)
 */
export function optionalApiKeyAuth() {
  return apiKeyAuth({
    required: false,
  });
}

/**
 * Extract API key from request
 */
function extractApiKey(c: Context): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = c.req.header('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check X-API-Key header
  const apiKeyHeader = c.req.header('x-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  // Check query parameter (less secure, but sometimes needed)
  const apiKeyQuery = c.req.query('api_key');
  if (apiKeyQuery) {
    return apiKeyQuery;
  }

  return null;
}

/**
 * Get domain from request headers
 */
function getDomainFromRequest(c: Context): string | undefined {
  // Check Origin header
  const origin = c.req.header('origin');
  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      // Invalid URL, continue
    }
  }

  // Check Referer header
  const referer = c.req.header('referer');
  if (referer) {
    try {
      return new URL(referer).hostname;
    } catch {
      // Invalid URL, continue
    }
  }

  // Check Host header
  const host = c.req.header('host');
  if (host) {
    return host.split(':')[0]; // Remove port if present
  }

  return undefined;
}

/**
 * Check if API key has required permissions
 */
function checkKeyPermissions(keyData: ApiKeyData, requiredPermissions: string[]): boolean {
  const keyPermissions = keyData.permissions || [];

  for (const permission of requiredPermissions) {
    if (!keyPermissions.includes(permission)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if API key has required scopes
 */
function checkKeyScopes(keyData: ApiKeyData, requiredScopes: string[]): boolean {
  const keyScopes = keyData.scopes || [];

  for (const scope of requiredScopes) {
    if (!keyScopes.includes(scope)) {
      return false;
    }
  }

  return true;
}

/**
 * Check rate limit for API key
 * Note: This is a simplified version. In production, use Redis or similar for distributed rate limiting
 */
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

async function checkRateLimit(keyId: string, requestsPerHour: number): Promise<boolean> {
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;

  const cacheEntry = rateLimitCache.get(keyId);

  if (!cacheEntry || now > cacheEntry.resetTime) {
    // Reset rate limit
    rateLimitCache.set(keyId, {
      count: 1,
      resetTime: now + hourInMs,
    });
    return true;
  }

  if (cacheEntry.count >= requestsPerHour) {
    logger.warn('API key rate limit exceeded', {
      keyId,
      count: cacheEntry.count,
      limit: requestsPerHour,
    });
    return false;
  }

  cacheEntry.count++;
  return true;
}

// Clean up rate limit cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [keyId, entry] of rateLimitCache.entries()) {
    if (now > entry.resetTime) {
      rateLimitCache.delete(keyId);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour