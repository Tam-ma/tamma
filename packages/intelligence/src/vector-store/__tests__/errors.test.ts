/**
 * Tests for Vector Store Error Classes
 */

import { describe, it, expect } from 'vitest';
import {
  VectorStoreError,
  VectorStoreErrorCode,
  CollectionNotFoundError,
  CollectionExistsError,
  InvalidEmbeddingDimensionsError,
  ProviderNotSupportedError,
  ProviderNotImplementedError,
  InvalidConfigError,
  NotInitializedError,
  ConnectionError,
} from '../errors.js';

describe('VectorStoreError', () => {
  it('should create error with required properties', () => {
    const error = new VectorStoreError(
      'Test error message',
      VectorStoreErrorCode.PROVIDER_ERROR,
      'chromadb',
    );

    expect(error.message).toBe('Test error message');
    expect(error.code).toBe(VectorStoreErrorCode.PROVIDER_ERROR);
    expect(error.provider).toBe('chromadb');
    expect(error.name).toBe('VectorStoreError');
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({});
  });

  it('should accept optional properties', () => {
    const cause = new Error('Root cause');
    const error = new VectorStoreError(
      'Test error',
      VectorStoreErrorCode.CONNECTION_FAILED,
      'pgvector',
      {
        cause,
        context: { host: 'localhost' },
        retryable: true,
      },
    );

    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ host: 'localhost' });
    expect(error.retryable).toBe(true);
  });

  it('should produce readable string representation', () => {
    const error = new VectorStoreError(
      'Connection failed',
      VectorStoreErrorCode.CONNECTION_FAILED,
      'pgvector',
    );

    const str = error.toString();
    expect(str).toContain('VectorStoreError');
    expect(str).toContain('CONNECTION_FAILED');
    expect(str).toContain('Connection failed');
    expect(str).toContain('pgvector');
  });

  it('should serialize to JSON correctly', () => {
    const error = new VectorStoreError(
      'Test error',
      VectorStoreErrorCode.INVALID_CONFIG,
      'chromadb',
      { context: { field: 'dimensions' } },
    );

    const json = error.toJSON();
    expect(json.name).toBe('VectorStoreError');
    expect(json.code).toBe(VectorStoreErrorCode.INVALID_CONFIG);
    expect(json.message).toBe('Test error');
    expect(json.provider).toBe('chromadb');
    expect(json.context).toEqual({ field: 'dimensions' });
  });

  it('should be an instance of Error', () => {
    const error = new VectorStoreError('test', VectorStoreErrorCode.UNKNOWN_ERROR);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('CollectionNotFoundError', () => {
  it('should create error with collection name', () => {
    const error = new CollectionNotFoundError('my-collection', 'chromadb');

    expect(error.name).toBe('CollectionNotFoundError');
    expect(error.code).toBe(VectorStoreErrorCode.COLLECTION_NOT_FOUND);
    expect(error.message).toContain('my-collection');
    expect(error.message).toContain('not found');
    expect(error.provider).toBe('chromadb');
    expect(error.context).toEqual({ collectionName: 'my-collection' });
  });
});

describe('CollectionExistsError', () => {
  it('should create error with collection name', () => {
    const error = new CollectionExistsError('existing-collection', 'pgvector');

    expect(error.name).toBe('CollectionExistsError');
    expect(error.code).toBe(VectorStoreErrorCode.COLLECTION_ALREADY_EXISTS);
    expect(error.message).toContain('existing-collection');
    expect(error.message).toContain('already exists');
    expect(error.provider).toBe('pgvector');
  });
});

describe('InvalidEmbeddingDimensionsError', () => {
  it('should create error with expected and actual dimensions', () => {
    const error = new InvalidEmbeddingDimensionsError(1536, 768, 'chromadb');

    expect(error.name).toBe('InvalidEmbeddingDimensionsError');
    expect(error.code).toBe(VectorStoreErrorCode.INVALID_EMBEDDING_DIMENSIONS);
    expect(error.message).toContain('1536');
    expect(error.message).toContain('768');
    expect(error.context).toEqual({ expected: 1536, actual: 768 });
  });
});

describe('ProviderNotSupportedError', () => {
  it('should list supported providers', () => {
    const error = new ProviderNotSupportedError('milvus', ['chromadb', 'pgvector']);

    expect(error.name).toBe('ProviderNotSupportedError');
    expect(error.code).toBe(VectorStoreErrorCode.PROVIDER_NOT_SUPPORTED);
    expect(error.message).toContain('milvus');
    expect(error.message).toContain('chromadb');
    expect(error.message).toContain('pgvector');
    expect(error.provider).toBe('unknown');
  });
});

describe('ProviderNotImplementedError', () => {
  it('should create error for unimplemented provider', () => {
    const error = new ProviderNotImplementedError('pinecone');

    expect(error.name).toBe('ProviderNotImplementedError');
    expect(error.code).toBe(VectorStoreErrorCode.PROVIDER_NOT_IMPLEMENTED);
    expect(error.message).toContain('pinecone');
    expect(error.message).toContain('not yet implemented');
  });

  it('should create error for unimplemented feature', () => {
    const error = new ProviderNotImplementedError('pinecone', 'hybridSearch');

    expect(error.message).toContain('pinecone');
    expect(error.message).toContain('hybridSearch');
    expect(error.context).toEqual({ feature: 'hybridSearch' });
  });
});

describe('InvalidConfigError', () => {
  it('should create error with message', () => {
    const error = new InvalidConfigError('Invalid dimensions: must be positive', 'chromadb');

    expect(error.name).toBe('InvalidConfigError');
    expect(error.code).toBe(VectorStoreErrorCode.INVALID_CONFIG);
    expect(error.message).toContain('Invalid dimensions');
    expect(error.provider).toBe('chromadb');
  });

  it('should work without provider', () => {
    const error = new InvalidConfigError('Missing configuration');

    expect(error.provider).toBe('unknown');
  });
});

describe('NotInitializedError', () => {
  it('should create error with provider', () => {
    const error = new NotInitializedError('pgvector');

    expect(error.name).toBe('NotInitializedError');
    expect(error.code).toBe(VectorStoreErrorCode.NOT_INITIALIZED);
    expect(error.message).toContain('not initialized');
    expect(error.message).toContain('initialize()');
    expect(error.provider).toBe('pgvector');
  });
});

describe('ConnectionError', () => {
  it('should create retryable error by default', () => {
    const error = new ConnectionError('Connection refused', 'pgvector');

    expect(error.name).toBe('ConnectionError');
    expect(error.code).toBe(VectorStoreErrorCode.CONNECTION_FAILED);
    expect(error.retryable).toBe(true);
    expect(error.provider).toBe('pgvector');
  });

  it('should allow overriding retryable flag', () => {
    const error = new ConnectionError('Invalid credentials', 'pgvector', { retryable: false });

    expect(error.retryable).toBe(false);
  });
});
