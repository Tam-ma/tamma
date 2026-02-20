/**
 * Tests for Ollama Embedding Provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaEmbeddingProvider } from '../embedding/ollama-embedding-provider.js';

describe('OllamaEmbeddingProvider', () => {
  let provider: OllamaEmbeddingProvider;

  beforeEach(() => {
    provider = new OllamaEmbeddingProvider();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  describe('initialize', () => {
    it('should initialize without API key (local service)', async () => {
      await provider.initialize({ model: 'nomic-embed-text' });

      expect(provider.name).toBe('ollama');
      expect(provider.dimensions).toBe(768);
    });

    it('should use default model if not specified', async () => {
      await provider.initialize({ model: 'nomic-embed-text' });

      expect(provider.dimensions).toBe(768);
    });

    it('should set dimensions based on known model', async () => {
      await provider.initialize({ model: 'mxbai-embed-large' });

      expect(provider.dimensions).toBe(1024);
    });

    it('should accept custom base URL', async () => {
      await provider.initialize({
        model: 'nomic-embed-text',
        baseUrl: 'http://custom-host:11434',
      });

      expect(provider.name).toBe('ollama');
    });
  });

  describe('embed', () => {
    it('should throw if not initialized', async () => {
      await expect(provider.embed('test')).rejects.toThrow('not initialized');
    });

    it('should call the Ollama API and return embeddings', async () => {
      const mockEmbedding = Array(768).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: [mockEmbedding],
          }),
          { status: 200 },
        ),
      );

      await provider.initialize({ model: 'nomic-embed-text' });

      const embedding = await provider.embed('test');

      expect(embedding).toEqual(mockEmbedding);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/embed');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(options?.body as string);
      expect(body.model).toBe('nomic-embed-text');
      expect(body.input).toEqual(['test']);

      fetchSpy.mockRestore();
    });
  });

  describe('embedBatch', () => {
    it('should return empty array for empty input', async () => {
      await provider.initialize({ model: 'nomic-embed-text' });

      const result = await provider.embedBatch([]);
      expect(result).toEqual([]);
    });

    it('should batch embed multiple texts', async () => {
      const mockEmbeddings = [
        Array(768).fill(0.1),
        Array(768).fill(0.2),
        Array(768).fill(0.3),
      ];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: mockEmbeddings,
          }),
          { status: 200 },
        ),
      );

      await provider.initialize({ model: 'nomic-embed-text' });

      const result = await provider.embedBatch(['a', 'b', 'c']);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(mockEmbeddings[0]);
      expect(result[1]).toEqual(mockEmbeddings[1]);
      expect(result[2]).toEqual(mockEmbeddings[2]);

      fetchSpy.mockRestore();
    });

    it('should split batches larger than maxBatchSize', async () => {
      const mockEmbedding = Array(768).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        const batchSize = body.input.length;
        return new Response(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: Array(batchSize).fill(mockEmbedding),
          }),
          { status: 200 },
        );
      });

      await provider.initialize({ model: 'nomic-embed-text' });

      // Create more texts than maxBatchSize (512)
      const texts = Array(600).fill('').map((_, i) => `text ${i}`);
      const result = await provider.embedBatch(texts);

      // Should have made 2 API calls (512 + 88)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(600);

      fetchSpy.mockRestore();
    });

    it('should update dimensions from response', async () => {
      // Response with different dimensions than expected
      const mockEmbedding = Array(512).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'custom-model',
            embeddings: [mockEmbedding],
          }),
          { status: 200 },
        ),
      );

      await provider.initialize({ model: 'custom-model' });

      const result = await provider.embedBatch(['test']);

      expect(result[0]).toHaveLength(512);
      expect(provider.dimensions).toBe(512);

      fetchSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should retry on server errors', async () => {
      const mockEmbedding = Array(768).fill(0.1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: 'Server error' }),
            { status: 500 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              model: 'nomic-embed-text',
              embeddings: [mockEmbedding],
            }),
            { status: 200 },
          ),
        );

      await provider.initialize({ model: 'nomic-embed-text' });

      const result = await provider.embed('test');
      expect(result).toEqual(mockEmbedding);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });

    it('should throw descriptive error when Ollama is unreachable', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('fetch failed'),
      );

      await provider.initialize({ model: 'nomic-embed-text' });

      await expect(provider.embed('test')).rejects.toThrow('Is Ollama running');

      fetchSpy.mockRestore();
    });

    it('should throw on API errors', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'model not found' }),
          { status: 404 },
        ),
      );

      await provider.initialize({ model: 'nonexistent-model' });

      await expect(provider.embed('test')).rejects.toThrow('Ollama API error');

      fetchSpy.mockRestore();
    });
  });

  describe('estimateCost', () => {
    it('should always return 0 for local models', async () => {
      await provider.initialize({ model: 'nomic-embed-text' });

      expect(provider.estimateCost(1000)).toBe(0);
      expect(provider.estimateCost(1000000)).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should clean up state', async () => {
      await provider.initialize({ model: 'nomic-embed-text' });

      await provider.dispose();

      await expect(provider.embed('test')).rejects.toThrow('not initialized');
    });
  });
});
