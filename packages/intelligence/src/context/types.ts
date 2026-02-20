/**
 * Context Aggregator Types
 *
 * Type definitions for the unified context aggregation service.
 * The Context Aggregator orchestrates context retrieval from multiple sources
 * (Vector DB, RAG, MCP, Web Search), manages token budgets, deduplicates
 * results, and assembles optimal context windows for agent tasks.
 *
 * @module @tamma/intelligence/context
 */

// === Source Types ===

/**
 * Available context retrieval sources
 */
export type ContextSourceType = 'vector_db' | 'rag' | 'mcp' | 'web_search' | 'live_api';

/**
 * Task types that determine default source configuration
 */
export type TaskType =
  | 'analysis'
  | 'planning'
  | 'implementation'
  | 'review'
  | 'testing'
  | 'documentation';

/**
 * Output format for assembled context
 */
export type ContextFormat = 'xml' | 'markdown' | 'plain';

// === Context Request ===

/**
 * Request for context retrieval
 */
export interface ContextRequest {
  /** Natural language query */
  query: string;

  /** Type of task requiring context */
  taskType: TaskType;

  /** Maximum tokens for assembled context */
  maxTokens: number;

  /** Tokens reserved for system/user prompts */
  reservedTokens?: number;

  /** Specific sources to query (defaults based on taskType) */
  sources?: ContextSourceType[];

  /** Source priority weights for budget allocation */
  sourcePriorities?: Partial<Record<ContextSourceType, number>>;

  /** Hints to improve retrieval quality */
  hints?: ContextHints;

  /** Processing options */
  options?: ContextOptions;
}

/**
 * Hints that help improve retrieval quality
 */
export interface ContextHints {
  relatedFiles?: string[];
  relatedIssues?: number[];
  language?: string;
  framework?: string;
  recentCommits?: string[];
}

/**
 * Processing options for context retrieval
 */
export interface ContextOptions {
  /** Enable deduplication (default: true) */
  deduplicate?: boolean;
  /** Enable compression for large chunks */
  compress?: boolean;
  /** Enable summarization for verbose content */
  summarize?: boolean;
  /** Include metadata in output */
  includeMetadata?: boolean;
  /** Output format (default: 'xml') */
  format?: ContextFormat;
  /** Custom cache key */
  cacheKey?: string;
  /** Skip cache lookup */
  skipCache?: boolean;
  /** Per-request timeout in milliseconds */
  timeout?: number;
}

// === Context Response ===

/**
 * Complete response from context retrieval
 */
export interface ContextResponse {
  /** Unique request identifier */
  requestId: string;

  /** Assembled context ready for LLM consumption */
  context: AssembledContext;

  /** Per-source contribution details */
  sources: SourceContribution[];

  /** Request metrics */
  metrics: ContextMetrics;
}

/**
 * Assembled context output
 */
export interface AssembledContext {
  /** Formatted context text */
  text: string;

  /** Individual chunks that compose the context */
  chunks: ContextChunk[];

  /** Total token count of the assembled text */
  tokenCount: number;

  /** Format used for assembly */
  format: ContextFormat;
}

/**
 * A single chunk of context from a source
 */
export interface ContextChunk {
  /** Unique chunk identifier */
  id: string;

  /** Chunk content text */
  content: string;

  /** Source that provided this chunk */
  source: ContextSourceType;

  /** Relevance score (0-1) */
  relevance: number;

  /** Chunk metadata */
  metadata: ChunkMetadata;

  /** Token count for this chunk */
  tokenCount?: number;

  /** Embedding vector (used for semantic deduplication) */
  embedding?: number[];
}

/**
 * Metadata attached to a context chunk
 */
export interface ChunkMetadata {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  symbolName?: string;
  symbolType?: 'function' | 'class' | 'interface' | 'module' | 'block';
  url?: string;
  title?: string;
  date?: Date;
  hash?: string;
}

/**
 * Contribution details from a single source
 */
export interface SourceContribution {
  source: ContextSourceType;
  chunksProvided: number;
  tokensUsed: number;
  latencyMs: number;
  cacheHit: boolean;
  error?: string;
}

/**
 * Metrics for a context retrieval request
 */
export interface ContextMetrics {
  totalLatencyMs: number;
  totalTokens: number;
  budgetUtilization: number;
  deduplicationRate: number;
  cacheHitRate: number;
  sourcesQueried: number;
  sourcesSucceeded: number;
}

// === Configuration ===

/**
 * Main aggregator configuration
 */
export interface AggregatorConfig {
  sources: SourcesConfig;
  budget: BudgetConfig;
  deduplication: DeduplicationConfig;
  caching: CachingConfig;
  optimization: OptimizationConfig;
}

export interface SourcesConfig {
  vector_db?: SourceConfig;
  rag?: SourceConfig;
  mcp?: SourceConfig;
  web_search?: SourceConfig;
  live_api?: SourceConfig;
}

export interface SourceConfig {
  enabled: boolean;
  timeoutMs: number;
  maxChunks?: number;
  retryAttempts?: number;
}

export interface BudgetConfig {
  defaultMaxTokens: number;
  reservedTokens: number;
  minChunkTokens: number;
  maxChunkTokens: number;
}

export interface DeduplicationConfig {
  enabled: boolean;
  similarityThreshold: number;
  useSemantic: boolean;
  useContentHash: boolean;
}

export interface CachingConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxEntries: number;
  provider: 'memory' | 'redis';
  redisUrl?: string;
}

export interface OptimizationConfig {
  compressLargeChunks: boolean;
  summarizeVerbose: boolean;
  smartTruncation: boolean;
  preserveCodeStructure: boolean;
}

// === Source Adapter Types ===

export interface SourceQuery {
  text: string;
  embedding?: number[];
  maxChunks: number;
  maxTokens: number;
  filters?: SourceFilters;
  timeout?: number;
}

export interface SourceFilters {
  filePaths?: string[];
  languages?: string[];
  dateRange?: { start?: Date; end?: Date };
  metadata?: Record<string, unknown>;
}

export interface SourceResult {
  chunks: ContextChunk[];
  latencyMs: number;
  cacheHit: boolean;
  error?: string;
}

// === Cache Types ===

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

export interface HealthStatus {
  healthy: boolean;
  sources: Record<ContextSourceType, { healthy: boolean; latencyMs?: number; error?: string }>;
  cache: { healthy: boolean; provider: string };
}

// === Interfaces ===

export interface IContextAggregator {
  configure(config: Partial<AggregatorConfig>): Promise<void>;
  getContext(request: ContextRequest): Promise<ContextResponse>;
  streamContext(request: ContextRequest): AsyncIterable<ContextChunk>;
  invalidateCache(pattern?: string): Promise<void>;
  getCacheStats(): CacheStats;
  healthCheck(): Promise<HealthStatus>;
  dispose(): Promise<void>;
}

export interface IContextSource {
  readonly name: ContextSourceType;
  initialize(config: SourceConfig): Promise<void>;
  isAvailable(): Promise<boolean>;
  retrieve(query: SourceQuery): Promise<SourceResult>;
  dispose(): Promise<void>;
}

export interface IContextCache {
  get(key: string): Promise<ContextResponse | null>;
  set(key: string, value: ContextResponse, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern?: string): Promise<void>;
  getStats(): CacheStats;
  healthCheck(): Promise<boolean>;
}

// === Default Configuration ===

export const DEFAULT_AGGREGATOR_CONFIG: AggregatorConfig = {
  sources: {
    vector_db: { enabled: true, timeoutMs: 2000, maxChunks: 20, retryAttempts: 2 },
    rag: { enabled: true, timeoutMs: 3000, maxChunks: 15, retryAttempts: 2 },
    mcp: { enabled: true, timeoutMs: 5000, maxChunks: 10, retryAttempts: 1 },
    web_search: { enabled: true, timeoutMs: 5000, maxChunks: 5, retryAttempts: 1 },
    live_api: { enabled: false, timeoutMs: 10000, maxChunks: 5 },
  },
  budget: { defaultMaxTokens: 8000, reservedTokens: 1000, minChunkTokens: 50, maxChunkTokens: 1000 },
  deduplication: { enabled: true, similarityThreshold: 0.9, useSemantic: true, useContentHash: true },
  caching: { enabled: true, ttlSeconds: 300, maxEntries: 1000, provider: 'memory' },
  optimization: { compressLargeChunks: true, summarizeVerbose: false, smartTruncation: true, preserveCodeStructure: true },
};
