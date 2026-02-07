import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorDBSource, createVectorDBSource } from '../../sources/vector-db-source.js';
import type { IVectorStore, SearchResult } from '../../../vector-store/interfaces.js';
import type { SourceQuery } from '../../types.js';

const mockVectorStore: IVectorStore = {
  initialize: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  healthCheck: vi.fn().mockResolvedValue({ healthy: true, provider: 'chromadb' as const, latencyMs: 1 }),
  createCollection: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
  listCollections: vi.fn().mockResolvedValue([]),
  getCollectionStats: vi.fn().mockResolvedValue({ name: 'test', documentCount: 0, dimensions: 384 }),
  upsert: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  search: vi.fn().mockResolvedValue([]),
  hybridSearch: vi.fn().mockResolvedValue([]),
  mmrSearch: vi.fn().mockResolvedValue([]),
  optimize: vi.fn().mockResolvedValue(undefined),
  vacuum: vi.fn().mockResolvedValue(undefined),
};

describe('VectorDBSource', () => {
  let source: VectorDBSource;

  beforeEach(() => {
    vi.clearAllMocks();
    source = createVectorDBSource(mockVectorStore, 'index');
  });

  it('should have name vector_db', () => {
    expect(source.name).toBe('vector_db');
  });

  it('should return empty when no embedding provided', async () => {
    const query: SourceQuery = { text: 'test', maxChunks: 5, maxTokens: 1000 };
    const result = await source.retrieve(query);
    expect(result.chunks).toHaveLength(0);
  });

  it('should search with embedding', async () => {
    const mockResults: SearchResult[] = [
      { id: 'doc1', score: 0.95, content: 'hello world', metadata: { filePath: 'src/index.ts', language: 'typescript', startLine: 1, endLine: 10 } },
    ];
    (mockVectorStore.search as any).mockResolvedValueOnce(mockResults);

    const query: SourceQuery = { text: 'test', maxChunks: 5, maxTokens: 1000, embedding: [1, 2, 3] };
    const result = await source.retrieve(query);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe('doc1');
    expect(result.chunks[0].source).toBe('vector_db');
    expect(result.chunks[0].relevance).toBe(0.95);
    expect(result.chunks[0].metadata.filePath).toBe('src/index.ts');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should respect maxChunks', async () => {
    const mockResults: SearchResult[] = [
      { id: 'd1', score: 0.9 },
      { id: 'd2', score: 0.8 },
      { id: 'd3', score: 0.7 },
    ];
    (mockVectorStore.search as any).mockResolvedValueOnce(mockResults);

    const query: SourceQuery = { text: 'test', maxChunks: 2, maxTokens: 1000, embedding: [1, 2] };
    const result = await source.retrieve(query);
    expect(result.chunks.length).toBeLessThanOrEqual(2);
  });

  it('should handle search errors', async () => {
    (mockVectorStore.search as any).mockRejectedValueOnce(new Error('Search failed'));
    const query: SourceQuery = { text: 'test', maxChunks: 5, maxTokens: 1000, embedding: [1] };
    const result = await source.retrieve(query);
    expect(result.chunks).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it('should initialize and dispose', async () => {
    await source.initialize({ enabled: true, timeoutMs: 5000 });
    const available = await source.isAvailable();
    expect(available).toBe(true);

    await source.dispose();
    const after = await source.isAvailable();
    expect(after).toBe(false);
  });
});
