/**
 * Vector DB Management Service Contract
 *
 * Defines the interface for vector database operations.
 */

import type {
  CollectionInfo,
  CollectionStatsInfo,
  VectorSearchRequest,
  VectorSearchResult,
  StorageUsage,
} from '../../types/knowledge-base/vector-db-types.js';

export interface IVectorDBService {
  listCollections(): Promise<CollectionInfo[]>;
  getCollectionStats(name: string): Promise<CollectionStatsInfo>;
  createCollection(name: string, dimensions?: number): Promise<void>;
  deleteCollection(name: string): Promise<void>;
  search(request: VectorSearchRequest): Promise<VectorSearchResult[]>;
  getStorageUsage(): Promise<StorageUsage>;
}
