import { describe, it, expect } from 'vitest';
import { Deduplicator, createDeduplicator } from '../deduplicator.js';
import type { ContextChunk, DeduplicationConfig } from '../types.js';

const makeChunk = (id: string, content: string, opts: Partial<ContextChunk> = {}): ContextChunk => ({
  id,
  content,
  source: 'vector_db',
  relevance: 0.8,
  metadata: {},
  ...opts,
});

describe('Deduplicator', () => {
  const dedup = createDeduplicator();

  const enabledConfig: DeduplicationConfig = {
    enabled: true,
    similarityThreshold: 0.9,
    useSemantic: true,
    useContentHash: true,
  };

  describe('createDeduplicator', () => {
    it('should create an instance via factory', () => {
      expect(createDeduplicator()).toBeInstanceOf(Deduplicator);
    });
  });

  describe('deduplicate', () => {
    it('should return chunks unchanged when disabled', async () => {
      const chunks = [makeChunk('a', 'hello'), makeChunk('b', 'hello')];
      const result = await dedup.deduplicate(chunks, { ...enabledConfig, enabled: false });
      expect(result.chunks).toHaveLength(2);
      expect(result.removedCount).toBe(0);
    });

    it('should return empty array unchanged', async () => {
      const result = await dedup.deduplicate([], enabledConfig);
      expect(result.chunks).toHaveLength(0);
      expect(result.removedCount).toBe(0);
    });

    it('should return single chunk unchanged', async () => {
      const chunks = [makeChunk('a', 'hello')];
      const result = await dedup.deduplicate(chunks, enabledConfig);
      expect(result.chunks).toHaveLength(1);
      expect(result.removedCount).toBe(0);
    });

    it('should remove exact content duplicates via hash', async () => {
      const chunks = [
        makeChunk('a', 'function hello() {}'),
        makeChunk('b', 'function hello() {}'),
        makeChunk('c', 'function world() {}'),
      ];
      const result = await dedup.deduplicate(chunks, { ...enabledConfig, useSemantic: false });
      expect(result.chunks).toHaveLength(2);
      expect(result.removedCount).toBe(1);
    });

    it('should normalize whitespace for hash dedup', async () => {
      const chunks = [
        makeChunk('a', '  hello   world  '),
        makeChunk('b', 'hello world'),
      ];
      const result = await dedup.deduplicate(chunks, { ...enabledConfig, useSemantic: false });
      expect(result.chunks).toHaveLength(1);
      expect(result.removedCount).toBe(1);
    });
  });

  describe('hashDeduplicate', () => {
    it('should remove hash duplicates', () => {
      const chunks = [
        makeChunk('a', 'same content'),
        makeChunk('b', 'same content'),
        makeChunk('c', 'different'),
      ];
      const { unique, removed } = dedup.hashDeduplicate(chunks);
      expect(unique).toHaveLength(2);
      expect(removed).toBe(1);
    });
  });

  describe('semanticDeduplicate', () => {
    it('should merge similar embeddings keeping highest relevance', () => {
      const emb1 = [1, 0, 0];
      const emb2 = [0.99, 0.01, 0]; // very similar to emb1
      const emb3 = [0, 0, 1]; // different

      const chunks = [
        makeChunk('a', 'first', { relevance: 0.7, embedding: emb1 }),
        makeChunk('b', 'second', { relevance: 0.9, embedding: emb2 }),
        makeChunk('c', 'third', { relevance: 0.5, embedding: emb3 }),
      ];

      const { unique, removed } = dedup.semanticDeduplicate(chunks, 0.9);
      expect(unique).toHaveLength(2);
      expect(removed).toBe(1);
      // Should keep the one with higher relevance from the similar pair
      const ids = unique.map(c => c.id);
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });

    it('should pass through chunks without embeddings', () => {
      const chunks = [
        makeChunk('a', 'no embedding', { relevance: 0.5 }),
        makeChunk('b', 'also no embedding', { relevance: 0.8 }),
      ];
      const { unique, removed } = dedup.semanticDeduplicate(chunks, 0.9);
      expect(unique).toHaveLength(2);
      expect(removed).toBe(0);
    });

    it('should handle single chunk with embedding', () => {
      const chunks = [
        makeChunk('a', 'solo', { embedding: [1, 0] }),
      ];
      const { unique, removed } = dedup.semanticDeduplicate(chunks, 0.9);
      expect(unique).toHaveLength(1);
      expect(removed).toBe(0);
    });
  });

  describe('mergeOverlappingChunks', () => {
    it('should merge chunks from the same file with overlapping lines', () => {
      const chunks = [
        makeChunk('a', 'lines 1-10', {
          metadata: { filePath: 'src/foo.ts', startLine: 1, endLine: 10 },
          relevance: 0.8,
        }),
        makeChunk('b', 'lines 5-15', {
          metadata: { filePath: 'src/foo.ts', startLine: 5, endLine: 15 },
          relevance: 0.9,
        }),
      ];
      const { unique, removed } = dedup.mergeOverlappingChunks(chunks);
      expect(unique).toHaveLength(1);
      expect(removed).toBe(1);
      // Should keep higher relevance
      expect(unique[0].id).toBe('b');
    });

    it('should not merge chunks from different files', () => {
      const chunks = [
        makeChunk('a', 'content a', {
          metadata: { filePath: 'src/foo.ts', startLine: 1, endLine: 10 },
        }),
        makeChunk('b', 'content b', {
          metadata: { filePath: 'src/bar.ts', startLine: 1, endLine: 10 },
        }),
      ];
      const { unique, removed } = dedup.mergeOverlappingChunks(chunks);
      expect(unique).toHaveLength(2);
      expect(removed).toBe(0);
    });

    it('should not merge non-overlapping chunks from the same file', () => {
      const chunks = [
        makeChunk('a', 'content a', {
          metadata: { filePath: 'src/foo.ts', startLine: 1, endLine: 10 },
        }),
        makeChunk('b', 'content b', {
          metadata: { filePath: 'src/foo.ts', startLine: 50, endLine: 60 },
        }),
      ];
      const { unique, removed } = dedup.mergeOverlappingChunks(chunks);
      expect(unique).toHaveLength(2);
      expect(removed).toBe(0);
    });

    it('should pass through chunks without line ranges', () => {
      const chunks = [
        makeChunk('a', 'no range'),
        makeChunk('b', 'also no range'),
      ];
      const { unique, removed } = dedup.mergeOverlappingChunks(chunks);
      expect(unique).toHaveLength(2);
      expect(removed).toBe(0);
    });

    it('should handle a mix of ranged and non-ranged chunks', () => {
      const chunks = [
        makeChunk('a', 'ranged', {
          metadata: { filePath: 'src/foo.ts', startLine: 1, endLine: 10 },
        }),
        makeChunk('b', 'no range'),
        makeChunk('c', 'overlapping', {
          metadata: { filePath: 'src/foo.ts', startLine: 5, endLine: 15 },
          relevance: 0.95,
        }),
      ];
      const { unique, removed } = dedup.mergeOverlappingChunks(chunks);
      // 'a' and 'c' overlap, keep 'c' (higher relevance). 'b' passes through.
      expect(unique).toHaveLength(2);
      expect(removed).toBe(1);
      const ids = unique.map(u => u.id);
      expect(ids).toContain('c');
      expect(ids).toContain('b');
    });

    it('should handle single chunk', () => {
      const chunks = [makeChunk('a', 'solo', {
        metadata: { filePath: 'src/foo.ts', startLine: 1, endLine: 10 },
      })];
      const { unique, removed } = dedup.mergeOverlappingChunks(chunks);
      expect(unique).toHaveLength(1);
      expect(removed).toBe(0);
    });
  });

  describe('computeHash', () => {
    it('should produce consistent hashes', () => {
      const h1 = dedup.computeHash('hello world');
      const h2 = dedup.computeHash('hello world');
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different content', () => {
      const h1 = dedup.computeHash('hello');
      const h2 = dedup.computeHash('world');
      expect(h1).not.toBe(h2);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      expect(dedup.cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(dedup.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('should return 0 for empty vectors', () => {
      expect(dedup.cosineSimilarity([], [])).toBe(0);
    });

    it('should return 0 for mismatched lengths', () => {
      expect(dedup.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('should return 0 for zero vectors', () => {
      expect(dedup.cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });
  });
});
