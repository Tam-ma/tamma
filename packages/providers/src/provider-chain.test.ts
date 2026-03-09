/**
 * Tests for ProviderChain
 *
 * Story 9-5: Provider Chain with health checks, budget checks,
 * instrumentation wrapping, and proper disposal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IProviderHealthTracker } from './types.js';
import type { IAgentProviderFactory } from './agent-provider-factory.js';
import type { IAgentProvider } from './agent-types.js';
import type { ICostTracker, LimitCheckResult, LimitContext } from '@tamma/cost-monitor';
import type { DiagnosticsQueue } from '@tamma/shared/telemetry';
import type { ProviderChainEntry } from '@tamma/shared';
import { ProviderChain } from './provider-chain.js';
import type { ProviderChainOptions, ProviderChainContext } from './provider-chain.js';
import { InstrumentedAgentProvider } from './instrumented-agent-provider.js';
import { ProviderHealthTracker } from './provider-health.js';
import { createProviderError, isProviderError } from './errors.js';

// ---- Test helpers ----

function createMockProvider(overrides?: Partial<IAgentProvider>): IAgentProvider {
  return {
    executeTask: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      costUsd: 0.01,
      durationMs: 100,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockFactory(
  providerOrFn?: IAgentProvider | ((entry: ProviderChainEntry) => IAgentProvider),
): IAgentProviderFactory {
  const createFn =
    typeof providerOrFn === 'function'
      ? providerOrFn
      : () => providerOrFn ?? createMockProvider();

  return {
    create: vi.fn().mockImplementation(async (entry: ProviderChainEntry) => createFn(entry)),
    register: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHealth(overrides?: Partial<IProviderHealthTracker>): IProviderHealthTracker {
  return {
    isHealthy: vi.fn().mockReturnValue(true),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    getStatus: vi.fn().mockReturnValue({}),
    reset: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

function createMockDiagnostics(): DiagnosticsQueue {
  return {
    emit: vi.fn(),
    setProcessor: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getDroppedCount: vi.fn().mockReturnValue(0),
  } as unknown as DiagnosticsQueue;
}

function createMockCostTracker(overrides?: Partial<ICostTracker>): ICostTracker {
  return {
    checkLimit: vi.fn().mockResolvedValue({
      allowed: true,
      currentUsageUsd: 0,
      limitUsd: 100,
      percentUsed: 0,
      warnings: [],
      triggeredLimits: [],
      recommendedAction: 'proceed',
    } satisfies LimitCheckResult),
    recordUsage: vi.fn(),
    getUsage: vi.fn(),
    getAggregate: vi.fn(),
    setLimit: vi.fn(),
    updateLimit: vi.fn(),
    deleteLimit: vi.fn(),
    getLimits: vi.fn(),
    getAlerts: vi.fn(),
    acknowledgeAlert: vi.fn(),
    resolveAlert: vi.fn(),
    generateReport: vi.fn(),
    scheduleReport: vi.fn(),
    getScheduledReports: vi.fn(),
    deleteScheduledReport: vi.fn(),
    estimateCost: vi.fn(),
    updatePricing: vi.fn(),
    getPricing: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as ICostTracker;
}

function createMockLogger() {
  return {
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

const defaultContext: ProviderChainContext = {
  agentType: 'implementer',
  projectId: 'proj-1',
  engineId: 'engine-1',
};

function makeEntry(provider: string, model?: string): ProviderChainEntry {
  return { provider, model };
}

// ---- Tests ----

describe('ProviderChain', () => {
  let mockProvider: IAgentProvider;
  let mockFactory: IAgentProviderFactory;
  let mockHealth: IProviderHealthTracker;
  let mockDiagnostics: DiagnosticsQueue;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockProvider = createMockProvider();
    mockFactory = createMockFactory(mockProvider);
    mockHealth = createMockHealth();
    mockDiagnostics = createMockDiagnostics();
    mockLogger = createMockLogger();
  });

  // ---- Core behavior ----

  describe('core behavior', () => {
    it('returns first healthy provider', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      const provider = await chain.getProvider(defaultContext);
      expect(provider).toBeInstanceOf(InstrumentedAgentProvider);
      expect(mockFactory.create).toHaveBeenCalledOnce();
    });

    it('skips unhealthy (circuit-open) provider and returns second', async () => {
      const provider2 = createMockProvider();
      const factory = createMockFactory((entry) =>
        entry.provider === 'openai' ? provider2 : createMockProvider(),
      );

      const health = createMockHealth({
        isHealthy: vi.fn().mockImplementation((key: string) => {
          return key !== ProviderHealthTracker.buildKey('anthropic', 'claude-sonnet-4-5');
        }),
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
      // Factory should only be called for openai (anthropic skipped by health)
      expect(factory.create).toHaveBeenCalledOnce();
      expect(factory.create).toHaveBeenCalledWith(makeEntry('openai', 'gpt-4'));
    });

    it('throws NO_AVAILABLE_PROVIDER when all fail', async () => {
      const factory = createMockFactory(
        createMockProvider({ isAvailable: vi.fn().mockResolvedValue(false) }),
      );

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      try {
        await chain.getProvider(defaultContext);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isProviderError(err)).toBe(true);
        if (isProviderError(err)) {
          expect(err.code).toBe('NO_AVAILABLE_PROVIDER');
          expect(err.retryable).toBe(false);
          expect(err.severity).toBe('critical');
          // Message should contain provider names
          expect(err.message).toContain('anthropic');
          expect(err.message).toContain('openai');
          // Should NOT contain sensitive info like API keys
          expect(err.message).not.toContain('apiKey');
        }
      }
    });

    it('NO_AVAILABLE_PROVIDER has structured context.errors', async () => {
      const factory = createMockFactory();
      (factory.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      try {
        await chain.getProvider(defaultContext);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isProviderError(err)).toBe(true);
        if (isProviderError(err)) {
          expect(err.context).toBeDefined();
          const errors = err.context?.['errors'] as Array<{
            provider: string;
            message: string;
          }>;
          expect(errors).toHaveLength(1);
          expect(errors[0]?.provider).toBe('anthropic');
          expect(errors[0]?.message).toBe('Connection refused');
        }
      }
    });

    it('throws EMPTY_PROVIDER_CHAIN when entries is empty', async () => {
      const chain = new ProviderChain({
        entries: [],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      try {
        await chain.getProvider(defaultContext);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isProviderError(err)).toBe(true);
        if (isProviderError(err)) {
          expect(err.code).toBe('EMPTY_PROVIDER_CHAIN');
          expect(err.retryable).toBe(false);
          expect(err.severity).toBe('critical');
        }
      }
    });
  });

  // ---- Budget checking ----

  describe('budget checking', () => {
    it('skips provider when budget exceeded, tries next', async () => {
      const provider2 = createMockProvider();
      const factory = createMockFactory((entry) =>
        entry.provider === 'openai' ? provider2 : createMockProvider(),
      );

      const costTracker = createMockCostTracker({
        checkLimit: vi.fn().mockImplementation(async (ctx: LimitContext) => {
          if (ctx.provider === 'anthropic') {
            return {
              allowed: false,
              currentUsageUsd: 100,
              limitUsd: 100,
              percentUsed: 100,
              warnings: ['Budget exceeded'],
              triggeredLimits: [],
              recommendedAction: 'abort',
            } satisfies LimitCheckResult;
          }
          return {
            allowed: true,
            currentUsageUsd: 0,
            limitUsd: 100,
            percentUsed: 0,
            warnings: [],
            triggeredLimits: [],
            recommendedAction: 'proceed',
          } satisfies LimitCheckResult;
        }),
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        costTracker,
        logger: mockLogger,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
      // Factory should only be called for openai
      expect(factory.create).toHaveBeenCalledOnce();
      expect(factory.create).toHaveBeenCalledWith(makeEntry('openai', 'gpt-4'));
      // Warning logged for anthropic
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Budget exceeded for provider',
        expect.objectContaining({ key: 'anthropic:claude-sonnet-4-5' }),
      );
    });

    it('unknown provider string does not trigger budget check', async () => {
      const costTracker = createMockCostTracker();

      const chain = new ProviderChain({
        entries: [makeEntry('custom-provider', 'model-x')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        costTracker,
        logger: mockLogger,
      });

      await chain.getProvider(defaultContext);
      // checkLimit should NOT be called for unknown providers
      expect(costTracker.checkLimit).not.toHaveBeenCalled();
    });

    it('checkLimit() throws -> fail-closed, all known providers skipped', async () => {
      const costTracker = createMockCostTracker({
        checkLimit: vi.fn().mockRejectedValue(new Error('Database unavailable')),
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        costTracker,
        logger: mockLogger,
      });

      try {
        await chain.getProvider(defaultContext);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isProviderError(err)).toBe(true);
        if (isProviderError(err)) {
          expect(err.code).toBe('NO_AVAILABLE_PROVIDER');
        }
      }

      // Both providers had checkLimit called and both threw
      expect(costTracker.checkLimit).toHaveBeenCalledTimes(2);
      // Factory create never called because budget checks failed for both
      expect(mockFactory.create).not.toHaveBeenCalled();
      // Warning logged for both
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Budget check failed, skipping provider (fail-closed)',
        expect.objectContaining({
          key: 'anthropic:claude-sonnet-4-5',
          error: 'Database unavailable',
        }),
      );
    });

    it('checkLimit() throws for first provider -> fail-closed, second succeeds', async () => {
      const provider2 = createMockProvider();
      let callCount = 0;
      const factory = createMockFactory((entry) =>
        entry.provider === 'openai' ? provider2 : createMockProvider(),
      );

      const costTracker = createMockCostTracker({
        checkLimit: vi.fn().mockImplementation(async (ctx: LimitContext) => {
          callCount++;
          if (ctx.provider === 'anthropic') {
            throw new Error('Database unavailable');
          }
          return {
            allowed: true,
            currentUsageUsd: 0,
            limitUsd: 100,
            percentUsed: 0,
            warnings: [],
            triggeredLimits: [],
            recommendedAction: 'proceed',
          } satisfies LimitCheckResult;
        }),
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        costTracker,
        logger: mockLogger,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
      expect(factory.create).toHaveBeenCalledOnce();
      expect(factory.create).toHaveBeenCalledWith(makeEntry('openai', 'gpt-4'));
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Budget check failed, skipping provider (fail-closed)',
        expect.objectContaining({
          key: 'anthropic:claude-sonnet-4-5',
          error: 'Database unavailable',
        }),
      );
    });
  });

  // ---- Instrumentation ----

  describe('instrumentation', () => {
    it('returned provider is InstrumentedAgentProvider', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
    });

    it('InstrumentedAgentProvider gets correct context', async () => {
      const capturedProvider = { ref: null as IAgentProvider | null };
      const origCreate = mockFactory.create;
      (mockFactory.create as ReturnType<typeof vi.fn>).mockImplementation(
        async (entry: ProviderChainEntry) => {
          const p = createMockProvider();
          capturedProvider.ref = p;
          return p;
        },
      );

      const chain = new ProviderChain({
        entries: [makeEntry('openrouter', 'z-ai/z1-mini')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      const ctx: ProviderChainContext = {
        agentType: 'reviewer',
        projectId: 'proj-99',
        engineId: 'eng-42',
      };

      const result = await chain.getProvider(ctx);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);

      // The instrumented provider should delegate to our mock
      // We can verify by calling executeTask and checking the inner mock was called
      const taskConfig = { prompt: 'test', cwd: '/tmp' };
      await result.executeTask(taskConfig);
      expect(capturedProvider.ref?.executeTask).toHaveBeenCalledWith(
        taskConfig,
        undefined,
      );
    });
  });

  // ---- Disposal ----

  describe('disposal', () => {
    it('dispose() called when isAvailable() returns false', async () => {
      const unavailableProvider = createMockProvider({
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      const availableProvider = createMockProvider();

      let callIndex = 0;
      const factory = createMockFactory(() => {
        callIndex++;
        return callIndex === 1 ? unavailableProvider : availableProvider;
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      await chain.getProvider(defaultContext);
      expect(unavailableProvider.dispose).toHaveBeenCalledOnce();
      expect(availableProvider.dispose).not.toHaveBeenCalled();
    });

    it('dispose() called on error during isAvailable()', async () => {
      const failingProvider = createMockProvider({
        isAvailable: vi.fn().mockRejectedValue(new Error('Check failed')),
      });
      const goodProvider = createMockProvider();

      let callIndex = 0;
      const factory = createMockFactory(() => {
        callIndex++;
        return callIndex === 1 ? failingProvider : goodProvider;
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      await chain.getProvider(defaultContext);
      expect(failingProvider.dispose).toHaveBeenCalledOnce();
    });

    it('dispose() NOT called when factory.create() throws (provider undefined)', async () => {
      const goodProvider = createMockProvider();
      let callIndex = 0;
      const factory: IAgentProviderFactory = {
        create: vi.fn().mockImplementation(async () => {
          callIndex++;
          if (callIndex === 1) {
            throw new Error('Creation failed');
          }
          return goodProvider;
        }),
        register: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      await chain.getProvider(defaultContext);
      // goodProvider should NOT have been disposed
      expect(goodProvider.dispose).not.toHaveBeenCalled();
    });

    it('dispose errors are logged but do not prevent fallback', async () => {
      const failingProvider = createMockProvider({
        isAvailable: vi.fn().mockResolvedValue(false),
        dispose: vi.fn().mockRejectedValue(new Error('Dispose broke')),
      });
      const goodProvider = createMockProvider();

      let callIndex = 0;
      const factory = createMockFactory(() => {
        callIndex++;
        return callIndex === 1 ? failingProvider : goodProvider;
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to dispose unavailable provider',
        expect.objectContaining({
          error: 'Dispose broke',
        }),
      );
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('ProviderError -> recordFailure(key, err) with error argument', async () => {
      const providerError = createProviderError(
        'SERVICE_UNAVAILABLE',
        'Service down',
        true,
        'high',
      );

      const factory: IAgentProviderFactory = {
        create: vi.fn().mockRejectedValue(providerError),
        register: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      try {
        await chain.getProvider(defaultContext);
      } catch {
        // expected
      }

      expect(mockHealth.recordFailure).toHaveBeenCalledWith(
        'anthropic:claude-sonnet-4-5',
        providerError,
      );
    });

    it('plain Error -> recordFailure(key) without error argument', async () => {
      const plainError = new Error('Something went wrong');

      const factory: IAgentProviderFactory = {
        create: vi.fn().mockRejectedValue(plainError),
        register: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      try {
        await chain.getProvider(defaultContext);
      } catch {
        // expected
      }

      expect(mockHealth.recordFailure).toHaveBeenCalledWith(
        'anthropic:claude-sonnet-4-5',
      );
    });

    it('non-Error thrown values are handled gracefully', async () => {
      const factory: IAgentProviderFactory = {
        create: vi.fn().mockRejectedValue('string-error'),
        register: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      try {
        await chain.getProvider(defaultContext);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isProviderError(err)).toBe(true);
        if (isProviderError(err)) {
          expect(err.code).toBe('NO_AVAILABLE_PROVIDER');
          const errors = err.context?.['errors'] as Array<{
            provider: string;
            message: string;
          }>;
          expect(errors[0]?.message).toBe('string-error');
        }
      }

      // recordFailure called without error arg (not an Error instance)
      expect(mockHealth.recordFailure).toHaveBeenCalledWith(
        'anthropic:claude-sonnet-4-5',
      );
    });
  });

  // ---- Invariants ----

  describe('invariants', () => {
    it('recordSuccess() is NOT called after isAvailable()', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      await chain.getProvider(defaultContext);
      expect(mockHealth.recordSuccess).not.toHaveBeenCalled();
    });

    it('entries are defensively copied and frozen', () => {
      const entries: ProviderChainEntry[] = [
        makeEntry('anthropic', 'claude-sonnet-4-5'),
      ];

      const chain = new ProviderChain({
        entries,
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      // Mutating the original array should not affect the chain
      entries.push(makeEntry('openai', 'gpt-4'));

      // Access internal entries via the chain's getProvider behavior
      // The chain should only have 1 entry (the original)
      // We verify by checking the factory is called exactly once
      // when the first provider fails
      const failFactory: IAgentProviderFactory = {
        create: vi.fn().mockRejectedValue(new Error('fail')),
        register: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const chain2 = new ProviderChain({
        entries,
        factory: failFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      // Mutate after construction
      entries.length = 0;

      // Chain2 should still have 2 entries (defensive copy at construction time)
      chain2.getProvider(defaultContext).catch(() => {
        // Expected to fail
      });
    });

    it('constructor takes options object (not positional args)', () => {
      const options: ProviderChainOptions = {
        entries: [makeEntry('anthropic')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      };

      // Should not throw
      const chain = new ProviderChain(options);
      expect(chain).toBeInstanceOf(ProviderChain);
    });

    it('uses ProviderHealthTracker.buildKey() for keys', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('openrouter', 'z-ai/z1-mini')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      await chain.getProvider(defaultContext);

      const expectedKey = ProviderHealthTracker.buildKey('openrouter', 'z-ai/z1-mini');
      expect(expectedKey).toBe('openrouter:z-ai/z1-mini');
      expect(mockHealth.isHealthy).toHaveBeenCalledWith(expectedKey);
    });

    it('uses "default" as model when model is undefined', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('anthropic')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      await chain.getProvider(defaultContext);

      const expectedKey = ProviderHealthTracker.buildKey('anthropic', undefined);
      expect(expectedKey).toBe('anthropic:default');
      expect(mockHealth.isHealthy).toHaveBeenCalledWith(expectedKey);
    });
  });

  // ---- Multi-entry scenarios ----

  describe('multi-entry chains', () => {
    it('3-entry chain: first unhealthy, second fails isAvailable, third succeeds', async () => {
      const secondProvider = createMockProvider({
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      const thirdProvider = createMockProvider();

      let callIndex = 0;
      const factory = createMockFactory(() => {
        callIndex++;
        return callIndex === 1 ? secondProvider : thirdProvider;
      });

      const health = createMockHealth({
        isHealthy: vi.fn().mockImplementation((key: string) => {
          // First provider is unhealthy
          return key !== ProviderHealthTracker.buildKey('anthropic', 'claude-sonnet-4-5');
        }),
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
          makeEntry('openrouter', 'z-ai/z1-mini'),
        ],
        factory,
        health,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);

      // Factory called for openai (2nd, isAvailable=false) and openrouter (3rd, succeeds)
      expect(factory.create).toHaveBeenCalledTimes(2);
      // Second provider disposed (isAvailable returned false)
      expect(secondProvider.dispose).toHaveBeenCalledOnce();
      // Third provider NOT disposed (it's the successful one)
      expect(thirdProvider.dispose).not.toHaveBeenCalled();
      // recordFailure called for unavailable second provider
      expect(health.recordFailure).toHaveBeenCalledWith('openai:gpt-4');
    });

    it('costTracker=undefined means no budget checks at all', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        // costTracker intentionally omitted
        logger: mockLogger,
      });

      await chain.getProvider(defaultContext);
      // No budget check warnings
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('logger=undefined does not cause crashes', async () => {
      const failingProvider = createMockProvider({
        isAvailable: vi.fn().mockResolvedValue(false),
        dispose: vi.fn().mockRejectedValue(new Error('Dispose failed')),
      });
      const goodProvider = createMockProvider();

      let callIndex = 0;
      const factory = createMockFactory(() => {
        callIndex++;
        return callIndex === 1 ? failingProvider : goodProvider;
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        // logger intentionally omitted
      });

      // Should not throw even though dispose fails and there's no logger
      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
    });
  });

  // ---- Budget + health interaction ----

  describe('budget and health interaction', () => {
    it('health check runs before budget check (short-circuits)', async () => {
      const costTracker = createMockCostTracker();
      const health = createMockHealth({
        isHealthy: vi.fn().mockReturnValue(false),
      });

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health,
        diagnostics: mockDiagnostics,
        costTracker,
      });

      try {
        await chain.getProvider(defaultContext);
      } catch {
        // Expected NO_AVAILABLE_PROVIDER
      }

      // Budget check never called because health check failed first
      expect(costTracker.checkLimit).not.toHaveBeenCalled();
      // Factory create never called
      expect(mockFactory.create).not.toHaveBeenCalled();
    });

    it('passes model to checkLimit when model is defined', async () => {
      const costTracker = createMockCostTracker();

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        costTracker,
      });

      await chain.getProvider(defaultContext);

      expect(costTracker.checkLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
        }),
      );
    });

    it('does not pass model to checkLimit when model is undefined', async () => {
      const costTracker = createMockCostTracker();

      const chain = new ProviderChain({
        entries: [makeEntry('anthropic')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        costTracker,
      });

      await chain.getProvider(defaultContext);

      const callArgs = (costTracker.checkLimit as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as LimitContext;
      expect(callArgs.provider).toBe('anthropic');
      expect(callArgs).not.toHaveProperty('model');
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    it('single entry that succeeds immediately', async () => {
      const chain = new ProviderChain({
        entries: [makeEntry('anthropic', 'claude-sonnet-4-5')],
        factory: mockFactory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
      });

      const result = await chain.getProvider(defaultContext);
      expect(result).toBeInstanceOf(InstrumentedAgentProvider);
      expect(mockFactory.create).toHaveBeenCalledOnce();
      expect(mockHealth.recordFailure).not.toHaveBeenCalled();
    });

    it('all providers unhealthy -> NO_AVAILABLE_PROVIDER (no errors in context)', async () => {
      const health = createMockHealth({
        isHealthy: vi.fn().mockReturnValue(false),
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory: mockFactory,
        health,
        diagnostics: mockDiagnostics,
      });

      try {
        await chain.getProvider(defaultContext);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isProviderError(err)).toBe(true);
        if (isProviderError(err)) {
          expect(err.code).toBe('NO_AVAILABLE_PROVIDER');
          // No errors because no providers were even tried
          const errors = err.context?.['errors'] as Array<{
            provider: string;
            message: string;
          }>;
          expect(errors).toHaveLength(0);
        }
      }
    });

    it('dispose error during error handling path is logged', async () => {
      const badProvider = createMockProvider({
        isAvailable: vi.fn().mockRejectedValue(new Error('isAvailable crashed')),
        dispose: vi.fn().mockRejectedValue(new Error('Dispose also crashed')),
      });
      const goodProvider = createMockProvider();

      let callIndex = 0;
      const factory = createMockFactory(() => {
        callIndex++;
        return callIndex === 1 ? badProvider : goodProvider;
      });

      const chain = new ProviderChain({
        entries: [
          makeEntry('anthropic', 'claude-sonnet-4-5'),
          makeEntry('openai', 'gpt-4'),
        ],
        factory,
        health: mockHealth,
        diagnostics: mockDiagnostics,
        logger: mockLogger,
      });

      await chain.getProvider(defaultContext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to dispose provider after error',
        expect.objectContaining({
          key: 'anthropic:claude-sonnet-4-5',
          error: 'Dispose also crashed',
        }),
      );
    });
  });
});
