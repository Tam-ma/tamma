/**
 * Streaming tool response tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  StreamingResultCollector,
  createNonStreamingResult,
  type StreamChunk,
} from '../../src/streaming.js';

describe('StreamingResultCollector', () => {
  describe('push', () => {
    it('should store content chunks', async () => {
      const collector = new StreamingResultCollector();

      collector.push({ type: 'content', content: { type: 'text', text: 'Hello' } });
      collector.push({ type: 'content', content: { type: 'text', text: 'World' } });
      collector.push({ type: 'done', totalChunks: 2 });

      const result = await collector.collect();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'text', text: 'Hello' });
      expect(result[1]).toEqual({ type: 'text', text: 'World' });
    });

    it('should call handlers on push', async () => {
      const collector = new StreamingResultCollector();
      const handler = vi.fn();

      collector.onChunk(handler);
      collector.push({ type: 'content', content: { type: 'text', text: 'Test' } });

      await new Promise((r) => setTimeout(r, 10));
      expect(handler).toHaveBeenCalledWith({
        type: 'content',
        content: { type: 'text', text: 'Test' },
      });
    });

    it('should resolve collect on done', async () => {
      const collector = new StreamingResultCollector();

      collector.push({ type: 'content', content: { type: 'text', text: 'Data' } });
      collector.push({ type: 'done', totalChunks: 1 });

      const result = await collector.collect();
      expect(result).toHaveLength(1);
    });

    it('should reject collect on error', async () => {
      const collector = new StreamingResultCollector();

      collector.push({ type: 'error', error: 'Test error' });

      await expect(collector.collect()).rejects.toThrow('Test error');
    });
  });

  describe('isDone', () => {
    it('should return false initially', () => {
      const collector = new StreamingResultCollector();
      expect(collector.isDone()).toBe(false);
    });

    it('should return true after done', () => {
      const collector = new StreamingResultCollector();
      collector.push({ type: 'done', totalChunks: 0 });
      expect(collector.isDone()).toBe(true);
    });

    it('should return true after error', () => {
      const collector = new StreamingResultCollector();
      collector.push({ type: 'error', error: 'Error' });
      expect(collector.isDone()).toBe(true);
    });
  });

  describe('abort', () => {
    it('should mark as done', () => {
      const collector = new StreamingResultCollector();
      collector.abort();
      expect(collector.isDone()).toBe(true);
    });
  });

  describe('asyncIterator', () => {
    it('should yield chunks in order', async () => {
      const collector = new StreamingResultCollector();

      // Push chunks
      setTimeout(() => {
        collector.push({ type: 'content', content: { type: 'text', text: 'A' } });
        collector.push({ type: 'content', content: { type: 'text', text: 'B' } });
        collector.push({ type: 'done', totalChunks: 2 });
      }, 10);

      const chunks: StreamChunk[] = [];
      for await (const chunk of collector) {
        chunks.push(chunk);
        if (chunk.type === 'done') break;
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]?.type).toBe('content');
      expect(chunks[1]?.type).toBe('content');
      expect(chunks[2]?.type).toBe('done');
    });
  });
});

describe('createNonStreamingResult', () => {
  it('should create a result with all content immediately available', async () => {
    const contents = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'text' as const, text: 'World' },
    ];

    const result = createNonStreamingResult(contents);

    expect(result.isDone()).toBe(true);

    const collected = await result.collect();
    expect(collected).toEqual(contents);
  });

  it('should handle empty content', async () => {
    const result = createNonStreamingResult([]);

    expect(result.isDone()).toBe(true);

    const collected = await result.collect();
    expect(collected).toEqual([]);
  });
});
