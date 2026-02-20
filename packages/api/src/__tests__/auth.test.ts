/**
 * Auth Plugin Tests
 *
 * Tests for JWT authentication routes and rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerAuthPlugin, InMemoryRateLimiter } from '../auth/index.js';

// ---------------------------------------------------------------------------
// InMemoryRateLimiter unit tests
// ---------------------------------------------------------------------------

describe('InMemoryRateLimiter', () => {
  it('allows requests up to the max limit', () => {
    const limiter = new InMemoryRateLimiter({ max: 3, windowMs: 60_000 });
    try {
      expect(limiter.check('ip1').allowed).toBe(true);
      expect(limiter.check('ip1').allowed).toBe(true);
      expect(limiter.check('ip1').allowed).toBe(true);
      expect(limiter.check('ip1').allowed).toBe(false);
    } finally {
      limiter.destroy();
    }
  });

  it('tracks remaining count correctly', () => {
    const limiter = new InMemoryRateLimiter({ max: 3, windowMs: 60_000 });
    try {
      expect(limiter.check('ip1').remaining).toBe(2);
      expect(limiter.check('ip1').remaining).toBe(1);
      expect(limiter.check('ip1').remaining).toBe(0);
      // After exhausting, remaining stays at 0
      expect(limiter.check('ip1').remaining).toBe(0);
    } finally {
      limiter.destroy();
    }
  });

  it('tracks different keys independently', () => {
    const limiter = new InMemoryRateLimiter({ max: 1, windowMs: 60_000 });
    try {
      expect(limiter.check('ip1').allowed).toBe(true);
      expect(limiter.check('ip1').allowed).toBe(false);
      // Different key should still be allowed
      expect(limiter.check('ip2').allowed).toBe(true);
    } finally {
      limiter.destroy();
    }
  });

  it('resets after the window expires', async () => {
    const limiter = new InMemoryRateLimiter({ max: 1, windowMs: 50 });
    try {
      expect(limiter.check('ip1').allowed).toBe(true);
      expect(limiter.check('ip1').allowed).toBe(false);
      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(limiter.check('ip1').allowed).toBe(true);
    } finally {
      limiter.destroy();
    }
  });

  it('returns a resetAt timestamp in the future', () => {
    const limiter = new InMemoryRateLimiter({ max: 5, windowMs: 60_000 });
    try {
      const before = Date.now();
      const result = limiter.check('ip1');
      expect(result.resetAt).toBeGreaterThanOrEqual(before);
      expect(result.resetAt).toBeLessThanOrEqual(before + 60_000 + 10);
    } finally {
      limiter.destroy();
    }
  });

  it('uses default config when none provided', () => {
    const limiter = new InMemoryRateLimiter();
    try {
      // Default is 10 requests per 60s window
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('ip1').allowed).toBe(true);
      }
      expect(limiter.check('ip1').allowed).toBe(false);
    } finally {
      limiter.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Auth route rate limiting integration tests
// ---------------------------------------------------------------------------

describe('Auth Routes Rate Limiting', () => {
  let app: FastifyInstance;
  const RATE_LIMIT_MAX = 3;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(registerAuthPlugin, {
      jwtSecret: 'test-secret',
      enableAuth: false,
      rateLimit: { max: RATE_LIMIT_MAX, windowMs: 60_000 },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/auth/login returns rate limit headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test', password: 'test' },
    });

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('POST /api/auth/api-key returns rate limit headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/api-key',
      payload: { apiKey: 'some-key' },
    });

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('POST /api/auth/refresh returns rate limit headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'invalid' },
    });

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });
});

describe('Auth Routes Rate Limiting - 429 Responses', () => {
  let app: FastifyInstance;
  const RATE_LIMIT_MAX = 2;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(registerAuthPlugin, {
      jwtSecret: 'test-secret',
      enableAuth: false,
      rateLimit: { max: RATE_LIMIT_MAX, windowMs: 60_000 },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after exceeding rate limit on /api/auth/login', async () => {
    // Exhaust the rate limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'test', password: 'test' },
      });
      expect(res.statusCode).not.toBe(429);
    }

    // Next request should be rate limited
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test', password: 'test' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error).toMatch(/too many requests/i);
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('shares rate limit across all auth routes (same IP)', async () => {
    // The rate limit was already exhausted by the previous test (same IP: 127.0.0.1)
    // All auth routes share the same limiter, so these should also be rate limited.
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'invalid' },
    });
    expect(refreshRes.statusCode).toBe(429);

    const apiKeyRes = await app.inject({
      method: 'POST',
      url: '/api/auth/api-key',
      payload: { apiKey: 'some-key' },
    });
    expect(apiKeyRes.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Auth route basic functionality tests (dev mode)
// ---------------------------------------------------------------------------

describe('Auth Routes - Basic Functionality', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(registerAuthPlugin, {
      jwtSecret: 'test-secret',
      enableAuth: false,
      rateLimit: { max: 100, windowMs: 60_000 },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/auth/login returns tokens in dev mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test', password: 'test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.user.username).toBe('test');
  });

  it('POST /api/auth/login returns 400 without credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/auth/api-key returns a token in dev mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/api-key',
      payload: { apiKey: 'any-key' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.user.role).toBe('operator');
  });

  it('POST /api/auth/api-key returns 400 without apiKey', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/api-key',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/auth/refresh returns 400 without refreshToken', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/auth/refresh works with a valid refresh token', async () => {
    // First get a refresh token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test', password: 'test' },
    });
    const { refreshToken } = loginRes.json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeDefined();
  });

  it('POST /api/auth/refresh returns 401 for invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'invalid-token' },
    });

    expect(response.statusCode).toBe(401);
  });
});
