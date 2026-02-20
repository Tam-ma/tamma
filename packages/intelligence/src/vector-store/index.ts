/**
 * Vector Store Module
 *
 * Provides vector database integration for the Tamma platform.
 * Supports multiple providers including ChromaDB and PostgreSQL pgvector.
 *
 * @module @tamma/intelligence/vector-store
 *
 * @example
 * ```typescript
 * import { createChromaDBStore } from '@tamma/intelligence';
 *
 * const store = createChromaDBStore('./data/vectors');
 * await store.initialize();
 *
 * // Create a collection
 * await store.createCollection('codebase');
 *
 * // Upsert documents
 * await store.upsert('codebase', [{
 *   id: 'doc-1',
 *   embedding: [0.1, 0.2, ...],
 *   content: 'function hello() { return "world"; }',
 *   metadata: { filePath: 'src/hello.ts', language: 'typescript' }
 * }]);
 *
 * // Search for similar documents
 * const results = await store.search('codebase', {
 *   embedding: [0.1, 0.2, ...],
 *   topK: 10,
 *   filter: { where: { language: 'typescript' } }
 * });
 *
 * await store.dispose();
 * ```
 */

// Core interfaces and types
export type {
  // Configuration
  VectorStoreProvider,
  DistanceMetric,
  VectorStoreConfig,
  ChromaDBConfig,
  PgVectorConfig,
  PineconeConfig,
  QdrantConfig,
  WeaviateConfig,
  CacheConfig,
  // Health & Status
  HealthStatus,
  CollectionStats,
  CollectionOptions,
  // Documents
  VectorDocument,
  VectorMetadata,
  // Search
  MetadataFilter,
  SearchQuery,
  HybridSearchQuery,
  MMRSearchQuery,
  SearchResult,
  // Interfaces
  IVectorStore,
  IVectorStoreFactory,
} from './interfaces.js';

// Error types
export {
  VectorStoreError,
  VectorStoreErrorCode,
  CollectionNotFoundError,
  CollectionExistsError,
  InvalidEmbeddingDimensionsError,
  ProviderNotSupportedError,
  ProviderNotImplementedError,
  InvalidConfigError,
  NotInitializedError,
  ConnectionError,
} from './errors.js';

// Base class (for extending)
export { BaseVectorStore } from './base-vector-store.js';

// Factory
export {
  VectorStoreFactory,
  vectorStoreFactory,
  createVectorStore,
  createChromaDBStore,
  createPgVectorStore,
} from './factory.js';

// Providers
export {
  ChromaDBVectorStore,
  PgVectorStore,
  PineconeVectorStore,
  QdrantVectorStore,
  WeaviateVectorStore,
} from './providers/index.js';

// Cache
export {
  QueryCache,
  NoOpCache,
  generateCacheKey,
  type IQueryCache,
  type CacheEntry,
  type CacheStats,
} from './cache/index.js';

// Utilities
export {
  // Distance metrics
  cosineDistanceToSimilarity,
  cosineSimilarityToDistance,
  normalizeCosineScore,
  euclideanDistanceToSimilarity,
  dotProductToCosineSimilarity,
  vectorMagnitude,
  normalizeVector,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeScore,
  getChromaDBDistanceFunction,
  getPgVectorOperator,
  // Metadata filters
  validateMetadataFilter,
  isEmptyFilter,
  toChromaDBFilter,
  toPgVectorFilter,
  mergeFilters,
  whereEquals,
  whereIn,
  whereRange,
  type ChromaDBWhereClause,
  type PgVectorSQLCondition,
} from './utils/index.js';
