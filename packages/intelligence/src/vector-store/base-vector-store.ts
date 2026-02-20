/**
 * Base Vector Store
 *
 * Abstract base class providing common functionality for all vector store providers.
 * Includes logging, validation, caching, and metrics collection.
 */

import type { ILogger } from '@tamma/shared';
import type {
  IVectorStore,
  VectorStoreConfig,
  VectorStoreProvider,
  DistanceMetric,
  HealthStatus,
  CollectionStats,
  CollectionOptions,
  VectorDocument,
  MetadataFilter,
  SearchQuery,
  HybridSearchQuery,
  MMRSearchQuery,
  SearchResult,
} from './interfaces.js';
import {
  VectorStoreError,
  VectorStoreErrorCode,
  NotInitializedError,
  InvalidEmbeddingDimensionsError,
} from './errors.js';
import { QueryCache, NoOpCache, generateCacheKey, type IQueryCache } from './cache/query-cache.js';
import { validateMetadataFilter, isEmptyFilter } from './utils/metadata-filter.js';

/**
 * Default logger that does nothing
 */
const noOpLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Abstract base class for vector store implementations
 */
export abstract class BaseVectorStore implements IVectorStore {
  protected readonly provider: VectorStoreProvider;
  protected readonly dimensions: number;
  protected readonly distanceMetric: DistanceMetric;
  protected readonly logger: ILogger;
  protected readonly cache: IQueryCache;

  protected initialized: boolean = false;

  constructor(provider: VectorStoreProvider, config: VectorStoreConfig) {
    this.provider = provider;
    this.dimensions = config.dimensions;
    this.distanceMetric = config.distanceMetric;
    this.logger = config.logger ?? noOpLogger;

    // Initialize cache
    if (config.cache?.enabled) {
      this.cache = new QueryCache({
        enabled: true,
        ttlMs: config.cache.ttlMs,
        maxEntries: config.cache.maxEntries,
      });
    } else {
      this.cache = new NoOpCache();
    }
  }

  // === Lifecycle ===

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Vector store already initialized', { provider: this.provider });
      return;
    }

    this.logger.info('Initializing vector store', {
      provider: this.provider,
      dimensions: this.dimensions,
      distanceMetric: this.distanceMetric,
    });

    const startTime = Date.now();
    await this.doInitialize();
    this.initialized = true;

    this.logger.info('Vector store initialized', {
      provider: this.provider,
      durationMs: Date.now() - startTime,
    });
  }

  async dispose(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Disposing vector store', { provider: this.provider });

    await this.doDispose();
    this.initialized = false;
    this.cache.clear();

    this.logger.info('Vector store disposed', { provider: this.provider });
  }

  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      const details = await this.doHealthCheck();
      const latencyMs = Date.now() - startTime;

      return {
        healthy: true,
        provider: this.provider,
        latencyMs,
        details,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Health check failed', {
        provider: this.provider,
        error: errorMessage,
      });

      return {
        healthy: false,
        provider: this.provider,
        latencyMs,
        error: errorMessage,
      };
    }
  }

  // === Collection Management ===

  async createCollection(name: string, options?: CollectionOptions): Promise<void> {
    this.ensureInitialized();
    this.validateCollectionName(name);

    this.logger.info('Creating collection', {
      provider: this.provider,
      collection: name,
      options,
    });

    const startTime = Date.now();
    await this.doCreateCollection(name, options);

    this.logger.info('Collection created', {
      provider: this.provider,
      collection: name,
      durationMs: Date.now() - startTime,
    });
  }

  async deleteCollection(name: string): Promise<void> {
    this.ensureInitialized();

    this.logger.info('Deleting collection', {
      provider: this.provider,
      collection: name,
    });

    const startTime = Date.now();
    await this.doDeleteCollection(name);

    // Invalidate cache for this collection
    this.cache.invalidate(`^${name}:`);

    this.logger.info('Collection deleted', {
      provider: this.provider,
      collection: name,
      durationMs: Date.now() - startTime,
    });
  }

  async listCollections(): Promise<string[]> {
    this.ensureInitialized();
    return this.doListCollections();
  }

  async getCollectionStats(name: string): Promise<CollectionStats> {
    this.ensureInitialized();
    return this.doGetCollectionStats(name);
  }

  async collectionExists(name: string): Promise<boolean> {
    this.ensureInitialized();
    return this.doCollectionExists(name);
  }

  // === Document Operations ===

  async upsert(collection: string, documents: VectorDocument[]): Promise<void> {
    this.ensureInitialized();

    if (documents.length === 0) {
      return;
    }

    // Validate documents
    for (const doc of documents) {
      this.validateDocument(doc);
    }

    this.logger.debug('Upserting documents', {
      provider: this.provider,
      collection,
      count: documents.length,
    });

    const startTime = Date.now();
    await this.doUpsert(collection, documents);

    // Invalidate cache for this collection
    this.cache.invalidate(`^${collection}:`);

    this.logger.info('Documents upserted', {
      provider: this.provider,
      collection,
      count: documents.length,
      durationMs: Date.now() - startTime,
    });
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    this.ensureInitialized();

    if (ids.length === 0) {
      return;
    }

    this.logger.debug('Deleting documents', {
      provider: this.provider,
      collection,
      count: ids.length,
    });

    const startTime = Date.now();
    await this.doDelete(collection, ids);

    // Invalidate cache for this collection
    this.cache.invalidate(`^${collection}:`);

    this.logger.info('Documents deleted', {
      provider: this.provider,
      collection,
      count: ids.length,
      durationMs: Date.now() - startTime,
    });
  }

  async get(collection: string, ids: string[]): Promise<VectorDocument[]> {
    this.ensureInitialized();

    if (ids.length === 0) {
      return [];
    }

    return this.doGet(collection, ids);
  }

  async count(collection: string, filter?: MetadataFilter): Promise<number> {
    this.ensureInitialized();

    if (filter !== undefined && !isEmptyFilter(filter)) {
      validateMetadataFilter(filter);
    }

    return this.doCount(collection, filter);
  }

  // === Search Operations ===

  async search(collection: string, query: SearchQuery): Promise<SearchResult[]> {
    this.ensureInitialized();
    this.validateSearchQuery(query);

    // Check cache
    const cacheKey = generateCacheKey(collection, query);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.logger.debug('Cache hit', {
        provider: this.provider,
        collection,
        cacheKey,
      });
      return cached;
    }

    this.logger.debug('Searching', {
      provider: this.provider,
      collection,
      topK: query.topK,
      hasFilter: !isEmptyFilter(query.filter),
    });

    const startTime = Date.now();
    const results = await this.doSearch(collection, query);

    this.logger.debug('Search completed', {
      provider: this.provider,
      collection,
      resultCount: results.length,
      durationMs: Date.now() - startTime,
    });

    // Cache results
    this.cache.set(cacheKey, results);

    return results;
  }

  async hybridSearch(collection: string, query: HybridSearchQuery): Promise<SearchResult[]> {
    this.ensureInitialized();
    this.validateSearchQuery(query);

    if (!query.text || query.text.trim().length === 0) {
      throw new VectorStoreError(
        'Hybrid search requires a non-empty text query',
        VectorStoreErrorCode.INVALID_QUERY,
        this.provider,
      );
    }

    this.logger.debug('Hybrid searching', {
      provider: this.provider,
      collection,
      topK: query.topK,
      alpha: query.alpha,
      hasFilter: !isEmptyFilter(query.filter),
    });

    const startTime = Date.now();
    const results = await this.doHybridSearch(collection, query);

    this.logger.debug('Hybrid search completed', {
      provider: this.provider,
      collection,
      resultCount: results.length,
      durationMs: Date.now() - startTime,
    });

    return results;
  }

  async mmrSearch(collection: string, query: MMRSearchQuery): Promise<SearchResult[]> {
    this.ensureInitialized();
    this.validateSearchQuery(query);

    const lambda = query.lambda ?? 0.5;
    if (lambda < 0 || lambda > 1) {
      throw new VectorStoreError(
        'MMR lambda must be between 0 and 1',
        VectorStoreErrorCode.INVALID_QUERY,
        this.provider,
      );
    }

    this.logger.debug('MMR searching', {
      provider: this.provider,
      collection,
      topK: query.topK,
      lambda: lambda,
      fetchK: query.fetchK,
      hasFilter: !isEmptyFilter(query.filter),
    });

    const startTime = Date.now();
    const results = await this.doMMRSearch(collection, query);

    this.logger.debug('MMR search completed', {
      provider: this.provider,
      collection,
      resultCount: results.length,
      durationMs: Date.now() - startTime,
    });

    return results;
  }

  // === Maintenance ===

  async optimize(collection: string): Promise<void> {
    this.ensureInitialized();

    this.logger.info('Optimizing collection', {
      provider: this.provider,
      collection,
    });

    const startTime = Date.now();
    await this.doOptimize(collection);

    this.logger.info('Collection optimized', {
      provider: this.provider,
      collection,
      durationMs: Date.now() - startTime,
    });
  }

  async vacuum(collection: string): Promise<void> {
    this.ensureInitialized();

    this.logger.info('Vacuuming collection', {
      provider: this.provider,
      collection,
    });

    const startTime = Date.now();
    await this.doVacuum(collection);

    this.logger.info('Collection vacuumed', {
      provider: this.provider,
      collection,
      durationMs: Date.now() - startTime,
    });
  }

  // === Protected Helpers ===

  /**
   * Ensure the vector store is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new NotInitializedError(this.provider);
    }
  }

  /**
   * Validate a collection name
   */
  protected validateCollectionName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new VectorStoreError(
        'Collection name cannot be empty',
        VectorStoreErrorCode.INVALID_CONFIG,
        this.provider,
      );
    }

    // Only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new VectorStoreError(
        'Collection name can only contain alphanumeric characters, underscores, and hyphens',
        VectorStoreErrorCode.INVALID_CONFIG,
        this.provider,
      );
    }
  }

  /**
   * Validate a document before upserting
   */
  protected validateDocument(doc: VectorDocument): void {
    if (!doc.id || doc.id.trim().length === 0) {
      throw new VectorStoreError(
        'Document ID cannot be empty',
        VectorStoreErrorCode.INVALID_DOCUMENT,
        this.provider,
      );
    }

    if (!Array.isArray(doc.embedding) || doc.embedding.length === 0) {
      throw new VectorStoreError(
        'Document embedding must be a non-empty array',
        VectorStoreErrorCode.INVALID_DOCUMENT,
        this.provider,
      );
    }

    if (doc.embedding.length !== this.dimensions) {
      throw new InvalidEmbeddingDimensionsError(
        this.dimensions,
        doc.embedding.length,
        this.provider,
      );
    }

    // Validate embedding values are numbers
    for (let i = 0; i < doc.embedding.length; i++) {
      if (typeof doc.embedding[i] !== 'number' || !isFinite(doc.embedding[i] as number)) {
        throw new VectorStoreError(
          `Invalid embedding value at index ${i}: must be a finite number`,
          VectorStoreErrorCode.INVALID_DOCUMENT,
          this.provider,
        );
      }
    }
  }

  /**
   * Validate a search query
   */
  protected validateSearchQuery(query: SearchQuery): void {
    if (!Array.isArray(query.embedding) || query.embedding.length === 0) {
      throw new VectorStoreError(
        'Query embedding must be a non-empty array',
        VectorStoreErrorCode.INVALID_QUERY,
        this.provider,
      );
    }

    if (query.embedding.length !== this.dimensions) {
      throw new InvalidEmbeddingDimensionsError(
        this.dimensions,
        query.embedding.length,
        this.provider,
      );
    }

    if (query.topK <= 0) {
      throw new VectorStoreError(
        'topK must be a positive integer',
        VectorStoreErrorCode.INVALID_QUERY,
        this.provider,
      );
    }

    if (query.scoreThreshold !== undefined && (query.scoreThreshold < 0 || query.scoreThreshold > 1)) {
      throw new VectorStoreError(
        'scoreThreshold must be between 0 and 1',
        VectorStoreErrorCode.INVALID_QUERY,
        this.provider,
      );
    }

    if (query.filter !== undefined && !isEmptyFilter(query.filter)) {
      validateMetadataFilter(query.filter);
    }
  }

  // === Abstract Methods (to be implemented by providers) ===

  protected abstract doInitialize(): Promise<void>;
  protected abstract doDispose(): Promise<void>;
  protected abstract doHealthCheck(): Promise<Record<string, unknown>>;

  protected abstract doCreateCollection(name: string, options?: CollectionOptions): Promise<void>;
  protected abstract doDeleteCollection(name: string): Promise<void>;
  protected abstract doListCollections(): Promise<string[]>;
  protected abstract doGetCollectionStats(name: string): Promise<CollectionStats>;
  protected abstract doCollectionExists(name: string): Promise<boolean>;

  protected abstract doUpsert(collection: string, documents: VectorDocument[]): Promise<void>;
  protected abstract doDelete(collection: string, ids: string[]): Promise<void>;
  protected abstract doGet(collection: string, ids: string[]): Promise<VectorDocument[]>;
  protected abstract doCount(collection: string, filter?: MetadataFilter): Promise<number>;

  protected abstract doSearch(collection: string, query: SearchQuery): Promise<SearchResult[]>;
  protected abstract doHybridSearch(
    collection: string,
    query: HybridSearchQuery,
  ): Promise<SearchResult[]>;
  protected abstract doMMRSearch(
    collection: string,
    query: MMRSearchQuery,
  ): Promise<SearchResult[]>;

  protected abstract doOptimize(collection: string): Promise<void>;
  protected abstract doVacuum(collection: string): Promise<void>;
}
