/**
 * RAG Pipeline Module
 *
 * Provides Retrieval Augmented Generation capabilities for the Tamma platform.
 * Combines multi-source retrieval, ranking, and context assembly for LLM augmentation.
 *
 * @module @tamma/intelligence/rag
 *
 * @example
 * ```typescript
 * import {
 *   createRAGPipeline,
 *   createVectorSource,
 *   createKeywordSource,
 * } from '@tamma/intelligence';
 *
 * // Create and initialize the RAG pipeline
 * const pipeline = createRAGPipeline({
 *   sources: {
 *     vector_db: { enabled: true, weight: 1.0, topK: 20 },
 *     keyword: { enabled: true, weight: 0.5, topK: 10 },
 *   },
 *   ranking: {
 *     fusionMethod: 'rrf',
 *     mmrLambda: 0.7,
 *   },
 *   assembly: {
 *     maxTokens: 4000,
 *     format: 'xml',
 *   },
 * });
 *
 * await pipeline.initialize({
 *   embeddingService,
 *   vectorStore,
 *   collectionName: 'codebase',
 * });
 *
 * // Retrieve context for a query
 * const result = await pipeline.retrieve({
 *   text: 'How does the authentication flow work?',
 *   maxTokens: 3000,
 * });
 *
 * console.log(`Retrieved ${result.retrievedChunks.length} chunks`);
 * console.log(`Context (${result.tokenCount} tokens):\n${result.assembledContext}`);
 *
 * // Record feedback
 * await pipeline.recordFeedback({
 *   queryId: result.queryId,
 *   chunkId: result.retrievedChunks[0].id,
 *   rating: 'helpful',
 * });
 *
 * await pipeline.dispose();
 * ```
 */

// Types
export type {
  // Core types
  RAGSourceType,
  ContextFormat,
  FusionMethod,
  // Configuration
  SourceSettings,
  RAGSourceConfig,
  RankingConfig,
  AssemblyConfig,
  CachingConfig,
  TimeoutConfig,
  RAGConfig,
  // Query types
  QueryContext,
  RAGQuery,
  // Result types
  ChunkMetadata,
  RetrievedChunk,
  SourceAttribution,
  AssembledContext,
  RAGResult,
  // Query processing
  EntityType,
  ExtractedEntity,
  QueryIntent,
  ProcessedQuery,
  // Feedback
  RelevanceRating,
  RelevanceFeedback,
  FeedbackStats,
  // Source types
  SourceFilter,
  RetrieveOptions,
  // Interfaces
  IRAGPipeline,
  IRAGSource,
  IQueryProcessor,
  IRanker,
  IContextAssembler,
} from './types.js';

// Default configuration
export { DEFAULT_RAG_CONFIG } from './types.js';

// Errors
export {
  RAGError,
  RAGErrorCode,
  NotInitializedError,
  InvalidConfigError,
  QueryProcessingError,
  RetrievalError,
  SourceTimeoutError,
  SourceUnavailableError,
  RankingError,
  AssemblyError,
  EmbeddingError,
  CacheError,
  FeedbackError,
} from './errors.js';

// Main pipeline
export { RAGPipeline, createRAGPipeline } from './rag-pipeline.js';

// Query processor
export { QueryProcessor, createQueryProcessor } from './query-processor.js';

// Ranker
export { Ranker, createRanker } from './ranker.js';

// Context assembler
export { ContextAssembler, createContextAssembler } from './assembler.js';

// Cache
export {
  RAGCache,
  NoOpRAGCache,
  createRAGCache,
  type RAGCacheStats,
} from './cache.js';

// Feedback
export { FeedbackTracker, createFeedbackTracker } from './feedback.js';

// Retriever
export { Retriever, createRetriever } from './retriever.js';

// Sources
export {
  // Base
  BaseRAGSource,
  // Vector source
  VectorSource,
  createVectorSource,
  type VectorSourceConfig,
  // Keyword source
  KeywordSource,
  createKeywordSource,
  type KeywordDocument,
  // Docs source
  DocsSource,
  createDocsSource,
  type DocEntry,
  // GitHub sources
  IssuesSource,
  PullRequestsSource,
  CommitsSource,
  createIssuesSource,
  createPullRequestsSource,
  createCommitsSource,
  type GitHubEntry,
  type GitHubContentType,
} from './sources/index.js';
