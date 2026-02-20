/**
 * Tests for RAG Errors
 */

import { describe, it, expect } from 'vitest';
import {
  RAGError,
  RAGErrorCode,
  NotInitializedError,
  InvalidConfigError,
  QueryProcessingError,
  RetrievalError,
  SourceTimeoutError,
  SourceUnavailableError,
  RankingError,
  AssemblyError,
  EmbeddingError,
  CacheError,
  FeedbackError,
} from '../errors.js';

describe('RAGError', () => {
  it('should create error with code and message', () => {
    const error = new RAGError(RAGErrorCode.NOT_INITIALIZED, 'Test message');

    expect(error.code).toBe(RAGErrorCode.NOT_INITIALIZED);
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('RAGError');
  });

  it('should include cause when provided', () => {
    const cause = new Error('Original error');
    const error = new RAGError(RAGErrorCode.RETRIEVAL_FAILED, 'Failed', cause);

    expect(error.cause).toBe(cause);
  });
});

describe('NotInitializedError', () => {
  it('should create with default message', () => {
    const error = new NotInitializedError();

    expect(error.code).toBe(RAGErrorCode.NOT_INITIALIZED);
    expect(error.message).toBe('RAG pipeline is not initialized');
    expect(error.name).toBe('NotInitializedError');
  });

  it('should accept custom message', () => {
    const error = new NotInitializedError('Custom message');

    expect(error.message).toBe('Custom message');
  });
});

describe('InvalidConfigError', () => {
  it('should create with message', () => {
    const error = new InvalidConfigError('Invalid value');

    expect(error.code).toBe(RAGErrorCode.INVALID_CONFIG);
    expect(error.message).toBe('Invalid value');
    expect(error.name).toBe('InvalidConfigError');
  });

  it('should include field name', () => {
    const error = new InvalidConfigError('Invalid value', 'maxTokens');

    expect(error.field).toBe('maxTokens');
  });
});

describe('QueryProcessingError', () => {
  it('should include query text', () => {
    const error = new QueryProcessingError('Failed to process', 'test query');

    expect(error.code).toBe(RAGErrorCode.QUERY_PROCESSING_FAILED);
    expect(error.query).toBe('test query');
    expect(error.name).toBe('QueryProcessingError');
  });

  it('should include cause', () => {
    const cause = new Error('Parse error');
    const error = new QueryProcessingError('Failed', 'query', cause);

    expect(error.cause).toBe(cause);
  });
});

describe('RetrievalError', () => {
  it('should include source name', () => {
    const error = new RetrievalError('Search failed', 'vector_db');

    expect(error.code).toBe(RAGErrorCode.RETRIEVAL_FAILED);
    expect(error.source).toBe('vector_db');
    expect(error.name).toBe('RetrievalError');
  });

  it('should work without source', () => {
    const error = new RetrievalError('Generic failure');

    expect(error.source).toBeUndefined();
  });
});

describe('SourceTimeoutError', () => {
  it('should include source and timeout', () => {
    const error = new SourceTimeoutError('vector_db', 2000);

    expect(error.code).toBe(RAGErrorCode.SOURCE_TIMEOUT);
    expect(error.source).toBe('vector_db');
    expect(error.timeoutMs).toBe(2000);
    expect(error.message).toContain('vector_db');
    expect(error.message).toContain('2000');
    expect(error.name).toBe('SourceTimeoutError');
  });
});

describe('SourceUnavailableError', () => {
  it('should include source name', () => {
    const error = new SourceUnavailableError('keyword');

    expect(error.code).toBe(RAGErrorCode.SOURCE_UNAVAILABLE);
    expect(error.source).toBe('keyword');
    expect(error.name).toBe('SourceUnavailableError');
  });

  it('should include cause', () => {
    const cause = new Error('Connection refused');
    const error = new SourceUnavailableError('vector_db', cause);

    expect(error.cause).toBe(cause);
  });
});

describe('RankingError', () => {
  it('should create error', () => {
    const error = new RankingError('RRF calculation failed');

    expect(error.code).toBe(RAGErrorCode.RANKING_FAILED);
    expect(error.name).toBe('RankingError');
  });
});

describe('AssemblyError', () => {
  it('should create error', () => {
    const error = new AssemblyError('Token counting failed');

    expect(error.code).toBe(RAGErrorCode.ASSEMBLY_FAILED);
    expect(error.name).toBe('AssemblyError');
  });
});

describe('EmbeddingError', () => {
  it('should create error', () => {
    const error = new EmbeddingError('API error');

    expect(error.code).toBe(RAGErrorCode.EMBEDDING_FAILED);
    expect(error.name).toBe('EmbeddingError');
  });
});

describe('CacheError', () => {
  it('should create error', () => {
    const error = new CacheError('Serialization failed');

    expect(error.code).toBe(RAGErrorCode.CACHE_ERROR);
    expect(error.name).toBe('CacheError');
  });
});

describe('FeedbackError', () => {
  it('should create error', () => {
    const error = new FeedbackError('Invalid rating');

    expect(error.code).toBe(RAGErrorCode.FEEDBACK_ERROR);
    expect(error.name).toBe('FeedbackError');
  });
});

describe('Error inheritance', () => {
  it('all errors should extend RAGError', () => {
    expect(new NotInitializedError()).toBeInstanceOf(RAGError);
    expect(new InvalidConfigError('msg')).toBeInstanceOf(RAGError);
    expect(new QueryProcessingError('msg', 'q')).toBeInstanceOf(RAGError);
    expect(new RetrievalError('msg')).toBeInstanceOf(RAGError);
    expect(new SourceTimeoutError('s', 1000)).toBeInstanceOf(RAGError);
    expect(new SourceUnavailableError('s')).toBeInstanceOf(RAGError);
    expect(new RankingError('msg')).toBeInstanceOf(RAGError);
    expect(new AssemblyError('msg')).toBeInstanceOf(RAGError);
    expect(new EmbeddingError('msg')).toBeInstanceOf(RAGError);
    expect(new CacheError('msg')).toBeInstanceOf(RAGError);
    expect(new FeedbackError('msg')).toBeInstanceOf(RAGError);
  });

  it('all errors should extend Error', () => {
    expect(new RAGError(RAGErrorCode.NOT_INITIALIZED, 'msg')).toBeInstanceOf(Error);
  });
});
