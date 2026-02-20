/**
 * Qdrant Vector Store Adapter (Stub)
 *
 * Placeholder implementation for Qdrant vector database.
 * To be implemented in a future iteration.
 */

import type {
  VectorStoreConfig,
  CollectionOptions,
  CollectionStats,
  VectorDocument,
  MetadataFilter,
  SearchQuery,
  HybridSearchQuery,
  MMRSearchQuery,
  SearchResult,
} from '../interfaces.js';
import { BaseVectorStore } from '../base-vector-store.js';
import { ProviderNotImplementedError, InvalidConfigError } from '../errors.js';

/**
 * Qdrant Vector Store stub implementation
 *
 * This provider is not yet implemented. To use Qdrant:
 *
 * 1. Install the Qdrant client: `npm install @qdrant/qdrant-js`
 * 2. Configure your Qdrant server URL and optional API key
 * 3. Wait for this adapter to be implemented
 *
 * @see https://qdrant.tech/documentation/
 */
export class QdrantVectorStore extends BaseVectorStore {
  constructor(config: VectorStoreConfig) {
    super('qdrant', config);

    if (!config.qdrant) {
      throw new InvalidConfigError('Qdrant configuration is required', 'qdrant');
    }

    // Validate configuration structure
    if (!config.qdrant.url) {
      throw new InvalidConfigError('Qdrant URL is required', 'qdrant');
    }
  }

  protected override async doInitialize(): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'initialize');
  }

  protected override async doDispose(): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'dispose');
  }

  protected override async doHealthCheck(): Promise<Record<string, unknown>> {
    throw new ProviderNotImplementedError('qdrant', 'healthCheck');
  }

  protected override async doCreateCollection(
    _name: string,
    _options?: CollectionOptions,
  ): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'createCollection');
  }

  protected override async doDeleteCollection(_name: string): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'deleteCollection');
  }

  protected override async doListCollections(): Promise<string[]> {
    throw new ProviderNotImplementedError('qdrant', 'listCollections');
  }

  protected override async doGetCollectionStats(_name: string): Promise<CollectionStats> {
    throw new ProviderNotImplementedError('qdrant', 'getCollectionStats');
  }

  protected override async doCollectionExists(_name: string): Promise<boolean> {
    throw new ProviderNotImplementedError('qdrant', 'collectionExists');
  }

  protected override async doUpsert(
    _collection: string,
    _documents: VectorDocument[],
  ): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'upsert');
  }

  protected override async doDelete(_collection: string, _ids: string[]): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'delete');
  }

  protected override async doGet(_collection: string, _ids: string[]): Promise<VectorDocument[]> {
    throw new ProviderNotImplementedError('qdrant', 'get');
  }

  protected override async doCount(
    _collection: string,
    _filter?: MetadataFilter,
  ): Promise<number> {
    throw new ProviderNotImplementedError('qdrant', 'count');
  }

  protected override async doSearch(
    _collection: string,
    _query: SearchQuery,
  ): Promise<SearchResult[]> {
    throw new ProviderNotImplementedError('qdrant', 'search');
  }

  protected override async doHybridSearch(
    _collection: string,
    _query: HybridSearchQuery,
  ): Promise<SearchResult[]> {
    throw new ProviderNotImplementedError('qdrant', 'hybridSearch');
  }

  protected override async doMMRSearch(
    _collection: string,
    _query: MMRSearchQuery,
  ): Promise<SearchResult[]> {
    throw new ProviderNotImplementedError('qdrant', 'mmrSearch');
  }

  protected override async doOptimize(_collection: string): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'optimize');
  }

  protected override async doVacuum(_collection: string): Promise<void> {
    throw new ProviderNotImplementedError('qdrant', 'vacuum');
  }
}
