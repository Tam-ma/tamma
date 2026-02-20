/**
 * Query Result Cache
 *
 * LRU cache implementation for caching vector search results.
 * Supports TTL expiration and cache statistics.
 */

import type { SearchResult, SearchQuery, CacheConfig } from '../interfaces.js';
import { createHash } from 'crypto';

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Expiration timestamp */
  expiresAt: number;
  /** Number of times this entry was accessed */
  hitCount: number;
  /** When this entry was created */
  createdAt: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of entries in cache */
  entries: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Estimated memory usage in bytes */
  memoryUsageBytes: number;
}

/**
 * Interface for query cache
 */
export interface IQueryCache {
  /**
   * Get cached results for a query
   * @param key - Cache key
   * @returns Cached results or undefined if not found/expired
   */
  get(key: string): SearchResult[] | undefined;

  /**
   * Store results in cache
   * @param key - Cache key
   * @param results - Search results to cache
   */
  set(key: string, results: SearchResult[]): void;

  /**
   * Invalidate cache entries
   * @param pattern - Optional pattern to match keys (invalidates all if not provided)
   */
  invalidate(pattern?: string): void;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;

  /**
   * Clear all cache entries
   */
  clear(): void;
}

/**
 * LRU Query Cache implementation
 */
export class QueryCache implements IQueryCache {
  private readonly cache: Map<string, CacheEntry<SearchResult[]>>;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.ttlMs = config.ttlMs;
    this.maxEntries = config.maxEntries;
  }

  /**
   * Get cached results
   */
  get(key: string): SearchResult[] | undefined {
    const entry = this.cache.get(key);

    if (entry === undefined) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Update hit count and move to end (LRU)
    entry.hitCount++;
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;

    return entry.value;
  }

  /**
   * Store results in cache
   */
  set(key: string, results: SearchResult[]): void {
    // Enforce max entries limit (LRU eviction)
    while (this.cache.size >= this.maxEntries) {
      // Delete the oldest entry (first in Map iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    const entry: CacheEntry<SearchResult[]> = {
      value: results,
      expiresAt: Date.now() + this.ttlMs,
      hitCount: 0,
      createdAt: Date.now(),
    };

    this.cache.set(key, entry);
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern?: string): void {
    if (pattern === undefined) {
      // Invalidate all
      this.cache.clear();
      return;
    }

    // Invalidate entries matching the pattern
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;

    // Clean up expired entries for accurate stats
    this.cleanupExpired();

    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      memoryUsageBytes: this.estimateMemoryUsage(),
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Remove expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Estimate memory usage of cache
   */
  private estimateMemoryUsage(): number {
    let bytes = 0;

    for (const [key, entry] of this.cache) {
      // Key size (rough estimate: 2 bytes per character)
      bytes += key.length * 2;

      // Entry overhead
      bytes += 32; // expiresAt, hitCount, createdAt

      // Results size
      for (const result of entry.value) {
        bytes += 50; // id, score overhead
        bytes += (result.content?.length ?? 0) * 2;
        bytes += JSON.stringify(result.metadata ?? {}).length * 2;
        bytes += (result.embedding?.length ?? 0) * 8; // 8 bytes per float64
      }
    }

    return bytes;
  }
}

/**
 * Generate a cache key from a search query and collection name
 *
 * @param collection - Collection name
 * @param query - Search query
 * @returns Cache key string
 */
export function generateCacheKey(collection: string, query: SearchQuery): string {
  // Create a deterministic hash of the query parameters
  const queryObj = {
    collection,
    embedding: query.embedding,
    topK: query.topK,
    scoreThreshold: query.scoreThreshold,
    filter: query.filter,
    includeMetadata: query.includeMetadata,
    includeContent: query.includeContent,
    includeEmbedding: query.includeEmbedding,
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(queryObj))
    .digest('hex')
    .substring(0, 16);

  return `${collection}:${hash}`;
}

/**
 * Create a no-op cache that doesn't actually cache anything
 * Useful for testing or when caching is disabled
 */
export class NoOpCache implements IQueryCache {
  private misses: number = 0;

  get(_key: string): SearchResult[] | undefined {
    this.misses++;
    return undefined;
  }

  set(_key: string, _results: SearchResult[]): void {
    // No-op
  }

  invalidate(_pattern?: string): void {
    // No-op
  }

  getStats(): CacheStats {
    return {
      entries: 0,
      hits: 0,
      misses: this.misses,
      hitRate: 0,
      memoryUsageBytes: 0,
    };
  }

  clear(): void {
    this.misses = 0;
  }
}
