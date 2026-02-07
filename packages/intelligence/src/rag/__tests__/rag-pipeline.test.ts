/**
 * Tests for RAG Pipeline
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RAGPipeline, createRAGPipeline } from '../rag-pipeline.js';
import { KeywordSource } from '../sources/keyword-source.js';
import { NotInitializedError } from '../errors.js';
import type { RAGConfig, RAGQuery } from '../types.js';

describe('RAGPipeline', () => {
  let pipeline: RAGPipeline;

  beforeEach(async () => {
    pipeline = createRAGPipeline({
      sources: {
        vector_db: { enabled: false, weight: 1.0, topK: 10 },
        keyword: { enabled: true, weight: 0.5, topK: 5 },
        docs: { enabled: false, weight: 0.3, topK: 5 },
        issues: { enabled: false, weight: 0.2, topK: 5 },
        prs: { enabled: false, weight: 0.2, topK: 5 },
        commits: { enabled: false, weight: 0.1, topK: 5 },
      },
      caching: {
        enabled: false,
        ttlSeconds: 300,
        maxEntries: 100,
      },
    });
  });

  afterEach(async () => {
    await pipeline.dispose();
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      await expect(pipeline.initialize()).resolves.not.toThrow();
    });

    it('should not reinitialize if already initialized', async () => {
      await pipeline.initialize();
      await expect(pipeline.initialize()).resolves.not.toThrow();
    });

    it('should throw on retrieve if not initialized', async () => {
      const newPipeline = createRAGPipeline();

      await expect(newPipeline.retrieve({ text: 'test' })).rejects.toThrow(
        NotInitializedError
      );
    });
  });

  describe('configure', () => {
    it('should update configuration', async () => {
      await pipeline.configure({
        assembly: {
          maxTokens: 2000,
          format: 'markdown',
          includeScores: true,
          deduplicationThreshold: 0.9,
        },
      });

      // Pipeline should still work after reconfiguration
      await pipeline.initialize();
      const result = await pipeline.retrieve({ text: 'test' });
      expect(result).toBeDefined();
    });
  });

  describe('retrieve', () => {
    beforeEach(async () => {
      await pipeline.initialize();

      // Add some test documents to keyword source
      const retriever = pipeline.getRetriever();
      const keywordSource = retriever.getSource('keyword') as KeywordSource;

      keywordSource.addDocuments([
        {
          id: 'doc1',
          content: 'function handleLogin(user, password) { return authenticate(user, password); }',
          metadata: { filePath: 'src/auth/login.ts', language: 'typescript' },
        },
        {
          id: 'doc2',
          content: 'function handleLogout(session) { session.invalidate(); }',
          metadata: { filePath: 'src/auth/logout.ts', language: 'typescript' },
        },
        {
          id: 'doc3',
          content: 'class UserService { getUser(id) { return db.find(id); } }',
          metadata: { filePath: 'src/services/user.ts', language: 'typescript' },
        },
      ]);
    });

    it('should retrieve relevant chunks', async () => {
      const result = await pipeline.retrieve({
        text: 'find the login function',
      });

      expect(result.queryId).toBeDefined();
      expect(result.retrievedChunks.length).toBeGreaterThan(0);
      expect(result.assembledContext).toContain('handleLogin');
    });

    it('should include source attribution', async () => {
      const result = await pipeline.retrieve({
        text: 'find user service',
      });

      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.sources[0].source).toBe('keyword');
      expect(result.sources[0].count).toBeGreaterThan(0);
    });

    it('should respect maxTokens parameter', async () => {
      const result = await pipeline.retrieve({
        text: 'find all functions',
        maxTokens: 100,
      });

      expect(result.tokenCount).toBeLessThanOrEqual(100);
    });

    it('should report latency', async () => {
      const result = await pipeline.retrieve({
        text: 'test query',
      });

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty results', async () => {
      const result = await pipeline.retrieve({
        text: 'xyz123 completely unrelated query',
      });

      expect(result.retrievedChunks).toEqual([]);
      expect(result.assembledContext).toBe('');
    });
  });

  describe('feedback', () => {
    beforeEach(async () => {
      await pipeline.initialize();
    });

    it('should record feedback', async () => {
      await expect(
        pipeline.recordFeedback({
          queryId: 'q1',
          chunkId: 'c1',
          rating: 'helpful',
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();
    });

    it('should get feedback stats', async () => {
      await pipeline.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      const stats = await pipeline.getFeedbackStats('q1');

      expect(stats.totalFeedback).toBe(1);
      expect(stats.helpfulCount).toBe(1);
    });
  });

  describe('caching', () => {
    beforeEach(async () => {
      // Create pipeline with caching enabled
      pipeline = createRAGPipeline({
        sources: {
          vector_db: { enabled: false, weight: 1.0, topK: 10 },
          keyword: { enabled: true, weight: 0.5, topK: 5 },
          docs: { enabled: false, weight: 0.3, topK: 5 },
          issues: { enabled: false, weight: 0.2, topK: 5 },
          prs: { enabled: false, weight: 0.2, topK: 5 },
          commits: { enabled: false, weight: 0.1, topK: 5 },
        },
        caching: {
          enabled: true,
          ttlSeconds: 300,
          maxEntries: 100,
        },
      });
      await pipeline.initialize();

      // Add test data
      const retriever = pipeline.getRetriever();
      const keywordSource = retriever.getSource('keyword') as KeywordSource;
      keywordSource.addDocuments([
        {
          id: 'doc1',
          content: 'test content for caching',
          metadata: {},
        },
      ]);
    });

    it('should cache results', async () => {
      const query: RAGQuery = { text: 'test content' };

      // First call - miss
      const result1 = await pipeline.retrieve(query);
      expect(result1.cacheHit).toBe(false);

      // Second call - hit
      const result2 = await pipeline.retrieve(query);
      expect(result2.cacheHit).toBe(true);
    });

    it('should report cache statistics', async () => {
      await pipeline.retrieve({ text: 'test' });
      await pipeline.retrieve({ text: 'test' });

      const stats = pipeline.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should invalidate cache', async () => {
      await pipeline.retrieve({ text: 'test' });
      pipeline.invalidateCache();

      const result = await pipeline.retrieve({ text: 'test' });
      expect(result.cacheHit).toBe(false);
    });
  });

  describe('health check', () => {
    beforeEach(async () => {
      await pipeline.initialize();
    });

    it('should check health of all sources', async () => {
      const health = await pipeline.checkHealth();

      expect(health.has('keyword')).toBe(true);
      expect(health.get('keyword')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      await pipeline.initialize();
      await pipeline.dispose();

      // Should throw on subsequent retrieve
      await expect(pipeline.retrieve({ text: 'test' })).rejects.toThrow(
        NotInitializedError
      );
    });
  });
});

describe('createRAGPipeline', () => {
  it('should create pipeline with default config', () => {
    const pipeline = createRAGPipeline();

    expect(pipeline).toBeInstanceOf(RAGPipeline);
  });

  it('should create pipeline with custom config', () => {
    const pipeline = createRAGPipeline({
      assembly: {
        maxTokens: 8000,
        format: 'markdown',
        includeScores: true,
        deduplicationThreshold: 0.9,
      },
    });

    expect(pipeline).toBeInstanceOf(RAGPipeline);
  });
});
