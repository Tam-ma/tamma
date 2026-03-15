/**
 * Installation Router
 *
 * Provides fast, cached lookups for GitHub App installations.
 * Uses a TTL-based Map cache to meet <10ms latency requirements
 * for webhook routing decisions.
 *
 * The cache is automatically invalidated when installations are
 * deleted or suspended via the `invalidate()` method.
 */

import type {
  IGitHubInstallationStore,
  GitHubInstallation,
} from '../persistence/installation-store.js';

/** Result of an installation lookup. */
export interface InstallationResolveResult {
  installation: GitHubInstallation;
  /** True if the installation is not suspended. */
  isActive: boolean;
}

/** Cached entry with expiration timestamp. */
interface CacheEntry {
  result: InstallationResolveResult | null;
  expiresAt: number;
}

export interface InstallationRouterOptions {
  /** Cache TTL in milliseconds. Defaults to 60000 (60 seconds). */
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

export class InstallationRouter {
  private readonly store: IGitHubInstallationStore;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<number, CacheEntry>();

  constructor(store: IGitHubInstallationStore, options?: InstallationRouterOptions) {
    this.store = store;
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Resolve an installation by its ID.
   *
   * Returns the installation data and whether it is active (not suspended),
   * or null if the installation does not exist.
   *
   * Results are cached with a configurable TTL to meet <10ms latency on cache hits.
   */
  async resolve(installationId: number): Promise<InstallationResolveResult | null> {
    const now = Date.now();

    // Check cache first
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    // Cache miss or expired — fetch from store
    const installation = await this.store.getInstallation(installationId);

    let result: InstallationResolveResult | null = null;
    if (installation) {
      result = {
        installation,
        isActive: installation.suspendedAt === null,
      };
    }

    // Update cache
    this.cache.set(installationId, {
      result,
      expiresAt: now + this.cacheTtlMs,
    });

    return result;
  }

  /**
   * Invalidate the cache entry for a specific installation.
   * Call this when an installation is deleted, suspended, or unsuspended
   * to ensure stale data is not served.
   */
  invalidate(installationId: number): void {
    this.cache.delete(installationId);
  }

  /**
   * Clear the entire cache. Primarily used for testing.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the current cache size. Useful for monitoring/debugging.
   */
  get cacheSize(): number {
    return this.cache.size;
  }
}
