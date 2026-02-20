/**
 * Vector Store Interface Definitions
 *
 * Core interfaces and types for vector database integration in the Tamma platform.
 * Supports multiple providers: ChromaDB, pgvector, and future cloud providers.
 */

import type { ILogger } from '@tamma/shared';

// === Provider Types ===

/**
 * Supported vector store providers
 */
export type VectorStoreProvider = 'chromadb' | 'pgvector' | 'pinecone' | 'qdrant' | 'weaviate';

/**
 * Distance metrics for similarity search
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot_product';

// === Configuration Types ===

/**
 * ChromaDB-specific configuration
 */
export interface ChromaDBConfig {
  /** Path to persist ChromaDB data (for embedded mode) */
  persistPath: string;
  /** Whether to enable anonymized telemetry (default: false) */
  anonymizedTelemetry?: boolean;
  /** Host for client mode (optional, uses embedded if not provided) */
  host?: string;
  /** Port for client mode (optional) */
  port?: number;
}

/**
 * PostgreSQL pgvector-specific configuration
 */
export interface PgVectorConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Connection pool size (default: 10) */
  poolSize?: number;
  /** Database schema to use (default: public) */
  schema?: string;
  /** HNSW index parameters */
  index?: {
    /** Index type: hnsw or ivfflat */
    type?: 'hnsw' | 'ivfflat';
    /** HNSW m parameter (max connections per layer) */
    m?: number;
    /** HNSW ef_construction parameter */
    efConstruction?: number;
  };
}

/**
 * Pinecone-specific configuration (for future implementation)
 */
export interface PineconeConfig {
  /** Pinecone API key */
  apiKey: string;
  /** Pinecone environment */
  environment: string;
  /** Index name */
  indexName: string;
}

/**
 * Qdrant-specific configuration (for future implementation)
 */
export interface QdrantConfig {
  /** Qdrant server URL */
  url: string;
  /** Optional API key */
  apiKey?: string;
}

/**
 * Weaviate-specific configuration (for future implementation)
 */
export interface WeaviateConfig {
  /** Connection scheme */
  scheme: 'http' | 'https';
  /** Weaviate host */
  host: string;
  /** Optional API key */
  apiKey?: string;
}

/**
 * Cache configuration for query results
 */
export interface CacheConfig {
  /** Enable caching */
  enabled: boolean;
  /** Time-to-live in milliseconds */
  ttlMs: number;
  /** Maximum number of cache entries */
  maxEntries: number;
}

/**
 * Main vector store configuration
 */
export interface VectorStoreConfig {
  /** Vector store provider to use */
  provider: VectorStoreProvider;
  /** Embedding dimensions (e.g., 1536 for OpenAI ada-002) */
  dimensions: number;
  /** Distance metric for similarity calculation */
  distanceMetric: DistanceMetric;
  /** Optional logger instance */
  logger?: ILogger;

  /** ChromaDB-specific configuration */
  chromadb?: ChromaDBConfig;
  /** pgvector-specific configuration */
  pgvector?: PgVectorConfig;
  /** Pinecone-specific configuration */
  pinecone?: PineconeConfig;
  /** Qdrant-specific configuration */
  qdrant?: QdrantConfig;
  /** Weaviate-specific configuration */
  weaviate?: WeaviateConfig;

  /** Query result caching configuration */
  cache?: CacheConfig;
}

// === Health & Status Types ===

/**
 * Health check result
 */
export interface HealthStatus {
  /** Whether the vector store is healthy */
  healthy: boolean;
  /** Provider name */
  provider: VectorStoreProvider;
  /** Health check latency in milliseconds */
  latencyMs: number;
  /** Additional provider-specific details */
  details?: Record<string, unknown>;
  /** Error message if unhealthy */
  error?: string;
}

/**
 * Collection statistics
 */
export interface CollectionStats {
  /** Collection name */
  name: string;
  /** Number of documents in the collection */
  documentCount: number;
  /** Embedding dimensions */
  dimensions: number;
  /** Index size in bytes (if available) */
  indexSize?: number;
  /** Collection creation timestamp */
  createdAt?: Date;
  /** Last update timestamp */
  updatedAt?: Date;
}

/**
 * Options for creating a collection
 */
export interface CollectionOptions {
  /** Override default dimensions */
  dimensions?: number;
  /** Override default distance metric */
  distanceMetric?: DistanceMetric;
  /** Additional metadata for the collection */
  metadata?: Record<string, unknown>;
}

// === Document Types ===

/**
 * Metadata associated with a vector document
 */
export interface VectorMetadata {
  /** Source file path */
  filePath?: string;
  /** Programming language */
  language?: string;
  /** Type of code chunk */
  chunkType?: 'function' | 'class' | 'module' | 'block';
  /** Name of the code element (function name, class name, etc.) */
  name?: string;
  /** Starting line number in source file */
  startLine?: number;
  /** Ending line number in source file */
  endLine?: number;
  /** Parent scope (e.g., class name for a method) */
  parentScope?: string;
  /** Import statements */
  imports?: string[];
  /** Export statements */
  exports?: string[];
  /** Docstring or documentation */
  docstring?: string;
  /** Content hash for deduplication */
  hash?: string;
  /** Timestamp when indexed */
  indexedAt?: string;
  /** Allow additional custom metadata */
  [key: string]: unknown;
}

/**
 * A document stored in the vector database
 */
export interface VectorDocument {
  /** Unique document identifier */
  id: string;
  /** Vector embedding */
  embedding: number[];
  /** Original text content */
  content: string;
  /** Associated metadata */
  metadata: VectorMetadata;
}

// === Search Types ===

/**
 * Metadata filter for search queries
 */
export interface MetadataFilter {
  /** Exact match conditions */
  where?: Record<string, unknown>;
  /** In list conditions */
  whereIn?: Record<string, unknown[]>;
  /** Not in list conditions */
  whereNotIn?: Record<string, unknown[]>;
  /** Greater than conditions */
  whereGt?: Record<string, number>;
  /** Greater than or equal conditions */
  whereGte?: Record<string, number>;
  /** Less than conditions */
  whereLt?: Record<string, number>;
  /** Less than or equal conditions */
  whereLte?: Record<string, number>;
  /** String contains conditions */
  whereContains?: Record<string, string>;
  /** AND combination of filters */
  and?: MetadataFilter[];
  /** OR combination of filters */
  or?: MetadataFilter[];
}

/**
 * Vector similarity search query
 */
export interface SearchQuery {
  /** Query embedding vector */
  embedding: number[];
  /** Number of results to return */
  topK: number;
  /** Minimum score threshold (0-1 for cosine similarity) */
  scoreThreshold?: number;
  /** Metadata filter */
  filter?: MetadataFilter;
  /** Include metadata in results */
  includeMetadata?: boolean;
  /** Include content in results */
  includeContent?: boolean;
  /** Include embedding vectors in results */
  includeEmbedding?: boolean;
}

/**
 * Hybrid search query combining vector and keyword search
 */
export interface HybridSearchQuery extends SearchQuery {
  /** Text query for keyword search */
  text: string;
  /** Alpha weighting: 0 = keyword only, 1 = vector only, default 0.5 */
  alpha?: number;
}

/**
 * Max Marginal Relevance (MMR) search query for diverse results
 */
export interface MMRSearchQuery extends SearchQuery {
  /**
   * Lambda parameter controlling diversity vs relevance trade-off.
   * 1.0 = pure relevance (same as regular search)
   * 0.0 = pure diversity (maximally different results)
   * Default: 0.5
   */
  lambda?: number;
  /**
   * Number of candidates to fetch before applying MMR re-ranking.
   * Should be >= topK. Default: topK * 4
   */
  fetchK?: number;
}

/**
 * Search result item
 */
export interface SearchResult {
  /** Document identifier */
  id: string;
  /** Similarity score (higher is more similar) */
  score: number;
  /** Document content (if requested) */
  content?: string;
  /** Document metadata (if requested) */
  metadata?: VectorMetadata;
  /** Document embedding (if requested) */
  embedding?: number[];
}

// === Main Interface ===

/**
 * Vector store interface defining all operations
 */
export interface IVectorStore {
  // === Lifecycle ===

  /**
   * Initialize the vector store connection
   * @throws {VectorStoreError} If initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Dispose of resources and close connections
   */
  dispose(): Promise<void>;

  /**
   * Check the health status of the vector store
   * @returns Health status including latency and any errors
   */
  healthCheck(): Promise<HealthStatus>;

  // === Collection Management ===

  /**
   * Create a new collection
   * @param name - Collection name
   * @param options - Optional collection settings
   * @throws {VectorStoreError} If collection already exists or creation fails
   */
  createCollection(name: string, options?: CollectionOptions): Promise<void>;

  /**
   * Delete a collection and all its documents
   * @param name - Collection name
   * @throws {VectorStoreError} If collection doesn't exist or deletion fails
   */
  deleteCollection(name: string): Promise<void>;

  /**
   * List all collections
   * @returns Array of collection names
   */
  listCollections(): Promise<string[]>;

  /**
   * Get statistics for a collection
   * @param name - Collection name
   * @returns Collection statistics
   * @throws {VectorStoreError} If collection doesn't exist
   */
  getCollectionStats(name: string): Promise<CollectionStats>;

  /**
   * Check if a collection exists
   * @param name - Collection name
   * @returns True if collection exists
   */
  collectionExists(name: string): Promise<boolean>;

  // === Document Operations ===

  /**
   * Insert or update documents in a collection
   * @param collection - Collection name
   * @param documents - Documents to upsert
   * @throws {VectorStoreError} If collection doesn't exist or upsert fails
   */
  upsert(collection: string, documents: VectorDocument[]): Promise<void>;

  /**
   * Delete documents by ID
   * @param collection - Collection name
   * @param ids - Document IDs to delete
   * @throws {VectorStoreError} If collection doesn't exist or deletion fails
   */
  delete(collection: string, ids: string[]): Promise<void>;

  /**
   * Get documents by ID
   * @param collection - Collection name
   * @param ids - Document IDs to retrieve
   * @returns Retrieved documents (may be fewer than requested if some don't exist)
   * @throws {VectorStoreError} If collection doesn't exist
   */
  get(collection: string, ids: string[]): Promise<VectorDocument[]>;

  /**
   * Count documents in a collection
   * @param collection - Collection name
   * @param filter - Optional metadata filter
   * @returns Document count
   * @throws {VectorStoreError} If collection doesn't exist
   */
  count(collection: string, filter?: MetadataFilter): Promise<number>;

  // === Search Operations ===

  /**
   * Perform vector similarity search
   * @param collection - Collection name
   * @param query - Search query with embedding and parameters
   * @returns Ranked search results
   * @throws {VectorStoreError} If collection doesn't exist or search fails
   */
  search(collection: string, query: SearchQuery): Promise<SearchResult[]>;

  /**
   * Perform hybrid search combining vector and keyword search
   * @param collection - Collection name
   * @param query - Hybrid search query
   * @returns Ranked search results
   * @throws {VectorStoreError} If collection doesn't exist or search fails
   */
  hybridSearch(collection: string, query: HybridSearchQuery): Promise<SearchResult[]>;

  /**
   * Perform Max Marginal Relevance (MMR) search for diverse results
   * @param collection - Collection name
   * @param query - MMR search query
   * @returns Ranked search results with diversity optimization
   * @throws {VectorStoreError} If collection doesn't exist or search fails
   */
  mmrSearch(collection: string, query: MMRSearchQuery): Promise<SearchResult[]>;

  // === Maintenance ===

  /**
   * Optimize collection indexes for better search performance
   * @param collection - Collection name
   */
  optimize(collection: string): Promise<void>;

  /**
   * Clean up deleted documents and reclaim space
   * @param collection - Collection name
   */
  vacuum(collection: string): Promise<void>;
}

// === Factory Interface ===

/**
 * Factory for creating vector store instances
 */
export interface IVectorStoreFactory {
  /**
   * Create a vector store instance with the given configuration
   * @param config - Vector store configuration
   * @returns Configured vector store instance
   * @throws {VectorStoreError} If provider is not supported or configuration is invalid
   */
  create(config: VectorStoreConfig): IVectorStore;

  /**
   * Get list of supported providers
   * @returns Array of provider names
   */
  getSupportedProviders(): VectorStoreProvider[];
}
