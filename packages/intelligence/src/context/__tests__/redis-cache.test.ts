import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisCache, createRedisCache, type IRedisClient } from '../cache/redis-cache.js';
import type { ContextResponse, CachingConfig } from '../types.js';

const makeResponse = (id: string): ContextResponse => ({
  requestId: id,
  context: { text: 'hello', chunks: [], tokenCount: 10, format: 'xml' },
  sources: [],
  metrics: { totalLatencyMs: 10, totalTokens: 10, budgetUtilization: 0.5, deduplicationRate: 0, cacheHitRate: 0, sourcesQueried: 1, sourcesSucceeded: 1 },
});

const defaultConfig: CachingConfig = {
  enabled: true,
  ttlSeconds: 300,
  maxEntries: 100,
  provider: 'redis',
  redisUrl: 'redis://localhost:6379',
};

function createMockRedisClient(): IRedisClient {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
      return entry.value;
    }),
    set: vi.fn(async () => 'OK'),
    setex: vi.fn(async (key: string, seconds: number, value: string) => {
      store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }),
    keys: vi.fn(async (pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(store.keys()).filter(k => regex.test(k));
    }),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
  };
}

describe('RedisCache', () => {
  let cache: RedisCache;
  let mockClient: IRedisClient;

  beforeEach(() => {
    mockClient = createMockRedisClient();
    cache = new RedisCache(mockClient, defaultConfig);
  });

  describe('createRedisCache', () => {
    it('should create an instance via factory', () => {
      const c = createRedisCache(mockClient, defaultConfig);
      expect(c).toBeInstanceOf(RedisCache);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve a value', async () => {
      const resp = makeResponse('r1');
      await cache.set('key1', resp);
      const result = await cache.get('key1');
      expect(result).toEqual(resp);
    });

    it('should return null for missing key', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should use custom TTL when provided', async () => {
      const resp = makeResponse('r1');
      await cache.set('key1', resp, 60);
      expect(mockClient.setex).toHaveBeenCalledWith(
        expect.stringContaining('key1'),
        60,
        expect.any(String),
      );
    });

    it('should use default TTL when not provided', async () => {
      const resp = makeResponse('r1');
      await cache.set('key1', resp);
      expect(mockClient.setex).toHaveBeenCalledWith(
        expect.stringContaining('key1'),
        300,
        expect.any(String),
      );
    });

    it('should handle get errors gracefully', async () => {
      (mockClient.get as any).mockRejectedValueOnce(new Error('Connection refused'));
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should handle set errors gracefully', async () => {
      (mockClient.setex as any).mockRejectedValueOnce(new Error('Connection refused'));
      // Should not throw
      await cache.set('key1', makeResponse('r1'));
    });
  });

  describe('delete', () => {
    it('should remove a key', async () => {
      await cache.set('key1', makeResponse('r1'));
      await cache.delete('key1');
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should handle delete errors gracefully', async () => {
      (mockClient.del as any).mockRejectedValueOnce(new Error('Connection refused'));
      await cache.delete('key1'); // Should not throw
    });
  });

  describe('clear', () => {
    it('should clear all entries with prefix', async () => {
      await cache.set('k1', makeResponse('r1'));
      await cache.set('k2', makeResponse('r2'));
      await cache.clear();
      expect(mockClient.keys).toHaveBeenCalledWith('tamma:ctx:*');
    });

    it('should clear by pattern', async () => {
      await cache.clear('ctx:*');
      expect(mockClient.keys).toHaveBeenCalledWith('tamma:ctx:ctx:*');
    });

    it('should handle clear errors gracefully', async () => {
      (mockClient.keys as any).mockRejectedValueOnce(new Error('Connection refused'));
      await cache.clear(); // Should not throw
    });
  });

  describe('getStats', () => {
    it('should track hits and misses', async () => {
      await cache.set('k1', makeResponse('r1'));
      await cache.get('k1'); // hit
      await cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it('should return 0 hitRate when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Redis responds PONG', async () => {
      const healthy = await cache.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should return false when Redis is unavailable', async () => {
      (mockClient.ping as any).mockRejectedValueOnce(new Error('Connection refused'));
      const healthy = await cache.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('custom prefix', () => {
    it('should use custom prefix', async () => {
      const customCache = createRedisCache(mockClient, defaultConfig, 'custom:');
      await customCache.set('key1', makeResponse('r1'));
      expect(mockClient.setex).toHaveBeenCalledWith(
        'custom:key1',
        expect.any(Number),
        expect.any(String),
      );
    });
  });
});
