/**
 * JWT Authentication Plugin
 *
 * Fastify plugin that provides:
 *   POST /api/auth/login     - username/password login  -> JWT
 *   POST /api/auth/refresh   - refresh token            -> new JWT
 *   POST /api/auth/api-key   - API key auth (CI/scripts)-> JWT
 *
 * When `enableAuth` is false (dev mode), all routes pass through with a stub user.
 */

import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Max requests per window. Default: 10 */
  max?: number;
  /** Window size in milliseconds. Default: 60000 (1 minute) */
  windowMs?: number;
}

export interface AuthConfig {
  jwtSecret: string;
  enableAuth: boolean;
  /** Optional list of valid API keys for machine-to-machine auth. */
  apiKeys?: string[];
  /** Token expiry in seconds. Default: 3600 (1 hour). */
  tokenExpiresIn?: number;
  /** Refresh token expiry in seconds. Default: 604800 (7 days). */
  refreshExpiresIn?: number;
  /** Rate limit configuration for auth routes. */
  rateLimit?: RateLimitConfig;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
}

interface LoginBody {
  username: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

interface ApiKeyBody {
  apiKey: string;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (no external dependency required)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly store = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig = {}) {
    this.max = config.max ?? 10;
    this.windowMs = config.windowMs ?? 60_000;
    // Periodically clean up expired entries to prevent unbounded memory growth
    this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs * 2);
    // Allow the process to exit even if the timer is still running
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check whether the given key is allowed to make a request.
   * Returns { allowed, remaining, resetAt } so callers can set headers.
   */
  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      // First request in a new window
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1, resetAt: now + this.windowMs };
    }

    if (entry.count < this.max) {
      entry.count++;
      return { allowed: true, remaining: this.max - entry.count, resetAt: entry.resetAt };
    }

    // Rate limit exceeded
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  /** Remove expired entries. */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  /** Stop the cleanup timer (useful for tests / graceful shutdown). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Stub user for dev mode
// ---------------------------------------------------------------------------

const STUB_USER: AuthUser = {
  id: 'dev-user',
  username: 'developer',
  role: 'admin',
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

async function authPlugin(
  fastify: FastifyInstance,
  opts: AuthConfig,
): Promise<void> {
  const {
    jwtSecret,
    enableAuth,
    apiKeys = [],
    tokenExpiresIn = 3600,
    refreshExpiresIn = 604800,
    rateLimit: rateLimitConfig,
  } = opts;

  // Require a real secret when auth is enabled
  if (enableAuth && !jwtSecret) {
    throw new Error('TAMMA_JWT_SECRET must be set when authentication is enabled');
  }
  const secret = jwtSecret || 'dev-secret-do-not-use-in-production';

  // Create rate limiter for auth routes
  const rateLimiter = new InMemoryRateLimiter(rateLimitConfig);

  // Clean up rate limiter when server closes
  fastify.addHook('onClose', () => {
    rateLimiter.destroy();
  });

  /**
   * Rate-limit preHandler for auth routes.
   * Uses the client IP as the rate-limit key.
   */
  const rateLimitPreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.ip;
    const { allowed, remaining, resetAt } = rateLimiter.check(key);

    reply.header('X-RateLimit-Limit', rateLimitConfig?.max ?? 10);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      reply.header('Retry-After', retryAfter);
      return reply.status(429).send({ error: 'Too many requests, please try again later' });
    }
  };

  // Register @fastify/jwt
  await fastify.register(await import('@fastify/jwt').then((m) => m.default ?? m), {
    secret,
    sign: { expiresIn: `${tokenExpiresIn}s` },
  });

  // ------------------------------------------------------------------
  // Decorate request with user
  // ------------------------------------------------------------------
  fastify.decorateRequest('authUser', null);

  // ------------------------------------------------------------------
  // Global onRequest hook
  // ------------------------------------------------------------------
  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Dev mode — skip auth entirely
      if (!enableAuth) {
        (request as FastifyRequest & { authUser: AuthUser }).authUser = STUB_USER;
        return;
      }

      // Public routes that don't need auth
      const publicPaths = ['/api/auth/login', '/api/auth/api-key', '/api/health'];
      if (publicPaths.some((p) => request.url === p || request.url.startsWith(p + '/'))) {
        return;
      }

      // Verify JWT
      try {
        const decoded = await request.jwtVerify<{ id: string; username: string; role: string }>();

        const allowedRoles: ReadonlySet<string> = new Set(['admin', 'operator', 'viewer']);
        if (!allowedRoles.has(decoded.role)) {
          return reply.status(403).send({ error: 'Invalid role in token' });
        }

        (request as FastifyRequest & { authUser: AuthUser }).authUser = {
          id: decoded.id,
          username: decoded.username,
          role: decoded.role as AuthUser['role'],
        };
      } catch (err) {
        // If we already sent a 403 for invalid role, don't override it
        if (reply.sent) return;
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /api/auth/login
  // ------------------------------------------------------------------
  fastify.post(
    '/api/auth/login',
    { preHandler: rateLimitPreHandler },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { username, password } = request.body ?? {};

      if (!username || !password) {
        return reply.status(400).send({ error: 'username and password are required' });
      }

      // In a real implementation this would check a user store.
      // For MVP we accept any non-empty credentials when auth is disabled,
      // or require a valid user store lookup when auth is enabled.
      if (enableAuth) {
        // Placeholder: reject all logins until a real user store is wired up
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const user: AuthUser = { id: 'user-1', username, role: 'admin' };
      const token = fastify.jwt.sign({ id: user.id, username: user.username, role: user.role });
      const refreshToken = fastify.jwt.sign(
        { id: user.id, username: user.username, role: user.role, type: 'refresh' },
        { expiresIn: `${refreshExpiresIn}s` },
      );

      return reply.send({ token, refreshToken, user });
    },
  );

  // ------------------------------------------------------------------
  // POST /api/auth/refresh
  // ------------------------------------------------------------------
  fastify.post(
    '/api/auth/refresh',
    { preHandler: rateLimitPreHandler },
    async (request: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
      const { refreshToken } = request.body ?? {};

      if (!refreshToken) {
        return reply.status(400).send({ error: 'refreshToken is required' });
      }

      try {
        const decoded = fastify.jwt.verify<{
          id: string;
          username: string;
          role: string;
          type?: string;
        }>(refreshToken);

        if (decoded.type !== 'refresh') {
          return reply.status(400).send({ error: 'Invalid refresh token' });
        }

        const token = fastify.jwt.sign({
          id: decoded.id,
          username: decoded.username,
          role: decoded.role,
        });

        return reply.send({ token });
      } catch {
        return reply.status(401).send({ error: 'Invalid or expired refresh token' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /api/auth/api-key
  // ------------------------------------------------------------------
  fastify.post(
    '/api/auth/api-key',
    { preHandler: rateLimitPreHandler },
    async (request: FastifyRequest<{ Body: ApiKeyBody }>, reply: FastifyReply) => {
      const { apiKey } = request.body ?? {};

      if (!apiKey) {
        return reply.status(400).send({ error: 'apiKey is required' });
      }

      if (enableAuth) {
        const isValidKey = apiKeys.some((k) => {
          try {
            return (
              k.length === apiKey.length &&
              timingSafeEqual(Buffer.from(k), Buffer.from(apiKey))
            );
          } catch {
            return false;
          }
        });
        if (!isValidKey) {
          return reply.status(401).send({ error: 'Invalid API key' });
        }
      }

      const user: AuthUser = { id: 'api-user', username: 'api', role: 'operator' };
      const token = fastify.jwt.sign({ id: user.id, username: user.username, role: user.role });

      return reply.send({ token, user });
    },
  );
}

export const registerAuthPlugin = fp(authPlugin, {
  name: 'tamma-auth',
});
