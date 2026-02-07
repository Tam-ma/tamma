import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RAGSource, createRAGSource } from '../../sources/rag-source.js';
import type { IRAGPipeline, RAGResult } from '../../../rag/types.js';
import type { SourceQuery } from '../../types.js';

const mockRAGResult: RAGResult = {
  queryId: 'q1',
  retrievedChunks: [
    {
      id: 'c1',
      content: 'function hello() {}',
      source: 'vector_db',
      score: 0.9,
      fusedScore: 0.85,
      metadata: {
        filePath: 'src/test.ts',
        startLine: 1,
        endLine: 10,
        language: 'typescript',
      },
    },
  ],
  assembledContext: '<context></context>',
  tokenCount: 50,
  sources: [{ source: 'vector_db', count: 1, avgScore: 0.9, latencyMs: 10 }],
  latencyMs: 15,
  cacheHit: false,
};

const mockRAGPipeline: IRAGPipeline = {
  configure: vi.fn().mockResolvedValue(undefined),
  retrieve: vi.fn().mockResolvedValue(mockRAGResult),
  recordFeedback: vi.fn().mockResolvedValue(undefined),
  getFeedbackStats: vi.fn().mockResolvedValue({ totalFeedback: 0, averageRating: 0, ratingDistribution: {} }),
};

describe('RAGSource', () => {
  let source: RAGSource;

  beforeEach(() => {
    vi.clearAllMocks();
    source = createRAGSource(mockRAGPipeline);
  });

  it('should have name rag', () => {
    expect(source.name).toBe('rag');
  });

  it('should retrieve chunks from RAG pipeline', async () => {
    const query: SourceQuery = { text: 'test query', maxChunks: 10, maxTokens: 2000 };
    const result = await source.retrieve(query);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe('c1');
    expect(result.chunks[0].source).toBe('rag');
    expect(result.chunks[0].relevance).toBe(0.85);
    expect(result.chunks[0].metadata.filePath).toBe('src/test.ts');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should pass query parameters to pipeline', async () => {
    const query: SourceQuery = {
      text: 'authentication',
      maxChunks: 5,
      maxTokens: 1500,
      filters: { languages: ['typescript'] },
    };
    await source.retrieve(query);

    expect(mockRAGPipeline.retrieve).toHaveBeenCalledWith(expect.objectContaining({
      text: 'authentication',
      maxTokens: 1500,
      topK: 5,
    }));
  });

  it('should handle pipeline errors', async () => {
    (mockRAGPipeline.retrieve as any).mockRejectedValueOnce(new Error('Pipeline failed'));
    const query: SourceQuery = { text: 'test', maxChunks: 5, maxTokens: 1000 };
    const result = await source.retrieve(query);
    expect(result.chunks).toHaveLength(0);
    expect(result.error).toBeDefined();
  });
});
