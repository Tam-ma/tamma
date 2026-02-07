/**
 * @tamma/mcp-client
 * Server capability cache
 */

import type { ServerCapabilities, MCPTool, MCPResource, MCPPrompt } from '../types.js';

/**
 * Cached server capabilities
 */
export interface CachedCapabilities {
  capabilities: ServerCapabilities;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  cachedAt: number;
}

/**
 * Capability cache options
 */
export interface CapabilityCacheOptions {
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  ttlMs?: number;
}

/**
 * Default cache options
 */
const DEFAULT_OPTIONS: Required<CapabilityCacheOptions> = {
  ttlMs: 300000, // 5 minutes
};

/**
 * Cache for server capabilities
 *
 * Stores server capabilities, tools, resources, and prompts
 * to avoid repeated discovery calls.
 */
export class CapabilityCache {
  private readonly cache = new Map<string, CachedCapabilities>();
  private readonly ttlMs: number;

  constructor(options: CapabilityCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_OPTIONS.ttlMs;
  }

  /**
   * Set cached capabilities for a server
   */
  set(serverName: string, capabilities: CachedCapabilities): void {
    this.cache.set(serverName, {
      ...capabilities,
      cachedAt: Date.now(),
    });
  }

  /**
   * Get cached capabilities for a server
   * Returns undefined if not cached or expired
   */
  get(serverName: string): CachedCapabilities | undefined {
    const cached = this.cache.get(serverName);

    if (!cached) {
      return undefined;
    }

    // Check if expired
    if (this.isExpired(cached.cachedAt)) {
      this.cache.delete(serverName);
      return undefined;
    }

    return cached;
  }

  /**
   * Check if a server has valid cached capabilities
   */
  has(serverName: string): boolean {
    return this.get(serverName) !== undefined;
  }

  /**
   * Invalidate cache for a server
   */
  invalidate(serverName: string): void {
    this.cache.delete(serverName);
  }

  /**
   * Invalidate all cached capabilities
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get tools for a server from cache
   */
  getTools(serverName: string): MCPTool[] | undefined {
    return this.get(serverName)?.tools;
  }

  /**
   * Get resources for a server from cache
   */
  getResources(serverName: string): MCPResource[] | undefined {
    return this.get(serverName)?.resources;
  }

  /**
   * Get prompts for a server from cache
   */
  getPrompts(serverName: string): MCPPrompt[] | undefined {
    return this.get(serverName)?.prompts;
  }

  /**
   * Update tools for a server in cache
   */
  updateTools(serverName: string, tools: MCPTool[]): void {
    const cached = this.cache.get(serverName);
    if (cached) {
      cached.tools = tools;
      cached.cachedAt = Date.now();
    }
  }

  /**
   * Update resources for a server in cache
   */
  updateResources(serverName: string, resources: MCPResource[]): void {
    const cached = this.cache.get(serverName);
    if (cached) {
      cached.resources = resources;
      cached.cachedAt = Date.now();
    }
  }

  /**
   * Update prompts for a server in cache
   */
  updatePrompts(serverName: string, prompts: MCPPrompt[]): void {
    const cached = this.cache.get(serverName);
    if (cached) {
      cached.prompts = prompts;
      cached.cachedAt = Date.now();
    }
  }

  /**
   * Get all cached server names
   */
  getServerNames(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get statistics about the cache
   */
  getStats(): {
    serverCount: number;
    totalTools: number;
    totalResources: number;
    totalPrompts: number;
  } {
    let totalTools = 0;
    let totalResources = 0;
    let totalPrompts = 0;

    for (const cached of this.cache.values()) {
      totalTools += cached.tools.length;
      totalResources += cached.resources.length;
      totalPrompts += cached.prompts.length;
    }

    return {
      serverCount: this.cache.size,
      totalTools,
      totalResources,
      totalPrompts,
    };
  }

  /**
   * Check if a cache entry has expired
   */
  private isExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > this.ttlMs;
  }
}
