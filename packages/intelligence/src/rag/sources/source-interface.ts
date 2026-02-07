/**
 * RAG Source Interface
 *
 * Base interface and abstract class for RAG source adapters.
 */

import type {
  IRAGSource,
  RAGSourceType,
  SourceSettings,
  ProcessedQuery,
  RetrieveOptions,
  RetrievedChunk,
} from '../types.js';
import { SourceTimeoutError } from '../errors.js';

/**
 * Abstract base class for RAG sources
 */
export abstract class BaseRAGSource implements IRAGSource {
  abstract readonly name: RAGSourceType;
  protected config: SourceSettings | null = null;
  protected _enabled = false;

  get enabled(): boolean {
    return this._enabled && (this.config?.enabled ?? false);
  }

  /**
   * Initialize the source with configuration
   */
  async initialize(config: SourceSettings): Promise<void> {
    this.config = config;
    this._enabled = config.enabled;
    await this.doInitialize(config);
  }

  /**
   * Retrieve chunks from this source with timeout handling
   */
  async retrieve(query: ProcessedQuery, options: RetrieveOptions): Promise<RetrievedChunk[]> {
    if (!this.enabled) {
      return [];
    }

    const timeout = options.timeout ?? 2000;

    return Promise.race([
      this.doRetrieve(query, options),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new SourceTimeoutError(this.name, timeout));
        }, timeout);
      }),
    ]);
  }

  /**
   * Check if source is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.doHealthCheck();
    } catch {
      return false;
    }
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    this._enabled = false;
    this.config = null;
    await this.doDispose();
  }

  /**
   * Subclass-specific initialization
   */
  protected abstract doInitialize(config: SourceSettings): Promise<void>;

  /**
   * Subclass-specific retrieval
   */
  protected abstract doRetrieve(query: ProcessedQuery, options: RetrieveOptions): Promise<RetrievedChunk[]>;

  /**
   * Subclass-specific health check
   */
  protected abstract doHealthCheck(): Promise<boolean>;

  /**
   * Subclass-specific disposal
   */
  protected abstract doDispose(): Promise<void>;
}
