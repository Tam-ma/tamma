/**
 * Vector Store Error Types
 *
 * Custom error classes for vector store operations with detailed error codes
 * and context for debugging and monitoring.
 */

import type { VectorStoreProvider } from './interfaces.js';

/**
 * Error codes for vector store operations
 */
export enum VectorStoreErrorCode {
  // Connection errors
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_LOST = 'CONNECTION_LOST',

  // Collection errors
  COLLECTION_NOT_FOUND = 'COLLECTION_NOT_FOUND',
  COLLECTION_ALREADY_EXISTS = 'COLLECTION_ALREADY_EXISTS',

  // Document errors
  DOCUMENT_NOT_FOUND = 'DOCUMENT_NOT_FOUND',
  INVALID_EMBEDDING_DIMENSIONS = 'INVALID_EMBEDDING_DIMENSIONS',
  INVALID_DOCUMENT = 'INVALID_DOCUMENT',

  // Query errors
  INVALID_FILTER = 'INVALID_FILTER',
  QUERY_TIMEOUT = 'QUERY_TIMEOUT',
  INVALID_QUERY = 'INVALID_QUERY',

  // Provider errors
  PROVIDER_NOT_SUPPORTED = 'PROVIDER_NOT_SUPPORTED',
  PROVIDER_NOT_IMPLEMENTED = 'PROVIDER_NOT_IMPLEMENTED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',

  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_CREDENTIALS = 'MISSING_CREDENTIALS',
  MISSING_CONFIG = 'MISSING_CONFIG',

  // Initialization errors
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  ALREADY_INITIALIZED = 'ALREADY_INITIALIZED',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Options for VectorStoreError
 */
export interface VectorStoreErrorOptions {
  /** The underlying cause of the error */
  cause?: Error;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
  /** Whether the operation can be retried */
  retryable?: boolean;
}

/**
 * Base error class for vector store operations
 */
export class VectorStoreError extends Error {
  public readonly code: VectorStoreErrorCode;
  public readonly provider: VectorStoreProvider | 'unknown';
  public readonly context: Record<string, unknown>;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: VectorStoreErrorCode,
    provider: VectorStoreProvider | 'unknown' = 'unknown',
    options?: VectorStoreErrorOptions,
  ) {
    super(message, { cause: options?.cause });
    this.name = 'VectorStoreError';
    this.code = code;
    this.provider = provider;
    this.context = options?.context ?? {};
    this.retryable = options?.retryable ?? false;
  }

  /**
   * Create a human-readable string representation
   */
  override toString(): string {
    let str = `${this.name} [${this.code}]: ${this.message}`;
    if (this.provider !== 'unknown') {
      str += ` (provider: ${this.provider})`;
    }
    return str;
  }

  /**
   * Convert to a plain object for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      provider: this.provider,
      context: this.context,
      retryable: this.retryable,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when a collection is not found
 */
export class CollectionNotFoundError extends VectorStoreError {
  constructor(
    collectionName: string,
    provider: VectorStoreProvider,
    options?: VectorStoreErrorOptions,
  ) {
    super(
      `Collection '${collectionName}' not found`,
      VectorStoreErrorCode.COLLECTION_NOT_FOUND,
      provider,
      { ...options, context: { ...options?.context, collectionName } },
    );
    this.name = 'CollectionNotFoundError';
  }
}

/**
 * Error thrown when a collection already exists
 */
export class CollectionExistsError extends VectorStoreError {
  constructor(
    collectionName: string,
    provider: VectorStoreProvider,
    options?: VectorStoreErrorOptions,
  ) {
    super(
      `Collection '${collectionName}' already exists`,
      VectorStoreErrorCode.COLLECTION_ALREADY_EXISTS,
      provider,
      { ...options, context: { ...options?.context, collectionName } },
    );
    this.name = 'CollectionExistsError';
  }
}

/**
 * Error thrown when embedding dimensions are invalid
 */
export class InvalidEmbeddingDimensionsError extends VectorStoreError {
  constructor(
    expected: number,
    actual: number,
    provider: VectorStoreProvider,
    options?: VectorStoreErrorOptions,
  ) {
    super(
      `Invalid embedding dimensions: expected ${expected}, got ${actual}`,
      VectorStoreErrorCode.INVALID_EMBEDDING_DIMENSIONS,
      provider,
      { ...options, context: { ...options?.context, expected, actual } },
    );
    this.name = 'InvalidEmbeddingDimensionsError';
  }
}

/**
 * Error thrown when a provider is not supported
 */
export class ProviderNotSupportedError extends VectorStoreError {
  constructor(provider: string, supportedProviders: string[], options?: VectorStoreErrorOptions) {
    super(
      `Provider '${provider}' is not supported. Supported providers: ${supportedProviders.join(', ')}`,
      VectorStoreErrorCode.PROVIDER_NOT_SUPPORTED,
      'unknown',
      { ...options, context: { ...options?.context, provider, supportedProviders } },
    );
    this.name = 'ProviderNotSupportedError';
  }
}

/**
 * Error thrown when a provider feature is not yet implemented
 */
export class ProviderNotImplementedError extends VectorStoreError {
  constructor(
    provider: VectorStoreProvider,
    feature?: string,
    options?: VectorStoreErrorOptions,
  ) {
    const message = feature
      ? `Provider '${provider}' does not implement '${feature}'`
      : `Provider '${provider}' is not yet implemented`;
    super(message, VectorStoreErrorCode.PROVIDER_NOT_IMPLEMENTED, provider, {
      ...options,
      context: { ...options?.context, feature },
    });
    this.name = 'ProviderNotImplementedError';
  }
}

/**
 * Error thrown when configuration is invalid
 */
export class InvalidConfigError extends VectorStoreError {
  constructor(
    message: string,
    provider?: VectorStoreProvider,
    options?: VectorStoreErrorOptions,
  ) {
    super(message, VectorStoreErrorCode.INVALID_CONFIG, provider ?? 'unknown', options);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Error thrown when the vector store is not initialized
 */
export class NotInitializedError extends VectorStoreError {
  constructor(provider: VectorStoreProvider, options?: VectorStoreErrorOptions) {
    super(
      'Vector store is not initialized. Call initialize() first.',
      VectorStoreErrorCode.NOT_INITIALIZED,
      provider,
      options,
    );
    this.name = 'NotInitializedError';
  }
}

/**
 * Error thrown when connection fails
 */
export class ConnectionError extends VectorStoreError {
  constructor(
    message: string,
    provider: VectorStoreProvider,
    options?: VectorStoreErrorOptions,
  ) {
    super(message, VectorStoreErrorCode.CONNECTION_FAILED, provider, {
      ...options,
      retryable: options?.retryable ?? true,
    });
    this.name = 'ConnectionError';
  }
}
