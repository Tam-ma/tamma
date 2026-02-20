/**
 * Codebase Indexer Error Types
 *
 * Custom error classes for indexer operations with detailed error codes
 * and context for debugging and monitoring.
 */

/**
 * Error codes for indexer operations
 */
export enum IndexerErrorCode {
  // File discovery errors
  DISCOVERY_FAILED = 'DISCOVERY_FAILED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  INVALID_PATTERN = 'INVALID_PATTERN',

  // Parsing errors
  PARSE_ERROR = 'PARSE_ERROR',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',

  // Chunking errors
  CHUNKING_FAILED = 'CHUNKING_FAILED',
  CHUNK_TOO_LARGE = 'CHUNK_TOO_LARGE',

  // Embedding errors
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  EMBEDDING_RATE_LIMITED = 'EMBEDDING_RATE_LIMITED',
  EMBEDDING_PROVIDER_ERROR = 'EMBEDDING_PROVIDER_ERROR',
  EMBEDDING_NOT_INITIALIZED = 'EMBEDDING_NOT_INITIALIZED',

  // Storage errors
  STORAGE_FAILED = 'STORAGE_FAILED',
  VECTOR_STORE_ERROR = 'VECTOR_STORE_ERROR',

  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_CONFIG = 'MISSING_CONFIG',

  // Initialization errors
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  ALREADY_INITIALIZED = 'ALREADY_INITIALIZED',

  // Operation errors
  OPERATION_CANCELLED = 'OPERATION_CANCELLED',
  TIMEOUT = 'TIMEOUT',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Options for IndexerError
 */
export interface IndexerErrorOptions {
  /** The underlying cause of the error */
  cause?: Error;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
  /** Whether the operation can be retried */
  retryable?: boolean;
}

/**
 * Base error class for indexer operations
 */
export class IndexerError extends Error {
  public readonly code: IndexerErrorCode;
  public readonly context: Record<string, unknown>;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: IndexerErrorCode,
    options?: IndexerErrorOptions,
  ) {
    super(message, { cause: options?.cause });
    this.name = 'IndexerError';
    this.code = code;
    this.context = options?.context ?? {};
    this.retryable = options?.retryable ?? false;
  }

  /**
   * Create a human-readable string representation
   */
  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  /**
   * Convert to a plain object for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      retryable: this.retryable,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when file discovery fails
 */
export class DiscoveryError extends IndexerError {
  constructor(message: string, options?: IndexerErrorOptions) {
    super(message, IndexerErrorCode.DISCOVERY_FAILED, options);
    this.name = 'DiscoveryError';
  }
}

/**
 * Error thrown when a file cannot be found
 */
export class FileNotFoundError extends IndexerError {
  constructor(filePath: string, options?: IndexerErrorOptions) {
    super(`File not found: ${filePath}`, IndexerErrorCode.FILE_NOT_FOUND, {
      ...options,
      context: { ...options?.context, filePath },
    });
    this.name = 'FileNotFoundError';
  }
}

/**
 * Error thrown when file cannot be read
 */
export class FileReadError extends IndexerError {
  constructor(filePath: string, options?: IndexerErrorOptions) {
    super(`Failed to read file: ${filePath}`, IndexerErrorCode.FILE_READ_ERROR, {
      ...options,
      context: { ...options?.context, filePath },
      retryable: options?.retryable ?? true,
    });
    this.name = 'FileReadError';
  }
}

/**
 * Error thrown when parsing fails
 */
export class ParseError extends IndexerError {
  constructor(
    filePath: string,
    language: string,
    options?: IndexerErrorOptions,
  ) {
    super(
      `Failed to parse ${language} file: ${filePath}`,
      IndexerErrorCode.PARSE_ERROR,
      {
        ...options,
        context: { ...options?.context, filePath, language },
      },
    );
    this.name = 'ParseError';
  }
}

/**
 * Error thrown when language is not supported
 */
export class UnsupportedLanguageError extends IndexerError {
  constructor(language: string, options?: IndexerErrorOptions) {
    super(
      `Unsupported language: ${language}`,
      IndexerErrorCode.UNSUPPORTED_LANGUAGE,
      {
        ...options,
        context: { ...options?.context, language },
      },
    );
    this.name = 'UnsupportedLanguageError';
  }
}

/**
 * Error thrown when chunking fails
 */
export class ChunkingError extends IndexerError {
  constructor(
    filePath: string,
    reason: string,
    options?: IndexerErrorOptions,
  ) {
    super(
      `Chunking failed for ${filePath}: ${reason}`,
      IndexerErrorCode.CHUNKING_FAILED,
      {
        ...options,
        context: { ...options?.context, filePath, reason },
      },
    );
    this.name = 'ChunkingError';
  }
}

/**
 * Error thrown when embedding fails
 */
export class EmbeddingError extends IndexerError {
  constructor(message: string, options?: IndexerErrorOptions) {
    super(message, IndexerErrorCode.EMBEDDING_FAILED, {
      ...options,
      retryable: options?.retryable ?? true,
    });
    this.name = 'EmbeddingError';
  }
}

/**
 * Error thrown when embedding rate limit is hit
 */
export class EmbeddingRateLimitError extends IndexerError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, options?: IndexerErrorOptions) {
    super(
      `Embedding rate limit exceeded. Retry after ${retryAfterMs}ms`,
      IndexerErrorCode.EMBEDDING_RATE_LIMITED,
      {
        ...options,
        context: { ...options?.context, retryAfterMs },
        retryable: true,
      },
    );
    this.name = 'EmbeddingRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Error thrown when embedding provider is not initialized
 */
export class EmbeddingNotInitializedError extends IndexerError {
  constructor(provider: string, options?: IndexerErrorOptions) {
    super(
      `Embedding provider '${provider}' is not initialized. Call initialize() first.`,
      IndexerErrorCode.EMBEDDING_NOT_INITIALIZED,
      {
        ...options,
        context: { ...options?.context, provider },
      },
    );
    this.name = 'EmbeddingNotInitializedError';
  }
}

/**
 * Error thrown when indexer configuration is invalid
 */
export class InvalidConfigError extends IndexerError {
  constructor(message: string, options?: IndexerErrorOptions) {
    super(message, IndexerErrorCode.INVALID_CONFIG, options);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Error thrown when indexer is not initialized
 */
export class NotInitializedError extends IndexerError {
  constructor(options?: IndexerErrorOptions) {
    super(
      'Indexer is not initialized. Call initialize() first.',
      IndexerErrorCode.NOT_INITIALIZED,
      options,
    );
    this.name = 'NotInitializedError';
  }
}

/**
 * Error thrown when operation is cancelled
 */
export class OperationCancelledError extends IndexerError {
  constructor(operation: string, options?: IndexerErrorOptions) {
    super(
      `Operation cancelled: ${operation}`,
      IndexerErrorCode.OPERATION_CANCELLED,
      {
        ...options,
        context: { ...options?.context, operation },
      },
    );
    this.name = 'OperationCancelledError';
  }
}

/**
 * Error thrown when vector store operation fails
 */
export class VectorStoreOperationError extends IndexerError {
  constructor(operation: string, options?: IndexerErrorOptions) {
    super(
      `Vector store operation failed: ${operation}`,
      IndexerErrorCode.VECTOR_STORE_ERROR,
      {
        ...options,
        context: { ...options?.context, operation },
        retryable: options?.retryable ?? true,
      },
    );
    this.name = 'VectorStoreOperationError';
  }
}
