/**
 * Tests for Vector Store Interfaces and Types
 *
 * These tests verify the type definitions work correctly at runtime
 * and validate the structure of configuration objects.
 */

import { describe, it, expect } from 'vitest';
import type {
  VectorStoreConfig,
  VectorDocument,
  MetadataFilter,
  SearchQuery,
  HybridSearchQuery,
  SearchResult,
  CollectionStats,
  HealthStatus,
} from '../interfaces.js';

describe('VectorStoreConfig', () => {
  it('should accept valid ChromaDB configuration', () => {
    const config: VectorStoreConfig = {
      provider: 'chromadb',
      dimensions: 1536,
      distanceMetric: 'cosine',
      chromadb: {
        persistPath: './data/chroma',
        anonymizedTelemetry: false,
      },
    };

    expect(config.provider).toBe('chromadb');
    expect(config.dimensions).toBe(1536);
    expect(config.distanceMetric).toBe('cosine');
    expect(config.chromadb?.persistPath).toBe('./data/chroma');
  });

  it('should accept valid pgvector configuration', () => {
    const config: VectorStoreConfig = {
      provider: 'pgvector',
      dimensions: 768,
      distanceMetric: 'euclidean',
      pgvector: {
        connectionString: 'postgresql://localhost:5432/test',
        poolSize: 20,
        schema: 'vectors',
        index: {
          type: 'hnsw',
          m: 32,
          efConstruction: 128,
        },
      },
    };

    expect(config.provider).toBe('pgvector');
    expect(config.pgvector?.poolSize).toBe(20);
    expect(config.pgvector?.index?.type).toBe('hnsw');
  });

  it('should accept cache configuration', () => {
    const config: VectorStoreConfig = {
      provider: 'chromadb',
      dimensions: 1536,
      distanceMetric: 'cosine',
      chromadb: {
        persistPath: './data',
      },
      cache: {
        enabled: true,
        ttlMs: 300000,
        maxEntries: 10000,
      },
    };

    expect(config.cache?.enabled).toBe(true);
    expect(config.cache?.ttlMs).toBe(300000);
    expect(config.cache?.maxEntries).toBe(10000);
  });
});

describe('VectorDocument', () => {
  it('should accept valid document structure', () => {
    const doc: VectorDocument = {
      id: 'doc-123',
      embedding: new Array(1536).fill(0.1),
      content: 'function hello() { return "world"; }',
      metadata: {
        filePath: 'src/hello.ts',
        language: 'typescript',
        chunkType: 'function',
        name: 'hello',
        startLine: 1,
        endLine: 3,
      },
    };

    expect(doc.id).toBe('doc-123');
    expect(doc.embedding.length).toBe(1536);
    expect(doc.metadata.language).toBe('typescript');
    expect(doc.metadata.chunkType).toBe('function');
  });

  it('should allow custom metadata fields', () => {
    const doc: VectorDocument = {
      id: 'doc-456',
      embedding: [0.1, 0.2, 0.3],
      content: 'test content',
      metadata: {
        customField: 'custom value',
        customNumber: 42,
        customArray: ['a', 'b', 'c'],
      },
    };

    expect(doc.metadata['customField']).toBe('custom value');
    expect(doc.metadata['customNumber']).toBe(42);
  });
});

describe('MetadataFilter', () => {
  it('should accept simple equality filter', () => {
    const filter: MetadataFilter = {
      where: { language: 'typescript' },
    };

    expect(filter.where?.['language']).toBe('typescript');
  });

  it('should accept in-list filter', () => {
    const filter: MetadataFilter = {
      whereIn: { language: ['typescript', 'javascript'] },
    };

    expect(filter.whereIn?.['language']).toEqual(['typescript', 'javascript']);
  });

  it('should accept numeric comparison filters', () => {
    const filter: MetadataFilter = {
      whereGte: { startLine: 10 },
      whereLte: { endLine: 100 },
    };

    expect(filter.whereGte?.['startLine']).toBe(10);
    expect(filter.whereLte?.['endLine']).toBe(100);
  });

  it('should accept nested AND/OR filters', () => {
    const filter: MetadataFilter = {
      and: [
        { where: { language: 'typescript' } },
        {
          or: [
            { where: { chunkType: 'function' } },
            { where: { chunkType: 'class' } },
          ],
        },
      ],
    };

    expect(filter.and?.length).toBe(2);
    expect(filter.and?.[1]?.or?.length).toBe(2);
  });
});

describe('SearchQuery', () => {
  it('should accept valid search query', () => {
    const query: SearchQuery = {
      embedding: new Array(1536).fill(0.1),
      topK: 10,
      scoreThreshold: 0.7,
      filter: { where: { language: 'typescript' } },
      includeMetadata: true,
      includeContent: true,
      includeEmbedding: false,
    };

    expect(query.topK).toBe(10);
    expect(query.scoreThreshold).toBe(0.7);
    expect(query.includeMetadata).toBe(true);
  });
});

describe('HybridSearchQuery', () => {
  it('should accept valid hybrid search query', () => {
    const query: HybridSearchQuery = {
      embedding: new Array(1536).fill(0.1),
      text: 'authentication middleware',
      topK: 20,
      alpha: 0.6, // More weight on vector search
    };

    expect(query.text).toBe('authentication middleware');
    expect(query.alpha).toBe(0.6);
  });
});

describe('SearchResult', () => {
  it('should have correct structure', () => {
    const result: SearchResult = {
      id: 'doc-123',
      score: 0.95,
      content: 'function authenticate() {}',
      metadata: {
        filePath: 'src/auth.ts',
        language: 'typescript',
      },
    };

    expect(result.id).toBe('doc-123');
    expect(result.score).toBe(0.95);
    expect(result.content).toBeDefined();
    expect(result.metadata?.filePath).toBe('src/auth.ts');
  });

  it('should allow optional fields', () => {
    const result: SearchResult = {
      id: 'doc-456',
      score: 0.8,
    };

    expect(result.content).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.embedding).toBeUndefined();
  });
});

describe('CollectionStats', () => {
  it('should have correct structure', () => {
    const stats: CollectionStats = {
      name: 'codebase',
      documentCount: 10000,
      dimensions: 1536,
      indexSize: 50000000,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-15'),
    };

    expect(stats.name).toBe('codebase');
    expect(stats.documentCount).toBe(10000);
    expect(stats.dimensions).toBe(1536);
  });
});

describe('HealthStatus', () => {
  it('should represent healthy status', () => {
    const status: HealthStatus = {
      healthy: true,
      provider: 'chromadb',
      latencyMs: 15,
      details: {
        version: '1.0.0',
        collections: 5,
      },
    };

    expect(status.healthy).toBe(true);
    expect(status.latencyMs).toBe(15);
    expect(status.error).toBeUndefined();
  });

  it('should represent unhealthy status', () => {
    const status: HealthStatus = {
      healthy: false,
      provider: 'pgvector',
      latencyMs: 5000,
      error: 'Connection timeout',
    };

    expect(status.healthy).toBe(false);
    expect(status.error).toBe('Connection timeout');
  });
});
