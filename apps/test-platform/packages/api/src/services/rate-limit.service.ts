/**
 * Rate Limiting Service
 * Provides both Redis-based and in-memory rate limiting
 */

import Redis from 'ioredis';
import { ApiError } from '../utils/api-error';

export interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxAttempts: number; // Maximum attempts allowed
  keyGenerator?: (req: any) => string; // Custom key generator
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  message?: string; // Custom error message
}

interface RateLimitInfo {
  remaining: number;
  resetTime: Date;
  total: number;
}

// In-memory storage for rate limiting (fallback)
class InMemoryStore {
  private store: Map<string, { count: number; resetTime: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.store.entries()) {
        if (value.resetTime < now) {
          this.store.delete(key);
        }
      }
    }, 60000);
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const resetTime = now + windowMs;

    const current = this.store.get(key);
    if (!current || current.resetTime < now) {
      this.store.set(key, { count: 1, resetTime });
      return 1;
    }

    current.count++;
    this.store.set(key, current);
    return current.count;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getCount(key: string): Promise<number> {
    const now = Date.now();
    const current = this.store.get(key);

    if (!current || current.resetTime < now) {
      return 0;
    }

    return current.count;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

export class RateLimitService {
  private redis: Redis | null = null;
  private inMemoryStore: InMemoryStore;
  private useRedis: boolean = false;

  constructor() {
    this.inMemoryStore = new InMemoryStore();
    this.initializeRedis();
  }

  private initializeRedis(): void {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      if (process.env.NODE_ENV === 'test' || !redisUrl) {
        console.log('Rate limiting using in-memory store');
        return;
      }

      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: 5000,
        retryStrategy: (times) => {
          if (times > 3) {
            console.error('Redis connection failed, falling back to in-memory store');
            this.useRedis = false;
            return null;
          }
          return Math.min(times * 200, 2000);
        }
      });

      this.redis.on('connect', () => {
        this.useRedis = true;
        console.log('Rate limiting connected to Redis');
      });

      this.redis.on('error', (error) => {
        console.error('Redis error, using in-memory store:', error.message);
        this.useRedis = false;
      });

      this.redis.on('ready', () => {
        this.useRedis = true;
      });

    } catch (error) {
      console.error('Failed to initialize Redis for rate limiting:', error);
      this.useRedis = false;
    }
  }

  /**
   * Check if request is within rate limit
   */
  async checkLimit(key: string, options: RateLimitOptions): Promise<boolean> {
    try {
      const count = await this.incrementCounter(key, options.windowMs);
      return count <= options.maxAttempts;
    } catch (error) {
      console.error('Rate limit check failed:', error);
      // Fail open - allow request if rate limiting fails
      return true;
    }
  }

  /**
   * Increment counter using Redis or in-memory store
   */
  private async incrementCounter(key: string, windowMs: number): Promise<number> {
    if (this.useRedis && this.redis) {
      return await this.incrementRedisCounter(key, windowMs);
    }
    return await this.inMemoryStore.increment(key, windowMs);
  }

  /**
   * Increment counter in Redis using sliding window
   */
  private async incrementRedisCounter(key: string, windowMs: number): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis not initialized');
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    const pipeline = this.redis.pipeline();

    // Remove old entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Add current request with unique identifier
    pipeline.zadd(key, now, `${now}-${Math.random()}`);

    // Count requests in window
    pipeline.zcard(key);

    // Set expiration
    pipeline.expire(key, Math.ceil(windowMs / 1000));

    const results = await pipeline.exec();

    if (!results || results.some(r => r[0])) {
      throw new Error('Redis pipeline failed');
    }

    return (results[2]?.[1] as number) || 0;
  }

  /**
   * Get remaining requests and reset time
   */
  async getRemainingRequests(
    key: string,
    options: RateLimitOptions
  ): Promise<RateLimitInfo> {
    try {
      let currentCount = 0;

      if (this.useRedis && this.redis) {
        const now = Date.now();
        const windowStart = now - options.windowMs;

        // Clean old entries and count current
        await this.redis.zremrangebyscore(key, 0, windowStart);
        currentCount = await this.redis.zcard(key);
      } else {
        currentCount = await this.inMemoryStore.getCount(key);
      }

      const remaining = Math.max(0, options.maxAttempts - currentCount);
      const resetTime = new Date(Date.now() + options.windowMs);

      return {
        remaining,
        resetTime,
        total: options.maxAttempts
      };
    } catch (error) {
      console.error('Failed to get remaining requests:', error);
      return {
        remaining: options.maxAttempts,
        resetTime: new Date(Date.now() + options.windowMs),
        total: options.maxAttempts
      };
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetKey(key: string): Promise<void> {
    try {
      if (this.useRedis && this.redis) {
        await this.redis.del(key);
      } else {
        await this.inMemoryStore.reset(key);
      }
    } catch (error) {
      console.error('Failed to reset rate limit key:', error);
    }
  }

  /**
   * Create middleware for Hono
   */
  middleware(options: RateLimitOptions) {
    return async (c: any, next: any) => {
      try {
        const defaultKeyGenerator = (ctx: any) => {
          const ip = ctx.req.header('x-forwarded-for') ||
                     ctx.req.header('x-real-ip') ||
                     ctx.env?.ip ||
                     'unknown';
          return `rate-limit:${ip}:${ctx.req.path}`;
        };

        const key = options.keyGenerator
          ? options.keyGenerator(c)
          : defaultKeyGenerator(c);

        const isAllowed = await this.checkLimit(key, options);

        if (!isAllowed) {
          const info = await this.getRemainingRequests(key, options);

          // Set rate limit headers
          c.header('X-RateLimit-Limit', info.total.toString());
          c.header('X-RateLimit-Remaining', info.remaining.toString());
          c.header('X-RateLimit-Reset', Math.ceil(info.resetTime.getTime() / 1000).toString());
          c.header('Retry-After', Math.ceil(options.windowMs / 1000).toString());

          const message = options.message || 'Too many requests, please try again later.';
          return c.json(
            {
              error: message,
              retryAfter: Math.ceil(options.windowMs / 1000)
            },
            429
          );
        }

        // Add rate limit headers for successful requests
        const info = await this.getRemainingRequests(key, options);
        c.header('X-RateLimit-Limit', info.total.toString());
        c.header('X-RateLimit-Remaining', info.remaining.toString());
        c.header('X-RateLimit-Reset', Math.ceil(info.resetTime.getTime() / 1000).toString());

        await next();
      } catch (error) {
        console.error('Rate limit middleware error:', error);
        // Fail open - allow request if rate limiting fails
        await next();
      }
    };
  }

  /**
   * Create specific rate limiters for different endpoints
   */
  createLimiter(name: string, options: RateLimitOptions) {
    return this.middleware({
      ...options,
      keyGenerator: (c) => {
        const ip = c.req.header('x-forwarded-for') ||
                   c.req.header('x-real-ip') ||
                   c.env?.ip ||
                   'unknown';
        return `rate-limit:${name}:${ip}`;
      }
    });
  }

  /**
   * Common rate limiters
   */
  static get limiters() {
    const service = new RateLimitService();

    return {
      // Strict rate limit for authentication endpoints
      auth: service.createLimiter('auth', {
        windowMs: 60 * 1000, // 1 minute
        maxAttempts: 5,
        message: 'Too many authentication attempts. Please try again later.'
      }),

      // More lenient for general API endpoints
      api: service.createLimiter('api', {
        windowMs: 60 * 1000, // 1 minute
        maxAttempts: 100,
        message: 'Too many requests. Please slow down.'
      }),

      // Very strict for password reset
      passwordReset: service.createLimiter('password-reset', {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxAttempts: 3,
        message: 'Too many password reset attempts. Please try again later.'
      }),

      // Email verification resend limit
      emailVerification: service.createLimiter('email-verification', {
        windowMs: 60 * 1000, // 1 minute
        maxAttempts: 2,
        message: 'Please wait before requesting another verification email.'
      })
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.redis) {
      this.redis.disconnect();
    }
    this.inMemoryStore.destroy();
  }
}

export const rateLimitService = new RateLimitService();