import { describe, it, expect } from 'vitest';
import { ChunkRanker, createChunkRanker } from '../ranker.js';
import type { ContextChunk, ContextRequest } from '../types.js';

const makeChunk = (id: string, relevance: number, opts: Partial<ContextChunk> = {}): ContextChunk => ({
  id,
  content: 'some content here',
  source: 'vector_db',
  relevance,
  metadata: {},
  ...opts,
});

const makeRequest = (overrides: Partial<ContextRequest> = {}): ContextRequest => ({
  query: 'test query',
  taskType: 'analysis',
  maxTokens: 4000,
  ...overrides,
});

describe('ChunkRanker', () => {
  const ranker = createChunkRanker();

  describe('createChunkRanker', () => {
    it('should create an instance via factory', () => {
      expect(createChunkRanker()).toBeInstanceOf(ChunkRanker);
    });
  });

  describe('rank', () => {
    it('should sort chunks by relevance descending', () => {
      const chunks = [
        makeChunk('low', 0.3),
        makeChunk('high', 0.9),
        makeChunk('mid', 0.6),
      ];
      const ranked = ranker.rank(chunks, makeRequest());
      expect(ranked[0].id).toBe('high');
      expect(ranked[1].id).toBe('mid');
      expect(ranked[2].id).toBe('low');
    });

    it('should boost chunks matching related files', () => {
      const chunks = [
        makeChunk('unrelated', 0.7, { metadata: { filePath: 'src/other.ts' } }),
        makeChunk('related', 0.6, { metadata: { filePath: 'src/auth.ts' } }),
      ];
      const request = makeRequest({
        hints: { relatedFiles: ['auth.ts'] },
      });
      const ranked = ranker.rank(chunks, request);
      // The related file should be boosted: 0.6 * 1.3 = 0.78 > 0.7
      expect(ranked[0].id).toBe('related');
    });

    it('should boost chunks matching language hint', () => {
      const chunks = [
        makeChunk('py', 0.7, { metadata: { language: 'python' } }),
        makeChunk('ts', 0.65, { metadata: { language: 'typescript' } }),
      ];
      const request = makeRequest({
        hints: { language: 'typescript' },
      });
      const ranked = ranker.rank(chunks, request);
      // ts: 0.65 * 1.1 = 0.715 > 0.7 = py
      expect(ranked[0].id).toBe('ts');
    });

    it('should cap scores at 1.0', () => {
      const chunks = [
        makeChunk('high', 0.95, { metadata: { filePath: 'src/auth.ts', language: 'typescript' } }),
      ];
      const request = makeRequest({
        hints: { relatedFiles: ['auth.ts'], language: 'typescript' },
      });
      const ranked = ranker.rank(chunks, request);
      expect(ranked[0].relevance).toBeLessThanOrEqual(1);
    });

    it('should handle empty chunks array', () => {
      const ranked = ranker.rank([], makeRequest());
      expect(ranked).toHaveLength(0);
    });
  });

  describe('selectWithinBudget', () => {
    it('should select chunks up to token budget', () => {
      const chunks = [
        makeChunk('a', 0.9, { tokenCount: 100 }),
        makeChunk('b', 0.8, { tokenCount: 100 }),
        makeChunk('c', 0.7, { tokenCount: 100 }),
      ];
      const selected = ranker.selectWithinBudget(chunks, 250);
      expect(selected).toHaveLength(2);
    });

    it('should handle zero budget', () => {
      const chunks = [makeChunk('a', 0.9, { tokenCount: 100 })];
      const selected = ranker.selectWithinBudget(chunks, 0);
      expect(selected).toHaveLength(0);
    });

    it('should estimate tokens when tokenCount is not set', () => {
      const chunks = [
        makeChunk('a', 0.9), // no tokenCount, will be estimated
      ];
      const selected = ranker.selectWithinBudget(chunks, 10000);
      expect(selected).toHaveLength(1);
      expect(selected[0].tokenCount).toBeGreaterThan(0);
    });

    it('should return empty for empty input', () => {
      const selected = ranker.selectWithinBudget([], 1000);
      expect(selected).toHaveLength(0);
    });
  });
});
