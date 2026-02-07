/**
 * Tests for RAG Cache
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RAGCache, NoOpRAGCache, createRAGCache } from '../cache.js';
import type { RAGQuery, RAGResult, CachingConfig } from '../types.js';

describe('RAGCache', () => {
  let cache: RAGCache;
  let defaultConfig: CachingConfig;

  beforeEach(() => {
    defaultConfig = {
      enabled: true,
      ttlSeconds: 300,
      maxEntries: 100,
    };
    cache = new RAGCache(defaultConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createQuery = (text: string): RAGQuery => ({
    text,
  });

  const createResult = (queryId: string): RAGResult => ({
    queryId,
    retrievedChunks: [],
    assembledContext: 'test context',
    tokenCount: 100,
    sources: [],
    latencyMs: 50,
    cacheHit: false,
  });

  describe('query cache', () => {
    it('should cache and retrieve results', () => {
      const query = createQuery('test query');
      const result = createResult('q1');

      cache.cacheResult(query, result);
      const cached = cache.getCachedResult(query);

      expect(cached).not.toBeNull();
      expect(cached?.queryId).toBe('q1');
      expect(cached?.cacheHit).toBe(true);
    });

    it('should return null for non-cached queries', () => {
      const query = createQuery('uncached query');
      const cached = cache.getCachedResult(query);

      expect(cached).toBeNull();
    });

    it('should use same key for similar queries', () => {
      const query1 = createQuery('  Test Query  ');
      const query2 = createQuery('test query');
      const result = createResult('q1');

      cache.cacheResult(query1, result);
      const cached = cache.getCachedResult(query2);

      expect(cached).not.toBeNull();
    });

    it('should respect TTL', () => {
      vi.useFakeTimers();

      const query = createQuery('test');
      const result = createResult('q1');

      cache.cacheResult(query, result);

      // Move time forward past TTL
      vi.advanceTimersByTime(400 * 1000); // 400 seconds > 300 TTL

      const cached = cache.getCachedResult(query);
      expect(cached).toBeNull();
    });

    it('should evict oldest entry when full', () => {
      const smallCache = new RAGCache({
        enabled: true,
        ttlSeconds: 300,
        maxEntries: 2,
      });

      smallCache.cacheResult(createQuery('q1'), createResult('r1'));
      smallCache.cacheResult(createQuery('q2'), createResult('r2'));
      smallCache.cacheResult(createQuery('q3'), createResult('r3'));

      // First entry should be evicted
      expect(smallCache.getCachedResult(createQuery('q1'))).toBeNull();
      expect(smallCache.getCachedResult(createQuery('q2'))).not.toBeNull();
      expect(smallCache.getCachedResult(createQuery('q3'))).not.toBeNull();
    });
  });

  describe('embedding cache', () => {
    it('should cache and retrieve embeddings', () => {
      const embedding = [0.1, 0.2, 0.3];

      cache.cacheEmbedding('test text', embedding);
      const cached = cache.getCachedEmbedding('test text');

      expect(cached).toEqual(embedding);
    });

    it('should return null for non-cached embeddings', () => {
      const cached = cache.getCachedEmbedding('uncached');

      expect(cached).toBeNull();
    });

    it('should respect TTL for embeddings', () => {
      vi.useFakeTimers();

      cache.cacheEmbedding('test', [0.1]);

      vi.advanceTimersByTime(400 * 1000);

      expect(cache.getCachedEmbedding('test')).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      const query = createQuery('test');
      const result = createResult('q1');

      // Miss
      cache.getCachedResult(createQuery('miss'));

      // Cache and hit
      cache.cacheResult(query, result);
      cache.getCachedResult(query);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should report cache sizes', () => {
      cache.cacheResult(createQuery('q1'), createResult('r1'));
      cache.cacheEmbedding('text', [0.1]);

      const stats = cache.getStats();
      expect(stats.queryCount).toBe(1);
      expect(stats.embeddingCount).toBe(1);
    });

    it('should reset statistics', () => {
      cache.getCachedResult(createQuery('miss'));
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('invalidation', () => {
    it('should invalidate all entries', () => {
      cache.cacheResult(createQuery('q1'), createResult('r1'));
      cache.cacheResult(createQuery('q2'), createResult('r2'));
      cache.cacheEmbedding('text', [0.1]);

      cache.invalidate();

      expect(cache.getCachedResult(createQuery('q1'))).toBeNull();
      expect(cache.getCachedResult(createQuery('q2'))).toBeNull();
      expect(cache.getCachedEmbedding('text')).toBeNull();
    });

    it('should clear all caches', () => {
      cache.cacheResult(createQuery('q1'), createResult('r1'));
      cache.cacheEmbedding('text', [0.1]);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.queryCount).toBe(0);
      expect(stats.embeddingCount).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', () => {
      vi.useFakeTimers();

      cache.cacheResult(createQuery('q1'), createResult('r1'));

      vi.advanceTimersByTime(400 * 1000);

      cache.cacheResult(createQuery('q2'), createResult('r2'));

      cache.cleanup();

      expect(cache.getCachedResult(createQuery('q1'))).toBeNull();
      expect(cache.getCachedResult(createQuery('q2'))).not.toBeNull();
    });
  });

  describe('config update', () => {
    it('should update configuration', () => {
      cache.updateConfig({ ttlSeconds: 600 });

      // Cache should still work
      cache.cacheResult(createQuery('q1'), createResult('r1'));
      expect(cache.getCachedResult(createQuery('q1'))).not.toBeNull();
    });
  });
});

describe('NoOpRAGCache', () => {
  let cache: NoOpRAGCache;

  beforeEach(() => {
    cache = new NoOpRAGCache();
  });

  it('should never return cached results', () => {
    cache.cacheResult(createQuery('test'), createResult('r1'));

    expect(cache.getCachedResult(createQuery('test'))).toBeNull();
  });

  it('should never return cached embeddings', () => {
    cache.cacheEmbedding('test', [0.1]);

    expect(cache.getCachedEmbedding('test')).toBeNull();
  });

  it('should return zero stats', () => {
    const stats = cache.getStats();

    expect(stats.queryCount).toBe(0);
    expect(stats.embeddingCount).toBe(0);
    expect(stats.hitRate).toBe(0);
  });
});

describe('createRAGCache', () => {
  it('should return NoOpRAGCache when disabled', () => {
    const cache = createRAGCache({ enabled: false, ttlSeconds: 300, maxEntries: 100 });

    expect(cache).toBeInstanceOf(NoOpRAGCache);
  });

  it('should return RAGCache when enabled', () => {
    const cache = createRAGCache({ enabled: true, ttlSeconds: 300, maxEntries: 100 });

    expect(cache).toBeInstanceOf(RAGCache);
    expect(cache).not.toBeInstanceOf(NoOpRAGCache);
  });
});

function createQuery(text: string): RAGQuery {
  return { text };
}

function createResult(queryId: string): RAGResult {
  return {
    queryId,
    retrievedChunks: [],
    assembledContext: 'test',
    tokenCount: 10,
    sources: [],
    latencyMs: 50,
    cacheHit: false,
  };
}
