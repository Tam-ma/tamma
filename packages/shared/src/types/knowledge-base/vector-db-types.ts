/**
 * Vector Database Types
 *
 * Types for vector database monitoring and management.
 */

/** Summary info for a vector collection */
export interface CollectionInfo {
  name: string;
  vectorCount: number;
  dimensions: number;
  storageBytes: number;
  createdAt: string;
  lastModified: string;
}

/** Detailed statistics for a collection */
export interface CollectionStatsInfo {
  name: string;
  vectorCount: number;
  dimensions: number;
  storageBytes: number;
  queryMetrics: QueryMetrics;
}

/** Query performance metrics */
export interface QueryMetrics {
  totalQueries: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  queriesPerMinute: number;
}

/** Result from a vector similarity search */
export interface VectorSearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}

/** Request to search a vector collection */
export interface VectorSearchRequest {
  collection: string;
  query: string;
  topK: number;
  scoreThreshold?: number;
  filter?: Record<string, unknown>;
}

/** Storage usage summary */
export interface StorageUsage {
  totalBytes: number;
  byCollection: Record<string, number>;
}

/** Request to create a new collection */
export interface CreateCollectionRequest {
  name: string;
  dimensions?: number;
}
