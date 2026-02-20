/**
 * Indexer Configuration
 *
 * Default configuration and utilities for the codebase indexer.
 */

import type { IndexerConfig } from './types.js';
import { DEFAULT_INCLUDE_PATTERNS, DEFAULT_EXCLUDE_PATTERNS } from './discovery/index.js';

/**
 * Default indexer configuration
 */
export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  // File discovery
  includePatterns: DEFAULT_INCLUDE_PATTERNS,
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  respectGitignore: true,

  // Chunking
  maxChunkTokens: 512,
  overlapTokens: 50,
  preserveImports: true,
  groupRelatedCode: true,

  // Embedding
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  batchSize: 100,

  // Triggers
  enableGitHooks: false,
  enableFileWatcher: false,
  scheduleCron: undefined,

  // Performance
  concurrency: 10,
  embeddingRateLimitPerMin: 3000,
};

/**
 * Merge partial config with defaults
 * @param partial - Partial configuration
 * @returns Complete configuration
 */
export function mergeConfig(partial: Partial<IndexerConfig>): IndexerConfig {
  return {
    ...DEFAULT_INDEXER_CONFIG,
    ...partial,
    // Merge arrays if provided
    includePatterns: partial.includePatterns ?? DEFAULT_INDEXER_CONFIG.includePatterns,
    excludePatterns: partial.excludePatterns ?? DEFAULT_INDEXER_CONFIG.excludePatterns,
  };
}

/**
 * Validate indexer configuration
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: IndexerConfig): void {
  if (config.maxChunkTokens <= 0) {
    throw new Error('maxChunkTokens must be positive');
  }

  if (config.overlapTokens < 0) {
    throw new Error('overlapTokens must be non-negative');
  }

  if (config.overlapTokens >= config.maxChunkTokens) {
    throw new Error('overlapTokens must be less than maxChunkTokens');
  }

  if (config.batchSize <= 0) {
    throw new Error('batchSize must be positive');
  }

  if (config.concurrency <= 0) {
    throw new Error('concurrency must be positive');
  }

  if (config.embeddingRateLimitPerMin <= 0) {
    throw new Error('embeddingRateLimitPerMin must be positive');
  }

  if (config.includePatterns.length === 0) {
    throw new Error('At least one include pattern is required');
  }
}
