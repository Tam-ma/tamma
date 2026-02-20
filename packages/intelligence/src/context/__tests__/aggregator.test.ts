import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextAggregator, createContextAggregator } from '../aggregator.js';
import type {
  IContextSource,
  ContextSourceType,
  SourceConfig,
  SourceQuery,
  SourceResult,
  ContextChunk,
  ContextRequest,
} from '../types.js';

class MockSource implements IContextSource {
  readonly name: ContextSourceType;
  private chunks: ContextChunk[];
  private shouldFail: boolean;

  constructor(name: ContextSourceType, chunks: ContextChunk[], shouldFail = false) {
    this.name = name;
    this.chunks = chunks;
    this.shouldFail = shouldFail;
  }

  async initialize(_config: SourceConfig): Promise<void> {}
  async isAvailable(): Promise<boolean> { return !this.shouldFail; }
  async retrieve(_query: SourceQuery): Promise<SourceResult> {
    if (this.shouldFail) throw new Error(`${this.name} failed`);
    return { chunks: this.chunks, latencyMs: 5, cacheHit: false };
  }
  async dispose(): Promise<void> {}
}

const makeChunk = (id: string, source: ContextSourceType, relevance = 0.8): ContextChunk => ({
  id,
  content: `content for ${id}`,
  source,
  relevance,
  metadata: { filePath: `src/${id}.ts`, language: 'typescript' },
  tokenCount: 20,
});

describe('ContextAggregator', () => {
  let aggregator: ContextAggregator;

  beforeEach(() => {
    aggregator = createContextAggregator({
      config: { caching: { enabled: false, ttlSeconds: 300, maxEntries: 100, provider: 'memory' } },
    });
  });

  describe('createContextAggregator', () => {
    it('should create an instance via factory', () => {
      expect(createContextAggregator()).toBeInstanceOf(ContextAggregator);
    });
  });

  describe('source management', () => {
    it('should register and list sources', () => {
      const source = new MockSource('vector_db', []);
      aggregator.registerSource(source);
      expect(aggregator.getAvailableSources()).toContain('vector_db');
    });

    it('should remove sources', () => {
      aggregator.registerSource(new MockSource('vector_db', []));
      aggregator.removeSource('vector_db');
      expect(aggregator.getAvailableSources()).not.toContain('vector_db');
    });
  });

  describe('getContext', () => {
    it('should retrieve context from registered sources', async () => {
      aggregator.registerSource(new MockSource('vector_db', [
        makeChunk('v1', 'vector_db', 0.9),
      ]));
      aggregator.registerSource(new MockSource('rag', [
        makeChunk('r1', 'rag', 0.8),
      ]));

      const request: ContextRequest = {
        query: 'how does auth work?',
        taskType: 'analysis',
        maxTokens: 4000,
      };
      const response = await aggregator.getContext(request);

      expect(response.requestId).toBeDefined();
      expect(response.context.chunks.length).toBeGreaterThanOrEqual(1);
      expect(response.context.text).toBeDefined();
      expect(response.context.tokenCount).toBeGreaterThan(0);
      expect(response.sources.length).toBe(2);
      expect(response.metrics.sourcesQueried).toBe(2);
      expect(response.metrics.sourcesSucceeded).toBe(2);
    });

    it('should handle source failures gracefully', async () => {
      aggregator.registerSource(new MockSource('vector_db', [
        makeChunk('v1', 'vector_db', 0.9),
      ]));
      aggregator.registerSource(new MockSource('rag', [], true)); // failing source

      const request: ContextRequest = {
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
      };
      const response = await aggregator.getContext(request);

      // Should still succeed with partial results
      expect(response.context.chunks.length).toBeGreaterThanOrEqual(1);
      expect(response.metrics.sourcesSucceeded).toBe(1);
      // Failed source should have error in contributions
      const ragContrib = response.sources.find(s => s.source === 'rag');
      expect(ragContrib?.error).toBeDefined();
    });

    it('should return empty context when no sources available', async () => {
      const request: ContextRequest = {
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
      };
      const response = await aggregator.getContext(request);
      expect(response.context.chunks).toHaveLength(0);
      expect(response.metrics.sourcesQueried).toBe(0);
    });

    it('should deduplicate chunks', async () => {
      const sameChunk = makeChunk('dupe', 'vector_db', 0.9);
      aggregator.registerSource(new MockSource('vector_db', [sameChunk]));
      aggregator.registerSource(new MockSource('rag', [{...sameChunk, id: 'dupe2', source: 'rag'}]));

      const request: ContextRequest = {
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
      };
      const response = await aggregator.getContext(request);

      expect(response.metrics.deduplicationRate).toBeGreaterThan(0);
    });

    it('should respect explicit sources in request', async () => {
      aggregator.registerSource(new MockSource('vector_db', [makeChunk('v1', 'vector_db')]));
      aggregator.registerSource(new MockSource('rag', [makeChunk('r1', 'rag')]));

      const request: ContextRequest = {
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
        sources: ['vector_db'], // only vector_db
      };
      const response = await aggregator.getContext(request);
      expect(response.metrics.sourcesQueried).toBe(1);
    });
  });

  describe('caching', () => {
    it('should cache and reuse results', async () => {
      const cachedAgg = createContextAggregator({
        config: { caching: { enabled: true, ttlSeconds: 300, maxEntries: 100, provider: 'memory' } },
      });
      let callCount = 0;
      const countingSource = new MockSource('vector_db', [makeChunk('v1', 'vector_db')]);
      const origRetrieve = countingSource.retrieve.bind(countingSource);
      countingSource.retrieve = async (query: SourceQuery) => {
        callCount++;
        return origRetrieve(query);
      };

      cachedAgg.registerSource(countingSource);

      const request: ContextRequest = {
        query: 'test query',
        taskType: 'analysis',
        maxTokens: 4000,
        sources: ['vector_db'],
      };

      await cachedAgg.getContext(request);
      await cachedAgg.getContext(request); // should hit cache

      expect(callCount).toBe(1); // source called only once
    });

    it('should skip cache when requested', async () => {
      const cachedAgg = createContextAggregator({
        config: { caching: { enabled: true, ttlSeconds: 300, maxEntries: 100, provider: 'memory' } },
      });
      let callCount = 0;
      const countingSource = new MockSource('vector_db', [makeChunk('v1', 'vector_db')]);
      const origRetrieve = countingSource.retrieve.bind(countingSource);
      countingSource.retrieve = async (query: SourceQuery) => {
        callCount++;
        return origRetrieve(query);
      };
      cachedAgg.registerSource(countingSource);

      const request: ContextRequest = {
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
        sources: ['vector_db'],
        options: { skipCache: true },
      };

      await cachedAgg.getContext(request);
      await cachedAgg.getContext(request);

      expect(callCount).toBe(2); // source called twice
    });
  });

  describe('metrics', () => {
    it('should track latency', async () => {
      aggregator.registerSource(new MockSource('vector_db', [makeChunk('v1', 'vector_db')]));

      const response = await aggregator.getContext({
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
      });

      expect(response.metrics.totalLatencyMs).toBeGreaterThanOrEqual(0);
      expect(response.metrics.budgetUtilization).toBeGreaterThanOrEqual(0);
    });
  });

  describe('streamContext', () => {
    it('should yield chunks', async () => {
      aggregator.registerSource(new MockSource('vector_db', [
        makeChunk('v1', 'vector_db'),
        makeChunk('v2', 'vector_db'),
      ]));

      const chunks: ContextChunk[] = [];
      for await (const chunk of aggregator.streamContext({
        query: 'test',
        taskType: 'analysis',
        maxTokens: 4000,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cache management', () => {
    it('should report cache stats', () => {
      const stats = aggregator.getCacheStats();
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('size');
    });

    it('should invalidate cache', async () => {
      await aggregator.invalidateCache();
      const stats = aggregator.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should report healthy when sources available', async () => {
      aggregator.registerSource(new MockSource('vector_db', []));
      const health = await aggregator.healthCheck();
      expect(health.cache.healthy).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clear all sources', async () => {
      aggregator.registerSource(new MockSource('vector_db', []));
      await aggregator.dispose();
      expect(aggregator.getAvailableSources()).toHaveLength(0);
    });
  });

  describe('configure', () => {
    it('should update config', async () => {
      await aggregator.configure({
        budget: { defaultMaxTokens: 16000, reservedTokens: 2000, minChunkTokens: 100, maxChunkTokens: 2000 },
      });
      // Should not throw
    });
  });
});
