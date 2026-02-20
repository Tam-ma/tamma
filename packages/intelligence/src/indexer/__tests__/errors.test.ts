/**
 * Tests for Indexer Errors
 */

import { describe, it, expect } from 'vitest';
import {
  IndexerError,
  IndexerErrorCode,
  DiscoveryError,
  FileNotFoundError,
  FileReadError,
  ParseError,
  UnsupportedLanguageError,
  ChunkingError,
  EmbeddingError,
  EmbeddingRateLimitError,
  EmbeddingNotInitializedError,
  InvalidConfigError,
  NotInitializedError,
  OperationCancelledError,
  VectorStoreOperationError,
} from '../errors.js';

describe('Indexer Errors', () => {
  describe('IndexerError', () => {
    it('should create error with message and code', () => {
      const error = new IndexerError('Test error', IndexerErrorCode.UNKNOWN_ERROR);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(IndexerErrorCode.UNKNOWN_ERROR);
      expect(error.name).toBe('IndexerError');
    });

    it('should include context', () => {
      const error = new IndexerError('Test', IndexerErrorCode.UNKNOWN_ERROR, {
        context: { key: 'value' },
      });

      expect(error.context).toEqual({ key: 'value' });
    });

    it('should track retryable flag', () => {
      const retryable = new IndexerError('Test', IndexerErrorCode.UNKNOWN_ERROR, {
        retryable: true,
      });
      const notRetryable = new IndexerError('Test', IndexerErrorCode.UNKNOWN_ERROR, {
        retryable: false,
      });

      expect(retryable.retryable).toBe(true);
      expect(notRetryable.retryable).toBe(false);
    });

    it('should include cause', () => {
      const cause = new Error('Original error');
      const error = new IndexerError('Wrapper', IndexerErrorCode.UNKNOWN_ERROR, {
        cause,
      });

      expect(error.cause).toBe(cause);
    });

    it('should convert to string', () => {
      const error = new IndexerError('Test message', IndexerErrorCode.UNKNOWN_ERROR);
      const str = error.toString();

      expect(str).toContain('IndexerError');
      expect(str).toContain('UNKNOWN_ERROR');
      expect(str).toContain('Test message');
    });

    it('should convert to JSON', () => {
      const error = new IndexerError('Test', IndexerErrorCode.UNKNOWN_ERROR, {
        context: { file: 'test.ts' },
        retryable: true,
      });

      const json = error.toJSON();

      expect(json.name).toBe('IndexerError');
      expect(json.code).toBe(IndexerErrorCode.UNKNOWN_ERROR);
      expect(json.message).toBe('Test');
      expect(json.context).toEqual({ file: 'test.ts' });
      expect(json.retryable).toBe(true);
    });
  });

  describe('DiscoveryError', () => {
    it('should create discovery error', () => {
      const error = new DiscoveryError('Failed to scan directory');

      expect(error.code).toBe(IndexerErrorCode.DISCOVERY_FAILED);
      expect(error.name).toBe('DiscoveryError');
    });
  });

  describe('FileNotFoundError', () => {
    it('should include file path', () => {
      const error = new FileNotFoundError('/path/to/file.ts');

      expect(error.code).toBe(IndexerErrorCode.FILE_NOT_FOUND);
      expect(error.message).toContain('/path/to/file.ts');
      expect(error.context.filePath).toBe('/path/to/file.ts');
    });
  });

  describe('FileReadError', () => {
    it('should be retryable by default', () => {
      const error = new FileReadError('/path/to/file.ts');

      expect(error.code).toBe(IndexerErrorCode.FILE_READ_ERROR);
      expect(error.retryable).toBe(true);
    });
  });

  describe('ParseError', () => {
    it('should include language and file path', () => {
      const error = new ParseError('/path/to/file.ts', 'typescript');

      expect(error.code).toBe(IndexerErrorCode.PARSE_ERROR);
      expect(error.context.filePath).toBe('/path/to/file.ts');
      expect(error.context.language).toBe('typescript');
    });
  });

  describe('UnsupportedLanguageError', () => {
    it('should include language', () => {
      const error = new UnsupportedLanguageError('cobol');

      expect(error.code).toBe(IndexerErrorCode.UNSUPPORTED_LANGUAGE);
      expect(error.message).toContain('cobol');
      expect(error.context.language).toBe('cobol');
    });
  });

  describe('ChunkingError', () => {
    it('should include file and reason', () => {
      const error = new ChunkingError('/path/to/file.ts', 'File too large');

      expect(error.code).toBe(IndexerErrorCode.CHUNKING_FAILED);
      expect(error.context.filePath).toBe('/path/to/file.ts');
      expect(error.context.reason).toBe('File too large');
    });
  });

  describe('EmbeddingError', () => {
    it('should be retryable by default', () => {
      const error = new EmbeddingError('API request failed');

      expect(error.code).toBe(IndexerErrorCode.EMBEDDING_FAILED);
      expect(error.retryable).toBe(true);
    });
  });

  describe('EmbeddingRateLimitError', () => {
    it('should include retry after duration', () => {
      const error = new EmbeddingRateLimitError(60000);

      expect(error.code).toBe(IndexerErrorCode.EMBEDDING_RATE_LIMITED);
      expect(error.retryAfterMs).toBe(60000);
      expect(error.retryable).toBe(true);
    });
  });

  describe('EmbeddingNotInitializedError', () => {
    it('should include provider name', () => {
      const error = new EmbeddingNotInitializedError('openai');

      expect(error.code).toBe(IndexerErrorCode.EMBEDDING_NOT_INITIALIZED);
      expect(error.message).toContain('openai');
      expect(error.context.provider).toBe('openai');
    });
  });

  describe('InvalidConfigError', () => {
    it('should create config error', () => {
      const error = new InvalidConfigError('maxChunkTokens must be positive');

      expect(error.code).toBe(IndexerErrorCode.INVALID_CONFIG);
      expect(error.name).toBe('InvalidConfigError');
    });
  });

  describe('NotInitializedError', () => {
    it('should have appropriate message', () => {
      const error = new NotInitializedError();

      expect(error.code).toBe(IndexerErrorCode.NOT_INITIALIZED);
      expect(error.message).toContain('initialize');
    });
  });

  describe('OperationCancelledError', () => {
    it('should include operation name', () => {
      const error = new OperationCancelledError('indexProject');

      expect(error.code).toBe(IndexerErrorCode.OPERATION_CANCELLED);
      expect(error.message).toContain('indexProject');
      expect(error.context.operation).toBe('indexProject');
    });
  });

  describe('VectorStoreOperationError', () => {
    it('should include operation and be retryable', () => {
      const error = new VectorStoreOperationError('upsert');

      expect(error.code).toBe(IndexerErrorCode.VECTOR_STORE_ERROR);
      expect(error.context.operation).toBe('upsert');
      expect(error.retryable).toBe(true);
    });
  });
});
