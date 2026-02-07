import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryCache, createMemoryCache } from '../cache/index.js';
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
  maxEntries: 10,
  provider: 'memory',
};

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache(defaultConfig);
  });

  describe('createMemoryCache', () => {
    it('should create an instance via factory', () => {
      const c = createMemoryCache(defaultConfig);
      expect(c).toBeInstanceOf(MemoryCache);
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

    it('should expire entries after TTL', async () => {
      const shortCache = new MemoryCache({ ...defaultConfig, ttlSeconds: 0 });
      await shortCache.set('key', makeResponse('r'));
      // Wait a tiny bit so Date.now() > expiresAt
      await new Promise(resolve => setTimeout(resolve, 10));
      const result = await shortCache.get('key');
      expect(result).toBeNull();
    });

    it('should evict oldest when at capacity', async () => {
      const smallCache = new MemoryCache({ ...defaultConfig, maxEntries: 2 });
      await smallCache.set('k1', makeResponse('r1'), 10);
      await new Promise(r => setTimeout(r, 5));
      await smallCache.set('k2', makeResponse('r2'), 20);
      await smallCache.set('k3', makeResponse('r3'), 20);
      // k1 should have been evicted (oldest expiry)
      const r1 = await smallCache.get('k1');
      expect(r1).toBeNull();
      const r3 = await smallCache.get('k3');
      expect(r3).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove a key', async () => {
      await cache.set('key1', makeResponse('r1'));
      await cache.delete('key1');
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      await cache.set('k1', makeResponse('r1'));
      await cache.set('k2', makeResponse('r2'));
      await cache.clear();
      expect(cache.getStats().size).toBe(0);
    });

    it('should clear by pattern', async () => {
      await cache.set('ctx:abc', makeResponse('r1'));
      await cache.set('other:xyz', makeResponse('r2'));
      await cache.clear('ctx:*');
      const r1 = await cache.get('ctx:abc');
      const r2 = await cache.get('other:xyz');
      expect(r1).toBeNull();
      expect(r2).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should track hits/misses', async () => {
      await cache.set('k1', makeResponse('r1'));
      await cache.get('k1'); // hit
      await cache.get('k2'); // miss
      await cache.get('k1'); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(10);
      expect(stats.hitRate).toBeCloseTo(2/3);
    });

    it('should return 0 hitRate when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should return true', async () => {
      const healthy = await cache.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
