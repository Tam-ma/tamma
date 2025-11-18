/**
 * Rate Limiting Service Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitService } from '../../services/rate-limit.service';

describe('RateLimitService', () => {
  let rateLimitService: RateLimitService;

  beforeEach(() => {
    // Mock environment
    vi.stubEnv('NODE_ENV', 'test');
    rateLimitService = new RateLimitService();
  });

  afterEach(() => {
    vi.clearAllMocks();
    rateLimitService.destroy();
  });

  describe('In-Memory Store', () => {
    it('should allow requests within the limit', async () => {
      const key = 'test-key-1';
      const options = {
        windowMs: 60000, // 1 minute
        maxAttempts: 5
      };

      // First 5 requests should pass
      for (let i = 0; i < 5; i++) {
        const allowed = await rateLimitService.checkLimit(key, options);
        expect(allowed).toBe(true);
      }
    });

    it('should block requests exceeding the limit', async () => {
      const key = 'test-key-2';
      const options = {
        windowMs: 60000,
        maxAttempts: 3
      };

      // First 3 requests should pass
      for (let i = 0; i < 3; i++) {
        const allowed = await rateLimitService.checkLimit(key, options);
        expect(allowed).toBe(true);
      }

      // Fourth request should be blocked
      const blocked = await rateLimitService.checkLimit(key, options);
      expect(blocked).toBe(false);
    });

    it('should reset after time window expires', async () => {
      const key = 'test-key-3';
      const options = {
        windowMs: 100, // 100ms window
        maxAttempts: 2
      };

      // Use up the limit
      await rateLimitService.checkLimit(key, options);
      await rateLimitService.checkLimit(key, options);

      // Should be blocked
      let blocked = await rateLimitService.checkLimit(key, options);
      expect(blocked).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be allowed again
      const allowed = await rateLimitService.checkLimit(key, options);
      expect(allowed).toBe(true);
    });

    it('should track different keys independently', async () => {
      const options = {
        windowMs: 60000,
        maxAttempts: 2
      };

      // Use up limit for key1
      await rateLimitService.checkLimit('key1', options);
      await rateLimitService.checkLimit('key1', options);
      const key1Blocked = await rateLimitService.checkLimit('key1', options);
      expect(key1Blocked).toBe(false);

      // key2 should still be allowed
      const key2Allowed = await rateLimitService.checkLimit('key2', options);
      expect(key2Allowed).toBe(true);
    });
  });

  describe('getRemainingRequests', () => {
    it('should return correct remaining requests', async () => {
      const key = 'test-remaining';
      const options = {
        windowMs: 60000,
        maxAttempts: 5
      };

      // Make 2 requests
      await rateLimitService.checkLimit(key, options);
      await rateLimitService.checkLimit(key, options);

      const info = await rateLimitService.getRemainingRequests(key, options);

      expect(info.remaining).toBe(3);
      expect(info.total).toBe(5);
      expect(info.resetTime).toBeInstanceOf(Date);
      expect(info.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return 0 remaining when limit exceeded', async () => {
      const key = 'test-exceeded';
      const options = {
        windowMs: 60000,
        maxAttempts: 2
      };

      // Exceed limit
      await rateLimitService.checkLimit(key, options);
      await rateLimitService.checkLimit(key, options);
      await rateLimitService.checkLimit(key, options);

      const info = await rateLimitService.getRemainingRequests(key, options);

      expect(info.remaining).toBe(0);
      expect(info.total).toBe(2);
    });
  });

  describe('resetKey', () => {
    it('should reset the rate limit for a key', async () => {
      const key = 'test-reset';
      const options = {
        windowMs: 60000,
        maxAttempts: 2
      };

      // Use up the limit
      await rateLimitService.checkLimit(key, options);
      await rateLimitService.checkLimit(key, options);

      // Should be blocked
      let blocked = await rateLimitService.checkLimit(key, options);
      expect(blocked).toBe(false);

      // Reset the key
      await rateLimitService.resetKey(key);

      // Should be allowed again
      const allowed = await rateLimitService.checkLimit(key, options);
      expect(allowed).toBe(true);
    });
  });

  describe('middleware', () => {
    it('should create middleware that blocks requests', async () => {
      const middleware = rateLimitService.middleware({
        windowMs: 60000,
        maxAttempts: 1,
        message: 'Custom rate limit message'
      });

      // Mock Hono context
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'x-forwarded-for') return '127.0.0.1';
            return null;
          }),
          path: '/test'
        },
        header: vi.fn(),
        json: vi.fn()
      };

      const next = vi.fn();

      // First request should pass
      await middleware(mockContext, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Reset mocks
      next.mockClear();
      mockContext.json.mockClear();

      // Second request should be blocked
      await middleware(mockContext, next);
      expect(next).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Custom rate limit message'
        }),
        429
      );
    });

    it('should set rate limit headers', async () => {
      const middleware = rateLimitService.middleware({
        windowMs: 60000,
        maxAttempts: 5
      });

      const mockContext = {
        req: {
          header: vi.fn(() => '192.168.1.1'),
          path: '/api/test'
        },
        header: vi.fn(),
        json: vi.fn()
      };

      const next = vi.fn();

      await middleware(mockContext, next);

      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
      expect(mockContext.header).toHaveBeenCalledWith(
        'X-RateLimit-Remaining',
        expect.any(String)
      );
      expect(mockContext.header).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(String)
      );
    });
  });

  describe('createLimiter', () => {
    it('should create named rate limiters', async () => {
      const authLimiter = rateLimitService.createLimiter('auth', {
        windowMs: 60000,
        maxAttempts: 2
      });

      const mockContext = {
        req: {
          header: vi.fn(() => '10.0.0.1'),
          path: '/auth/login'
        },
        header: vi.fn(),
        json: vi.fn()
      };

      const next = vi.fn();

      // Test that limiter works
      await authLimiter(mockContext, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Reset and test again
      next.mockClear();
      await authLimiter(mockContext, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Third request should be blocked
      next.mockClear();
      await authLimiter(mockContext, next);
      expect(next).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        expect.any(Object),
        429
      );
    });
  });

  describe('Static limiters', () => {
    it('should provide pre-configured limiters', () => {
      const limiters = RateLimitService.limiters;

      expect(limiters).toHaveProperty('auth');
      expect(limiters).toHaveProperty('api');
      expect(limiters).toHaveProperty('passwordReset');
      expect(limiters).toHaveProperty('emailVerification');

      // Each should be a function (middleware)
      expect(typeof limiters.auth).toBe('function');
      expect(typeof limiters.api).toBe('function');
      expect(typeof limiters.passwordReset).toBe('function');
      expect(typeof limiters.emailVerification).toBe('function');
    });
  });
});