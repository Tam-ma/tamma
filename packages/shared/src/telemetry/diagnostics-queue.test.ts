/**
 * Unit tests for DiagnosticsEvent types and DiagnosticsQueue class.
 *
 * Tests cover:
 * - Type assertion tests for discriminated union types
 * - Synchronous emit behavior
 * - Timer-based drain with processor
 * - drainPromise concurrency guard
 * - Queue overflow and drop counting
 * - FIFO ordering within batches
 * - Processor error handling and structured logging
 * - dispose() re-drain loop
 * - Timer .unref() behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DiagnosticsEvent,
  DiagnosticsEventType,
  DiagnosticsErrorCode,
  ToolDiagnosticsEvent,
  ProviderDiagnosticsEvent,
  DiagnosticsEventBase,
} from './diagnostics-event.js';
import {
  DiagnosticsQueue,
  type DiagnosticsEventProcessor,
  type DiagnosticsQueueLogger,
  type IDiagnosticsQueue,
} from './diagnostics-queue.js';

// --- Helper factories ---

function makeToolEvent(
  overrides: Partial<ToolDiagnosticsEvent> = {},
): ToolDiagnosticsEvent {
  return {
    type: 'tool:invoke',
    timestamp: Date.now(),
    toolName: 'test-tool',
    ...overrides,
  };
}

function makeProviderEvent(
  overrides: Partial<ProviderDiagnosticsEvent> = {},
): ProviderDiagnosticsEvent {
  return {
    type: 'provider:call',
    timestamp: Date.now(),
    providerName: 'test-provider',
    ...overrides,
  };
}

// --- Type assertion tests ---

describe('DiagnosticsEvent types', () => {
  it('DiagnosticsEventType includes all 6 event types', () => {
    const types: DiagnosticsEventType[] = [
      'tool:invoke',
      'tool:complete',
      'tool:error',
      'provider:call',
      'provider:complete',
      'provider:error',
    ];
    expect(types).toHaveLength(6);
  });

  it('DiagnosticsErrorCode includes all error codes', () => {
    const codes: DiagnosticsErrorCode[] = [
      'RATE_LIMIT_EXCEEDED',
      'QUOTA_EXCEEDED',
      'AUTH_FAILED',
      'TIMEOUT',
      'NETWORK_ERROR',
      'TASK_FAILED',
      'UNKNOWN',
    ];
    expect(codes).toHaveLength(7);
  });

  it('ToolDiagnosticsEvent requires toolName', () => {
    const event: ToolDiagnosticsEvent = {
      type: 'tool:invoke',
      timestamp: Date.now(),
      toolName: 'my-tool',
    };
    expect(event.toolName).toBe('my-tool');
    expect(event.type).toBe('tool:invoke');
  });

  it('ToolDiagnosticsEvent accepts optional serverName and args', () => {
    const event: ToolDiagnosticsEvent = {
      type: 'tool:complete',
      timestamp: Date.now(),
      toolName: 'my-tool',
      serverName: 'my-server',
      args: { key: 'value' },
      latencyMs: 100,
      success: true,
    };
    expect(event.serverName).toBe('my-server');
    expect(event.args).toEqual({ key: 'value' });
  });

  it('ProviderDiagnosticsEvent requires providerName', () => {
    const event: ProviderDiagnosticsEvent = {
      type: 'provider:call',
      timestamp: Date.now(),
      providerName: 'anthropic',
    };
    expect(event.providerName).toBe('anthropic');
    expect(event.type).toBe('provider:call');
  });

  it('ProviderDiagnosticsEvent accepts optional model and tokens', () => {
    const event: ProviderDiagnosticsEvent = {
      type: 'provider:complete',
      timestamp: Date.now(),
      providerName: 'openai',
      model: 'gpt-4o',
      tokens: { input: 100, output: 50 },
      costUsd: 0.005,
    };
    expect(event.model).toBe('gpt-4o');
    expect(event.tokens).toEqual({ input: 100, output: 50 });
  });

  it('DiagnosticsEvent discriminated union narrows on type', () => {
    const event: DiagnosticsEvent = makeToolEvent({ type: 'tool:complete' });

    if (
      event.type === 'tool:invoke' ||
      event.type === 'tool:complete' ||
      event.type === 'tool:error'
    ) {
      // TypeScript narrows to ToolDiagnosticsEvent
      expect(event.toolName).toBe('test-tool');
    }
  });

  it('DiagnosticsEvent discriminated union narrows provider events', () => {
    const event: DiagnosticsEvent = makeProviderEvent({
      type: 'provider:complete',
      model: 'claude-sonnet-4',
    });

    if (
      event.type === 'provider:call' ||
      event.type === 'provider:complete' ||
      event.type === 'provider:error'
    ) {
      // TypeScript narrows to ProviderDiagnosticsEvent
      expect(event.providerName).toBe('test-provider');
    }
  });

  it('DiagnosticsEventBase includes correlationId for event pairing (F15)', () => {
    const event: ToolDiagnosticsEvent = {
      type: 'tool:invoke',
      timestamp: Date.now(),
      toolName: 'my-tool',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
    };
    expect(event.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('DiagnosticsEventBase includes optional context fields', () => {
    const event: ToolDiagnosticsEvent = {
      type: 'tool:invoke',
      timestamp: Date.now(),
      toolName: 'my-tool',
      agentType: 'implementer',
      projectId: 'proj-1',
      engineId: 'eng-1',
      taskId: 'task-1',
      taskType: 'implementation',
    };
    expect(event.agentType).toBe('implementer');
    expect(event.projectId).toBe('proj-1');
    expect(event.engineId).toBe('eng-1');
    expect(event.taskId).toBe('task-1');
    expect(event.taskType).toBe('implementation');
  });

  it('DiagnosticsEventBase includes error fields for error events', () => {
    const event: ToolDiagnosticsEvent = {
      type: 'tool:error',
      timestamp: Date.now(),
      toolName: 'my-tool',
      latencyMs: 500,
      success: false,
      errorCode: 'TIMEOUT',
      errorMessage: 'Tool call timed out after 30s',
    };
    expect(event.errorCode).toBe('TIMEOUT');
    expect(event.errorMessage).toBe('Tool call timed out after 30s');
    expect(event.success).toBe(false);
  });

  it('agentType field is typed as AgentType (not string)', () => {
    // This test validates at compile time that agentType is AgentType
    const event: DiagnosticsEventBase = {
      type: 'tool:invoke',
      timestamp: Date.now(),
      agentType: 'scrum_master',
    };
    // All valid AgentType values should compile
    const validAgentTypes: DiagnosticsEventBase['agentType'][] = [
      'scrum_master',
      'architect',
      'researcher',
      'analyst',
      'planner',
      'implementer',
      'reviewer',
      'tester',
      'documenter',
      undefined,
    ];
    expect(validAgentTypes).toContain(event.agentType);
  });
});

// --- IDiagnosticsQueue interface tests ---

describe('IDiagnosticsQueue interface', () => {
  it('DiagnosticsQueue implements IDiagnosticsQueue', () => {
    const queue: IDiagnosticsQueue = new DiagnosticsQueue();
    expect(typeof queue.emit).toBe('function');
    expect(typeof queue.setProcessor).toBe('function');
    expect(typeof queue.dispose).toBe('function');
    expect(typeof queue.getDroppedCount).toBe('function');
  });
});

// --- DiagnosticsQueue class tests ---

describe('DiagnosticsQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emit() is synchronous -- no drain occurs immediately', () => {
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue();
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    // Processor should NOT have been called yet (no drain)
    expect(processor).not.toHaveBeenCalled();
  });

  it('queue drains to processor on interval (default 5000ms)', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue();
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());
    queue.emit(makeProviderEvent());

    // Advance past drain interval
    await vi.advanceTimersByTimeAsync(5000);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool:invoke' }),
        expect.objectContaining({ type: 'provider:call' }),
      ]),
    );
  });

  it('queue drains to processor on custom interval', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue({ drainIntervalMs: 1000 });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    // Should not drain at 500ms
    await vi.advanceTimersByTimeAsync(500);
    expect(processor).not.toHaveBeenCalled();

    // Should drain at 1000ms
    await vi.advanceTimersByTimeAsync(500);
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('drainPromise guard prevents concurrent drain', async () => {
    let resolveProcessor: (() => void) | undefined;
    const processorPromise = new Promise<void>((resolve) => {
      resolveProcessor = resolve;
    });
    const processor = vi.fn<DiagnosticsEventProcessor>().mockReturnValue(processorPromise);
    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    // First timer fires, starts drain
    await vi.advanceTimersByTimeAsync(100);
    expect(processor).toHaveBeenCalledTimes(1);

    // Second timer fires while drain is in-flight
    queue.emit(makeToolEvent());
    await vi.advanceTimersByTimeAsync(100);
    // Should still be only 1 call since drain is in-flight
    expect(processor).toHaveBeenCalledTimes(1);

    // Resolve the first drain
    resolveProcessor!();
    await vi.advanceTimersByTimeAsync(0);

    // Now the next timer tick should trigger a new drain
    await vi.advanceTimersByTimeAsync(100);
    expect(processor).toHaveBeenCalledTimes(2);

    await queue.dispose();
  });

  it('processor error does not lose subsequently emitted events', async () => {
    const logger: DiagnosticsQueueLogger = {
      warn: vi.fn(),
    };
    const processor = vi.fn<DiagnosticsEventProcessor>();
    // First call rejects
    processor.mockRejectedValueOnce(new Error('processor failed'));
    // Second call resolves
    processor.mockResolvedValueOnce(undefined);

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100, logger });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent({ toolName: 'first' }));

    // First drain (fails)
    await vi.advanceTimersByTimeAsync(100);
    expect(processor).toHaveBeenCalledTimes(1);

    // Emit another event after failure
    queue.emit(makeToolEvent({ toolName: 'second' }));

    // Second drain (succeeds)
    await vi.advanceTimersByTimeAsync(100);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(processor).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'second' }),
      ]),
    );

    await queue.dispose();
  });

  it('queue drops oldest event when maxQueueSize is exceeded', () => {
    const queue = new DiagnosticsQueue({ maxQueueSize: 3 });

    queue.emit(makeToolEvent({ toolName: 'tool-1' }));
    queue.emit(makeToolEvent({ toolName: 'tool-2' }));
    queue.emit(makeToolEvent({ toolName: 'tool-3' }));
    // Queue is full (3 items), next emit drops oldest
    queue.emit(makeToolEvent({ toolName: 'tool-4' }));

    expect(queue.getDroppedCount()).toBe(1);
  });

  it('getDroppedCount() returns correct count after multiple overflows (F02)', () => {
    const queue = new DiagnosticsQueue({ maxQueueSize: 2 });

    queue.emit(makeToolEvent({ toolName: 'tool-1' }));
    queue.emit(makeToolEvent({ toolName: 'tool-2' }));
    // Overflow: drops tool-1
    queue.emit(makeToolEvent({ toolName: 'tool-3' }));
    // Overflow: drops tool-2
    queue.emit(makeToolEvent({ toolName: 'tool-4' }));
    // Overflow: drops tool-3
    queue.emit(makeToolEvent({ toolName: 'tool-5' }));

    expect(queue.getDroppedCount()).toBe(3);
  });

  it('dispose() drains queued events and rejects new emits (F12)', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>();
    // Simulate events being emitted during drain -- these are dropped
    // because dispose() sets the disposed flag before draining.
    let callCount = 0;
    processor.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        queue.emit(makeToolEvent({ toolName: `during-drain-${callCount}` }));
      }
    });

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent({ toolName: 'initial' }));

    await queue.dispose();

    // Only 1 drain: the initial event. Events emitted during/after dispose are dropped.
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('dispose() caps at 10 iterations to prevent infinite loop (F12)', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>();
    // Always add an event during processing to test the cap
    processor.mockImplementation(async () => {
      queue.emit(makeToolEvent({ toolName: 'infinite' }));
    });

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent({ toolName: 'start' }));

    await queue.dispose();

    // Should stop at 10 iterations max
    expect(processor.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('timer uses .unref() so it does not keep the process alive', () => {
    const unrefSpy = vi.fn();
    const originalSetInterval = globalThis.setInterval;

    vi.spyOn(globalThis, 'setInterval').mockImplementation((...args) => {
      const timer = originalSetInterval(...args);
      const originalUnref = timer.unref.bind(timer);
      timer.unref = () => {
        unrefSpy();
        return originalUnref();
      };
      return timer;
    });

    const queue = new DiagnosticsQueue();
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    queue.setProcessor(processor);

    expect(unrefSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('setProcessor() does not start timer if called without processor being used', async () => {
    // This tests that the timer starts only once even with multiple setProcessor calls
    const processor1 = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const processor2 = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor1);
    // Setting a second processor should not start a second timer
    queue.setProcessor(processor2);

    queue.emit(makeToolEvent());

    await vi.advanceTimersByTimeAsync(100);

    // Only processor2 should be called (it replaced processor1)
    expect(processor1).not.toHaveBeenCalled();
    expect(processor2).toHaveBeenCalledTimes(1);

    await queue.dispose();
  });

  it('emit() before setProcessor() queues events, then draining after setProcessor() delivers them', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });

    // Emit before setting processor
    queue.emit(makeToolEvent({ toolName: 'early-1' }));
    queue.emit(makeToolEvent({ toolName: 'early-2' }));

    // Now set processor
    queue.setProcessor(processor);

    // Advance timer to trigger drain
    await vi.advanceTimersByTimeAsync(100);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'early-1' }),
        expect.objectContaining({ toolName: 'early-2' }),
      ]),
    );

    await queue.dispose();
  });

  it('dispose() on a queue with no processor does not throw', async () => {
    const queue = new DiagnosticsQueue();
    queue.emit(makeToolEvent());

    // Should not throw
    await expect(queue.dispose()).resolves.toBeUndefined();
  });

  it('drain() logs structured warning via logger.warn() on processor failure (F05)', async () => {
    const logger: DiagnosticsQueueLogger = {
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const processor = vi.fn<DiagnosticsEventProcessor>().mockRejectedValue(
      new Error('boom'),
    );

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100, logger });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    await vi.advanceTimersByTimeAsync(100);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Diagnostics processor drain failed',
      expect.objectContaining({
        error: 'boom',
        batchSize: 1,
      }),
    );

    await queue.dispose();
  });

  it('drain() logs non-Error thrown values as strings (F05)', async () => {
    const logger: DiagnosticsQueueLogger = {
      warn: vi.fn(),
    };
    const processor = vi.fn<DiagnosticsEventProcessor>().mockRejectedValue(
      'string error',
    );

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100, logger });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    await vi.advanceTimersByTimeAsync(100);

    expect(logger.warn).toHaveBeenCalledWith(
      'Diagnostics processor drain failed',
      expect.objectContaining({
        error: 'string error',
        batchSize: 1,
      }),
    );

    await queue.dispose();
  });

  it('events are delivered in FIFO order within a batch (F17)', async () => {
    const receivedBatches: DiagnosticsEvent[][] = [];
    const processor: DiagnosticsEventProcessor = async (events) => {
      receivedBatches.push([...events]);
    };

    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    // Emit events in specific order
    queue.emit(makeToolEvent({ toolName: 'first', timestamp: 1 }));
    queue.emit(makeProviderEvent({ providerName: 'second', timestamp: 2 }));
    queue.emit(makeToolEvent({ toolName: 'third', timestamp: 3 }));

    await vi.advanceTimersByTimeAsync(100);

    expect(receivedBatches).toHaveLength(1);
    const batch = receivedBatches[0]!;
    expect(batch).toHaveLength(3);
    expect(batch[0]!.timestamp).toBe(1);
    expect(batch[1]!.timestamp).toBe(2);
    expect(batch[2]!.timestamp).toBe(3);

    await queue.dispose();
  });

  it('dropped events preserve FIFO order of remaining events (F17)', async () => {
    const receivedBatches: DiagnosticsEvent[][] = [];
    const processor: DiagnosticsEventProcessor = async (events) => {
      receivedBatches.push([...events]);
    };

    const queue = new DiagnosticsQueue({ maxQueueSize: 3, drainIntervalMs: 100 });
    queue.setProcessor(processor);

    // Emit 5 events with maxQueueSize 3 -- first 2 should be dropped
    queue.emit(makeToolEvent({ toolName: 'A', timestamp: 1 }));
    queue.emit(makeToolEvent({ toolName: 'B', timestamp: 2 }));
    queue.emit(makeToolEvent({ toolName: 'C', timestamp: 3 }));
    queue.emit(makeToolEvent({ toolName: 'D', timestamp: 4 }));
    queue.emit(makeToolEvent({ toolName: 'E', timestamp: 5 }));

    expect(queue.getDroppedCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(100);

    expect(receivedBatches).toHaveLength(1);
    const batch = receivedBatches[0]!;
    expect(batch).toHaveLength(3);
    // Remaining events are C, D, E in order
    expect((batch[0]! as ToolDiagnosticsEvent).toolName).toBe('C');
    expect((batch[1]! as ToolDiagnosticsEvent).toolName).toBe('D');
    expect((batch[2]! as ToolDiagnosticsEvent).toolName).toBe('E');

    await queue.dispose();
  });

  it('empty drain does not call processor', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    // No events emitted -- drain should skip processor
    await vi.advanceTimersByTimeAsync(100);

    expect(processor).not.toHaveBeenCalled();

    await queue.dispose();
  });

  it('dispose() clears the timer before draining', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    await queue.dispose();

    // clearInterval should have been called
    expect(clearIntervalSpy).toHaveBeenCalled();
    // And processor should have been called to drain remaining events
    expect(processor).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
  });

  it('multiple dispose() calls are safe', async () => {
    const processor = vi.fn<DiagnosticsEventProcessor>().mockResolvedValue(undefined);
    const queue = new DiagnosticsQueue({ drainIntervalMs: 100 });
    queue.setProcessor(processor);

    queue.emit(makeToolEvent());

    // Calling dispose twice should not throw
    await queue.dispose();
    await queue.dispose();

    // Processor called only once (from first dispose)
    expect(processor).toHaveBeenCalledTimes(1);
  });
});
