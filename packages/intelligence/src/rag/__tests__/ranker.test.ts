/**
 * Tests for Result Ranker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Ranker, createRanker } from '../ranker.js';
import type { RetrievedChunk, RankingConfig, RAGSourceType } from '../types.js';

describe('Ranker', () => {
  let ranker: Ranker;
  let defaultConfig: RankingConfig;

  beforeEach(() => {
    ranker = createRanker();
    defaultConfig = {
      fusionMethod: 'rrf',
      rrfK: 60,
      mmrLambda: 0.7,
      recencyBoost: 0.1,
      recencyDecayDays: 30,
    };
  });

  const createChunk = (
    id: string,
    source: RAGSourceType,
    score: number,
    embedding?: number[]
  ): RetrievedChunk => ({
    id,
    content: `Content for ${id}`,
    source,
    score,
    metadata: {},
    embedding,
  });

  describe('mergeWithRRF', () => {
    it('should merge results from multiple sources', () => {
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', [
          createChunk('v1', 'vector_db', 0.95),
          createChunk('v2', 'vector_db', 0.85),
        ]],
        ['keyword', [
          createChunk('k1', 'keyword', 0.9),
          createChunk('v1', 'keyword', 0.8), // Duplicate with vector
        ]],
      ]);

      const result = ranker.mergeWithRRF(sourceResults, defaultConfig);

      expect(result.length).toBe(3); // v1, v2, k1
      // v1 should have higher fused score (appears in both)
      expect(result[0].id).toBe('v1');
    });

    it('should handle empty source results', () => {
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', []],
        ['keyword', []],
      ]);

      const result = ranker.mergeWithRRF(sourceResults, defaultConfig);

      expect(result).toHaveLength(0);
    });

    it('should handle single source', () => {
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', [
          createChunk('v1', 'vector_db', 0.95),
          createChunk('v2', 'vector_db', 0.85),
        ]],
      ]);

      const result = ranker.mergeWithRRF(sourceResults, defaultConfig);

      expect(result).toHaveLength(2);
      // Should maintain order by score
      expect(result[0].id).toBe('v1');
      expect(result[1].id).toBe('v2');
    });

    it('should assign fused scores to all results', () => {
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', [createChunk('v1', 'vector_db', 0.9)]],
      ]);

      const result = ranker.mergeWithRRF(sourceResults, defaultConfig);

      expect(result[0].fusedScore).toBeDefined();
      expect(result[0].fusedScore).toBeGreaterThan(0);
    });

    it('should calculate correct RRF scores', () => {
      const k = defaultConfig.rrfK;
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', [createChunk('v1', 'vector_db', 0.9)]],
      ]);

      const result = ranker.mergeWithRRF(sourceResults, defaultConfig);

      // RRF score for rank 0 = 1/(k + 0 + 1) = 1/61
      const expectedScore = 1 / (k + 1);
      expect(result[0].fusedScore).toBeCloseTo(expectedScore, 5);
    });
  });

  describe('applyMMR', () => {
    it('should select diverse results', () => {
      // Create chunks with embeddings
      const chunks = [
        createChunk('c1', 'vector_db', 0.9, [1, 0, 0]),
        createChunk('c2', 'vector_db', 0.85, [0.99, 0.1, 0]), // Similar to c1
        createChunk('c3', 'vector_db', 0.8, [0, 1, 0]), // Different from c1
      ].map((c) => ({ ...c, fusedScore: c.score }));

      const result = ranker.applyMMR(chunks, 2, 0.5);

      expect(result).toHaveLength(2);
      // Should select c1 (highest score) and c3 (most diverse)
      const ids = result.map((r) => r.id);
      expect(ids).toContain('c1');
      expect(ids).toContain('c3');
    });

    it('should return all chunks if k >= length', () => {
      const chunks = [
        createChunk('c1', 'vector_db', 0.9),
        createChunk('c2', 'vector_db', 0.8),
      ].map((c) => ({ ...c, fusedScore: c.score }));

      const result = ranker.applyMMR(chunks, 10, 0.7);

      expect(result).toHaveLength(2);
    });

    it('should handle empty input', () => {
      const result = ranker.applyMMR([], 5, 0.7);

      expect(result).toHaveLength(0);
    });

    it('should work without embeddings (falls back to top-k)', () => {
      const chunks = [
        createChunk('c1', 'vector_db', 0.9),
        createChunk('c2', 'vector_db', 0.8),
        createChunk('c3', 'vector_db', 0.7),
      ].map((c) => ({ ...c, fusedScore: c.score }));

      const result = ranker.applyMMR(chunks, 2, 0.7);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(result[1].id).toBe('c2');
    });

    it('should prefer relevance with high lambda', () => {
      const chunks = [
        createChunk('c1', 'vector_db', 0.9, [1, 0, 0]),
        createChunk('c2', 'vector_db', 0.85, [0.99, 0.1, 0]),
        createChunk('c3', 'vector_db', 0.5, [0, 1, 0]),
      ].map((c) => ({ ...c, fusedScore: c.score }));

      const result = ranker.applyMMR(chunks, 2, 1.0); // Pure relevance

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(result[1].id).toBe('c2');
    });
  });

  describe('applyRecencyBoost', () => {
    it('should boost recent chunks', () => {
      const now = new Date();
      const chunks: RetrievedChunk[] = [
        {
          ...createChunk('c1', 'vector_db', 0.8),
          fusedScore: 0.8,
          metadata: { date: now },
        },
        {
          ...createChunk('c2', 'vector_db', 0.9),
          fusedScore: 0.9,
          metadata: { date: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) }, // 60 days ago
        },
      ];

      const result = ranker.applyRecencyBoost(chunks, defaultConfig);

      // c1 should be boosted (recent), c2 should not (old)
      expect(result[0].fusedScore).toBeGreaterThan(0.8);
      expect(result[1].fusedScore).toBe(0.9); // No boost for old content
    });

    it('should not boost chunks without dates', () => {
      const chunks: RetrievedChunk[] = [
        { ...createChunk('c1', 'vector_db', 0.8), fusedScore: 0.8 },
      ];

      const result = ranker.applyRecencyBoost(chunks, defaultConfig);

      expect(result[0].fusedScore).toBe(0.8);
    });

    it('should handle empty input', () => {
      const result = ranker.applyRecencyBoost([], defaultConfig);

      expect(result).toHaveLength(0);
    });

    it('should decay boost over time', () => {
      const now = new Date();
      const halfDecay = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); // 15 days ago

      const chunks: RetrievedChunk[] = [
        {
          ...createChunk('recent', 'vector_db', 0.8),
          fusedScore: 0.8,
          metadata: { date: now },
        },
        {
          ...createChunk('half', 'vector_db', 0.8),
          fusedScore: 0.8,
          metadata: { date: halfDecay },
        },
      ];

      const result = ranker.applyRecencyBoost(chunks, defaultConfig);

      // Recent should have higher boost than half-decay
      expect(result[0].fusedScore).toBeGreaterThan(result[1].fusedScore!);
    });
  });

  describe('normalizeScores', () => {
    it('should normalize scores to 0-1 range', () => {
      const chunks = [
        { ...createChunk('c1', 'vector_db', 0.5), fusedScore: 0.5 },
        { ...createChunk('c2', 'vector_db', 1.0), fusedScore: 1.0 },
      ];

      const result = ranker.normalizeScores(chunks);

      expect(result[0].fusedScore).toBe(0);
      expect(result[1].fusedScore).toBe(1);
    });

    it('should handle all same scores', () => {
      const chunks = [
        { ...createChunk('c1', 'vector_db', 0.5), fusedScore: 0.5 },
        { ...createChunk('c2', 'vector_db', 0.5), fusedScore: 0.5 },
      ];

      const result = ranker.normalizeScores(chunks);

      expect(result[0].fusedScore).toBe(1);
      expect(result[1].fusedScore).toBe(1);
    });

    it('should handle empty input', () => {
      const result = ranker.normalizeScores([]);

      expect(result).toHaveLength(0);
    });
  });

  describe('deduplicateChunks', () => {
    it('should remove exact ID duplicates', () => {
      const chunks = [
        createChunk('c1', 'vector_db', 0.9),
        createChunk('c1', 'keyword', 0.8), // Duplicate ID
        createChunk('c2', 'vector_db', 0.7),
      ];

      const result = ranker.deduplicateChunks(chunks, 1.0);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(['c1', 'c2']);
    });

    it('should remove similar content based on threshold', () => {
      const chunks = [
        { ...createChunk('c1', 'vector_db', 0.9), embedding: [1, 0, 0] },
        { ...createChunk('c2', 'vector_db', 0.8), embedding: [0.99, 0.1, 0] }, // Very similar
        { ...createChunk('c3', 'vector_db', 0.7), embedding: [0, 1, 0] }, // Different
      ];

      const result = ranker.deduplicateChunks(chunks, 0.9);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toContain('c1');
      expect(result.map((r) => r.id)).toContain('c3');
    });

    it('should handle empty input', () => {
      const result = ranker.deduplicateChunks([], 0.9);

      expect(result).toHaveLength(0);
    });

    it('should keep all chunks with threshold 1.0', () => {
      const chunks = [
        createChunk('c1', 'vector_db', 0.9),
        createChunk('c2', 'vector_db', 0.8),
        createChunk('c3', 'vector_db', 0.7),
      ];

      const result = ranker.deduplicateChunks(chunks, 1.0);

      expect(result).toHaveLength(3);
    });
  });

  describe('mergeWithLinear', () => {
    it('should calculate weighted average scores', () => {
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', [createChunk('v1', 'vector_db', 1.0)]],
        ['keyword', [createChunk('v1', 'keyword', 0.5)]],
      ]);

      const weights = new Map<RAGSourceType, number>([
        ['vector_db', 2.0],
        ['keyword', 1.0],
      ]);

      const result = ranker.mergeWithLinear(sourceResults, weights);

      // Weighted avg = (1.0 * 2 + 0.5 * 1) / (2 + 1) = 2.5/3 ≈ 0.833
      expect(result[0].fusedScore).toBeCloseTo(0.833, 2);
    });

    it('should handle non-overlapping results', () => {
      const sourceResults = new Map<RAGSourceType, RetrievedChunk[]>([
        ['vector_db', [createChunk('v1', 'vector_db', 0.9)]],
        ['keyword', [createChunk('k1', 'keyword', 0.8)]],
      ]);

      const weights = new Map<RAGSourceType, number>([
        ['vector_db', 1.0],
        ['keyword', 1.0],
      ]);

      const result = ranker.mergeWithLinear(sourceResults, weights);

      expect(result).toHaveLength(2);
    });
  });
});
