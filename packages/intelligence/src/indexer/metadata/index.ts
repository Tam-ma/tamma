/**
 * Metadata Module
 *
 * Provides metadata extraction, hashing, and token counting utilities.
 *
 * @module @tamma/intelligence/indexer/metadata
 */

export {
  calculateHash,
  generateContentId,
  generateFileId,
  generateChunkId,
  hashesEqual,
  calculateFileHash,
} from './hash-calculator.js';

export {
  TokenCounter,
  estimateTokens,
  estimateTokensSimple,
  estimateTokensApproximate,
  type TokenCountMethod,
} from './token-counter.js';
