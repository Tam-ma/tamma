/**
 * @tamma/mcp-client
 * Resource content cache
 */

import type { ResourceContent } from '../types.js';

/**
 * Cached resource entry
 */
export interface CachedResource {
  content: ResourceContent;
  cachedAt: number;
  size: number;
}

/**
 * Resource cache options
 */
export interface ResourceCacheOptions {
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  ttlMs?: number;
  /** Maximum cache size in bytes (default: 50MB) */
  maxSizeBytes?: number;
  /** Maximum number of entries (default: 1000) */
  maxEntries?: number;
}

/**
 * Default cache options
 */
const DEFAULT_OPTIONS: Required<ResourceCacheOptions> = {
  ttlMs: 300000, // 5 minutes
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
  maxEntries: 1000,
};

/**
 * LRU cache for resource content
 *
 * Stores resource content with TTL-based expiration and
 * size-based eviction.
 */
export class ResourceCache {
  private readonly cache = new Map<string, CachedResource>();
  private readonly ttlMs: number;
  private readonly maxSizeBytes: number;
  private readonly maxEntries: number;
  private currentSize = 0;

  constructor(options: ResourceCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_OPTIONS.ttlMs;
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_OPTIONS.maxSizeBytes;
    this.maxEntries = options.maxEntries ?? DEFAULT_OPTIONS.maxEntries;
  }

  /**
   * Get cache key for a resource
   */
  private getKey(serverName: string, uri: string): string {
    return `${serverName}:${uri}`;
  }

  /**
   * Calculate size of a resource content
   */
  private calculateSize(content: ResourceContent): number {
    let size = 0;

    if (content.text) {
      size += content.text.length * 2; // Approximate UTF-16 size
    }

    if (content.blob) {
      size += content.blob.length;
    }

    return size;
  }

  /**
   * Set a resource in the cache
   */
  set(serverName: string, content: ResourceContent): void {
    const key = this.getKey(serverName, content.uri);
    const size = this.calculateSize(content);

    // Don't cache if too large
    if (size > this.maxSizeBytes) {
      return;
    }

    // Remove existing entry if present
    this.delete(serverName, content.uri);

    // Evict entries until we have space
    this.evictIfNeeded(size);

    // Add new entry
    this.cache.set(key, {
      content,
      cachedAt: Date.now(),
      size,
    });
    this.currentSize += size;
  }

  /**
   * Get a resource from the cache
   * Returns undefined if not cached or expired
   */
  get(serverName: string, uri: string): ResourceContent | undefined {
    const key = this.getKey(serverName, uri);
    const cached = this.cache.get(key);

    if (!cached) {
      return undefined;
    }

    // Check if expired
    if (this.isExpired(cached.cachedAt)) {
      this.delete(serverName, uri);
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    this.cache.set(key, cached);

    return cached.content;
  }

  /**
   * Check if a resource is in the cache
   */
  has(serverName: string, uri: string): boolean {
    return this.get(serverName, uri) !== undefined;
  }

  /**
   * Delete a resource from the cache
   */
  delete(serverName: string, uri: string): boolean {
    const key = this.getKey(serverName, uri);
    const cached = this.cache.get(key);

    if (cached) {
      this.currentSize -= cached.size;
      return this.cache.delete(key);
    }

    return false;
  }

  /**
   * Clear cache for a specific server
   */
  clearServer(serverName: string): void {
    const prefix = `${serverName}:`;

    for (const [key, cached] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        this.currentSize -= cached.size;
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  /**
   * Get statistics about the cache
   */
  getStats(): {
    entryCount: number;
    totalSize: number;
    maxSize: number;
    utilization: number;
  } {
    return {
      entryCount: this.cache.size,
      totalSize: this.currentSize,
      maxSize: this.maxSizeBytes,
      utilization: this.currentSize / this.maxSizeBytes,
    };
  }

  /**
   * Check if a cache entry has expired
   */
  private isExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > this.ttlMs;
  }

  /**
   * Evict entries to make room for new content
   */
  private evictIfNeeded(newSize: number): void {
    // Evict expired entries first
    this.evictExpired();

    // Then evict oldest entries until we have space
    while (
      (this.currentSize + newSize > this.maxSizeBytes ||
        this.cache.size >= this.maxEntries) &&
      this.cache.size > 0
    ) {
      // Get first entry (oldest in Map insertion order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const cached = this.cache.get(firstKey);
        if (cached) {
          this.currentSize -= cached.size;
        }
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Remove all expired entries
   */
  private evictExpired(): void {
    const now = Date.now();

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.cachedAt > this.ttlMs) {
        this.currentSize -= cached.size;
        this.cache.delete(key);
      }
    }
  }
}
