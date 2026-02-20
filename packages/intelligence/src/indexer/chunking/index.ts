/**
 * Chunking Module
 *
 * Provides code chunking strategies for different programming languages.
 *
 * @module @tamma/intelligence/indexer/chunking
 */

export { BaseChunker } from './base-chunker.js';
export { TypeScriptChunker } from './typescript-chunker.js';
export { GenericChunker } from './generic-chunker.js';
export {
  ChunkerFactory,
  chunkerFactory,
  DEFAULT_STRATEGIES,
} from './chunker-factory.js';
