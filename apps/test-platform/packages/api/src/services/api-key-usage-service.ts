/**
 * API Key Usage Service
 * Handles usage tracking, statistics, and rate limiting for API keys
 */

import Redis from 'ioredis';
import { getDatabase } from '../../../../src/database/connection';
import { logger } from '../../../../src/observability/logger';
import { ApiError } from '../utils/api-error';

export interface UsageStats {
  totalRequests: number;
  requestsThisHour: number;
  requestsToday: number;
  requestsThisMonth: number;
  lastUsedAt?: Date;
  topEndpoints: Array<{
    endpoint: string;
    count: number;
  }>;
  errorRate: number;
  averageResponseTime: number;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
}

export class ApiKeyUsageService {
  private redis: Redis | null = null;
  private useInMemoryFallback = false;
  private inMemoryStore = new Map<string, any>();

  constructor(redisUrl?: string) {
    // Try to connect to Redis if URL is provided
    if (redisUrl || process.env.REDIS_URL) {
      try {
        this.redis = new Redis(redisUrl || process.env.REDIS_URL!, {
          retryStrategy: (times) => {
            if (times > 3) {
              logger.warn('Redis connection failed, falling back to in-memory store');
              this.useInMemoryFallback = true;
              return null;
            }
            return Math.min(times * 50, 2000);
          },
        });

        this.redis.on('error', (error) => {
          logger.error('Redis connection error', { error });
          this.useInMemoryFallback = true;
        });

        this.redis.on('connect', () => {
          logger.info('Redis connected successfully');
          this.useInMemoryFallback = false;
        });
      } catch (error) {
        logger.warn('Redis initialization failed, using in-memory store', { error });
        this.useInMemoryFallback = true;
      }
    } else {
      logger.info('No Redis URL provided, using in-memory store for rate limiting');
      this.useInMemoryFallback = true;
    }
  }

  /**
   * Track API key usage
   */
  async trackUsage(
    keyId: string,
    endpoint: string,
    statusCode: number,
    responseTime: number,
    context?: {
      ipAddress?: string;
      userAgent?: string;
      method?: string;
      path?: string;
    }
  ): Promise<void> {
    try {
      const now = new Date();

      if (this.useInMemoryFallback || !this.redis) {
        // Use in-memory tracking
        this.trackUsageInMemory(keyId, endpoint, statusCode, responseTime);
      } else {
        // Use Redis for tracking
        await this.trackUsageInRedis(keyId, endpoint, statusCode, responseTime);
      }

      // Always update database for persistent storage
      await this.updateDatabaseUsage(keyId, endpoint, statusCode, responseTime, context);

      logger.debug('API key usage tracked', {
        keyId,
        endpoint,
        statusCode,
        responseTime,
      });
    } catch (error) {
      logger.error('Failed to track API key usage', { error, keyId, endpoint });
      // Don't throw error to avoid impacting the main request flow
    }
  }

  /**
   * Track usage in Redis
   */
  private async trackUsageInRedis(
    keyId: string,
    endpoint: string,
    statusCode: number,
    responseTime: number
  ): Promise<void> {
    if (!this.redis) return;

    const now = new Date();
    const hourKey = this.getHourKey(keyId);
    const dayKey = this.getDayKey(keyId);
    const monthKey = this.getMonthKey(keyId);

    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Hourly counter
    pipeline.incr(hourKey);
    pipeline.expire(hourKey, 2 * 60 * 60); // 2 hours

    // Daily counter
    pipeline.incr(dayKey);
    pipeline.expire(dayKey, 25 * 60 * 60); // 25 hours

    // Monthly counter
    pipeline.incr(monthKey);
    pipeline.expire(monthKey, 32 * 24 * 60 * 60); // 32 days

    // Track endpoints
    const endpointKey = `api_key:${keyId}:endpoints`;
    pipeline.hincrby(endpointKey, endpoint, 1);
    pipeline.expire(endpointKey, 7 * 24 * 60 * 60); // 7 days

    // Track errors
    if (statusCode >= 400) {
      const errorKey = `api_key:${keyId}:errors:hour`;
      pipeline.incr(errorKey);
      pipeline.expire(errorKey, 2 * 60 * 60); // 2 hours
    }

    // Track response times (keep last 100)
    const responseTimeKey = `api_key:${keyId}:response_times`;
    pipeline.lpush(responseTimeKey, responseTime.toString());
    pipeline.ltrim(responseTimeKey, 0, 99);
    pipeline.expire(responseTimeKey, 24 * 60 * 60); // 24 hours

    await pipeline.exec();
  }

  /**
   * Track usage in memory (fallback)
   */
  private trackUsageInMemory(
    keyId: string,
    endpoint: string,
    statusCode: number,
    responseTime: number
  ): void {
    const now = Date.now();
    const hourKey = this.getHourKey(keyId);

    // Initialize or get existing data
    if (!this.inMemoryStore.has(keyId)) {
      this.inMemoryStore.set(keyId, {
        hourly: {},
        endpoints: {},
        errors: 0,
        responseTimes: [],
      });
    }

    const data = this.inMemoryStore.get(keyId);

    // Update hourly count
    if (!data.hourly[hourKey]) {
      data.hourly[hourKey] = { count: 0, expires: now + 60 * 60 * 1000 };
    }
    data.hourly[hourKey].count++;

    // Update endpoint count
    data.endpoints[endpoint] = (data.endpoints[endpoint] || 0) + 1;

    // Track errors
    if (statusCode >= 400) {
      data.errors++;
    }

    // Track response times (keep last 100)
    data.responseTimes.unshift(responseTime);
    if (data.responseTimes.length > 100) {
      data.responseTimes = data.responseTimes.slice(0, 100);
    }

    // Clean up expired hourly data
    for (const key in data.hourly) {
      if (data.hourly[key].expires < now) {
        delete data.hourly[key];
      }
    }
  }

  /**
   * Check rate limit for an API key
   */
  async checkRateLimit(keyId: string, limitPerHour: number): Promise<RateLimitInfo> {
    try {
      const hourKey = this.getHourKey(keyId);
      let currentUsage = 0;

      if (this.useInMemoryFallback || !this.redis) {
        // Check in-memory rate limit
        const data = this.inMemoryStore.get(keyId);
        if (data && data.hourly[hourKey]) {
          currentUsage = data.hourly[hourKey].count;
        }
      } else {
        // Check Redis rate limit
        const usage = await this.redis.get(hourKey);
        currentUsage = parseInt(usage || '0');
      }

      const remaining = Math.max(0, limitPerHour - currentUsage);
      const resetTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      if (currentUsage >= limitPerHour) {
        logger.warn('API key rate limit exceeded', {
          keyId,
          usage: currentUsage,
          limit: limitPerHour,
        });
      }

      return {
        limit: limitPerHour,
        remaining,
        resetTime,
      };
    } catch (error) {
      logger.error('Failed to check rate limit', { error, keyId });
      // Fail open - allow request if rate limiting fails
      return {
        limit: limitPerHour,
        remaining: limitPerHour,
        resetTime: new Date(Date.now() + 60 * 60 * 1000),
      };
    }
  }

  /**
   * Get usage statistics for an API key
   */
  async getUsageStats(keyId: string): Promise<UsageStats> {
    try {
      let stats: UsageStats;

      if (this.useInMemoryFallback || !this.redis) {
        stats = await this.getUsageStatsFromMemory(keyId);
      } else {
        stats = await this.getUsageStatsFromRedis(keyId);
      }

      // Get last used timestamp from database
      const db = await getDatabase();
      const apiKey = await db('api_keys').where('id', keyId).first('last_used_at');
      if (apiKey?.last_used_at) {
        stats.lastUsedAt = apiKey.last_used_at;
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get usage stats', { error, keyId });
      throw new ApiError(500, 'Failed to get usage statistics');
    }
  }

  /**
   * Get usage stats from Redis
   */
  private async getUsageStatsFromRedis(keyId: string): Promise<UsageStats> {
    if (!this.redis) {
      return this.getEmptyStats();
    }

    const hourKey = this.getHourKey(keyId);
    const dayKey = this.getDayKey(keyId);
    const monthKey = this.getMonthKey(keyId);

    // Get usage counters
    const [hourly, daily, monthly] = await Promise.all([
      this.redis.get(hourKey),
      this.redis.get(dayKey),
      this.redis.get(monthKey),
    ]);

    // Get top endpoints
    const endpointKey = `api_key:${keyId}:endpoints`;
    const endpoints = await this.redis.hgetall(endpointKey);
    const topEndpoints = Object.entries(endpoints || {})
      .map(([endpoint, count]) => ({
        endpoint,
        count: parseInt(count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get error rate
    const errorKey = `api_key:${keyId}:errors:hour`;
    const errors = await this.redis.get(errorKey);
    const totalRequests = parseInt(hourly || '0');
    const errorCount = parseInt(errors || '0');
    const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

    // Get average response time
    const responseTimeKey = `api_key:${keyId}:response_times`;
    const responseTimes = await this.redis.lrange(responseTimeKey, 0, -1);
    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + parseFloat(time), 0) / responseTimes.length
        : 0;

    return {
      totalRequests: parseInt(monthly || '0'),
      requestsThisHour: parseInt(hourly || '0'),
      requestsToday: parseInt(daily || '0'),
      requestsThisMonth: parseInt(monthly || '0'),
      topEndpoints,
      errorRate,
      averageResponseTime,
    };
  }

  /**
   * Get usage stats from memory
   */
  private async getUsageStatsFromMemory(keyId: string): Promise<UsageStats> {
    const data = this.inMemoryStore.get(keyId);
    if (!data) {
      return this.getEmptyStats();
    }

    const hourKey = this.getHourKey(keyId);
    const requestsThisHour = data.hourly[hourKey]?.count || 0;

    // Calculate top endpoints
    const topEndpoints = Object.entries(data.endpoints)
      .map(([endpoint, count]) => ({ endpoint, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate error rate
    const errorRate = requestsThisHour > 0 ? (data.errors / requestsThisHour) * 100 : 0;

    // Calculate average response time
    const averageResponseTime =
      data.responseTimes.length > 0
        ? data.responseTimes.reduce((sum: number, time: number) => sum + time, 0) / data.responseTimes.length
        : 0;

    return {
      totalRequests: requestsThisHour, // In memory, we only have hourly data
      requestsThisHour,
      requestsToday: requestsThisHour, // Simplified for in-memory
      requestsThisMonth: requestsThisHour, // Simplified for in-memory
      topEndpoints,
      errorRate,
      averageResponseTime,
    };
  }

  /**
   * Get empty statistics
   */
  private getEmptyStats(): UsageStats {
    return {
      totalRequests: 0,
      requestsThisHour: 0,
      requestsToday: 0,
      requestsThisMonth: 0,
      topEndpoints: [],
      errorRate: 0,
      averageResponseTime: 0,
    };
  }

  /**
   * Reset usage counters for an API key
   */
  async resetUsageCounters(keyId: string): Promise<void> {
    try {
      if (this.useInMemoryFallback || !this.redis) {
        // Reset in-memory counters
        this.inMemoryStore.delete(keyId);
      } else {
        // Reset Redis counters
        const keys = await this.redis.keys(`api_key:${keyId}:*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      logger.info('API key usage counters reset', { keyId });
    } catch (error) {
      logger.error('Failed to reset usage counters', { error, keyId });
      throw new ApiError(500, 'Failed to reset usage counters');
    }
  }

  /**
   * Update database usage statistics
   */
  private async updateDatabaseUsage(
    keyId: string,
    endpoint: string,
    statusCode: number,
    responseTime: number,
    context?: {
      ipAddress?: string;
      userAgent?: string;
      method?: string;
      path?: string;
    }
  ): Promise<void> {
    try {
      const db = await getDatabase();

      // Update API key usage count and last used info
      await db('api_keys').where('id', keyId).increment('usage_count', 1).update({
        last_used_at: new Date(),
        last_used_ip: context?.ipAddress,
        last_used_user_agent: context?.userAgent,
        updated_at: new Date(),
      });

      // Store detailed usage record if table exists
      try {
        await db('api_key_usage_logs').insert({
          api_key_id: keyId,
          endpoint,
          method: context?.method,
          path: context?.path,
          status_code: statusCode,
          response_time: responseTime,
          ip_address: context?.ipAddress,
          user_agent: context?.userAgent,
          created_at: new Date(),
        });
      } catch (error) {
        // Table might not exist yet, log but don't fail
        logger.debug('Could not insert usage log (table may not exist)', { error });
      }
    } catch (error) {
      logger.error('Failed to update database usage', { error, keyId });
    }
  }

  /**
   * Get hour key for Redis/in-memory storage
   */
  private getHourKey(keyId: string): string {
    const now = new Date();
    const hour = now.getHours();
    const date = now.toISOString().split('T')[0];
    return `api_key_usage:${keyId}:${date}:hour:${hour}`;
  }

  /**
   * Get day key for Redis storage
   */
  private getDayKey(keyId: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `api_key_usage:${keyId}:${date}:day`;
  }

  /**
   * Get month key for Redis storage
   */
  private getMonthKey(keyId: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return `api_key_usage:${keyId}:${year}:month:${month}`;
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Export singleton instance
export const apiKeyUsageService = new ApiKeyUsageService();