/**
 * Diagnostics Queue
 *
 * Provides a synchronous `emit()` method for zero hot-path overhead
 * and a timer-based drain that batches events to a processor.
 * Events are delivered in FIFO order; oldest events are dropped
 * when the queue exceeds `maxQueueSize`.
 */

import type { DiagnosticsEvent } from './diagnostics-event.js';

/**
 * Processor function type that receives a batch of diagnostics events.
 * Called by DiagnosticsQueue during drain cycles.
 */
export type DiagnosticsEventProcessor = (events: DiagnosticsEvent[]) => Promise<void>;

/**
 * Logger interface for DiagnosticsQueue internal warnings and debug messages.
 * Kept minimal to avoid coupling to a specific logging framework.
 */
export interface DiagnosticsQueueLogger {
  warn(msg: string, context?: Record<string, unknown>): void;
  debug?(msg: string, context?: Record<string, unknown>): void;
}

/**
 * Interface for the diagnostics queue.
 * Decouples consumers from the concrete DiagnosticsQueue implementation.
 */
export interface IDiagnosticsQueue {
  /** Synchronously enqueue a diagnostics event (zero async overhead) */
  emit(event: DiagnosticsEvent): void;
  /** Set the processor that will receive batched events on drain */
  setProcessor(processor: DiagnosticsEventProcessor): void;
  /** Flush remaining events and stop the drain timer */
  dispose(): Promise<void>;
  /** Return the count of events dropped due to queue overflow */
  getDroppedCount(): number;
}

/**
 * Bounded, timer-drained diagnostics event queue.
 *
 * - `emit()` is synchronous -- zero overhead on the hot path
 * - Timer-based drain batches events to the processor
 * - `drainPromise` guard prevents concurrent drain
 * - Oldest events are dropped when queue is full
 * - `dispose()` re-drains until empty (max 10 iterations)
 */
export class DiagnosticsQueue implements IDiagnosticsQueue {
  private queue: DiagnosticsEvent[] = [];
  private processor: DiagnosticsEventProcessor | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private drainPromise: Promise<void> | null = null;
  private readonly drainIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly logger?: DiagnosticsQueueLogger;
  private droppedCount: number = 0;
  private disposed: boolean = false;

  constructor(options?: {
    drainIntervalMs?: number;
    maxQueueSize?: number;
    logger?: DiagnosticsQueueLogger;
  }) {
    this.drainIntervalMs = options?.drainIntervalMs ?? 5000;
    this.maxQueueSize = options?.maxQueueSize ?? 1000;
    if (options?.logger) {
      this.logger = options.logger;
    }
  }

  /**
   * Set the processor and start the drain timer.
   * The timer uses `.unref()` so it does not keep the Node.js process alive.
   */
  setProcessor(processor: DiagnosticsEventProcessor): void {
    this.processor = processor;
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => void this.drain(), this.drainIntervalMs);
      if (this.drainTimer.unref) {
        this.drainTimer.unref();
      }
    }
  }

  /**
   * Synchronous push -- zero overhead in the hot path.
   * Drops the oldest event when the queue exceeds maxQueueSize.
   * Silently ignores events emitted after dispose() has been called.
   */
  emit(event: DiagnosticsEvent): void {
    if (this.disposed) return;
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.droppedCount++;
    }
    this.queue.push(event);
  }

  /**
   * Returns the number of events dropped due to queue overflow.
   */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  /**
   * Drain the queue to the processor.
   * Guarded by `drainPromise` to prevent concurrent drain execution.
   * Processor errors are logged via `logger?.warn()` with structured context.
   */
  private async drain(): Promise<void> {
    // If a drain is already in flight, wait for it to complete
    if (this.drainPromise) {
      await this.drainPromise;
      return;
    }

    if (!this.processor || this.queue.length === 0) {
      return;
    }

    // splice(0) atomically removes all elements, preserving FIFO order
    const batch = this.queue.splice(0);

    // Use async/await (project rule: NEVER .then()/.catch()) with a
    // manually-resolved promise so concurrent callers can await drainPromise.
    let resolve!: () => void;
    this.drainPromise = new Promise<void>((r) => { resolve = r; });

    try {
      await this.processor(batch);
    } catch (err: unknown) {
      this.logger?.warn('Diagnostics processor drain failed', {
        error: err instanceof Error ? err.message : String(err),
        batchSize: batch.length,
      });
    } finally {
      this.drainPromise = null;
      resolve();
    }
  }

  /**
   * Stop accepting new events, flush remaining queued events, and stop
   * the drain timer. Re-drains in a loop until the queue is empty
   * (max 10 iterations). Events emitted after dispose() begins are
   * silently dropped (the `disposed` flag gates `emit()`).
   */
  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }

    let maxIterations = 10;
    while ((this.queue.length > 0 || this.drainPromise) && maxIterations-- > 0) {
      await this.drain();
    }
  }
}
