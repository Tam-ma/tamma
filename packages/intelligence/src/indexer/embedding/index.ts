/**
 * Embedding Module
 *
 * Provides embedding generation capabilities for the codebase indexer.
 *
 * @module @tamma/intelligence/indexer/embedding
 */

export { BaseEmbeddingProvider } from './base-embedding-provider.js';
export { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';
export { CohereEmbeddingProvider } from './cohere-embedding-provider.js';
export { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
export { MockEmbeddingProvider } from './mock-embedding-provider.js';
export {
  EmbeddingService,
  type EmbeddingServiceConfig,
} from './embedding-service.js';
