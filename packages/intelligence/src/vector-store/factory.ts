/**
 * Vector Store Factory
 *
 * Factory for creating vector store instances based on configuration.
 * Handles provider selection, validation, and lazy initialization.
 */

import type {
  IVectorStore,
  IVectorStoreFactory,
  VectorStoreConfig,
  VectorStoreProvider,
} from './interfaces.js';
import { ProviderNotSupportedError, InvalidConfigError } from './errors.js';
import { ChromaDBVectorStore } from './providers/chromadb.js';
import { PgVectorStore } from './providers/pgvector.js';
import { PineconeVectorStore } from './providers/pinecone.js';
import { QdrantVectorStore } from './providers/qdrant.js';
import { WeaviateVectorStore } from './providers/weaviate.js';

/**
 * Supported vector store providers
 */
const SUPPORTED_PROVIDERS: VectorStoreProvider[] = [
  'chromadb',
  'pgvector',
  'pinecone',
  'qdrant',
  'weaviate',
];

/**
 * Fully implemented providers (others are stubs)
 */
const IMPLEMENTED_PROVIDERS: VectorStoreProvider[] = ['chromadb', 'pgvector'];

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  dimensions: 1536, // OpenAI ada-002 embedding dimensions
  distanceMetric: 'cosine' as const,
};

/**
 * Factory for creating vector store instances
 */
export class VectorStoreFactory implements IVectorStoreFactory {
  /**
   * Create a vector store instance with the given configuration
   *
   * @param config - Vector store configuration
   * @returns Configured vector store instance (not yet initialized)
   * @throws {ProviderNotSupportedError} If provider is not supported
   * @throws {InvalidConfigError} If configuration is invalid
   */
  create(config: VectorStoreConfig): IVectorStore {
    // Validate provider
    if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
      throw new ProviderNotSupportedError(config.provider, SUPPORTED_PROVIDERS);
    }

    // Apply defaults
    const fullConfig: VectorStoreConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    // Validate dimensions
    if (fullConfig.dimensions <= 0 || !Number.isInteger(fullConfig.dimensions)) {
      throw new InvalidConfigError(
        `Invalid dimensions: ${fullConfig.dimensions}. Must be a positive integer.`,
        config.provider,
      );
    }

    // Create provider-specific instance
    switch (config.provider) {
      case 'chromadb':
        return new ChromaDBVectorStore(fullConfig);
      case 'pgvector':
        return new PgVectorStore(fullConfig);
      case 'pinecone':
        return new PineconeVectorStore(fullConfig);
      case 'qdrant':
        return new QdrantVectorStore(fullConfig);
      case 'weaviate':
        return new WeaviateVectorStore(fullConfig);
      default:
        throw new ProviderNotSupportedError(config.provider, SUPPORTED_PROVIDERS);
    }
  }

  /**
   * Get list of supported providers
   */
  getSupportedProviders(): VectorStoreProvider[] {
    return [...SUPPORTED_PROVIDERS];
  }

  /**
   * Get list of fully implemented providers
   * (as opposed to stubs for future implementation)
   */
  getImplementedProviders(): VectorStoreProvider[] {
    return [...IMPLEMENTED_PROVIDERS];
  }

  /**
   * Check if a provider is supported
   */
  isProviderSupported(provider: string): provider is VectorStoreProvider {
    return SUPPORTED_PROVIDERS.includes(provider as VectorStoreProvider);
  }

  /**
   * Check if a provider is fully implemented
   */
  isProviderImplemented(provider: VectorStoreProvider): boolean {
    return IMPLEMENTED_PROVIDERS.includes(provider);
  }
}

/**
 * Singleton factory instance for convenience
 */
export const vectorStoreFactory = new VectorStoreFactory();

/**
 * Create a vector store with the given configuration
 * Convenience function that uses the singleton factory
 *
 * @param config - Vector store configuration
 * @returns Configured vector store instance
 */
export function createVectorStore(config: VectorStoreConfig): IVectorStore {
  return vectorStoreFactory.create(config);
}

/**
 * Create a ChromaDB vector store with minimal configuration
 *
 * @param persistPath - Path to persist data
 * @param dimensions - Embedding dimensions (default: 1536)
 * @returns ChromaDB vector store instance
 */
export function createChromaDBStore(
  persistPath: string,
  dimensions: number = 1536,
): IVectorStore {
  return createVectorStore({
    provider: 'chromadb',
    dimensions,
    distanceMetric: 'cosine',
    chromadb: {
      persistPath,
      anonymizedTelemetry: false,
    },
  });
}

/**
 * Create a pgvector store with minimal configuration
 *
 * @param connectionString - PostgreSQL connection string
 * @param dimensions - Embedding dimensions (default: 1536)
 * @returns pgvector store instance
 */
export function createPgVectorStore(
  connectionString: string,
  dimensions: number = 1536,
): IVectorStore {
  return createVectorStore({
    provider: 'pgvector',
    dimensions,
    distanceMetric: 'cosine',
    pgvector: {
      connectionString,
    },
  });
}
