/**
 * Provider Chain - Ordered provider fallback with health, budget, and instrumentation.
 *
 * Given a list of ProviderChainEntry objects (from configuration), iterates
 * in order and returns the first available provider wrapped with diagnostics
 * instrumentation. Providers are skipped if:
 *
 * 1. Circuit is open (provider health tracker says unhealthy)
 * 2. Budget is exceeded (cost tracker says not allowed)
 * 3. Budget check throws (fail-closed -- treated as exceeded)
 * 4. Factory creation fails
 * 5. isAvailable() returns false
 *
 * The returned provider is always an InstrumentedAgentProvider decorator,
 * ensuring every task execution emits diagnostics events.
 *
 * Story 9-5: Provider Chain
 */

import type { AgentType } from '@tamma/shared';
import type { ProviderChainEntry } from '@tamma/shared';
import type { ICostTracker, Provider, LimitContext } from '@tamma/cost-monitor';
import type { IProviderHealthTracker } from './types.js';
import type { IAgentProviderFactory } from './agent-provider-factory.js';
import type { IAgentProvider } from './agent-types.js';
import type { DiagnosticsQueue } from '@tamma/shared/telemetry';
import { ProviderHealthTracker } from './provider-health.js';
import { InstrumentedAgentProvider } from './instrumented-agent-provider.js';
import { createProviderError, isProviderError } from './errors.js';

// ---- Module-level constants ----

/**
 * Set of known provider names that match the cost-monitor Provider type.
 * Only providers in this set will have budget checks via ICostTracker.checkLimit().
 * Unknown provider strings (e.g. custom/third-party) skip budget checks entirely.
 */
const KNOWN_PROVIDERS = new Set<string>([
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'local',
  'claude-code',
  'opencode',
  'z-ai',
  'zen-mcp',
]);

// ---- Interfaces ----

/**
 * Context passed to getProvider() to identify the calling agent and project.
 */
export interface ProviderChainContext {
  agentType: AgentType;
  projectId: string;
  engineId: string;
}

/**
 * Interface for the provider chain.
 * Decouples consumers from the concrete ProviderChain class.
 */
export interface IProviderChain {
  /**
   * Get the first available provider from the chain, wrapped with instrumentation.
   * Throws EMPTY_PROVIDER_CHAIN if the chain has no entries.
   * Throws NO_AVAILABLE_PROVIDER if all entries are exhausted.
   */
  getProvider(context: ProviderChainContext): Promise<IAgentProvider>;
}

/**
 * Options for constructing a ProviderChain.
 */
export interface ProviderChainOptions {
  /** Ordered provider entries (first = primary, rest = fallbacks) */
  entries: readonly ProviderChainEntry[];
  /** Factory to create IAgentProvider instances from chain entries */
  factory: IAgentProviderFactory;
  /** Health tracker for circuit breaker per provider+model */
  health: IProviderHealthTracker;
  /** Diagnostics queue for instrumentation events */
  diagnostics: DiagnosticsQueue;
  /** Optional cost tracker for budget enforcement */
  costTracker?: ICostTracker;
  /** Optional logger for warnings and debug messages */
  logger?: {
    warn(msg: string, ctx?: Record<string, unknown>): void;
    debug?(msg: string, ctx?: Record<string, unknown>): void;
  };
}

// ---- ProviderChain implementation ----

/**
 * Ordered provider fallback chain.
 *
 * Iterates entries in order, skipping unhealthy and over-budget providers,
 * and returns the first successfully created and available provider wrapped
 * with InstrumentedAgentProvider for diagnostics.
 */
export class ProviderChain implements IProviderChain {
  private readonly entries: readonly ProviderChainEntry[];
  private readonly factory: IAgentProviderFactory;
  private readonly health: IProviderHealthTracker;
  private readonly diagnostics: DiagnosticsQueue;
  private readonly costTracker: ICostTracker | undefined;
  private readonly logger:
    | {
        warn(msg: string, ctx?: Record<string, unknown>): void;
        debug?(msg: string, ctx?: Record<string, unknown>): void;
      }
    | undefined;

  constructor(options: ProviderChainOptions) {
    // Defensive copy and freeze to prevent external mutation of the entries array
    this.entries = Object.freeze([...options.entries]);
    this.factory = options.factory;
    this.health = options.health;
    this.diagnostics = options.diagnostics;
    if (options.costTracker !== undefined) {
      this.costTracker = options.costTracker;
    }
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
  }

  /**
   * Get the first available provider from the chain.
   *
   * Steps per entry:
   * 1. Health check (circuit breaker)
   * 2. Budget check (if costTracker present and provider is known)
   * 3. Factory create + isAvailable check
   * 4. Wrap with InstrumentedAgentProvider
   *
   * On failure, records error in health tracker and tries next entry.
   */
  async getProvider(context: ProviderChainContext): Promise<IAgentProvider> {
    if (this.entries.length === 0) {
      throw createProviderError(
        'EMPTY_PROVIDER_CHAIN',
        'Provider chain is empty',
        false,
        'critical',
      );
    }

    const errors: Array<{ provider: string; message: string }> = [];

    for (const entry of this.entries) {
      const key = ProviderHealthTracker.buildKey(entry.provider, entry.model);

      // 1. Health check -- skip circuit-open providers
      if (!this.health.isHealthy(key)) {
        this.logger?.debug?.('Skipping unhealthy provider', { key });
        continue;
      }

      // 2. Budget check (fail-closed: if check throws, skip provider)
      if (this.costTracker !== undefined && KNOWN_PROVIDERS.has(entry.provider)) {
        try {
          const limitCtx: LimitContext = {
            provider: entry.provider as Provider,
          };
          if (entry.model !== undefined) {
            limitCtx.model = entry.model;
          }
          const limit = await this.costTracker.checkLimit(limitCtx);
          if (!limit.allowed) {
            this.logger?.warn('Budget exceeded for provider', {
              key,
              percentUsed: limit.percentUsed,
            });
            continue;
          }
        } catch (budgetErr) {
          // Fail-closed: treat budget check failures as "exceeded"
          this.logger?.warn('Budget check failed, skipping provider (fail-closed)', {
            key,
            error: budgetErr instanceof Error ? budgetErr.message : String(budgetErr),
          });
          continue;
        }
      }

      // 3. Create provider + check availability
      let provider: IAgentProvider | undefined;
      try {
        provider = await this.factory.create(entry);

        const available = await provider.isAvailable();
        if (!available) {
          // Dispose the unavailable provider (log but don't throw on dispose error)
          await provider.dispose().catch((disposeErr: unknown) => {
            this.logger?.warn('Failed to dispose unavailable provider', {
              key,
              error: disposeErr instanceof Error ? disposeErr.message : String(disposeErr),
            });
          });
          this.health.recordFailure(key);
          continue;
        }

        // 4. Wrap with instrumentation and return
        return new InstrumentedAgentProvider(provider, this.diagnostics, {
          providerName: entry.provider,
          model: entry.model ?? 'default',
          agentType: context.agentType,
          projectId: context.projectId,
          engineId: context.engineId,
          // taskId and taskType are not known at chain resolution time.
          // The caller uses updateContext() before executeTask().
          taskId: '',
          taskType: '',
        });
      } catch (err) {
        // Dispose the provider if it was created (factory.create succeeded
        // but isAvailable or something else threw)
        if (provider !== undefined) {
          await provider.dispose().catch((disposeErr: unknown) => {
            this.logger?.warn('Failed to dispose provider after error', {
              key,
              error: disposeErr instanceof Error ? disposeErr.message : String(disposeErr),
            });
          });
        }

        // Record failure -- pass the error if it's a ProviderError
        if (isProviderError(err)) {
          this.health.recordFailure(key, err);
        } else {
          this.health.recordFailure(key);
        }

        errors.push({
          provider: entry.provider,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // All providers exhausted
    throw createProviderError(
      'NO_AVAILABLE_PROVIDER',
      `All ${this.entries.length} providers exhausted. Tried: ${this.entries.map(e => e.provider).join(', ')}`,
      false,
      'critical',
      { errors },
    );
  }
}
