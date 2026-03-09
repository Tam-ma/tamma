/**
 * Role-Based Agent Resolver
 *
 * Top-level resolver that the engine uses to get configured agent providers
 * for workflow phases. Maps workflow phases to agent roles, resolves provider
 * chains per role, applies security wrapping, config merging, and prompt
 * rendering.
 *
 * Security features:
 * - FORBIDDEN_KEYS prototype pollution guard
 * - Template injection prevention (strips {{ }})
 * - Budget clamping (task overrides cannot exceed ceiling)
 * - Permission clamping (bypassPermissions requires env var)
 * - Tool clamping (allowedTools intersection only)
 *
 * Story 9-8: Role-Based Agent Resolver
 */

import type {
  AgentType,
  AgentsConfig,
  WorkflowPhase,
  IContentSanitizer,
  ILogger,
} from '@tamma/shared';
import { DEFAULT_PHASE_ROLE_MAP } from '@tamma/shared';
import type { ICostTracker } from '@tamma/cost-monitor';
import type { DiagnosticsQueue } from '@tamma/shared/telemetry';
import type { IProviderHealthTracker } from './types.js';
import type { IAgentProviderFactory } from './agent-provider-factory.js';
import type { IAgentProvider, AgentTaskConfig } from './agent-types.js';
import type { IAgentPromptRegistry } from './agent-prompt-registry.js';
import { ProviderChain } from './provider-chain.js';
import type { IProviderChain } from './provider-chain.js';
import { SecureAgentProvider } from './secure-agent-provider.js';
import { createProviderError } from './errors.js';

// ---- Constants ----

/**
 * Keys that must be rejected to prevent prototype pollution attacks
 * in role name lookups and phase-to-role mappings.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---- Interfaces ----

/**
 * Logger interface for RoleBasedAgentResolver.
 * Kept minimal to avoid coupling to a specific logging framework.
 */
export interface RoleBasedAgentResolverLogger {
  warn(msg: string, ctx?: Record<string, unknown>): void;
  debug?(msg: string, ctx?: Record<string, unknown>): void;
  info?(msg: string, ctx?: Record<string, unknown>): void;
  error?(msg: string, ctx?: Record<string, unknown>): void;
}

/**
 * Options for constructing a RoleBasedAgentResolver.
 */
export interface RoleBasedAgentResolverOptions {
  /** Multi-agent configuration (roles, defaults, phaseRoleMap) */
  config: AgentsConfig;
  /** Factory to create IAgentProvider instances from chain entries */
  factory: IAgentProviderFactory;
  /** Health tracker for circuit breaker per provider+model */
  health: IProviderHealthTracker;
  /** Prompt registry for template resolution and rendering */
  promptRegistry: IAgentPromptRegistry;
  /** Diagnostics queue for instrumentation events */
  diagnostics: DiagnosticsQueue;
  /** Optional cost tracker for budget enforcement */
  costTracker?: ICostTracker;
  /** Optional content sanitizer for secure wrapping */
  sanitizer?: IContentSanitizer;
  /** Optional logger */
  logger?: RoleBasedAgentResolverLogger;
}

/**
 * Interface for the role-based agent resolver.
 * Decouples consumers (engine) from the concrete implementation.
 */
export interface IRoleBasedAgentResolver {
  /**
   * Get an agent provider for a workflow phase.
   * Maps phase to role, then delegates to getAgentForRole.
   */
  getAgentForPhase(
    phase: WorkflowPhase,
    context: { projectId: string; engineId: string },
  ): Promise<IAgentProvider>;

  /**
   * Get an agent provider for a specific agent role.
   * Resolves the provider chain, gets the first available provider,
   * and optionally wraps with SecureAgentProvider.
   */
  getAgentForRole(
    role: AgentType,
    context: { projectId: string; engineId: string },
  ): Promise<IAgentProvider>;

  /**
   * Get merged task configuration for a role with optional overrides.
   * Applies 3-level merge (defaults < role < overrides) with clamping.
   */
  getTaskConfig(
    role: AgentType,
    taskOverrides?: Partial<AgentTaskConfig>,
  ): Partial<AgentTaskConfig>;

  /**
   * Get a rendered prompt for a role and provider.
   * Sanitizes variable values to prevent template injection.
   */
  getPrompt(
    role: AgentType,
    providerName: string,
    vars?: Record<string, string>,
  ): string;

  /**
   * Get the agent role mapped to a workflow phase.
   * Synchronous lookup via config.phaseRoleMap then DEFAULT_PHASE_ROLE_MAP.
   */
  getRoleForPhase(phase: WorkflowPhase): AgentType;

  /**
   * Dispose of all cached provider chains.
   */
  dispose(): Promise<void>;
}

// ---- Implementation ----

/**
 * RoleBasedAgentResolver resolves configured agent providers for workflow phases.
 *
 * Caches ProviderChain instances per role to avoid repeated construction.
 * When a sanitizer is provided, all returned providers are wrapped with
 * SecureAgentProvider for defense-in-depth content sanitization.
 */
export class RoleBasedAgentResolver implements IRoleBasedAgentResolver {
  private readonly config: AgentsConfig;
  private readonly factory: IAgentProviderFactory;
  private readonly health: IProviderHealthTracker;
  private readonly promptRegistry: IAgentPromptRegistry;
  private readonly diagnostics: DiagnosticsQueue;
  private readonly costTracker: ICostTracker | undefined;
  private readonly sanitizer: IContentSanitizer | undefined;
  private readonly logger: RoleBasedAgentResolverLogger | undefined;

  /** Cached provider chains per agent role */
  private readonly chains = new Map<string, IProviderChain>();

  constructor(options: RoleBasedAgentResolverOptions) {
    // Validate that defaults.providerChain is non-empty
    if (options.config.defaults.providerChain.length === 0) {
      throw createProviderError(
        'EMPTY_PROVIDER_CHAIN',
        'defaults.providerChain must not be empty',
        false,
        'critical',
      );
    }

    this.config = options.config;
    this.factory = options.factory;
    this.health = options.health;
    this.promptRegistry = options.promptRegistry;
    this.diagnostics = options.diagnostics;
    if (options.costTracker !== undefined) {
      this.costTracker = options.costTracker;
    }
    if (options.sanitizer !== undefined) {
      this.sanitizer = options.sanitizer;
    }
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
  }

  /**
   * Map a workflow phase to an agent role and get the provider.
   *
   * Resolution order:
   * 1. config.phaseRoleMap?.[phase] (user override)
   * 2. DEFAULT_PHASE_ROLE_MAP[phase] (built-in default)
   */
  async getAgentForPhase(
    phase: WorkflowPhase,
    context: { projectId: string; engineId: string },
  ): Promise<IAgentProvider> {
    const role = this.getRoleForPhase(phase);
    return this.getAgentForRole(role, context);
  }

  /**
   * Get an agent provider for a specific role.
   *
   * Validates the role name against FORBIDDEN_KEYS, resolves or creates
   * the provider chain, gets the first available provider, and wraps
   * with SecureAgentProvider if a sanitizer is configured.
   */
  async getAgentForRole(
    role: AgentType,
    context: { projectId: string; engineId: string },
  ): Promise<IAgentProvider> {
    if (FORBIDDEN_KEYS.has(role)) {
      throw createProviderError(
        'INVALID_ROLE',
        `Forbidden role name: "${role}"`,
        false,
        'critical',
      );
    }

    const chain = this._getOrCreateChain(role);
    const provider = await chain.getProvider({
      agentType: role,
      projectId: context.projectId,
      engineId: context.engineId,
    });

    if (this.sanitizer) {
      // SecureAgentProvider accepts ILogger which requires all 4 methods.
      // Our logger may only have warn(). Cast is safe because
      // SecureAgentProvider only uses logger?.warn() internally.
      const loggerForSecure = this.logger as ILogger | undefined;
      return new SecureAgentProvider(provider, this.sanitizer, loggerForSecure);
    }

    this.logger?.warn('No content sanitizer configured', { role });
    return provider;
  }

  /**
   * Get merged task configuration for a role.
   *
   * 3-level merge with clamping:
   * 1. Base: defaults (allowedTools, maxBudgetUsd, permissionMode)
   * 2. Role: roles[role] overrides (undefined fields don't clobber)
   * 3. Task: taskOverrides with clamping:
   *    - maxBudgetUsd: Math.min(override, ceiling)
   *    - bypassPermissions: requires TAMMA_ALLOW_BYPASS_PERMISSIONS=true
   *    - allowedTools: intersection only (can restrict, never expand)
   */
  getTaskConfig(
    role: AgentType,
    taskOverrides?: Partial<AgentTaskConfig>,
  ): Partial<AgentTaskConfig> {
    if (FORBIDDEN_KEYS.has(role)) {
      throw createProviderError(
        'INVALID_ROLE',
        `Forbidden role name: "${role}"`,
        false,
        'critical',
      );
    }

    // Level 1: Defaults
    const result: Partial<AgentTaskConfig> = {};

    if (this.config.defaults.allowedTools !== undefined) {
      result.allowedTools = [...this.config.defaults.allowedTools];
    }
    if (this.config.defaults.maxBudgetUsd !== undefined) {
      result.maxBudgetUsd = this.config.defaults.maxBudgetUsd;
    }
    if (this.config.defaults.permissionMode !== undefined) {
      result.permissionMode = this.config.defaults.permissionMode;
    }

    // Level 2: Role-specific overrides (undefined fields don't clobber)
    const roleConfig = this.config.roles?.[role];
    if (roleConfig !== undefined) {
      if (roleConfig.allowedTools !== undefined) {
        result.allowedTools = [...roleConfig.allowedTools];
      }
      if (roleConfig.maxBudgetUsd !== undefined) {
        result.maxBudgetUsd = roleConfig.maxBudgetUsd;
      }
      if (roleConfig.permissionMode !== undefined) {
        result.permissionMode = roleConfig.permissionMode;
      }
    }

    // Level 3: Task overrides with clamping
    if (taskOverrides !== undefined) {
      // Budget clamping: can't exceed ceiling from defaults/role
      if (taskOverrides.maxBudgetUsd !== undefined) {
        const ceiling = result.maxBudgetUsd;
        if (ceiling !== undefined) {
          result.maxBudgetUsd = Math.min(taskOverrides.maxBudgetUsd, ceiling);
        } else {
          result.maxBudgetUsd = taskOverrides.maxBudgetUsd;
        }
      }

      // Permission clamping: bypassPermissions requires env var
      if (taskOverrides.permissionMode !== undefined) {
        if (taskOverrides.permissionMode === 'bypassPermissions') {
          const envAllow = process.env['TAMMA_ALLOW_BYPASS_PERMISSIONS'];
          if (envAllow === 'true') {
            result.permissionMode = 'bypassPermissions';
          } else {
            this.logger?.warn(
              'bypassPermissions denied: TAMMA_ALLOW_BYPASS_PERMISSIONS is not set to "true"',
              { role },
            );
            // Keep current permissionMode (do not override)
          }
        } else {
          result.permissionMode = taskOverrides.permissionMode;
        }
      }

      // Tool clamping: intersection only (restrict, never expand)
      if (taskOverrides.allowedTools !== undefined) {
        const currentTools = result.allowedTools;
        if (currentTools !== undefined && currentTools.length > 0) {
          const currentSet = new Set(currentTools);
          result.allowedTools = taskOverrides.allowedTools.filter(t =>
            currentSet.has(t),
          );
        } else {
          // No current tools restriction — use the override
          result.allowedTools = [...taskOverrides.allowedTools];
        }
      }

      // Forward other non-clamped fields from taskOverrides
      if (taskOverrides.prompt !== undefined) {
        result.prompt = taskOverrides.prompt;
      }
      if (taskOverrides.cwd !== undefined) {
        result.cwd = taskOverrides.cwd;
      }
      if (taskOverrides.model !== undefined) {
        result.model = taskOverrides.model;
      }
      if (taskOverrides.sessionId !== undefined) {
        result.sessionId = taskOverrides.sessionId;
      }
      if (taskOverrides.outputFormat !== undefined) {
        result.outputFormat = taskOverrides.outputFormat;
      }
    }

    return result;
  }

  /**
   * Get a rendered prompt for a role and provider.
   *
   * Sanitizes variable values by stripping `{{` and `}}` to prevent
   * template injection. Delegates to promptRegistry.render() for
   * template resolution and interpolation.
   */
  getPrompt(
    role: AgentType,
    providerName: string,
    vars?: Record<string, string>,
  ): string {
    // Sanitize vars: strip {{ and }} from values to prevent template injection
    const sanitizedVars: Record<string, string> = {};
    if (vars !== undefined) {
      for (const [key, value] of Object.entries(vars)) {
        sanitizedVars[key] = value.replace(/\{\{/g, '').replace(/\}\}/g, '');
      }
    }

    return this.promptRegistry.render(role, providerName, sanitizedVars);
  }

  /**
   * Get the agent role for a workflow phase (synchronous).
   *
   * Resolution order:
   * 1. config.phaseRoleMap?.[phase] (user override)
   * 2. DEFAULT_PHASE_ROLE_MAP[phase] (built-in default)
   *
   * Validates the resolved role against FORBIDDEN_KEYS.
   */
  getRoleForPhase(phase: WorkflowPhase): AgentType {
    const customRole = this.config.phaseRoleMap?.[phase];
    const role = customRole ?? DEFAULT_PHASE_ROLE_MAP[phase];

    if (FORBIDDEN_KEYS.has(role)) {
      throw createProviderError(
        'INVALID_ROLE',
        `Forbidden role name resolved for phase "${phase}": "${role}"`,
        false,
        'critical',
      );
    }

    return role;
  }

  /**
   * Dispose of all cached provider chains.
   * Clears the chains Map to release references.
   */
  async dispose(): Promise<void> {
    this.chains.clear();
    this.logger?.debug?.('RoleBasedAgentResolver disposed');
  }

  /**
   * Get or create a cached ProviderChain for a role.
   *
   * Uses the role-specific providerChain if available and non-empty;
   * otherwise falls back to defaults.providerChain.
   *
   * IMPORTANT: Cannot use `??` for the empty-array fallback because
   * an empty array `[]` is truthy. Must check `.length` explicitly.
   */
  private _getOrCreateChain(role: AgentType): IProviderChain {
    const cached = this.chains.get(role);
    if (cached !== undefined) {
      return cached;
    }

    // Determine entries: role-specific if available and non-empty, else defaults
    const roleConfig = this.config.roles?.[role];
    let entries = roleConfig?.providerChain;
    if (entries === undefined || entries.length === 0) {
      entries = this.config.defaults.providerChain;
    }

    // Build options with conditional assignment for optional properties
    // (exactOptionalPropertyTypes: can't assign undefined to optional props)
    const chainOptions: ConstructorParameters<typeof ProviderChain>[0] = {
      entries,
      factory: this.factory,
      health: this.health,
      diagnostics: this.diagnostics,
    };
    if (this.costTracker !== undefined) {
      chainOptions.costTracker = this.costTracker;
    }
    if (this.logger !== undefined) {
      chainOptions.logger = this.logger;
    }

    const chain = new ProviderChain(chainOptions);

    this.chains.set(role, chain);
    return chain;
  }
}
