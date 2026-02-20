/**
 * @tamma/mcp-client
 * Rate limiter implementation
 */

import { MCPRateLimitError } from '../errors.js';

/**
 * Rate limiter options
 */
export interface RateLimiterOptions {
  /** Maximum requests per minute */
  requestsPerMinute: number;
  /** Server name for error messages */
  serverName: string;
}

/**
 * Token bucket rate limiter
 *
 * Implements a token bucket algorithm where tokens are added at a fixed rate
 * and consumed when requests are made.
 */
export class RateLimiter {
  private readonly serverName: string;
  private readonly tokensPerSecond: number;
  private readonly maxTokens: number;
  private tokens: number;
  private lastRefill: number;

  constructor(options: RateLimiterOptions) {
    this.serverName = options.serverName;
    this.tokensPerSecond = options.requestsPerMinute / 60;
    this.maxTokens = options.requestsPerMinute;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Try to acquire a token (make a request)
   * Throws MCPRateLimitError if rate limited
   */
  acquire(): void {
    this.refill();

    if (this.tokens < 1) {
      // Calculate time until next token
      const retryAfterMs = Math.ceil((1 / this.tokensPerSecond) * 1000);
      throw new MCPRateLimitError(this.serverName, retryAfterMs);
    }

    this.tokens -= 1;
  }

  /**
   * Try to acquire a token without throwing
   * Returns true if successful, false if rate limited
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens < 1) {
      return false;
    }

    this.tokens -= 1;
    return true;
  }

  /**
   * Check if a request can be made without consuming a token
   */
  canAcquire(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  /**
   * Get the current number of available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Get time in ms until the next token is available
   */
  getTimeUntilNextToken(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    const tokensNeeded = 1 - this.tokens;
    return Math.ceil((tokensNeeded / this.tokensPerSecond) * 1000);
  }

  /**
   * Reset the rate limiter to full capacity
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.tokensPerSecond;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Rate limiter registry for managing multiple rate limiters
 */
export class RateLimiterRegistry {
  private readonly limiters = new Map<string, RateLimiter>();

  /**
   * Get or create a rate limiter for a server
   */
  getOrCreate(serverName: string, requestsPerMinute: number): RateLimiter {
    let limiter = this.limiters.get(serverName);

    if (!limiter) {
      limiter = new RateLimiter({ serverName, requestsPerMinute });
      this.limiters.set(serverName, limiter);
    }

    return limiter;
  }

  /**
   * Get an existing rate limiter
   */
  get(serverName: string): RateLimiter | undefined {
    return this.limiters.get(serverName);
  }

  /**
   * Remove a rate limiter
   */
  remove(serverName: string): boolean {
    return this.limiters.delete(serverName);
  }

  /**
   * Reset all rate limiters
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }

  /**
   * Clear all rate limiters
   */
  clear(): void {
    this.limiters.clear();
  }
}
