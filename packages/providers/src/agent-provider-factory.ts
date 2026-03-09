import type { AgentTaskResult } from '@tamma/shared';
import type { ILogger } from '@tamma/shared';
import type {
  IAIProvider,
  MessageRequest,
  MessageResponse,
  ProviderConfig,
} from './types.js';
import type {
  IAgentProvider,
  AgentTaskConfig,
  AgentProgressCallback,
} from './agent-types.js';
import { ClaudeAgentProvider } from './claude-agent-provider.js';
import { OpenCodeProvider } from './opencode-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import { ZenMCPProvider } from './zen-mcp-provider.js';

// ---- Local type for ProviderChainEntry ----
// Story 9-1 defines this in @tamma/shared/src/types/agent-config.ts.
// Until that story is implemented, we define a local interface that matches.

/**
 * A single entry in a provider chain. Describes which provider to try,
 * which model to use, and how to locate the API key.
 *
 * `apiKeyRef` is an environment variable name (NOT a raw API key).
 * Resolved at runtime via `process.env[apiKeyRef]`.
 */
export interface ProviderChainEntry {
  /** Provider name, e.g. 'claude-code', 'openrouter', 'zen-mcp' */
  provider: string;
  /** Model identifier, e.g. 'claude-sonnet-4-5', 'z-ai/z1-mini' */
  model?: string;
  /** Environment variable name containing the API key */
  apiKeyRef?: string;
  /** Provider-specific configuration (baseUrl, timeout, etc.) */
  config?: Record<string, unknown>;
}

// ---- Constants ----

/**
 * Built-in provider name constants.
 * Avoids string literal duplication across the codebase.
 */
export const BUILTIN_PROVIDER_NAMES = Object.freeze({
  CLAUDE_CODE: 'claude-code',
  OPENCODE: 'opencode',
  OPENROUTER: 'openrouter',
  ZEN_MCP: 'zen-mcp',
} as const);

/** Regex for valid provider names (same as Story 9-1 config validation). */
const PROVIDER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Names that must be rejected to prevent prototype pollution. */
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/** Regex for valid apiKeyRef values -- only alphanumeric + underscore. */
const API_KEY_REF_PATTERN = /^[A-Za-z0-9_]+$/;

// ---- IAgentProviderFactory interface ----

/**
 * Interface for the agent provider factory.
 * ProviderChain (Story 9-5) depends on this interface, not the concrete class.
 */
export interface IAgentProviderFactory {
  create(entry: ProviderChainEntry): Promise<IAgentProvider>;
  register(name: string, creator: () => IAgentProvider | IAIProvider): void;
  dispose(): Promise<void>;
}

// ---- resolveApiKey ----

/**
 * Resolve the API key from the environment using entry.apiKeyRef.
 *
 * - If apiKeyRef is undefined, returns '' (some providers like claude-code
 *   don't need API keys -- they manage their own auth).
 * - Validates apiKeyRef format (alphanumeric + underscore only).
 * - Looks up process.env[apiKeyRef] and throws if the env var is missing.
 *
 * SECURITY: Never log the resolved API key value.
 */
export function resolveApiKey(entry: ProviderChainEntry): string {
  if (entry.apiKeyRef === undefined) return '';

  if (!API_KEY_REF_PATTERN.test(entry.apiKeyRef)) {
    throw new Error(
      `Invalid apiKeyRef format "${entry.apiKeyRef}" for provider "${entry.provider}": only alphanumeric and underscore characters are allowed`,
    );
  }

  const value = process.env[entry.apiKeyRef];
  if (value === undefined) {
    throw new Error(
      `Environment variable "${entry.apiKeyRef}" is not set for provider "${entry.provider}"`,
    );
  }

  return value;
}

// ---- wrapAsAgent ----

/**
 * Wrap an IAIProvider as IAgentProvider.
 *
 * Converts sendMessageSync() into executeTask():
 * 1. Builds a MessageRequest from the prompt string
 * 2. Calls sendMessageSync() to get a MessageResponse
 * 3. Maps MessageResponse to AgentTaskResult, extracting tokens/cost from usage
 *
 * LIMITATIONS: wrapAsAgent() provides a simple prompt-to-response mapping.
 * It does NOT support:
 * - Tool-use loops (multi-turn tool calling)
 * - File tracking (which files were read/written)
 * - Exit code semantics
 * - Streaming progress callbacks
 * These capabilities are only available through native agent providers
 * (claude-code, opencode) that implement IAgentProvider directly.
 */
export function wrapAsAgent(llm: IAIProvider, model: string): IAgentProvider {
  return {
    async executeTask(
      config: AgentTaskConfig,
      _onProgress?: AgentProgressCallback,
    ): Promise<AgentTaskResult> {
      const start = Date.now();

      // Use config.model if provided (task-level override), otherwise fall back
      // to the model from the closure (chain entry level).
      const request: MessageRequest = {
        messages: [{ role: 'user', content: config.prompt }],
        model: config.model ?? model,
      };

      try {
        const response: MessageResponse = await llm.sendMessageSync(request);

        const isSuccess = response.finishReason === 'end_turn'
          || response.finishReason === 'stop'
          || response.finishReason === 'tool_use'
          || response.finishReason === 'tool_calls'
          || response.finishReason === 'length';
        return {
          success: isSuccess,
          output: response.content,
          costUsd: 0, // Actual cost computed by cost-monitor from token counts
          durationMs: Date.now() - start,
          ...(isSuccess ? {} : { error: `Unexpected finish reason: ${response.finishReason}` }),
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          costUsd: 0,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    /**
     * isAvailable() always returns true for wrapped LLM providers.
     *
     * TRADE-OFF: IAIProvider does NOT have an isAvailable() method, so
     * there is nothing to delegate to. We assume available if initialize()
     * succeeded (which already ran before wrapping). If the provider is
     * actually down, executeTask() will throw when calling sendMessageSync(),
     * and ProviderChain handles the fallback. This means connectivity is
     * only validated lazily (on first task), not eagerly.
     */
    async isAvailable(): Promise<boolean> {
      return true;
    },

    async dispose(): Promise<void> {
      return llm.dispose();
    },
  };
}

// ---- AgentProviderFactory ----

/**
 * AgentProviderFactory creates IAgentProvider instances by name.
 *
 * THREAD-SAFETY NOTE: This class is NOT thread-safe. It should be
 * instantiated once per process and not shared across worker threads.
 * Each worker thread should create its own factory instance.
 */
export class AgentProviderFactory implements IAgentProviderFactory {
  private creators = new Map<string, () => IAgentProvider | IAIProvider>();
  private locked = false;

  constructor(private readonly logger?: ILogger) {
    // CLI agent providers -- already implement IAgentProvider
    this.register(BUILTIN_PROVIDER_NAMES.CLAUDE_CODE, () => new ClaudeAgentProvider());
    this.register(BUILTIN_PROVIDER_NAMES.OPENCODE, () => new OpenCodeProvider());
    // LLM providers -- implement IAIProvider, will be wrapped
    this.register(BUILTIN_PROVIDER_NAMES.OPENROUTER, () => new OpenRouterProvider());
    this.register(BUILTIN_PROVIDER_NAMES.ZEN_MCP, () => new ZenMCPProvider());

    // Lock after registering built-ins so they cannot be overridden
    this.lock();
  }

  /**
   * Lock the factory. After locking, register() will throw if trying
   * to override an existing provider (but can still register new ones).
   */
  private lock(): void {
    this.locked = true;
  }

  /**
   * Register a provider creator function.
   *
   * Provider name must match /^[a-z0-9][a-z0-9_-]{0,63}$/ (same as Story 9-1).
   * Rejects '__proto__', 'constructor', 'prototype' to prevent prototype pollution.
   * When locked, throws if trying to override an existing provider.
   */
  register(name: string, creator: () => IAgentProvider | IAIProvider): void {
    if (FORBIDDEN_NAMES.has(name)) {
      throw new Error(`Forbidden provider name: "${name}"`);
    }
    if (!PROVIDER_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid provider name "${name}": must match ${PROVIDER_NAME_PATTERN}`,
      );
    }
    if (this.locked && this.creators.has(name)) {
      throw new Error(
        `Cannot override locked built-in provider "${name}". Register with a different name.`,
      );
    }

    this.creators.set(name, creator);
    this.logger?.info('Provider registered', { provider: name });
  }

  /**
   * Create a provider by name. ALWAYS returns IAgentProvider.
   * LLM providers are eagerly wrapped via wrapAsAgent().
   */
  async create(entry: ProviderChainEntry): Promise<IAgentProvider> {
    const creator = this.creators.get(entry.provider);
    if (!creator) throw new Error(`Unknown provider: ${entry.provider}`);

    this.logger?.info('Creating provider', { provider: entry.provider, model: entry.model });

    const provider = creator();

    // Resolve API key from environment via apiKeyRef.
    // Returns '' if apiKeyRef is undefined (e.g., claude-code manages its own auth).
    const resolvedKey = resolveApiKey(entry);

    // Initialize if the provider supports it.
    //
    // NOTE on specific providers:
    //
    // ClaudeAgentProvider.initialize() is a no-op. It ignores the apiKey
    // from the chain entry because the Claude CLI reads credentials from
    // its own config store (Claude subscription auth). This is by design.
    //
    // OpenCodeProvider.initialize() eagerly creates an SDK client via
    // dynamic import of @opencode-ai/sdk. It will throw if OpenCode is
    // not running locally. This error is caught by ProviderChain, which
    // records the failure and tries the next entry.
    if ('initialize' in provider && typeof provider.initialize === 'function') {
      try {
        // Spread order: entry.config first, then explicit fields override.
        // This ensures apiKey and model cannot be accidentally overridden by user config.
        await (provider as IAIProvider).initialize({
          ...entry.config,
          apiKey: resolvedKey,
          ...(entry.model !== undefined ? { model: entry.model } : {}),
        } as ProviderConfig);
        this.logger?.info('Provider initialized successfully', { provider: entry.provider });
      } catch (err) {
        // Sanitize error messages to strip potentially sensitive content
        // (API keys, file paths) before propagating.
        const sanitizedMessage = err instanceof Error ? err.message : String(err);
        this.logger?.error('Provider initialization failed', {
          provider: entry.provider,
          error: sanitizedMessage,
        });
        throw new Error(
          `Provider "${entry.provider}" failed to initialize: ${sanitizedMessage}`,
        );
      }
    }

    // If this is an LLM provider (has sendMessageSync), wrap it.
    //
    // DUCK-TYPING RATIONALE: We use `'sendMessageSync' in provider` to detect
    // LLM providers rather than `instanceof` checks or a type discriminant field.
    // Trade-offs:
    // - Pro: More resilient to module boundary issues (different package versions)
    // - Pro: Works correctly with mocked providers in tests
    // - Pro: No need for providers to set a discriminant field
    // - Con: Could false-positive if an IAgentProvider happened to have a
    //   `sendMessageSync` property (unlikely in practice)
    // - Con: Not statically verifiable by TypeScript's type system
    if ('sendMessageSync' in provider) {
      return wrapAsAgent(provider as IAIProvider, entry.model ?? 'default');
    }

    return provider as IAgentProvider;
  }

  /**
   * Dispose of the factory by clearing the creators map.
   *
   * NOTE: The factory is a stateless creator -- it does not track provider
   * instances. Instance lifecycle (dispose) is the caller's responsibility.
   * This method only clears the internal registration map.
   */
  async dispose(): Promise<void> {
    this.creators.clear();
    this.logger?.info('AgentProviderFactory disposed');
  }
}
