/**
 * Tests for Query Cache
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  QueryCache,
  NoOpCache,
  generateCacheKey,
  type IQueryCache,
} from '../cache/query-cache.js';
import type { SearchResult, SearchQuery } from '../interfaces.js';

describe('QueryCache', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache({
      enabled: true,
      ttlMs: 60000, // 1 minute
      maxEntries: 100,
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      const results: SearchResult[] = [
        { id: 'doc-1', score: 0.95 },
        { id: 'doc-2', score: 0.85 },
      ];

      cache.set('key1', results);
      const retrieved = cache.get('key1');

      expect(retrieved).toEqual(results);
    });

    it('should return undefined for missing key', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should track hits and misses', () => {
      cache.set('key1', [{ id: 'doc-1', score: 0.9 }]);

      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire entries after TTL', () => {
      cache.set('key1', [{ id: 'doc-1', score: 0.9 }]);

      expect(cache.get('key1')).toBeDefined();

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      expect(cache.get('key1')).toBeUndefined();
    });

    it('should not expire entries before TTL', () => {
      cache.set('key1', [{ id: 'doc-1', score: 0.9 }]);

      vi.advanceTimersByTime(30000); // Half of TTL

      expect(cache.get('key1')).toBeDefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when max size reached', () => {
      const smallCache = new QueryCache({
        enabled: true,
        ttlMs: 60000,
        maxEntries: 3,
      });

      smallCache.set('key1', [{ id: '1', score: 0.9 }]);
      smallCache.set('key2', [{ id: '2', score: 0.8 }]);
      smallCache.set('key3', [{ id: '3', score: 0.7 }]);

      // Access key1 to make it recently used
      smallCache.get('key1');

      // Add key4, should evict key2 (oldest not recently accessed)
      smallCache.set('key4', [{ id: '4', score: 0.6 }]);

      expect(smallCache.get('key1')).toBeDefined();
      expect(smallCache.get('key2')).toBeUndefined();
      expect(smallCache.get('key3')).toBeDefined();
      expect(smallCache.get('key4')).toBeDefined();
    });
  });

  describe('invalidate', () => {
    it('should invalidate all entries when no pattern provided', () => {
      cache.set('key1', [{ id: '1', score: 0.9 }]);
      cache.set('key2', [{ id: '2', score: 0.8 }]);

      cache.invalidate();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });

    it('should invalidate entries matching pattern', () => {
      cache.set('collection1:abc', [{ id: '1', score: 0.9 }]);
      cache.set('collection1:def', [{ id: '2', score: 0.8 }]);
      cache.set('collection2:ghi', [{ id: '3', score: 0.7 }]);

      cache.invalidate('^collection1:');

      expect(cache.get('collection1:abc')).toBeUndefined();
      expect(cache.get('collection1:def')).toBeUndefined();
      expect(cache.get('collection2:ghi')).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      cache.set('key1', [{ id: '1', score: 0.9, content: 'test content' }]);
      cache.set('key2', [{ id: '2', score: 0.8 }]);

      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing'); // miss

      const stats = cache.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.memoryUsageBytes).toBeGreaterThan(0);
    });

    it('should return 0 hit rate when no requests', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all entries and reset stats', () => {
      cache.set('key1', [{ id: '1', score: 0.9 }]);
      cache.get('key1');
      cache.get('missing');

      cache.clear();

      // Get stats before triggering any new misses
      const stats = cache.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);

      // Now verify key1 is gone (this will add a miss)
      expect(cache.get('key1')).toBeUndefined();
    });
  });
});

describe('NoOpCache', () => {
  let cache: NoOpCache;

  beforeEach(() => {
    cache = new NoOpCache();
  });

  it('should always return undefined for get', () => {
    expect(cache.get('any-key')).toBeUndefined();
  });

  it('should track misses', () => {
    cache.get('key1');
    cache.get('key2');

    const stats = cache.getStats();
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it('should do nothing on set', () => {
    cache.set('key1', [{ id: '1', score: 0.9 }]);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should do nothing on invalidate', () => {
    // Should not throw
    cache.invalidate();
    cache.invalidate('pattern');
  });

  it('should return zero stats', () => {
    const stats = cache.getStats();
    expect(stats.entries).toBe(0);
    expect(stats.memoryUsageBytes).toBe(0);
  });

  it('should reset misses on clear', () => {
    cache.get('key1');
    cache.clear();
    expect(cache.getStats().misses).toBe(0);
  });
});

describe('generateCacheKey', () => {
  it('should generate deterministic key for same query', () => {
    const query: SearchQuery = {
      embedding: [0.1, 0.2, 0.3],
      topK: 10,
      filter: { where: { language: 'typescript' } },
    };

    const key1 = generateCacheKey('collection1', query);
    const key2 = generateCacheKey('collection1', query);

    expect(key1).toBe(key2);
  });

  it('should generate different keys for different queries', () => {
    const query1: SearchQuery = {
      embedding: [0.1, 0.2, 0.3],
      topK: 10,
    };

    const query2: SearchQuery = {
      embedding: [0.1, 0.2, 0.3],
      topK: 20,
    };

    const key1 = generateCacheKey('collection1', query1);
    const key2 = generateCacheKey('collection1', query2);

    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different collections', () => {
    const query: SearchQuery = {
      embedding: [0.1, 0.2, 0.3],
      topK: 10,
    };

    const key1 = generateCacheKey('collection1', query);
    const key2 = generateCacheKey('collection2', query);

    expect(key1).not.toBe(key2);
  });

  it('should include collection name in key', () => {
    const query: SearchQuery = {
      embedding: [0.1, 0.2, 0.3],
      topK: 10,
    };

    const key = generateCacheKey('my-collection', query);
    expect(key).toMatch(/^my-collection:/);
  });

  it('should generate keys with consistent length', () => {
    const query: SearchQuery = {
      embedding: new Array(1536).fill(0.1),
      topK: 10,
    };

    const key = generateCacheKey('collection', query);
    // Collection name + : + 16 char hash
    expect(key.length).toBe('collection:'.length + 16);
  });
});
