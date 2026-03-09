/**
 * InstrumentedLLMProvider Unit Tests
 *
 * Tests the decorator that wraps IAIProvider to emit diagnostics
 * events to DiagnosticsQueue. Covers:
 * - Full IAIProvider interface implementation
 * - sendMessageSync instrumentation (provider:call / provider:complete / provider:error)
 * - sendMessage streaming instrumentation (token tracking, completion/error events)
 * - Context fields in all events
 * - Error re-throwing
 * - Sanitized error messages
 * - Typed DiagnosticsErrorCode
 * - Security boundary: no prompt content in events
 * - No isAvailable() method
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentType } from '@tamma/shared';
import type { DiagnosticsQueue } from '@tamma/shared/telemetry';
import type { ProviderDiagnosticsEvent, DiagnosticsErrorCode } from '@tamma/shared/telemetry';
import type {
  IAIProvider,
  MessageRequest,
  MessageResponse,
  MessageChunk,
  ProviderConfig,
  ProviderCapabilities,
  ModelInfo,
  TokenUsage,
  StreamOptions,
} from './types.js';
import {
  InstrumentedLLMProvider,
  type InstrumentedLLMContext,
} from './instrumented-llm-provider.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockResponse(overrides?: Partial<MessageResponse>): MessageResponse {
  return {
    id: 'resp-123',
    content: 'Hello, world!',
    model: 'claude-sonnet-4-20250514',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    finishReason: 'stop',
    ...overrides,
  };
}

function createMockChunk(
  overrides?: Partial<MessageChunk>,
): MessageChunk {
  return {
    id: 'chunk-1',
    delta: 'Hello',
    model: 'claude-sonnet-4-20250514',
    finishReason: null,
    ...overrides,
  };
}

function createMockStream(
  chunks: MessageChunk[],
): AsyncIterable<MessageChunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<MessageChunk> {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<MessageChunk>> {
          if (index < chunks.length) {
            const value = chunks[index]!;
            index++;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function createFailingStream(
  chunksBeforeError: MessageChunk[],
  error: Error,
): AsyncIterable<MessageChunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<MessageChunk> {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<MessageChunk>> {
          if (index < chunksBeforeError.length) {
            const value = chunksBeforeError[index]!;
            index++;
            return { done: false, value };
          }
          throw error;
        },
      };
    },
  };
}

function createMockCapabilities(): ProviderCapabilities {
  return {
    supportsStreaming: true,
    supportsImages: true,
    supportsTools: true,
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
    supportedModels: [],
    features: {},
  };
}

function createMockModelInfo(): ModelInfo {
  return {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet',
    maxTokens: 200000,
    supportsStreaming: true,
    supportsImages: true,
    supportsTools: true,
  };
}

function createMockLLMProvider(
  overrides?: Partial<IAIProvider>,
): IAIProvider {
  return {
    initialize: vi.fn<[ProviderConfig], Promise<void>>().mockResolvedValue(undefined),
    sendMessage: vi.fn<
      [MessageRequest, StreamOptions?],
      Promise<AsyncIterable<MessageChunk>>
    >().mockResolvedValue(createMockStream([])),
    sendMessageSync: vi.fn<
      [MessageRequest],
      Promise<MessageResponse>
    >().mockResolvedValue(createMockResponse()),
    getCapabilities: vi.fn<[], ProviderCapabilities>().mockReturnValue(
      createMockCapabilities(),
    ),
    getModels: vi.fn<[], Promise<ModelInfo[]>>().mockResolvedValue([
      createMockModelInfo(),
    ]),
    dispose: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDiagnosticsQueue(): DiagnosticsQueue {
  return {
    emit: vi.fn(),
    setProcessor: vi.fn(),
    dispose: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    getDroppedCount: vi.fn<[], number>().mockReturnValue(0),
  } as unknown as DiagnosticsQueue;
}

function createContext(
  overrides?: Partial<InstrumentedLLMContext>,
): InstrumentedLLMContext {
  return {
    providerName: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    agentType: 'implementer' as AgentType,
    projectId: 'proj-123',
    engineId: 'eng-456',
    taskId: 'task-789',
    taskType: 'implementation',
    ...overrides,
  };
}

function createRequest(
  overrides?: Partial<MessageRequest>,
): MessageRequest {
  return {
    messages: [{ role: 'user', content: 'Write a function' }],
    ...overrides,
  };
}

function getEmittedEvent(
  diagnostics: DiagnosticsQueue,
  index: number,
): ProviderDiagnosticsEvent {
  return (diagnostics.emit as ReturnType<typeof vi.fn>).mock
    .calls[index]![0] as ProviderDiagnosticsEvent;
}

// Helper to consume an async iterable
async function consumeStream(
  stream: AsyncIterable<MessageChunk>,
): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstrumentedLLMProvider', () => {
  let inner: IAIProvider;
  let diagnostics: DiagnosticsQueue;
  let context: InstrumentedLLMContext;
  let provider: InstrumentedLLMProvider;

  beforeEach(() => {
    inner = createMockLLMProvider();
    diagnostics = createMockDiagnosticsQueue();
    context = createContext();
    provider = new InstrumentedLLMProvider(inner, diagnostics, context);
  });

  // -------------------------------------------------------------------------
  // Full IAIProvider implementation
  // -------------------------------------------------------------------------

  describe('IAIProvider contract', () => {
    it('implements all IAIProvider methods', () => {
      expect(typeof provider.initialize).toBe('function');
      expect(typeof provider.sendMessage).toBe('function');
      expect(typeof provider.sendMessageSync).toBe('function');
      expect(typeof provider.getCapabilities).toBe('function');
      expect(typeof provider.getModels).toBe('function');
      expect(typeof provider.dispose).toBe('function');
    });

    it('does NOT expose isAvailable method', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((provider as any).isAvailable).toBeUndefined();
    });

    it('initialize() delegates to inner.initialize()', async () => {
      const config: ProviderConfig = { apiKey: 'test-key' };
      await provider.initialize(config);

      expect(inner.initialize).toHaveBeenCalledTimes(1);
      expect(inner.initialize).toHaveBeenCalledWith(config);
    });

    it('getCapabilities() delegates to inner.getCapabilities()', () => {
      const caps = provider.getCapabilities();

      expect(inner.getCapabilities).toHaveBeenCalledTimes(1);
      expect(caps).toEqual(createMockCapabilities());
    });

    it('getModels() delegates to inner.getModels()', async () => {
      const models = await provider.getModels();

      expect(inner.getModels).toHaveBeenCalledTimes(1);
      expect(models).toEqual([createMockModelInfo()]);
    });

    it('dispose() delegates to inner.dispose()', async () => {
      await provider.dispose();

      expect(inner.dispose).toHaveBeenCalledTimes(1);
      expect(diagnostics.emit).not.toHaveBeenCalled();
    });

    it('initialize() does not emit diagnostics events', async () => {
      await provider.initialize({ apiKey: 'test-key' });
      expect(diagnostics.emit).not.toHaveBeenCalled();
    });

    it('getCapabilities() does not emit diagnostics events', () => {
      provider.getCapabilities();
      expect(diagnostics.emit).not.toHaveBeenCalled();
    });

    it('getModels() does not emit diagnostics events', async () => {
      await provider.getModels();
      expect(diagnostics.emit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // sendMessageSync: provider:call emission
  // -------------------------------------------------------------------------

  describe('sendMessageSync - provider:call', () => {
    it('emits provider:call event before inner is called', async () => {
      let resolveInner!: (value: MessageResponse) => void;
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<MessageResponse>((resolve) => {
            resolveInner = resolve;
          }),
      );

      const promise = provider.sendMessageSync(createRequest());

      // provider:call should be emitted before inner resolves
      expect(diagnostics.emit).toHaveBeenCalledTimes(1);
      const callEvent = getEmittedEvent(diagnostics, 0);
      expect(callEvent.type).toBe('provider:call');

      // Resolve so we don't leak
      resolveInner(createMockResponse());
      await promise;
    });

    it('provider:call contains all required context fields', async () => {
      await provider.sendMessageSync(createRequest());

      const callEvent = getEmittedEvent(diagnostics, 0);

      expect(callEvent.type).toBe('provider:call');
      expect(callEvent.providerName).toBe('anthropic');
      expect(callEvent.model).toBe('claude-sonnet-4-20250514');
      expect(callEvent.agentType).toBe('implementer');
      expect(callEvent.projectId).toBe('proj-123');
      expect(callEvent.engineId).toBe('eng-456');
      expect(callEvent.taskId).toBe('task-789');
      expect(callEvent.taskType).toBe('implementation');
      expect(typeof callEvent.timestamp).toBe('number');
      expect(callEvent.timestamp).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // sendMessageSync: provider:complete emission
  // -------------------------------------------------------------------------

  describe('sendMessageSync - provider:complete', () => {
    it('emits provider:complete on successful inner call', async () => {
      await provider.sendMessageSync(createRequest());

      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.type).toBe('provider:complete');
    });

    it('provider:complete contains latencyMs >= 0', async () => {
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<MessageResponse>((resolve) =>
            setTimeout(() => resolve(createMockResponse()), 5),
          ),
      );

      await provider.sendMessageSync(createRequest());

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(typeof completeEvent.latencyMs).toBe('number');
      expect(completeEvent.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('provider:complete contains success: true', async () => {
      await provider.sendMessageSync(createRequest());

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.success).toBe(true);
    });

    it('provider:complete contains tokens.input matching response.usage.inputTokens', async () => {
      const response = createMockResponse({
        usage: { inputTokens: 250, outputTokens: 100, totalTokens: 350 },
      });
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      await provider.sendMessageSync(createRequest());

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.tokens).toBeDefined();
      expect(completeEvent.tokens!.input).toBe(250);
    });

    it('provider:complete contains tokens.output matching response.usage.outputTokens', async () => {
      const response = createMockResponse({
        usage: { inputTokens: 100, outputTokens: 75, totalTokens: 175 },
      });
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      await provider.sendMessageSync(createRequest());

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.tokens).toBeDefined();
      expect(completeEvent.tokens!.output).toBe(75);
    });

    it('provider:complete contains all context fields', async () => {
      await provider.sendMessageSync(createRequest());

      const completeEvent = getEmittedEvent(diagnostics, 1);

      expect(completeEvent.providerName).toBe('anthropic');
      expect(completeEvent.model).toBe('claude-sonnet-4-20250514');
      expect(completeEvent.agentType).toBe('implementer');
      expect(completeEvent.projectId).toBe('proj-123');
      expect(completeEvent.engineId).toBe('eng-456');
      expect(completeEvent.taskId).toBe('task-789');
      expect(completeEvent.taskType).toBe('implementation');
    });

    it('returns the response from inner provider', async () => {
      const expectedResponse = createMockResponse({ content: 'specific output' });
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockResolvedValue(
        expectedResponse,
      );

      const result = await provider.sendMessageSync(createRequest());
      expect(result).toBe(expectedResponse);
    });
  });

  // -------------------------------------------------------------------------
  // sendMessageSync: provider:error emission
  // -------------------------------------------------------------------------

  describe('sendMessageSync - provider:error', () => {
    it('emits provider:error when inner throws', async () => {
      const error = new Error('API unavailable');
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow(
        'API unavailable',
      );

      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.type).toBe('provider:error');
    });

    it('provider:error contains success: false', async () => {
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.success).toBe(false);
    });

    it('provider:error contains typed DiagnosticsErrorCode from error.code', async () => {
      const error = Object.assign(new Error('rate limited'), {
        code: 'RATE_LIMIT_EXCEEDED',
      });
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('provider:error defaults errorCode to UNKNOWN when error has no code', async () => {
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('generic error'),
      );

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorCode).toBe('UNKNOWN');
    });

    it('provider:error contains sanitized errorMessage', async () => {
      const error = new Error(
        'Auth failed with key sk-abcdefghijklmnopqrstuvwxyz1234567890',
      );
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorMessage).not.toContain('sk-');
      expect(errorEvent.errorMessage).toContain('[REDACTED]');
    });

    it('errorMessage is truncated to 500 chars', async () => {
      const longMessage = 'A'.repeat(600);
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error(longMessage),
      );

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      // The message may be redacted first (long alpha string), then truncated
      expect(errorEvent.errorMessage!.length).toBeLessThanOrEqual(503); // 500 + '...'
    });

    it('error is re-thrown after emitting provider:error', async () => {
      const originalError = new Error('original error');
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        originalError,
      );

      const thrown = await provider
        .sendMessageSync(createRequest())
        .catch((e: unknown) => e);

      expect(thrown).toBe(originalError);
    });

    it('provider:error contains latencyMs', async () => {
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(typeof errorEvent.latencyMs).toBe('number');
      expect(errorEvent.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('provider:error contains all context fields', async () => {
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.providerName).toBe('anthropic');
      expect(errorEvent.model).toBe('claude-sonnet-4-20250514');
      expect(errorEvent.agentType).toBe('implementer');
      expect(errorEvent.projectId).toBe('proj-123');
      expect(errorEvent.engineId).toBe('eng-456');
      expect(errorEvent.taskId).toBe('task-789');
      expect(errorEvent.taskType).toBe('implementation');
    });

    it('handles non-Error thrown values (string)', async () => {
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        'string error',
      );

      await expect(provider.sendMessageSync(createRequest())).rejects.toBe(
        'string error',
      );

      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.type).toBe('provider:error');
      expect(errorEvent.errorCode).toBe('UNKNOWN');
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage: provider:call emission
  // -------------------------------------------------------------------------

  describe('sendMessage - provider:call', () => {
    it('emits provider:call before calling inner', async () => {
      const stream = await provider.sendMessage(createRequest());

      // provider:call should have been emitted
      expect(diagnostics.emit).toHaveBeenCalledTimes(1);
      const callEvent = getEmittedEvent(diagnostics, 0);
      expect(callEvent.type).toBe('provider:call');

      // Consume stream to prevent leak
      await consumeStream(stream);
    });

    it('provider:call contains all required context fields', async () => {
      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      const callEvent = getEmittedEvent(diagnostics, 0);

      expect(callEvent.providerName).toBe('anthropic');
      expect(callEvent.model).toBe('claude-sonnet-4-20250514');
      expect(callEvent.agentType).toBe('implementer');
      expect(callEvent.projectId).toBe('proj-123');
      expect(callEvent.engineId).toBe('eng-456');
      expect(callEvent.taskId).toBe('task-789');
      expect(callEvent.taskType).toBe('implementation');
      expect(typeof callEvent.timestamp).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage: streaming instrumentation
  // -------------------------------------------------------------------------

  describe('sendMessage - streaming instrumentation', () => {
    it('returns a wrapped AsyncIterable<MessageChunk>', async () => {
      const chunks = [
        createMockChunk({ delta: 'Hello' }),
        createMockChunk({ delta: ' world' }),
      ];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream(chunks),
      );

      const stream = await provider.sendMessage(createRequest());

      // Verify it's an async iterable
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');

      const collected = await consumeStream(stream);
      expect(collected).toHaveLength(2);
      expect(collected[0]!.delta).toBe('Hello');
      expect(collected[1]!.delta).toBe(' world');
    });

    it('tracks tokens incrementally from chunk.usage', async () => {
      const chunks = [
        createMockChunk({
          delta: 'Hello',
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        }),
        createMockChunk({
          delta: ' world',
          usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
        }),
      ];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream(chunks),
      );

      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      // provider:call + provider:complete
      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const completeEvent = getEmittedEvent(diagnostics, 1);

      expect(completeEvent.type).toBe('provider:complete');
      expect(completeEvent.tokens).toEqual({ input: 100, output: 25 });
    });

    it('emits provider:complete when stream completes (done: true) with accumulated tokens', async () => {
      const chunks = [
        createMockChunk({
          usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250 },
        }),
      ];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream(chunks),
      );

      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      const completeEvent = getEmittedEvent(diagnostics, 1);

      expect(completeEvent.type).toBe('provider:complete');
      expect(completeEvent.success).toBe(true);
      expect(completeEvent.tokens).toEqual({ input: 200, output: 50 });
      expect(typeof completeEvent.latencyMs).toBe('number');
      expect(completeEvent.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('emits provider:complete with zero tokens when chunks have no usage', async () => {
      const chunks = [
        createMockChunk({ delta: 'Hello' }),
        createMockChunk({ delta: ' world' }),
      ];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream(chunks),
      );

      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.tokens).toEqual({ input: 0, output: 0 });
    });

    it('emits provider:complete for empty stream (no chunks)', async () => {
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([]),
      );

      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.type).toBe('provider:complete');
      expect(completeEvent.tokens).toEqual({ input: 0, output: 0 });
    });

    it('emits provider:error when stream iteration throws', async () => {
      const streamError = new Error('Connection lost during streaming');
      const chunks = [createMockChunk({ delta: 'partial' })];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createFailingStream(chunks, streamError),
      );

      const stream = await provider.sendMessage(createRequest());

      await expect(consumeStream(stream)).rejects.toThrow('Connection lost during streaming');

      // provider:call + provider:error
      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const errorEvent = getEmittedEvent(diagnostics, 1);

      expect(errorEvent.type).toBe('provider:error');
      expect(errorEvent.success).toBe(false);
      expect(errorEvent.errorCode).toBe('UNKNOWN');
      expect(typeof errorEvent.errorMessage).toBe('string');
      expect(typeof errorEvent.latencyMs).toBe('number');
    });

    it('stream error contains sanitized errorMessage', async () => {
      const streamError = new Error(
        'Failed with Bearer eyJhbGciOiJIUzI1NiJ9.secret-token',
      );
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createFailingStream([], streamError),
      );

      const stream = await provider.sendMessage(createRequest());
      await expect(consumeStream(stream)).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorMessage).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(errorEvent.errorMessage).toContain('[REDACTED]');
    });

    it('stream error contains typed errorCode from error.code', async () => {
      const streamError = Object.assign(new Error('timeout'), {
        code: 'TIMEOUT',
      });
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createFailingStream([], streamError),
      );

      const stream = await provider.sendMessage(createRequest());
      await expect(consumeStream(stream)).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorCode).toBe('TIMEOUT');
    });

    it('stream wrapper re-throws errors after emitting provider:error', async () => {
      const originalError = new Error('stream broken');
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createFailingStream([], originalError),
      );

      const stream = await provider.sendMessage(createRequest());
      const thrown = await consumeStream(stream).catch((e: unknown) => e);

      expect(thrown).toBe(originalError);
    });

    it('stream latencyMs measures from call start to stream completion', async () => {
      const chunks = [createMockChunk({ delta: 'data' })];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream(chunks),
      );

      const stream = await provider.sendMessage(createRequest());
      // Add small delay before consuming
      await new Promise((resolve) => setTimeout(resolve, 5));
      await consumeStream(stream);

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('provider:complete contains all context fields', async () => {
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([createMockChunk()]),
      );

      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      const completeEvent = getEmittedEvent(diagnostics, 1);

      expect(completeEvent.providerName).toBe('anthropic');
      expect(completeEvent.model).toBe('claude-sonnet-4-20250514');
      expect(completeEvent.agentType).toBe('implementer');
      expect(completeEvent.projectId).toBe('proj-123');
      expect(completeEvent.engineId).toBe('eng-456');
      expect(completeEvent.taskId).toBe('task-789');
      expect(completeEvent.taskType).toBe('implementation');
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage: inner.sendMessage() throws before stream starts
  // -------------------------------------------------------------------------

  describe('sendMessage - inner throws before stream', () => {
    it('emits provider:error when inner.sendMessage() itself throws', async () => {
      const error = new Error('Provider not initialized');
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.sendMessage(createRequest())).rejects.toThrow(
        'Provider not initialized',
      );

      // provider:call + provider:error
      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.type).toBe('provider:error');
      expect(errorEvent.success).toBe(false);
    });

    it('re-throws the original error', async () => {
      const originalError = new Error('init failed');
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(originalError);

      const thrown = await provider
        .sendMessage(createRequest())
        .catch((e: unknown) => e);

      expect(thrown).toBe(originalError);
    });

    it('error event contains sanitized errorMessage', async () => {
      const error = new Error('key-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH invalid');
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.sendMessage(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorMessage).toContain('[REDACTED]');
    });
  });

  // -------------------------------------------------------------------------
  // Context and security
  // -------------------------------------------------------------------------

  describe('context and security', () => {
    it('all events contain providerName, model, agentType, projectId, engineId, taskId, taskType', async () => {
      await provider.sendMessageSync(createRequest());

      const callEvent = getEmittedEvent(diagnostics, 0);
      const completeEvent = getEmittedEvent(diagnostics, 1);

      for (const event of [callEvent, completeEvent]) {
        expect(event.providerName).toBe('anthropic');
        expect(event.model).toBe('claude-sonnet-4-20250514');
        expect(event.agentType).toBe('implementer');
        expect(event.projectId).toBe('proj-123');
        expect(event.engineId).toBe('eng-456');
        expect(event.taskId).toBe('task-789');
        expect(event.taskType).toBe('implementation');
      }
    });

    it('agentType is typed as AgentType (compile-time verified)', async () => {
      const ctx = createContext({ agentType: 'reviewer' as AgentType });
      const p = new InstrumentedLLMProvider(inner, diagnostics, ctx);

      await p.sendMessageSync(createRequest());

      const callEvent = getEmittedEvent(diagnostics, 0);
      expect(callEvent.agentType).toBe('reviewer');
    });

    it('projectId and engineId are included in all emitted events', async () => {
      const ctx = createContext({
        projectId: 'custom-proj',
        engineId: 'custom-eng',
      });
      const p = new InstrumentedLLMProvider(inner, diagnostics, ctx);

      await p.sendMessageSync(createRequest());

      const callEvent = getEmittedEvent(diagnostics, 0);
      const completeEvent = getEmittedEvent(diagnostics, 1);

      expect(callEvent.projectId).toBe('custom-proj');
      expect(callEvent.engineId).toBe('custom-eng');
      expect(completeEvent.projectId).toBe('custom-proj');
      expect(completeEvent.engineId).toBe('custom-eng');
    });

    it('diagnostics.emit() is called synchronously (not awaited)', async () => {
      const emitSpy = diagnostics.emit as ReturnType<typeof vi.fn>;

      await provider.sendMessageSync(createRequest());

      // Verify emit returns void (synchronous), not a promise
      const returnValue = emitSpy.mock.results[0]!.value;
      expect(returnValue).toBeUndefined();
    });

    it('emitted events do NOT contain MessageRequest content (security boundary)', async () => {
      const sensitiveRequest = createRequest({
        messages: [
          { role: 'system', content: 'You are an assistant with secret instructions.' },
          { role: 'user', content: 'My API key is sk-supersecret123456789012345' },
        ],
      });

      await provider.sendMessageSync(sensitiveRequest);

      const emitSpy = diagnostics.emit as ReturnType<typeof vi.fn>;
      for (const call of emitSpy.mock.calls) {
        const event = call[0] as Record<string, unknown>;
        const eventJson = JSON.stringify(event);

        // Verify no prompt content leaked into the event
        expect(eventJson).not.toContain('You are an assistant');
        expect(eventJson).not.toContain('My API key');
        expect(eventJson).not.toContain('secret instructions');
        expect(eventJson).not.toContain('messages');
        expect(event['request']).toBeUndefined();
        expect(event['messages']).toBeUndefined();
        expect(event['content']).toBeUndefined();
      }
    });

    it('streaming events do NOT contain MessageRequest content', async () => {
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([createMockChunk()]),
      );

      const sensitiveRequest = createRequest({
        messages: [{ role: 'user', content: 'Secret prompt content here' }],
      });

      const stream = await provider.sendMessage(sensitiveRequest);
      await consumeStream(stream);

      const emitSpy = diagnostics.emit as ReturnType<typeof vi.fn>;
      for (const call of emitSpy.mock.calls) {
        const eventJson = JSON.stringify(call[0]);
        expect(eventJson).not.toContain('Secret prompt content');
      }
    });

    it('context fields spread correctly into events', async () => {
      const customContext = createContext({
        providerName: 'openai',
        model: 'gpt-4o',
        agentType: 'architect' as AgentType,
        projectId: 'proj-abc',
        engineId: 'eng-def',
        taskId: 'task-ghi',
        taskType: 'architecture',
      });
      const p = new InstrumentedLLMProvider(inner, diagnostics, customContext);

      await p.sendMessageSync(createRequest());

      const callEvent = getEmittedEvent(diagnostics, 0);
      expect(callEvent.providerName).toBe('openai');
      expect(callEvent.model).toBe('gpt-4o');
      expect(callEvent.agentType).toBe('architect');
      expect(callEvent.projectId).toBe('proj-abc');
      expect(callEvent.engineId).toBe('eng-def');
      expect(callEvent.taskId).toBe('task-ghi');
      expect(callEvent.taskType).toBe('architecture');
    });
  });

  // -------------------------------------------------------------------------
  // Context immutability
  // -------------------------------------------------------------------------

  describe('context immutability', () => {
    it('constructor copies context to prevent external mutation', async () => {
      const mutableContext = createContext();
      const p = new InstrumentedLLMProvider(inner, diagnostics, mutableContext);

      // Mutate original context
      mutableContext.providerName = 'mutated';

      await p.sendMessageSync(createRequest());

      const callEvent = getEmittedEvent(diagnostics, 0);
      expect(callEvent.providerName).toBe('anthropic'); // not mutated
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles error with null code property', async () => {
      const error = Object.assign(new Error('fail'), { code: null });
      (inner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.sendMessageSync(createRequest())).rejects.toThrow();

      const errorEvent = getEmittedEvent(diagnostics, 1);
      expect(errorEvent.errorCode).toBe('UNKNOWN');
    });

    it('handles multiple sequential sendMessageSync calls', async () => {
      await provider.sendMessageSync(createRequest());
      await provider.sendMessageSync(createRequest());
      await provider.sendMessageSync(createRequest());

      // 3 calls * 2 events each = 6 total emit calls
      expect(diagnostics.emit).toHaveBeenCalledTimes(6);
    });

    it('errorCode uses error.code value directly for valid DiagnosticsErrorCode', async () => {
      const validCodes: DiagnosticsErrorCode[] = [
        'RATE_LIMIT_EXCEEDED',
        'QUOTA_EXCEEDED',
        'TIMEOUT',
        'AUTH_FAILED',
        'NETWORK_ERROR',
        'TASK_FAILED',
        'UNKNOWN',
      ];

      for (const code of validCodes) {
        const freshInner = createMockLLMProvider();
        const freshDiag = createMockDiagnosticsQueue();
        const p = new InstrumentedLLMProvider(
          freshInner,
          freshDiag,
          createContext(),
        );

        const error = Object.assign(new Error('test'), { code });
        (freshInner.sendMessageSync as ReturnType<typeof vi.fn>).mockRejectedValue(
          error,
        );

        await expect(p.sendMessageSync(createRequest())).rejects.toThrow();

        const errorEvent = getEmittedEvent(freshDiag, 1);
        expect(errorEvent.errorCode).toBe(code);
      }
    });

    it('handles stream with partial usage in some chunks', async () => {
      const chunks = [
        createMockChunk({ delta: 'chunk1' }), // no usage
        createMockChunk({
          delta: 'chunk2',
          usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
        }),
        createMockChunk({ delta: 'chunk3' }), // no usage -- tokens should remain at last values
        createMockChunk({
          delta: 'chunk4',
          usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        }),
      ];
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream(chunks),
      );

      const stream = await provider.sendMessage(createRequest());
      await consumeStream(stream);

      const completeEvent = getEmittedEvent(diagnostics, 1);
      expect(completeEvent.tokens).toEqual({ input: 50, output: 30 });
    });

    it('forwards options parameter to inner.sendMessage()', async () => {
      (inner.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([]),
      );

      const streamOptions: StreamOptions = {
        onChunk: vi.fn(),
        onError: vi.fn(),
        onComplete: vi.fn(),
      };

      const stream = await provider.sendMessage(createRequest(), streamOptions);
      await consumeStream(stream);

      expect(inner.sendMessage).toHaveBeenCalledWith(
        expect.any(Object),
        streamOptions,
      );
    });
  });
});
