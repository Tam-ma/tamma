/**
 * Codebase Indexer Module
 *
 * Provides codebase indexing capabilities for the Tamma platform.
 * Processes source files, chunks them based on code structure,
 * generates embeddings, and stores them for semantic search.
 *
 * @module @tamma/intelligence/indexer
 *
 * @example
 * ```typescript
 * import { createCodebaseIndexer, createChromaDBStore } from '@tamma/intelligence';
 *
 * // Create a vector store
 * const vectorStore = createChromaDBStore('./data/vectors');
 * await vectorStore.initialize();
 *
 * // Create and initialize the indexer
 * const indexer = createCodebaseIndexer(vectorStore);
 * await indexer.initialize(process.env.OPENAI_API_KEY);
 *
 * // Subscribe to progress events
 * indexer.on('progress', (progress) => {
 *   console.log(`Phase: ${progress.phase}, Files: ${progress.filesProcessed}/${progress.filesTotal}`);
 * });
 *
 * // Index a project
 * const result = await indexer.indexProject('/path/to/project');
 * console.log(`Indexed ${result.filesProcessed} files, created ${result.chunksCreated} chunks`);
 *
 * // Clean up
 * await indexer.dispose();
 * await vectorStore.dispose();
 * ```
 */

// Types
export type {
  // Core types
  SupportedLanguage,
  ChunkType,
  CodeChunk,
  IndexedChunk,
  FileMetadata,
  EmbeddingProviderType,
  IndexerConfig,
  IndexResult,
  IndexError,
  IndexPhase,
  IndexProgress,
  IndexStatus,
  DiscoveredFile,
  ChunkingStrategy,
  // Interfaces
  ICodeChunker,
  IEmbeddingProvider,
  EmbeddingProviderConfig,
  ICodebaseIndexer,
  // Event handlers
  IndexerEventType,
  ProgressHandler,
  ErrorHandler,
  CompleteHandler,
} from './types.js';

// Errors
export {
  IndexerError,
  IndexerErrorCode,
  DiscoveryError,
  FileNotFoundError,
  FileReadError,
  ParseError,
  UnsupportedLanguageError,
  ChunkingError,
  EmbeddingError,
  EmbeddingRateLimitError,
  EmbeddingNotInitializedError,
  InvalidConfigError,
  NotInitializedError,
  OperationCancelledError,
  VectorStoreOperationError,
} from './errors.js';

// Configuration
export {
  DEFAULT_INDEXER_CONFIG,
  mergeConfig,
  validateConfig,
} from './config.js';

// Main indexer
export {
  CodebaseIndexer,
  createCodebaseIndexer,
} from './codebase-indexer.js';

// Discovery
export {
  FileDiscovery,
  createFileDiscovery,
  GitignoreParser,
  createGitignoreParser,
  GitDiffDetector,
  createGitDiffDetector,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  type FileDiscoveryOptions,
  type ChangeType,
  type DetectedChange,
  type GitDiffOptions,
} from './discovery/index.js';

// Chunking
export {
  BaseChunker,
  TypeScriptChunker,
  GenericChunker,
  ChunkerFactory,
  chunkerFactory,
  DEFAULT_STRATEGIES,
} from './chunking/index.js';

// Metadata
export {
  calculateHash,
  generateContentId,
  generateFileId,
  generateChunkId,
  hashesEqual,
  calculateFileHash,
  TokenCounter,
  estimateTokens,
  estimateTokensSimple,
  estimateTokensApproximate,
  type TokenCountMethod,
} from './metadata/index.js';

// Embedding
export {
  BaseEmbeddingProvider,
  OpenAIEmbeddingProvider,
  CohereEmbeddingProvider,
  OllamaEmbeddingProvider,
  MockEmbeddingProvider,
  EmbeddingService,
  type EmbeddingServiceConfig,
} from './embedding/index.js';

// Triggers
export {
  FileWatcher,
  createFileWatcher,
  GitHookInstaller,
  createGitHookInstaller,
  Scheduler,
  createScheduler,
  parseInterval,
  type FileWatcherConfig,
  type FileChangeCallback,
  type GitHookConfig,
  type GitHookResult,
  type SchedulerConfig,
  type SchedulerCallback,
} from './triggers/index.js';
