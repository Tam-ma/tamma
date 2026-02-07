/**
 * Rate limiter unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter, RateLimiterRegistry } from '../../src/security/rate-limiter.js';
import { MCPRateLimitError } from '../../src/errors.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter({
      serverName: 'test-server',
      requestsPerMinute: 60, // 1 per second
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquire', () => {
    it('should allow requests within limit', () => {
      expect(() => limiter.acquire()).not.toThrow();
    });

    it('should throw MCPRateLimitError when rate limited', () => {
      // Use up all tokens (60 tokens at start)
      for (let i = 0; i < 60; i++) {
        limiter.acquire();
      }

      expect(() => limiter.acquire()).toThrow(MCPRateLimitError);
    });

    it('should include retry after time in error', () => {
      // Use up all tokens
      for (let i = 0; i < 60; i++) {
        limiter.acquire();
      }

      try {
        limiter.acquire();
      } catch (error) {
        expect(error).toBeInstanceOf(MCPRateLimitError);
        expect((error as MCPRateLimitError).retryAfterMs).toBeGreaterThan(0);
      }
    });
  });

  describe('tryAcquire', () => {
    it('should return true when token available', () => {
      expect(limiter.tryAcquire()).toBe(true);
    });

    it('should return false when rate limited', () => {
      // Use up all tokens
      for (let i = 0; i < 60; i++) {
        limiter.tryAcquire();
      }

      expect(limiter.tryAcquire()).toBe(false);
    });
  });

  describe('canAcquire', () => {
    it('should return true when token available', () => {
      expect(limiter.canAcquire()).toBe(true);
    });

    it('should not consume token', () => {
      const before = limiter.getAvailableTokens();
      limiter.canAcquire();
      const after = limiter.getAvailableTokens();

      expect(before).toBe(after);
    });

    it('should return false when rate limited', () => {
      // Use up all tokens
      for (let i = 0; i < 60; i++) {
        limiter.acquire();
      }

      expect(limiter.canAcquire()).toBe(false);
    });
  });

  describe('getAvailableTokens', () => {
    it('should return initial token count', () => {
      expect(limiter.getAvailableTokens()).toBe(60);
    });

    it('should decrease after acquire', () => {
      limiter.acquire();
      expect(limiter.getAvailableTokens()).toBe(59);
    });
  });

  describe('token refill', () => {
    it('should refill tokens over time', () => {
      // Use up all tokens
      for (let i = 0; i < 60; i++) {
        limiter.acquire();
      }

      expect(limiter.getAvailableTokens()).toBe(0);

      // Advance time by 1 second (should add 1 token)
      vi.advanceTimersByTime(1000);

      expect(limiter.getAvailableTokens()).toBe(1);
    });

    it('should not exceed max tokens', () => {
      // Advance time significantly
      vi.advanceTimersByTime(120000); // 2 minutes

      expect(limiter.getAvailableTokens()).toBe(60);
    });
  });

  describe('getTimeUntilNextToken', () => {
    it('should return 0 when tokens available', () => {
      expect(limiter.getTimeUntilNextToken()).toBe(0);
    });

    it('should return time until next token when rate limited', () => {
      // Use up all tokens
      for (let i = 0; i < 60; i++) {
        limiter.acquire();
      }

      const time = limiter.getTimeUntilNextToken();
      expect(time).toBeGreaterThan(0);
      expect(time).toBeLessThanOrEqual(1000); // Should be around 1 second
    });
  });

  describe('reset', () => {
    it('should restore tokens to max', () => {
      // Use some tokens
      for (let i = 0; i < 30; i++) {
        limiter.acquire();
      }

      limiter.reset();

      expect(limiter.getAvailableTokens()).toBe(60);
    });
  });
});

describe('RateLimiterRegistry', () => {
  let registry: RateLimiterRegistry;

  beforeEach(() => {
    registry = new RateLimiterRegistry();
  });

  describe('getOrCreate', () => {
    it('should create a new limiter', () => {
      const limiter = registry.getOrCreate('server1', 100);

      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('should return existing limiter', () => {
      const limiter1 = registry.getOrCreate('server1', 100);
      const limiter2 = registry.getOrCreate('server1', 200);

      expect(limiter1).toBe(limiter2);
    });
  });

  describe('get', () => {
    it('should return existing limiter', () => {
      registry.getOrCreate('server1', 100);
      const limiter = registry.get('server1');

      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('should return undefined for non-existent limiter', () => {
      const limiter = registry.get('nonexistent');

      expect(limiter).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove a limiter', () => {
      registry.getOrCreate('server1', 100);

      const result = registry.remove('server1');

      expect(result).toBe(true);
      expect(registry.get('server1')).toBeUndefined();
    });

    it('should return false for non-existent limiter', () => {
      const result = registry.remove('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('should reset all limiters', () => {
      vi.useFakeTimers();

      const limiter1 = registry.getOrCreate('server1', 60);
      const limiter2 = registry.getOrCreate('server2', 60);

      // Use some tokens
      limiter1.acquire();
      limiter2.acquire();

      registry.resetAll();

      expect(limiter1.getAvailableTokens()).toBe(60);
      expect(limiter2.getAvailableTokens()).toBe(60);

      vi.useRealTimers();
    });
  });

  describe('clear', () => {
    it('should remove all limiters', () => {
      registry.getOrCreate('server1', 100);
      registry.getOrCreate('server2', 100);

      registry.clear();

      expect(registry.get('server1')).toBeUndefined();
      expect(registry.get('server2')).toBeUndefined();
    });
  });
});
