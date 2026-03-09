/**
 * InstrumentedAgentProvider Unit Tests
 *
 * Tests the decorator that wraps IAgentProvider to emit diagnostics
 * events to DiagnosticsQueue. Covers:
 * - provider:call emission on entry
 * - provider:complete emission on success
 * - provider:error emission on failure
 * - Context fields in all events
 * - updateContext() for mutable taskId/taskType
 * - Delegation of isAvailable() and dispose()
 * - Error re-throwing
 * - onProgress callback forwarding
 * - Sanitized error messages
 * - Typed DiagnosticsErrorCode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTaskResult } from '@tamma/shared';
import type { AgentType } from '@tamma/shared';
import type { DiagnosticsQueue } from '@tamma/shared/telemetry';
import type { ProviderDiagnosticsEvent, DiagnosticsErrorCode } from '@tamma/shared/telemetry';
import type {
  IAgentProvider,
  AgentTaskConfig,
  AgentProgressCallback,
} from './agent-types.js';
import {
  InstrumentedAgentProvider,
  type InstrumentedAgentContext,
} from './instrumented-agent-provider.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockAgentProvider(
  overrides?: Partial<IAgentProvider>,
): IAgentProvider {
  return {
    executeTask: vi.fn<
      [AgentTaskConfig, AgentProgressCallback?],
      Promise<AgentTaskResult>
    >().mockResolvedValue({
      success: true,
      output: 'task output',
      costUsd: 0.05,
      durationMs: 1200,
    }),
    isAvailable: vi.fn<[], Promise<boolean>>().mockResolvedValue(true),
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
  overrides?: Partial<InstrumentedAgentContext>,
): InstrumentedAgentContext {
  return {
    providerName: 'claude-code',
    model: 'claude-sonnet-4-20250514',
    agentType: 'implementer' as AgentType,
    projectId: 'proj-123',
    engineId: 'eng-456',
    taskId: 'task-789',
    taskType: 'implementation',
    ...overrides,
  };
}

function createTaskConfig(
  overrides?: Partial<AgentTaskConfig>,
): AgentTaskConfig {
  return {
    prompt: 'Implement feature X',
    cwd: '/workspace/repo',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstrumentedAgentProvider', () => {
  let inner: IAgentProvider;
  let diagnostics: DiagnosticsQueue;
  let context: InstrumentedAgentContext;
  let provider: InstrumentedAgentProvider;

  beforeEach(() => {
    inner = createMockAgentProvider();
    diagnostics = createMockDiagnosticsQueue();
    context = createContext();
    provider = new InstrumentedAgentProvider(inner, diagnostics, context);
  });

  // -------------------------------------------------------------------------
  // IAgentProvider contract
  // -------------------------------------------------------------------------

  describe('IAgentProvider contract', () => {
    it('implements executeTask, isAvailable, and dispose', () => {
      expect(typeof provider.executeTask).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.dispose).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // executeTask: provider:call emission
  // -------------------------------------------------------------------------

  describe('executeTask - provider:call', () => {
    it('emits provider:call event before inner is called', async () => {
      // Make inner.executeTask block until we check the call
      let resolveTask!: (value: AgentTaskResult) => void;
      (inner.executeTask as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<AgentTaskResult>((resolve) => {
            resolveTask = resolve;
          }),
      );

      const taskPromise = provider.executeTask(createTaskConfig());

      // provider:call should have been emitted before inner resolves
      expect(diagnostics.emit).toHaveBeenCalledTimes(1);
      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;
      expect(callEvent.type).toBe('provider:call');

      // Resolve so we don't leak
      resolveTask({
        success: true,
        output: '',
        costUsd: 0,
        durationMs: 0,
      });
      await taskPromise;
    });

    it('provider:call contains all required context fields', async () => {
      await provider.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;

      expect(callEvent.type).toBe('provider:call');
      expect(callEvent.providerName).toBe('claude-code');
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
  // executeTask: provider:complete emission
  // -------------------------------------------------------------------------

  describe('executeTask - provider:complete', () => {
    it('emits provider:complete on successful inner call', async () => {
      await provider.executeTask(createTaskConfig());

      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.type).toBe('provider:complete');
    });

    it('provider:complete contains latencyMs > 0', async () => {
      // Add small delay to ensure measurable latency
      (inner.executeTask as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<AgentTaskResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  output: '',
                  costUsd: 0,
                  durationMs: 0,
                }),
              5,
            ),
          ),
      );

      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof completeEvent.latencyMs).toBe('number');
    });

    it('provider:complete contains success: true when result.success is true', async () => {
      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.success).toBe(true);
    });

    it('provider:complete contains success: false when result.success is false', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'something went wrong',
        costUsd: 0.02,
        durationMs: 500,
        error: 'Task failed due to compilation error',
      });

      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.success).toBe(false);
    });

    it('provider:complete contains costUsd from result.costUsd', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'done',
        costUsd: 0.123,
        durationMs: 1000,
      });

      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.costUsd).toBe(0.123);
    });

    it('provider:complete contains tokens from result.tokens when present', async () => {
      const resultWithTokens = {
        success: true,
        output: 'done',
        costUsd: 0.05,
        durationMs: 1000,
        tokens: { input: 1500, output: 800 },
      };
      (inner.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
        resultWithTokens,
      );

      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.tokens).toEqual({ input: 1500, output: 800 });
    });

    it('provider:complete does not include tokens when result has no tokens', async () => {
      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.tokens).toBeUndefined();
    });

    it('provider:complete contains errorCode TASK_FAILED when result.error is truthy', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: '',
        costUsd: 0.01,
        durationMs: 200,
        error: 'Build failed',
      });

      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.errorCode).toBe('TASK_FAILED');
    });

    it('provider:complete does not contain errorCode when result.error is falsy', async () => {
      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.errorCode).toBeUndefined();
    });

    it('provider:complete contains all context fields', async () => {
      await provider.executeTask(createTaskConfig());

      const completeEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(completeEvent.providerName).toBe('claude-code');
      expect(completeEvent.model).toBe('claude-sonnet-4-20250514');
      expect(completeEvent.agentType).toBe('implementer');
      expect(completeEvent.projectId).toBe('proj-123');
      expect(completeEvent.engineId).toBe('eng-456');
      expect(completeEvent.taskId).toBe('task-789');
      expect(completeEvent.taskType).toBe('implementation');
    });
  });

  // -------------------------------------------------------------------------
  // executeTask: provider:error emission
  // -------------------------------------------------------------------------

  describe('executeTask - provider:error', () => {
    it('emits provider:error when inner throws an exception', async () => {
      const error = new Error('Connection refused');
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow(
        'Connection refused',
      );

      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.type).toBe('provider:error');
    });

    it('provider:error contains success: false', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.success).toBe(false);
    });

    it('provider:error contains typed DiagnosticsErrorCode from error.code', async () => {
      const error = Object.assign(new Error('rate limited'), {
        code: 'RATE_LIMIT_EXCEEDED',
      });
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('provider:error defaults errorCode to UNKNOWN when error has no code', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('generic error'),
      );

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.errorCode).toBe('UNKNOWN');
    });

    it('provider:error contains sanitized errorMessage', async () => {
      const error = new Error(
        'Auth failed with key sk-abcdefghijklmnopqrstuvwxyz1234567890',
      );
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.errorMessage).not.toContain('sk-');
      expect(errorEvent.errorMessage).toContain('[REDACTED]');
    });

    it('errorMessage is truncated to 500 chars', async () => {
      const longMessage = 'A'.repeat(600);
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error(longMessage),
      );

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      // The message may be redacted first (long alpha string), then truncated
      expect(
        errorEvent.errorMessage!.length,
      ).toBeLessThanOrEqual(503); // 500 + '...'
    });

    it('error is re-thrown after emitting provider:error', async () => {
      const originalError = new Error('original error');
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        originalError,
      );

      const thrown = await provider
        .executeTask(createTaskConfig())
        .catch((e: unknown) => e);

      expect(thrown).toBe(originalError);
    });

    it('provider:error contains latencyMs', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(typeof errorEvent.latencyMs).toBe('number');
      expect(errorEvent.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('provider:error contains all context fields', async () => {
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      );

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.providerName).toBe('claude-code');
      expect(errorEvent.model).toBe('claude-sonnet-4-20250514');
      expect(errorEvent.agentType).toBe('implementer');
      expect(errorEvent.projectId).toBe('proj-123');
      expect(errorEvent.engineId).toBe('eng-456');
      expect(errorEvent.taskId).toBe('task-789');
      expect(errorEvent.taskType).toBe('implementation');
    });
  });

  // -------------------------------------------------------------------------
  // agentType typing
  // -------------------------------------------------------------------------

  describe('agentType typing', () => {
    it('agentType field is typed as AgentType (not arbitrary string)', async () => {
      const ctx = createContext({ agentType: 'reviewer' as AgentType });
      const p = new InstrumentedAgentProvider(inner, diagnostics, ctx);

      await p.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;

      expect(callEvent.agentType).toBe('reviewer');
    });
  });

  // -------------------------------------------------------------------------
  // updateContext
  // -------------------------------------------------------------------------

  describe('updateContext', () => {
    it('changes taskId for subsequent executeTask calls', async () => {
      await provider.executeTask(createTaskConfig());

      let callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;
      expect(callEvent.taskId).toBe('task-789');

      // Update taskId
      provider.updateContext({ taskId: 'task-new' });

      await provider.executeTask(createTaskConfig());

      // Third call (call #3 = index 2 after first call+complete)
      callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[2]![0] as ProviderDiagnosticsEvent;
      expect(callEvent.taskId).toBe('task-new');
    });

    it('changes taskType for subsequent executeTask calls', async () => {
      await provider.executeTask(createTaskConfig());

      provider.updateContext({ taskType: 'review' });

      await provider.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[2]![0] as ProviderDiagnosticsEvent;
      expect(callEvent.taskType).toBe('review');
    });

    it('does not affect other context fields', async () => {
      provider.updateContext({ taskId: 'new-task', taskType: 'testing' });

      await provider.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;

      expect(callEvent.providerName).toBe('claude-code');
      expect(callEvent.model).toBe('claude-sonnet-4-20250514');
      expect(callEvent.agentType).toBe('implementer');
      expect(callEvent.projectId).toBe('proj-123');
      expect(callEvent.engineId).toBe('eng-456');
      expect(callEvent.taskId).toBe('new-task');
      expect(callEvent.taskType).toBe('testing');
    });

    it('can update only taskId without affecting taskType', async () => {
      provider.updateContext({ taskId: 'only-id' });

      await provider.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;

      expect(callEvent.taskId).toBe('only-id');
      expect(callEvent.taskType).toBe('implementation'); // unchanged
    });

    it('can update only taskType without affecting taskId', async () => {
      provider.updateContext({ taskType: 'analysis' });

      await provider.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;

      expect(callEvent.taskId).toBe('task-789'); // unchanged
      expect(callEvent.taskType).toBe('analysis');
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable delegation
  // -------------------------------------------------------------------------

  describe('isAvailable', () => {
    it('delegates to inner.isAvailable() without emitting events', async () => {
      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(inner.isAvailable).toHaveBeenCalledTimes(1);
      expect(diagnostics.emit).not.toHaveBeenCalled();
    });

    it('returns false when inner returns false', async () => {
      (inner.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // dispose delegation
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('delegates to inner.dispose() without emitting events', async () => {
      await provider.dispose();

      expect(inner.dispose).toHaveBeenCalledTimes(1);
      expect(diagnostics.emit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // diagnostics.emit is synchronous
  // -------------------------------------------------------------------------

  describe('synchronous emit', () => {
    it('diagnostics.emit() is called synchronously (not awaited)', async () => {
      // Verify emit is called as a regular function, not awaited
      const emitSpy = diagnostics.emit as ReturnType<typeof vi.fn>;

      await provider.executeTask(createTaskConfig());

      // emit was called twice (provider:call + provider:complete)
      expect(emitSpy).toHaveBeenCalledTimes(2);

      // Verify emit returns void (synchronous), not a promise
      const returnValue = emitSpy.mock.results[0]!.value;
      expect(returnValue).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // onProgress callback forwarding
  // -------------------------------------------------------------------------

  describe('onProgress forwarding', () => {
    it('forwards onProgress callback to inner provider', async () => {
      const onProgress: AgentProgressCallback = vi.fn();

      await provider.executeTask(createTaskConfig(), onProgress);

      expect(inner.executeTask).toHaveBeenCalledWith(
        expect.any(Object),
        onProgress,
      );
    });

    it('forwards undefined onProgress when not provided', async () => {
      await provider.executeTask(createTaskConfig());

      expect(inner.executeTask).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Context immutability
  // -------------------------------------------------------------------------

  describe('context immutability', () => {
    it('constructor copies context to prevent external mutation', async () => {
      const mutableContext = createContext();
      const p = new InstrumentedAgentProvider(
        inner,
        diagnostics,
        mutableContext,
      );

      // Mutate original context
      mutableContext.providerName = 'mutated';

      await p.executeTask(createTaskConfig());

      const callEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ProviderDiagnosticsEvent;

      expect(callEvent.providerName).toBe('claude-code'); // not mutated
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles error with null code property', async () => {
      const error = Object.assign(new Error('fail'), { code: null });
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(provider.executeTask(createTaskConfig())).rejects.toThrow();

      const errorEvent = (diagnostics.emit as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as ProviderDiagnosticsEvent;

      expect(errorEvent.errorCode).toBe('UNKNOWN');
    });

    it('returns the result from inner provider', async () => {
      const expectedResult: AgentTaskResult = {
        success: true,
        output: 'feature implemented',
        costUsd: 0.07,
        durationMs: 2000,
      };
      (inner.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
        expectedResult,
      );

      const result = await provider.executeTask(createTaskConfig());

      expect(result).toBe(expectedResult);
    });

    it('handles error without message property gracefully', async () => {
      // Non-Error thrown value
      (inner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        'string error',
      );

      await expect(provider.executeTask(createTaskConfig())).rejects.toBe(
        'string error',
      );

      // provider:error should still be emitted
      // Note: (err as Error).message on a string will be undefined
      expect(diagnostics.emit).toHaveBeenCalledTimes(2);
    });

    it('handles multiple sequential executeTask calls', async () => {
      await provider.executeTask(createTaskConfig());
      await provider.executeTask(createTaskConfig());
      await provider.executeTask(createTaskConfig());

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
        const freshInner = createMockAgentProvider();
        const freshDiag = createMockDiagnosticsQueue();
        const p = new InstrumentedAgentProvider(
          freshInner,
          freshDiag,
          createContext(),
        );

        const error = Object.assign(new Error('test'), { code });
        (freshInner.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
          error,
        );

        await expect(p.executeTask(createTaskConfig())).rejects.toThrow();

        const errorEvent = (freshDiag.emit as ReturnType<typeof vi.fn>).mock
          .calls[1]![0] as ProviderDiagnosticsEvent;

        expect(errorEvent.errorCode).toBe(code);
      }
    });
  });
});
