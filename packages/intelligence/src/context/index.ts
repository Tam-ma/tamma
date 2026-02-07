/**
 * Context Aggregator Module
 *
 * Provides unified context retrieval from multiple sources
 * (Vector DB, RAG, MCP, Web Search) with token budget management,
 * deduplication, and context assembly for LLM consumption.
 *
 * @module @tamma/intelligence/context
 *
 * @example
 * ```typescript
 * import { createContextAggregator } from '@tamma/intelligence';
 *
 * const aggregator = createContextAggregator();
 *
 * const result = await aggregator.getContext({
 *   query: 'How does authentication work?',
 *   taskType: 'analysis',
 *   maxTokens: 4000,
 * });
 *
 * console.log(result.context.text);
 * ```
 */

// Types
export type {
  ContextSourceType,
  TaskType,
  ContextFormat,
  ContextRequest,
  ContextHints,
  ContextOptions,
  ContextResponse,
  AssembledContext,
  ContextChunk,
  ChunkMetadata,
  SourceContribution,
  ContextMetrics,
  AggregatorConfig,
  SourcesConfig,
  SourceConfig,
  BudgetConfig,
  DeduplicationConfig,
  CachingConfig,
  OptimizationConfig,
  SourceQuery,
  SourceFilters,
  SourceResult,
  CacheStats,
  HealthStatus,
  IContextAggregator,
  IContextSource,
  IContextCache,
} from './types.js';

export { DEFAULT_AGGREGATOR_CONFIG } from './types.js';

// Main aggregator
export {
  ContextAggregator,
  createContextAggregator,
  type ContextAggregatorOptions,
} from './aggregator.js';

// Budget manager
export {
  BudgetManager,
  createBudgetManager,
  type BudgetAllocation,
} from './budget-manager.js';

// Deduplicator
export {
  Deduplicator,
  createDeduplicator,
  type DeduplicationResult,
} from './deduplicator.js';

// Ranker
export {
  ChunkRanker,
  createChunkRanker,
} from './ranker.js';

// Assembler
export {
  ContextAssemblerAgg,
  createContextAssemblerAgg,
} from './assembler.js';

// Cache
export {
  MemoryCache,
  createMemoryCache,
  RedisCache,
  createRedisCache,
  type IRedisClient,
} from './cache/index.js';

// Source adapters
export {
  BaseContextSource,
  VectorDBSource,
  createVectorDBSource,
  RAGSource,
  createRAGSource,
  MCPSource,
  createMCPSource,
  type IMCPClientLike,
  WebSearchSource,
  createWebSearchSource,
} from './sources/index.js';
