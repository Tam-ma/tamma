/**
 * Tests for Cohere Embedding Provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CohereEmbeddingProvider } from '../embedding/cohere-embedding-provider.js';

describe('CohereEmbeddingProvider', () => {
  let provider: CohereEmbeddingProvider;

  beforeEach(() => {
    provider = new CohereEmbeddingProvider();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  describe('initialize', () => {
    it('should require an API key', async () => {
      await expect(
        provider.initialize({ model: 'embed-english-v3.0' }),
      ).rejects.toThrow('Cohere API key is required');
    });

    it('should initialize with valid config', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      expect(provider.name).toBe('cohere');
      expect(provider.dimensions).toBe(1024);
    });

    it('should use default model if not specified', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      expect(provider.dimensions).toBe(1024);
    });

    it('should set dimensions based on model', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-light-v3.0',
      });

      expect(provider.dimensions).toBe(384);
    });
  });

  describe('embed', () => {
    it('should throw if not initialized', async () => {
      await expect(provider.embed('test')).rejects.toThrow('not initialized');
    });

    it('should call the Cohere API and return embeddings', async () => {
      const mockEmbedding = Array(1024).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'test-id',
            embeddings: {
              float: [mockEmbedding],
            },
            texts: ['test'],
            meta: {
              api_version: { version: '2' },
              billed_units: { input_tokens: 5 },
            },
          }),
          { status: 200 },
        ),
      );

      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      const embedding = await provider.embed('test');

      expect(embedding).toEqual(mockEmbedding);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.cohere.ai/v2/embed');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(options?.body as string);
      expect(body.texts).toEqual(['test']);
      expect(body.model).toBe('embed-english-v3.0');
      expect(body.input_type).toBe('search_document');
      expect(body.embedding_types).toEqual(['float']);

      fetchSpy.mockRestore();
    });
  });

  describe('embedBatch', () => {
    it('should return empty array for empty input', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      const result = await provider.embedBatch([]);
      expect(result).toEqual([]);
    });

    it('should batch embed multiple texts', async () => {
      const mockEmbeddings = [
        Array(1024).fill(0.1),
        Array(1024).fill(0.2),
        Array(1024).fill(0.3),
      ];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'test-id',
            embeddings: { float: mockEmbeddings },
            texts: ['a', 'b', 'c'],
            meta: {
              api_version: { version: '2' },
              billed_units: { input_tokens: 15 },
            },
          }),
          { status: 200 },
        ),
      );

      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      const result = await provider.embedBatch(['a', 'b', 'c']);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(mockEmbeddings[0]);
      expect(result[1]).toEqual(mockEmbeddings[1]);
      expect(result[2]).toEqual(mockEmbeddings[2]);

      fetchSpy.mockRestore();
    });

    it('should split batches larger than maxBatchSize', async () => {
      const mockEmbedding = Array(1024).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        const batchSize = body.texts.length;
        return new Response(
          JSON.stringify({
            id: 'test-id',
            embeddings: {
              float: Array(batchSize).fill(mockEmbedding),
            },
            texts: body.texts,
            meta: {
              api_version: { version: '2' },
              billed_units: { input_tokens: batchSize * 5 },
            },
          }),
          { status: 200 },
        );
      });

      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      // Create more texts than maxBatchSize (96)
      const texts = Array(100).fill('').map((_, i) => `text ${i}`);
      const result = await provider.embedBatch(texts);

      // Should have made 2 API calls (96 + 4)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(100);

      fetchSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle rate limit errors', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'Rate limit exceeded' }),
          {
            status: 429,
            headers: { 'retry-after': '5' },
          },
        ),
      );

      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      await expect(provider.embed('test')).rejects.toThrow('rate limit');

      fetchSpy.mockRestore();
    });

    it('should retry on server errors', async () => {
      const mockEmbedding = Array(1024).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: 'Server error' }), { status: 500 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'test-id',
              embeddings: { float: [mockEmbedding] },
              texts: ['test'],
              meta: {
                api_version: { version: '2' },
                billed_units: { input_tokens: 5 },
              },
            }),
            { status: 200 },
          ),
        );

      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      const result = await provider.embed('test');
      expect(result).toEqual(mockEmbedding);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });

    it('should throw on non-retryable API errors', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'Invalid API key' }),
          { status: 401 },
        ),
      );

      await provider.initialize({
        apiKey: 'bad-key',
        model: 'embed-english-v3.0',
      });

      await expect(provider.embed('test')).rejects.toThrow('Cohere API error');

      fetchSpy.mockRestore();
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost based on token count', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      const cost = provider.estimateCost(1000);
      expect(cost).toBeCloseTo(0.0001);
    });

    it('should scale cost linearly with tokens', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      const cost1k = provider.estimateCost(1000);
      const cost10k = provider.estimateCost(10000);
      expect(cost10k).toBeCloseTo(cost1k * 10);
    });
  });

  describe('dispose', () => {
    it('should clean up state', async () => {
      await provider.initialize({
        apiKey: 'test-key',
        model: 'embed-english-v3.0',
      });

      await provider.dispose();

      await expect(provider.embed('test')).rejects.toThrow('not initialized');
    });
  });
});
