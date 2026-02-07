/**
 * @tamma/mcp-client
 * Streaming tool response support
 */

import type { ToolResultContent } from './types.js';

/**
 * Streaming response handler
 */
export type StreamHandler = (chunk: StreamChunk) => void | Promise<void>;

/**
 * Stream chunk types
 */
export type StreamChunk =
  | { type: 'content'; content: ToolResultContent }
  | { type: 'progress'; progress: number; message?: string }
  | { type: 'done'; totalChunks: number }
  | { type: 'error'; error: string };

/**
 * Streaming tool result
 */
export interface StreamingToolResult {
  /**
   * Async iterator for streaming chunks
   */
  [Symbol.asyncIterator](): AsyncIterator<StreamChunk>;

  /**
   * Subscribe to chunks with a handler
   */
  onChunk(handler: StreamHandler): void;

  /**
   * Wait for all chunks and collect them
   */
  collect(): Promise<ToolResultContent[]>;

  /**
   * Abort the stream
   */
  abort(): void;

  /**
   * Check if the stream is done
   */
  isDone(): boolean;
}

/**
 * Create a streaming result collector
 */
export class StreamingResultCollector implements StreamingToolResult {
  private chunks: ToolResultContent[] = [];
  private handlers: StreamHandler[] = [];
  private done = false;
  private aborted = false;
  private resolvers: Array<(value: IteratorResult<StreamChunk>) => void> = [];
  private pendingChunks: StreamChunk[] = [];
  private donePromise?: Promise<ToolResultContent[]>;
  private doneResolve?: (value: ToolResultContent[]) => void;
  private doneReject?: (error: Error) => void;

  constructor() {
    this.donePromise = new Promise((resolve, reject) => {
      this.doneResolve = resolve;
      this.doneReject = reject;
    });
    // Prevent unhandled rejection when error chunks are pushed without collect()
    this.donePromise.catch(() => {});
  }

  /**
   * Push a chunk to the stream
   */
  push(chunk: StreamChunk): void {
    if (this.done || this.aborted) {
      return;
    }

    // Store content chunks
    if (chunk.type === 'content') {
      this.chunks.push(chunk.content);
    }

    // Handle done
    if (chunk.type === 'done') {
      this.done = true;
      this.doneResolve?.(this.chunks);
    }

    // Handle error
    if (chunk.type === 'error') {
      this.done = true;
      this.doneReject?.(new Error(chunk.error));
    }

    // Notify handlers
    for (const handler of this.handlers) {
      void Promise.resolve(handler(chunk));
    }

    // Resolve any waiting iterator
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: chunk, done: false });
    } else {
      this.pendingChunks.push(chunk);
    }
  }

  /**
   * Async iterator implementation
   */
  async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
    while ((!this.done && !this.aborted) || this.pendingChunks.length > 0) {
      const pending = this.pendingChunks.shift();
      if (pending) {
        yield pending;
        if (pending.type === 'done' || pending.type === 'error') {
          return;
        }
        continue; // Check for more pending chunks before waiting
      }
      const chunk = await new Promise<IteratorResult<StreamChunk>>((resolve) => {
        this.resolvers.push(resolve);
      });
      if (!chunk.done) {
        yield chunk.value;
        if (chunk.value.type === 'done' || chunk.value.type === 'error') {
          return;
        }
      }
    }
  }

  onChunk(handler: StreamHandler): void {
    this.handlers.push(handler);
  }

  async collect(): Promise<ToolResultContent[]> {
    if (this.donePromise) {
      return this.donePromise;
    }
    return this.chunks;
  }

  abort(): void {
    this.aborted = true;
    this.done = true;
    this.push({ type: 'error', error: 'Stream aborted' });
  }

  isDone(): boolean {
    return this.done;
  }
}

/**
 * Create an empty streaming result (non-streaming fallback)
 */
export function createNonStreamingResult(contents: ToolResultContent[]): StreamingToolResult {
  const collector = new StreamingResultCollector();

  // Push all content immediately
  for (const content of contents) {
    collector.push({ type: 'content', content });
  }
  collector.push({ type: 'done', totalChunks: contents.length });

  return collector;
}
