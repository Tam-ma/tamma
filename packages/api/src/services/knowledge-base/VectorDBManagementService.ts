/**
 * Vector DB Management Service
 *
 * Manages vector database collections, search testing, and metrics.
 */

import { randomUUID } from 'node:crypto';
import type {
  CollectionInfo,
  CollectionStatsInfo,
  VectorSearchRequest,
  VectorSearchResult,
  StorageUsage,
} from '@tamma/shared';

export class VectorDBManagementService {
  private collections: Map<string, CollectionInfo> = new Map();
  private queryCounters: Map<string, number> = new Map();

  constructor() {
    // Seed with a default collection
    const now = new Date().toISOString();
    this.collections.set('codebase', {
      name: 'codebase',
      vectorCount: 12450,
      dimensions: 1536,
      storageBytes: 12450 * 1536 * 4,
      createdAt: now,
      lastModified: now,
    });
    this.queryCounters.set('codebase', 0);
  }

  async listCollections(): Promise<CollectionInfo[]> {
    return Array.from(this.collections.values());
  }

  async getCollectionStats(name: string): Promise<CollectionStatsInfo> {
    const collection = this.collections.get(name);
    if (!collection) {
      throw new Error(`Collection not found: ${name}`);
    }

    const totalQueries = this.queryCounters.get(name) ?? 0;

    return {
      name: collection.name,
      vectorCount: collection.vectorCount,
      dimensions: collection.dimensions,
      storageBytes: collection.storageBytes,
      queryMetrics: {
        totalQueries,
        avgLatencyMs: 12.5,
        p95LatencyMs: 45.2,
        p99LatencyMs: 89.1,
        queriesPerMinute: totalQueries > 0 ? 2.5 : 0,
      },
    };
  }

  async createCollection(name: string, dimensions = 1536): Promise<void> {
    if (this.collections.has(name)) {
      throw new Error(`Collection already exists: ${name}`);
    }

    const now = new Date().toISOString();
    this.collections.set(name, {
      name,
      vectorCount: 0,
      dimensions,
      storageBytes: 0,
      createdAt: now,
      lastModified: now,
    });
    this.queryCounters.set(name, 0);
  }

  async deleteCollection(name: string): Promise<void> {
    if (!this.collections.has(name)) {
      throw new Error(`Collection not found: ${name}`);
    }
    this.collections.delete(name);
    this.queryCounters.delete(name);
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const collection = this.collections.get(request.collection);
    if (!collection) {
      throw new Error(`Collection not found: ${request.collection}`);
    }

    // Track query count
    const current = this.queryCounters.get(request.collection) ?? 0;
    this.queryCounters.set(request.collection, current + 1);

    // Return simulated search results
    const results: VectorSearchResult[] = [];
    const count = Math.min(request.topK, 5);

    for (let i = 0; i < count; i++) {
      const score = 0.95 - i * 0.08;
      if (request.scoreThreshold && score < request.scoreThreshold) {
        break;
      }
      results.push({
        id: randomUUID(),
        score,
        content: `// Result ${i + 1} matching "${request.query}"\nexport function example${i + 1}() {\n  // Implementation related to the query\n  return true;\n}`,
        metadata: {
          filePath: `src/modules/example-${i + 1}.ts`,
          startLine: 1 + i * 10,
          endLine: 5 + i * 10,
          language: 'typescript',
        },
      });
    }

    return results;
  }

  async getStorageUsage(): Promise<StorageUsage> {
    const byCollection: Record<string, number> = {};
    let totalBytes = 0;

    for (const [name, info] of this.collections) {
      byCollection[name] = info.storageBytes;
      totalBytes += info.storageBytes;
    }

    return { totalBytes, byCollection };
  }
}
