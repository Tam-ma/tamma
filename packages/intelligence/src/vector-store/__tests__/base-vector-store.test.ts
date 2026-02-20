/**
 * Tests for BaseVectorStore
 *
 * Tests the common functionality provided by the abstract base class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseVectorStore } from '../base-vector-store.js';
import type {
  VectorStoreConfig,
  CollectionOptions,
  CollectionStats,
  VectorDocument,
  MetadataFilter,
  SearchQuery,
  HybridSearchQuery,
  MMRSearchQuery,
  SearchResult,
} from '../interfaces.js';
import {
  NotInitializedError,
  InvalidEmbeddingDimensionsError,
  VectorStoreError,
} from '../errors.js';

/**
 * Concrete implementation of BaseVectorStore for testing
 */
class TestVectorStore extends BaseVectorStore {
  public initializeCalled = false;
  public disposeCalled = false;

  constructor(config: VectorStoreConfig) {
    super('chromadb', config);
  }

  protected override async doInitialize(): Promise<void> {
    this.initializeCalled = true;
  }

  protected override async doDispose(): Promise<void> {
    this.disposeCalled = true;
  }

  protected override async doHealthCheck(): Promise<Record<string, unknown>> {
    return { test: true };
  }

  protected override async doCreateCollection(
    _name: string,
    _options?: CollectionOptions,
  ): Promise<void> {}

  protected override async doDeleteCollection(_name: string): Promise<void> {}

  protected override async doListCollections(): Promise<string[]> {
    return ['collection1', 'collection2'];
  }

  protected override async doGetCollectionStats(_name: string): Promise<CollectionStats> {
    return {
      name: _name,
      documentCount: 100,
      dimensions: this.dimensions,
    };
  }

  protected override async doCollectionExists(_name: string): Promise<boolean> {
    return true;
  }

  protected override async doUpsert(
    _collection: string,
    _documents: VectorDocument[],
  ): Promise<void> {}

  protected override async doDelete(_collection: string, _ids: string[]): Promise<void> {}

  protected override async doGet(_collection: string, _ids: string[]): Promise<VectorDocument[]> {
    return [];
  }

  protected override async doCount(
    _collection: string,
    _filter?: MetadataFilter,
  ): Promise<number> {
    return 50;
  }

  protected override async doSearch(
    _collection: string,
    _query: SearchQuery,
  ): Promise<SearchResult[]> {
    return [
      { id: 'doc-1', score: 0.95 },
      { id: 'doc-2', score: 0.85 },
    ];
  }

  protected override async doHybridSearch(
    _collection: string,
    _query: HybridSearchQuery,
  ): Promise<SearchResult[]> {
    return [{ id: 'doc-1', score: 0.9 }];
  }

  protected override async doMMRSearch(
    _collection: string,
    _query: MMRSearchQuery,
  ): Promise<SearchResult[]> {
    return [{ id: 'doc-1', score: 0.85 }];
  }

  protected override async doOptimize(_collection: string): Promise<void> {}

  protected override async doVacuum(_collection: string): Promise<void> {}
}

describe('BaseVectorStore', () => {
  let store: TestVectorStore;
  let config: VectorStoreConfig;

  beforeEach(() => {
    config = {
      provider: 'chromadb',
      dimensions: 3,
      distanceMetric: 'cosine',
      chromadb: {
        persistPath: './test-data',
      },
    };

    store = new TestVectorStore(config);
  });

  describe('initialization', () => {
    it('should call doInitialize on initialize()', async () => {
      await store.initialize();
      expect(store.initializeCalled).toBe(true);
    });

    it('should not throw when already initialized', async () => {
      await store.initialize();
      await expect(store.initialize()).resolves.not.toThrow();
    });

    it('should call doDispose on dispose()', async () => {
      await store.initialize();
      await store.dispose();
      expect(store.disposeCalled).toBe(true);
    });

    it('should not throw when disposing uninitialized store', async () => {
      await expect(store.dispose()).resolves.not.toThrow();
    });
  });

  describe('ensureInitialized', () => {
    it('should throw NotInitializedError when not initialized', async () => {
      await expect(store.listCollections()).rejects.toThrow(NotInitializedError);
    });

    it('should not throw when initialized', async () => {
      await store.initialize();
      await expect(store.listCollections()).resolves.not.toThrow();
    });
  });

  describe('validateCollectionName', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('should accept valid collection names', async () => {
      await expect(store.createCollection('valid-name')).resolves.not.toThrow();
      await expect(store.createCollection('valid_name')).resolves.not.toThrow();
      await expect(store.createCollection('ValidName123')).resolves.not.toThrow();
    });

    it('should reject empty collection name', async () => {
      await expect(store.createCollection('')).rejects.toThrow('cannot be empty');
      await expect(store.createCollection('   ')).rejects.toThrow('cannot be empty');
    });

    it('should reject collection names with special characters', async () => {
      await expect(store.createCollection('invalid.name')).rejects.toThrow(
        'can only contain',
      );
      await expect(store.createCollection('invalid/name')).rejects.toThrow(
        'can only contain',
      );
      await expect(store.createCollection('invalid name')).rejects.toThrow(
        'can only contain',
      );
    });
  });

  describe('validateDocument', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('should accept valid documents', async () => {
      const docs: VectorDocument[] = [
        {
          id: 'doc-1',
          embedding: [0.1, 0.2, 0.3],
          content: 'test',
          metadata: {},
        },
      ];

      await expect(store.upsert('collection', docs)).resolves.not.toThrow();
    });

    it('should reject documents with empty ID', async () => {
      const docs: VectorDocument[] = [
        {
          id: '',
          embedding: [0.1, 0.2, 0.3],
          content: 'test',
          metadata: {},
        },
      ];

      await expect(store.upsert('collection', docs)).rejects.toThrow('ID cannot be empty');
    });

    it('should reject documents with wrong embedding dimensions', async () => {
      const docs: VectorDocument[] = [
        {
          id: 'doc-1',
          embedding: [0.1, 0.2], // 2 instead of 3
          content: 'test',
          metadata: {},
        },
      ];

      await expect(store.upsert('collection', docs)).rejects.toThrow(
        InvalidEmbeddingDimensionsError,
      );
    });

    it('should reject documents with empty embedding', async () => {
      const docs: VectorDocument[] = [
        {
          id: 'doc-1',
          embedding: [],
          content: 'test',
          metadata: {},
        },
      ];

      await expect(store.upsert('collection', docs)).rejects.toThrow('non-empty array');
    });

    it('should reject documents with non-finite embedding values', async () => {
      const docs: VectorDocument[] = [
        {
          id: 'doc-1',
          embedding: [0.1, NaN, 0.3],
          content: 'test',
          metadata: {},
        },
      ];

      await expect(store.upsert('collection', docs)).rejects.toThrow('finite number');
    });
  });

  describe('validateSearchQuery', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('should accept valid search query', async () => {
      const query: SearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
      };

      await expect(store.search('collection', query)).resolves.not.toThrow();
    });

    it('should reject query with wrong embedding dimensions', async () => {
      const query: SearchQuery = {
        embedding: [0.1, 0.2],
        topK: 10,
      };

      await expect(store.search('collection', query)).rejects.toThrow(
        InvalidEmbeddingDimensionsError,
      );
    });

    it('should reject query with non-positive topK', async () => {
      const query: SearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 0,
      };

      await expect(store.search('collection', query)).rejects.toThrow('positive integer');
    });

    it('should reject query with invalid scoreThreshold', async () => {
      const query1: SearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
        scoreThreshold: -0.1,
      };

      const query2: SearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
        scoreThreshold: 1.5,
      };

      await expect(store.search('collection', query1)).rejects.toThrow('between 0 and 1');
      await expect(store.search('collection', query2)).rejects.toThrow('between 0 and 1');
    });
  });

  describe('hybridSearch', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('should reject empty text query', async () => {
      const query: HybridSearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        text: '',
        topK: 10,
      };

      await expect(store.hybridSearch('collection', query)).rejects.toThrow(
        'non-empty text query',
      );
    });

    it('should reject whitespace-only text query', async () => {
      const query: HybridSearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        text: '   ',
        topK: 10,
      };

      await expect(store.hybridSearch('collection', query)).rejects.toThrow(
        'non-empty text query',
      );
    });
  });

  describe('mmrSearch', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('should accept valid MMR search query', async () => {
      const query: MMRSearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
        lambda: 0.5,
      };

      await expect(store.mmrSearch('collection', query)).resolves.not.toThrow();
    });

    it('should use default lambda of 0.5', async () => {
      const query: MMRSearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
      };

      const results = await store.mmrSearch('collection', query);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should reject lambda less than 0', async () => {
      const query: MMRSearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
        lambda: -0.1,
      };

      await expect(store.mmrSearch('collection', query)).rejects.toThrow(
        'lambda must be between 0 and 1',
      );
    });

    it('should reject lambda greater than 1', async () => {
      const query: MMRSearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
        lambda: 1.5,
      };

      await expect(store.mmrSearch('collection', query)).rejects.toThrow(
        'lambda must be between 0 and 1',
      );
    });
  });

  describe('caching', () => {
    it('should use cache when enabled', async () => {
      const cachedStore = new TestVectorStore({
        ...config,
        cache: {
          enabled: true,
          ttlMs: 60000,
          maxEntries: 100,
        },
      });

      await cachedStore.initialize();

      const query: SearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
      };

      // First search - cache miss
      await cachedStore.search('collection', query);

      // Second search - should be cache hit
      await cachedStore.search('collection', query);

      // Note: We can't easily verify cache hits without exposing cache stats
      // This is mainly testing that caching doesn't break functionality
    });

    it('should use NoOpCache when caching is disabled', async () => {
      const uncachedStore = new TestVectorStore({
        ...config,
        cache: {
          enabled: false,
          ttlMs: 60000,
          maxEntries: 100,
        },
      });

      await uncachedStore.initialize();

      const query: SearchQuery = {
        embedding: [0.1, 0.2, 0.3],
        topK: 10,
      };

      // Should work without caching
      await expect(uncachedStore.search('collection', query)).resolves.not.toThrow();
    });
  });

  describe('logging', () => {
    it('should use provided logger', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const loggedStore = new TestVectorStore({
        ...config,
        logger: mockLogger,
      });

      await loggedStore.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initializing'),
        expect.any(Object),
      );
    });

    it('should work without logger', async () => {
      // No logger provided
      await expect(store.initialize()).resolves.not.toThrow();
    });
  });
});
