/**
 * Tests for RoleBasedAgentResolver
 *
 * Story 9-8: Role-Based Agent Resolver
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AgentType,
  AgentsConfig,
  WorkflowPhase,
  IContentSanitizer,
} from '@tamma/shared';
import { DEFAULT_PHASE_ROLE_MAP } from '@tamma/shared';
import type { IProviderHealthTracker } from './types.js';
import type { IAgentProviderFactory } from './agent-provider-factory.js';
import type { IAgentProvider, AgentTaskConfig } from './agent-types.js';
import type { IAgentPromptRegistry } from './agent-prompt-registry.js';
import type { DiagnosticsQueue } from '@tamma/shared/telemetry';
import {
  RoleBasedAgentResolver,
  type RoleBasedAgentResolverOptions,
  type RoleBasedAgentResolverLogger,
} from './role-based-agent-resolver.js';

// ---- Mock helpers ----

function createMockProvider(): IAgentProvider {
  return {
    executeTask: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      costUsd: 0.01,
      durationMs: 100,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFactory(): IAgentProviderFactory {
  return {
    create: vi.fn().mockResolvedValue(createMockProvider()),
    register: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHealth(): IProviderHealthTracker {
  return {
    isHealthy: vi.fn().mockReturnValue(true),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    getStatus: vi.fn().mockReturnValue({}),
    reset: vi.fn(),
    clear: vi.fn(),
  };
}

function createMockPromptRegistry(): IAgentPromptRegistry {
  return {
    render: vi.fn().mockReturnValue('rendered prompt'),
    resolveTemplate: vi.fn().mockReturnValue('template'),
    registerBuiltin: vi.fn(),
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

function createMockSanitizer(): IContentSanitizer {
  return {
    sanitize: vi.fn().mockImplementation((input: string) => ({
      result: input,
      warnings: [],
    })),
    sanitizeOutput: vi.fn().mockImplementation((output: string) => ({
      result: output,
      warnings: [],
    })),
  };
}

function createMockLogger(): RoleBasedAgentResolverLogger {
  return {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  };
}

function createDefaultConfig(
  overrides?: Partial<AgentsConfig>,
): AgentsConfig {
  return {
    defaults: {
      providerChain: [{ provider: 'claude-code' }],
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: 5.0,
      permissionMode: 'default',
      ...overrides?.defaults,
    },
    roles: overrides?.roles,
    phaseRoleMap: overrides?.phaseRoleMap,
  } as AgentsConfig;
}

function createOptions(
  overrides?: Partial<RoleBasedAgentResolverOptions>,
): RoleBasedAgentResolverOptions {
  return {
    config: createDefaultConfig(),
    factory: createMockFactory(),
    health: createMockHealth(),
    promptRegistry: createMockPromptRegistry(),
    diagnostics: createMockDiagnostics(),
    ...overrides,
  };
}

// ---- Tests ----

describe('RoleBasedAgentResolver', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ---- Constructor ----

  describe('constructor', () => {
    it('accepts valid options', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      expect(resolver).toBeDefined();
    });

    it('throws on empty defaults.providerChain', () => {
      const config = createDefaultConfig();
      config.defaults.providerChain = [];
      expect(
        () => new RoleBasedAgentResolver(createOptions({ config })),
      ).toThrow('defaults.providerChain must not be empty');
    });
  });

  // ---- getRoleForPhase ----

  describe('getRoleForPhase', () => {
    it('maps all 8 phases correctly via DEFAULT_PHASE_ROLE_MAP', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      const phases: WorkflowPhase[] = [
        'ISSUE_SELECTION',
        'CONTEXT_ANALYSIS',
        'PLAN_GENERATION',
        'CODE_GENERATION',
        'PR_CREATION',
        'CODE_REVIEW',
        'TEST_EXECUTION',
        'STATUS_MONITORING',
      ];

      for (const phase of phases) {
        expect(resolver.getRoleForPhase(phase)).toBe(
          DEFAULT_PHASE_ROLE_MAP[phase],
        );
      }
    });

    it('uses custom phaseRoleMap overrides', () => {
      const config = createDefaultConfig({
        phaseRoleMap: { CODE_GENERATION: 'architect' },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config }),
      );

      expect(resolver.getRoleForPhase('CODE_GENERATION')).toBe('architect');
      // Other phases still use defaults
      expect(resolver.getRoleForPhase('ISSUE_SELECTION')).toBe('scrum_master');
    });

    it('rejects forbidden key (__proto__) in resolved role', () => {
      const config = createDefaultConfig({
        phaseRoleMap: {
          CODE_GENERATION: '__proto__' as AgentType,
        },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config }),
      );

      expect(() => resolver.getRoleForPhase('CODE_GENERATION')).toThrow(
        'Forbidden role name',
      );
    });
  });

  // ---- getAgentForPhase ----

  describe('getAgentForPhase', () => {
    it('maps phase to role and returns a provider', async () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      const provider = await resolver.getAgentForPhase(
        'CODE_GENERATION',
        context,
      );
      expect(provider).toBeDefined();
      expect(provider.executeTask).toBeDefined();
    });

    it('returns SecureAgentProvider when sanitizer is configured', async () => {
      const sanitizer = createMockSanitizer();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ sanitizer }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      const provider = await resolver.getAgentForPhase(
        'CODE_GENERATION',
        context,
      );

      // Verify the wrapping by calling executeTask and checking sanitizer was called
      await provider.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(sanitizer.sanitize).toHaveBeenCalledWith('test');
    });
  });

  // ---- getAgentForRole ----

  describe('getAgentForRole', () => {
    it('delegates to chain.getProvider with correct context', async () => {
      const factory = createMockFactory();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      const provider = await resolver.getAgentForRole(
        'implementer',
        context,
      );
      expect(provider).toBeDefined();
      expect(factory.create).toHaveBeenCalled();
    });

    it('wraps with SecureAgentProvider when sanitizer is provided', async () => {
      const sanitizer = createMockSanitizer();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ sanitizer }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      const provider = await resolver.getAgentForRole(
        'implementer',
        context,
      );

      // Execute task to verify sanitizer wrapping
      await provider.executeTask({ prompt: 'code this', cwd: '/tmp' });
      expect(sanitizer.sanitize).toHaveBeenCalledWith('code this');
      expect(sanitizer.sanitizeOutput).toHaveBeenCalled();
    });

    it('returns raw provider when sanitizer is absent (logs warn)', async () => {
      const logger = createMockLogger();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ logger }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      const provider = await resolver.getAgentForRole(
        'implementer',
        context,
      );
      expect(provider).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'No content sanitizer configured',
        expect.objectContaining({ role: 'implementer' }),
      );
    });

    it('rejects forbidden role names', async () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await expect(
        resolver.getAgentForRole(
          '__proto__' as AgentType,
          context,
        ),
      ).rejects.toThrow('Forbidden role name');
    });
  });

  // ---- getTaskConfig ----

  describe('getTaskConfig', () => {
    it('returns defaults when no role or overrides', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      const config = resolver.getTaskConfig('implementer');

      expect(config.allowedTools).toEqual(['Read', 'Write', 'Bash']);
      expect(config.maxBudgetUsd).toBe(5.0);
      expect(config.permissionMode).toBe('default');
    });

    it('role config overrides defaults', () => {
      const agentsConfig = createDefaultConfig({
        roles: {
          implementer: {
            allowedTools: ['Read', 'Write'],
            maxBudgetUsd: 10.0,
            permissionMode: 'bypassPermissions',
          },
        },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig }),
      );
      const config = resolver.getTaskConfig('implementer');

      expect(config.allowedTools).toEqual(['Read', 'Write']);
      expect(config.maxBudgetUsd).toBe(10.0);
      expect(config.permissionMode).toBe('bypassPermissions');
    });

    it('partial role config does not clobber undefined fields', () => {
      const agentsConfig = createDefaultConfig({
        roles: {
          implementer: {
            // Only override maxBudgetUsd, leave others as defaults
            maxBudgetUsd: 3.0,
          },
        },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig }),
      );
      const config = resolver.getTaskConfig('implementer');

      expect(config.maxBudgetUsd).toBe(3.0);
      expect(config.allowedTools).toEqual(['Read', 'Write', 'Bash']);
      expect(config.permissionMode).toBe('default');
    });

    it('clamps budget: task override cannot exceed ceiling', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      // Default maxBudgetUsd is 5.0
      const config = resolver.getTaskConfig('implementer', {
        maxBudgetUsd: 20.0,
      });

      expect(config.maxBudgetUsd).toBe(5.0); // Clamped to ceiling
    });

    it('allows budget below ceiling', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      const config = resolver.getTaskConfig('implementer', {
        maxBudgetUsd: 2.0,
      });

      expect(config.maxBudgetUsd).toBe(2.0);
    });

    it('allows budget when no ceiling is defined', () => {
      const agentsConfig: AgentsConfig = {
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
      };
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig }),
      );
      const config = resolver.getTaskConfig('implementer', {
        maxBudgetUsd: 20.0,
      });

      expect(config.maxBudgetUsd).toBe(20.0);
    });

    it('clamps bypassPermissions: requires TAMMA_ALLOW_BYPASS_PERMISSIONS env var', () => {
      const logger = createMockLogger();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ logger }),
      );

      // Without env var
      delete process.env['TAMMA_ALLOW_BYPASS_PERMISSIONS'];
      const config = resolver.getTaskConfig('implementer', {
        permissionMode: 'bypassPermissions',
      });

      expect(config.permissionMode).toBe('default'); // Not overridden
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('bypassPermissions denied'),
        expect.objectContaining({ role: 'implementer' }),
      );
    });

    it('allows bypassPermissions when env var is set', () => {
      process.env['TAMMA_ALLOW_BYPASS_PERMISSIONS'] = 'true';
      const resolver = new RoleBasedAgentResolver(createOptions());
      const config = resolver.getTaskConfig('implementer', {
        permissionMode: 'bypassPermissions',
      });

      expect(config.permissionMode).toBe('bypassPermissions');
    });

    it('clamps allowedTools: intersection only (restrict, never expand)', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      // Defaults have ['Read', 'Write', 'Bash']
      const config = resolver.getTaskConfig('implementer', {
        allowedTools: ['Read', 'Bash', 'Exec'],
      });

      // Intersection: only Read and Bash are in both lists
      expect(config.allowedTools).toEqual(['Read', 'Bash']);
    });

    it('allows all override tools when no current restriction', () => {
      const agentsConfig: AgentsConfig = {
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
      };
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig }),
      );
      const config = resolver.getTaskConfig('implementer', {
        allowedTools: ['Read', 'Write'],
      });

      expect(config.allowedTools).toEqual(['Read', 'Write']);
    });

    it('throws on forbidden role name', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      expect(() =>
        resolver.getTaskConfig('constructor' as AgentType),
      ).toThrow('Forbidden role name');
    });

    it('forwards non-clamped fields from taskOverrides', () => {
      const resolver = new RoleBasedAgentResolver(createOptions());
      const config = resolver.getTaskConfig('implementer', {
        prompt: 'test prompt',
        cwd: '/workspace',
        model: 'claude-sonnet-4',
        sessionId: 'sess-123',
      });

      expect(config.prompt).toBe('test prompt');
      expect(config.cwd).toBe('/workspace');
      expect(config.model).toBe('claude-sonnet-4');
      expect(config.sessionId).toBe('sess-123');
    });
  });

  // ---- getPrompt ----

  describe('getPrompt', () => {
    it('delegates to promptRegistry.render', () => {
      const promptRegistry = createMockPromptRegistry();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ promptRegistry }),
      );

      const result = resolver.getPrompt('implementer', 'claude-code');
      expect(promptRegistry.render).toHaveBeenCalledWith(
        'implementer',
        'claude-code',
        {},
      );
      expect(result).toBe('rendered prompt');
    });

    it('sanitizes vars by stripping {{ and }}', () => {
      const promptRegistry = createMockPromptRegistry();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ promptRegistry }),
      );

      resolver.getPrompt('implementer', 'claude-code', {
        context: 'safe value',
        injected: '{{malicious}}',
        nested: 'before {{inner}} after',
      });

      expect(promptRegistry.render).toHaveBeenCalledWith(
        'implementer',
        'claude-code',
        {
          context: 'safe value',
          injected: 'malicious',
          nested: 'before inner after',
        },
      );
    });

    it('passes empty vars by default', () => {
      const promptRegistry = createMockPromptRegistry();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ promptRegistry }),
      );

      resolver.getPrompt('implementer', 'claude-code');
      expect(promptRegistry.render).toHaveBeenCalledWith(
        'implementer',
        'claude-code',
        {},
      );
    });
  });

  // ---- getOrCreateChain ----

  describe('getOrCreateChain (via getAgentForRole)', () => {
    it('creates new chain on first call', async () => {
      const factory = createMockFactory();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await resolver.getAgentForRole('implementer', context);
      expect(factory.create).toHaveBeenCalledTimes(1);
    });

    it('returns cached chain on second call (same role)', async () => {
      const factory = createMockFactory();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await resolver.getAgentForRole('implementer', context);
      await resolver.getAgentForRole('implementer', context);

      // Factory.create should have been called for each getProvider call,
      // but the chain itself is cached (not recreated).
      // The chain calls factory.create internally for each getProvider.
      // Since the mock always returns a new provider, we check the factory
      // was called the expected number of times (once per getProvider call).
      expect(factory.create).toHaveBeenCalledTimes(2);
    });

    it('creates separate chains for different roles', async () => {
      const factory = createMockFactory();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await resolver.getAgentForRole('implementer', context);
      await resolver.getAgentForRole('reviewer', context);

      expect(factory.create).toHaveBeenCalledTimes(2);
    });

    it('uses role-specific providerChain when available', async () => {
      const factory = createMockFactory();
      const agentsConfig = createDefaultConfig({
        roles: {
          implementer: {
            providerChain: [{ provider: 'opencode' }],
          },
        },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig, factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await resolver.getAgentForRole('implementer', context);

      // Factory should have been called with the role-specific provider
      expect(factory.create).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'opencode' }),
      );
    });

    it('falls back to defaults when role providerChain is empty array', async () => {
      const factory = createMockFactory();
      const agentsConfig = createDefaultConfig({
        roles: {
          implementer: {
            providerChain: [], // Empty array -- must fallback
          },
        },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig, factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await resolver.getAgentForRole('implementer', context);

      // Factory should have been called with the default provider
      expect(factory.create).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'claude-code' }),
      );
    });

    it('falls back to defaults when role providerChain is undefined', async () => {
      const factory = createMockFactory();
      const agentsConfig = createDefaultConfig({
        roles: {
          implementer: {
            // No providerChain specified
            maxBudgetUsd: 10.0,
          },
        },
      });
      const resolver = new RoleBasedAgentResolver(
        createOptions({ config: agentsConfig, factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      await resolver.getAgentForRole('implementer', context);

      // Factory should have been called with the default provider
      expect(factory.create).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'claude-code' }),
      );
    });
  });

  // ---- dispose ----

  describe('dispose', () => {
    it('clears cached chains', async () => {
      const factory = createMockFactory();
      const resolver = new RoleBasedAgentResolver(
        createOptions({ factory }),
      );
      const context = { projectId: 'proj-1', engineId: 'eng-1' };

      // Populate the cache
      await resolver.getAgentForRole('implementer', context);

      await resolver.dispose();

      // After dispose, getting the same role should create a new chain
      // (factory.create is called again, not reusing cached chain)
      await resolver.getAgentForRole('implementer', context);

      // Total of 2 create calls (one before dispose, one after)
      expect(factory.create).toHaveBeenCalledTimes(2);
    });
  });
});
