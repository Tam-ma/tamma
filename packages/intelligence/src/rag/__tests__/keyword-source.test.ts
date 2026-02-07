/**
 * Tests for Keyword Source (BM25)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KeywordSource, createKeywordSource } from '../sources/keyword-source.js';
import type { ProcessedQuery, SourceSettings } from '../types.js';

describe('KeywordSource', () => {
  let source: KeywordSource;
  const defaultSettings: SourceSettings = {
    enabled: true,
    weight: 1.0,
    topK: 10,
  };

  beforeEach(async () => {
    source = createKeywordSource();
    await source.initialize(defaultSettings);
  });

  const createQuery = (text: string): ProcessedQuery => ({
    original: text,
    expanded: [text],
    entities: [],
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newSource = createKeywordSource();
      await expect(newSource.initialize(defaultSettings)).resolves.not.toThrow();
    });

    it('should be enabled after initialization', async () => {
      expect(source.enabled).toBe(true);
    });
  });

  describe('addDocument', () => {
    it('should add a single document', () => {
      source.addDocument({
        id: 'doc1',
        content: 'function hello() { return "world"; }',
        metadata: { filePath: 'test.ts' },
      });

      expect(source.size).toBe(1);
    });

    it('should add multiple documents', () => {
      source.addDocuments([
        { id: 'doc1', content: 'first', metadata: {} },
        { id: 'doc2', content: 'second', metadata: {} },
      ]);

      expect(source.size).toBe(2);
    });
  });

  describe('removeDocument', () => {
    it('should remove a document', () => {
      source.addDocument({ id: 'doc1', content: 'test', metadata: {} });
      source.removeDocument('doc1');

      expect(source.size).toBe(0);
    });

    it('should handle removing non-existent document', () => {
      source.removeDocument('nonexistent');

      expect(source.size).toBe(0);
    });
  });

  describe('retrieve', () => {
    beforeEach(() => {
      source.addDocuments([
        {
          id: 'doc1',
          content: 'function handleLogin(user, password) { authenticate(user, password); }',
          metadata: { filePath: 'auth.ts', language: 'typescript' },
        },
        {
          id: 'doc2',
          content: 'function handleLogout(session) { session.invalidate(); }',
          metadata: { filePath: 'auth.ts', language: 'typescript' },
        },
        {
          id: 'doc3',
          content: 'class UserService { getUser(id) { return database.find(id); } }',
          metadata: { filePath: 'user.ts', language: 'typescript' },
        },
      ]);
    });

    it('should retrieve relevant documents', async () => {
      const results = await source.retrieve(createQuery('login'), { topK: 5 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('doc1');
    });

    it('should respect topK limit', async () => {
      const results = await source.retrieve(createQuery('function'), { topK: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for non-matching query', async () => {
      const results = await source.retrieve(createQuery('xyz123nonexistent'), { topK: 5 });

      expect(results).toHaveLength(0);
    });

    it('should return scores', async () => {
      const results = await source.retrieve(createQuery('login'), { topK: 5 });

      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should include metadata in results', async () => {
      const results = await source.retrieve(createQuery('login'), { topK: 5 });

      expect(results[0].metadata.filePath).toBe('auth.ts');
      expect(results[0].metadata.language).toBe('typescript');
    });

    it('should use expanded query terms', async () => {
      const query: ProcessedQuery = {
        original: 'login',
        expanded: ['login', 'authenticate'],
        entities: [],
      };

      const results = await source.retrieve(query, { topK: 5 });

      // Should still find doc1 which contains both terms
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('doc1');
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      source.addDocuments([
        {
          id: 'doc1',
          content: 'typescript code',
          metadata: { filePath: 'src/auth/login.ts', language: 'typescript' },
        },
        {
          id: 'doc2',
          content: 'python code',
          metadata: { filePath: 'scripts/deploy.py', language: 'python' },
        },
      ]);
    });

    it('should filter by language', async () => {
      const results = await source.retrieve(createQuery('code'), {
        topK: 5,
        filter: { languages: ['typescript'] },
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc1');
    });

    it('should filter by file path', async () => {
      const results = await source.retrieve(createQuery('code'), {
        topK: 5,
        filter: { filePaths: ['scripts'] },
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc2');
    });
  });

  describe('BM25 scoring', () => {
    it('should rank documents by relevance', async () => {
      source.addDocuments([
        {
          id: 'low',
          content: 'other content without the query term',
          metadata: {},
        },
        {
          id: 'medium',
          content: 'contains login once',
          metadata: {},
        },
        {
          id: 'high',
          content: 'login login login login authentication',
          metadata: {},
        },
      ]);

      const results = await source.retrieve(createQuery('login'), { topK: 5 });

      expect(results[0].id).toBe('high');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should penalize long documents for normalized TF', async () => {
      // BM25 includes length normalization
      source.addDocuments([
        {
          id: 'short',
          content: 'login authentication',
          metadata: {},
        },
        {
          id: 'long',
          content: 'login ' + 'other words '.repeat(100),
          metadata: {},
        },
      ]);

      const results = await source.retrieve(createQuery('login'), { topK: 5 });

      // Short document should score higher due to term density
      expect(results[0].id).toBe('short');
    });
  });

  describe('clear', () => {
    it('should remove all documents', () => {
      source.addDocuments([
        { id: 'doc1', content: 'test', metadata: {} },
        { id: 'doc2', content: 'test', metadata: {} },
      ]);

      source.clear();

      expect(source.size).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should return true', async () => {
      const healthy = await source.healthCheck();

      expect(healthy).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clear all data', async () => {
      source.addDocument({ id: 'doc1', content: 'test', metadata: {} });

      await source.dispose();

      expect(source.size).toBe(0);
      expect(source.enabled).toBe(false);
    });
  });
});

describe('createKeywordSource', () => {
  it('should create source with default BM25 params', () => {
    const source = createKeywordSource();

    expect(source).toBeInstanceOf(KeywordSource);
  });

  it('should create source with custom BM25 params', () => {
    const source = createKeywordSource({ k1: 2.0, b: 0.5 });

    expect(source).toBeInstanceOf(KeywordSource);
  });
});
