/**
 * Tests for Multi-Source Retriever
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Retriever, createRetriever } from '../retriever.js';
import { KeywordSource } from '../sources/keyword-source.js';
import { DocsSource } from '../sources/docs-source.js';
import type { RAGConfig, ProcessedQuery, RAGSourceType } from '../types.js';

describe('Retriever', () => {
  let retriever: Retriever;
  let keywordSource: KeywordSource;
  let docsSource: DocsSource;
  let defaultConfig: RAGConfig;

  beforeEach(async () => {
    retriever = createRetriever();
    keywordSource = new KeywordSource();
    docsSource = new DocsSource();

    defaultConfig = {
      sources: {
        vector_db: { enabled: false, weight: 1.0, topK: 10 },
        keyword: { enabled: true, weight: 0.5, topK: 5 },
        docs: { enabled: true, weight: 0.3, topK: 5 },
        issues: { enabled: false, weight: 0.2, topK: 5 },
        prs: { enabled: false, weight: 0.2, topK: 5 },
        commits: { enabled: false, weight: 0.1, topK: 5 },
      },
      ranking: {
        fusionMethod: 'rrf',
        rrfK: 60,
        mmrLambda: 0.7,
        recencyBoost: 0.1,
        recencyDecayDays: 30,
      },
      assembly: {
        maxTokens: 4000,
        format: 'xml',
        includeScores: false,
        deduplicationThreshold: 0.85,
      },
      caching: {
        enabled: false,
        ttlSeconds: 300,
        maxEntries: 100,
      },
      timeouts: {
        perSourceMs: 2000,
        totalMs: 5000,
      },
    };

    retriever.registerSource(keywordSource);
    retriever.registerSource(docsSource);
    await retriever.initializeSources(defaultConfig);

    // Add test data
    keywordSource.addDocuments([
      {
        id: 'k1',
        content: 'function login() { authenticate(); }',
        metadata: { filePath: 'auth.ts' },
      },
      {
        id: 'k2',
        content: 'function logout() { invalidate(); }',
        metadata: { filePath: 'auth.ts' },
      },
    ]);

    docsSource.addDocs([
      {
        id: 'd1',
        title: 'Authentication Guide',
        content: 'How to implement login and authentication in the app.',
        filePath: 'docs/auth.md',
      },
    ]);
  });

  afterEach(async () => {
    await retriever.dispose();
    vi.useRealTimers();
  });

  const createQuery = (text: string): ProcessedQuery => ({
    original: text,
    expanded: [text],
    entities: [],
  });

  describe('registerSource', () => {
    it('should register a source', () => {
      const newRetriever = createRetriever();
      const source = new KeywordSource();

      newRetriever.registerSource(source);

      expect(newRetriever.getSource('keyword')).toBe(source);
    });
  });

  describe('unregisterSource', () => {
    it('should unregister a source', () => {
      retriever.unregisterSource('keyword');

      expect(retriever.getSource('keyword')).toBeUndefined();
    });
  });

  describe('getAllSources', () => {
    it('should return all registered sources', () => {
      const sources = retriever.getAllSources();

      expect(sources.length).toBe(2);
      expect(sources.some((s) => s.name === 'keyword')).toBe(true);
      expect(sources.some((s) => s.name === 'docs')).toBe(true);
    });
  });

  describe('retrieveFromAllSources', () => {
    it('should retrieve from all specified sources', async () => {
      const { results, attributions } = await retriever.retrieveFromAllSources(
        createQuery('login authentication'),
        ['keyword', 'docs'],
        defaultConfig
      );

      expect(results.has('keyword')).toBe(true);
      expect(results.has('docs')).toBe(true);
      expect(results.get('keyword')!.length).toBeGreaterThan(0);
      expect(results.get('docs')!.length).toBeGreaterThan(0);
    });

    it('should include attributions', async () => {
      const { attributions } = await retriever.retrieveFromAllSources(
        createQuery('login'),
        ['keyword'],
        defaultConfig
      );

      expect(attributions.length).toBeGreaterThan(0);
      expect(attributions[0].source).toBe('keyword');
      expect(attributions[0].count).toBeGreaterThan(0);
      expect(attributions[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should skip disabled sources', async () => {
      const disabledConfig = {
        ...defaultConfig,
        sources: {
          ...defaultConfig.sources,
          keyword: { enabled: false, weight: 0.5, topK: 5 },
        },
      };

      await retriever.initializeSources(disabledConfig);

      const { results } = await retriever.retrieveFromAllSources(
        createQuery('login'),
        ['keyword'],
        disabledConfig
      );

      expect(results.has('keyword')).toBe(false);
    });

    it('should skip unregistered sources', async () => {
      const { results } = await retriever.retrieveFromAllSources(
        createQuery('login'),
        ['vector_db'], // Not registered
        defaultConfig
      );

      expect(results.has('vector_db')).toBe(false);
    });

    it('should handle source errors gracefully', async () => {
      // Create a mock source that throws
      const failingSource = {
        name: 'keyword' as RAGSourceType,
        enabled: true,
        initialize: vi.fn().mockResolvedValue(undefined),
        retrieve: vi.fn().mockRejectedValue(new Error('Source error')),
        healthCheck: vi.fn().mockResolvedValue(true),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const errorRetriever = createRetriever();
      errorRetriever.registerSource(failingSource);
      await errorRetriever.initializeSources(defaultConfig);

      // Should not throw, just return empty results
      const { results } = await errorRetriever.retrieveFromAllSources(
        createQuery('test'),
        ['keyword'],
        defaultConfig
      );

      expect(results.has('keyword')).toBe(false);
      await errorRetriever.dispose();
    });
  });

  describe('checkHealth', () => {
    it('should check health of all sources', async () => {
      const health = await retriever.checkHealth();

      expect(health.get('keyword')).toBe(true);
      expect(health.get('docs')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should dispose all sources', async () => {
      await retriever.dispose();

      expect(retriever.getAllSources()).toHaveLength(0);
    });
  });
});

describe('createRetriever', () => {
  it('should create a retriever instance', () => {
    const retriever = createRetriever();

    expect(retriever).toBeInstanceOf(Retriever);
  });
});
