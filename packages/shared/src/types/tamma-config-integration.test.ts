/**
 * Integration tests for TammaConfig with AgentsConfig and SecurityConfig.
 * Verifies Task 2 of Story 9-1: extending TammaConfig with new optional fields.
 */

import { describe, it, expect } from 'vitest';
import type {
  TammaConfig,
  AgentConfig,
  GitHubConfig,
  EngineConfig,
  AgentsConfig,
  WorkflowPhase,
  ProviderChainEntry,
  PermissionMode,
} from './index.js';
import type { SecurityConfig } from './security-config.js';
import {
  DEFAULT_PHASE_ROLE_MAP,
  ENGINE_STATE_TO_PHASE,
} from './index.js';

// --- Helpers ---

/** Creates a minimal valid TammaConfig (legacy, without agents/security) */
function createMinimalConfig(): TammaConfig {
  return {
    mode: 'standalone',
    logLevel: 'info',
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      issueLabels: ['tamma'],
      excludeLabels: ['wontfix'],
      botUsername: 'tamma-bot',
    },
    agent: {
      model: 'claude-sonnet-4-5',
      maxBudgetUsd: 1.0,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
      permissionMode: 'default',
    },
    engine: {
      pollIntervalMs: 300000,
      workingDirectory: '/tmp/tamma-test',
      approvalMode: 'auto',
      ciPollIntervalMs: 30000,
      ciMonitorTimeoutMs: 3600000,
    },
  };
}

// --- Backward Compatibility ---

describe('TammaConfig backward compatibility', () => {
  it('should compile and work without agents and security fields', () => {
    const config = createMinimalConfig();

    expect(config.mode).toBe('standalone');
    expect(config.agent.model).toBe('claude-sonnet-4-5');
    expect(config.agents).toBeUndefined();
    expect(config.security).toBeUndefined();
  });

  it('should keep agent as a required field', () => {
    const config = createMinimalConfig();
    // agent is required -- accessing it directly without optional chaining
    expect(config.agent.model).toBeDefined();
    expect(config.agent.maxBudgetUsd).toBe(1.0);
    expect(config.agent.allowedTools).toHaveLength(4);
    expect(config.agent.permissionMode).toBe('default');
  });

  it('should allow agent with optional provider field', () => {
    const config = createMinimalConfig();
    config.agent.provider = 'anthropic';
    expect(config.agent.provider).toBe('anthropic');
  });
});

// --- New Fields Integration ---

describe('TammaConfig with agents field', () => {
  it('should accept agents as an optional field', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      agents: {
        defaults: {
          providerChain: [
            { provider: 'openrouter', model: 'z-ai/z1-mini' },
            { provider: 'opencode' },
          ],
          maxBudgetUsd: 1.0,
        },
      },
    };

    expect(config.agents).toBeDefined();
    expect(config.agents?.defaults.providerChain).toHaveLength(2);
  });

  it('should accept agents with roles and phaseRoleMap', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      agents: {
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
        roles: {
          architect: {
            providerChain: [
              { provider: 'openrouter', model: 'anthropic/claude-opus-4' },
            ],
            maxBudgetUsd: 2.0,
          },
          implementer: {
            providerChain: [
              { provider: 'claude-code', model: 'claude-sonnet-4-5' },
              { provider: 'opencode' },
            ],
            allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
            maxBudgetUsd: 5.0,
          },
        },
        phaseRoleMap: {
          CODE_GENERATION: 'architect',
        },
      },
    };

    expect(config.agents?.roles?.architect?.maxBudgetUsd).toBe(2.0);
    expect(config.agents?.roles?.implementer?.providerChain).toHaveLength(2);
    expect(config.agents?.phaseRoleMap?.CODE_GENERATION).toBe('architect');
  });

  it('should allow both agent and agents to coexist', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      agents: {
        defaults: {
          providerChain: [{ provider: 'opencode' }],
        },
      },
    };

    // Legacy agent is still required and present
    expect(config.agent.model).toBe('claude-sonnet-4-5');
    // New agents field is also present
    expect(config.agents?.defaults.providerChain).toHaveLength(1);
  });
});

describe('TammaConfig with security field', () => {
  it('should accept security as an optional field', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      security: {
        sanitizeContent: true,
        validateUrls: true,
      },
    };

    expect(config.security).toBeDefined();
    expect(config.security?.sanitizeContent).toBe(true);
    expect(config.security?.validateUrls).toBe(true);
  });

  it('should accept security with all fields', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      security: {
        sanitizeContent: true,
        validateUrls: true,
        gateActions: false,
        maxFetchSizeBytes: 1048576,
        blockedCommandPatterns: ['rm\\s+-rf', 'sudo\\s+'],
      },
    };

    expect(config.security?.gateActions).toBe(false);
    expect(config.security?.maxFetchSizeBytes).toBe(1048576);
    expect(config.security?.blockedCommandPatterns).toHaveLength(2);
  });

  it('should accept empty security config', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      security: {},
    };

    expect(config.security).toBeDefined();
    expect(config.security?.sanitizeContent).toBeUndefined();
  });
});

describe('TammaConfig with both agents and security', () => {
  it('should accept both fields together', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      agents: {
        defaults: {
          providerChain: [
            { provider: 'openrouter', model: 'z-ai/z1-mini' },
          ],
          maxBudgetUsd: 1.0,
        },
      },
      security: {
        sanitizeContent: true,
        validateUrls: true,
      },
    };

    expect(config.agents).toBeDefined();
    expect(config.security).toBeDefined();
    expect(config.agent.model).toBe('claude-sonnet-4-5');
  });

  it('should match the example config from the story spec', () => {
    const config: TammaConfig = {
      ...createMinimalConfig(),
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'default',
      },
      agents: {
        defaults: {
          providerChain: [
            { provider: 'openrouter', model: 'z-ai/z1-mini' },
            { provider: 'opencode' },
          ],
          maxBudgetUsd: 1.0,
        },
        roles: {
          architect: {
            providerChain: [
              { provider: 'openrouter', model: 'anthropic/claude-opus-4' },
            ],
            maxBudgetUsd: 2.0,
          },
          implementer: {
            providerChain: [
              { provider: 'claude-code', model: 'claude-sonnet-4-5' },
              { provider: 'opencode' },
            ],
            allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
            maxBudgetUsd: 5.0,
          },
        },
      },
      security: {
        sanitizeContent: true,
        validateUrls: true,
      },
    };

    expect(config.agents?.defaults.providerChain).toHaveLength(2);
    expect(config.agents?.roles?.architect?.maxBudgetUsd).toBe(2.0);
    expect(config.agents?.roles?.implementer?.allowedTools).toHaveLength(6);
    expect(config.security?.sanitizeContent).toBe(true);
  });
});

// --- Type Import Accessibility from @tamma/shared ---

describe('Type exports from @tamma/shared barrel', () => {
  it('should export AgentsConfig through the barrel', async () => {
    // We verify by dynamically importing the types barrel and checking
    // that the module loads successfully. AgentsConfig is a type-only
    // export, so we verify via compile-time usage above.
    const indexModule = await import('./index.js');
    expect(indexModule).toBeDefined();
  });

  it('should export DEFAULT_PHASE_ROLE_MAP as a value through the barrel', async () => {
    const indexModule = await import('./index.js');
    expect(indexModule.DEFAULT_PHASE_ROLE_MAP).toBeDefined();
    expect(typeof indexModule.DEFAULT_PHASE_ROLE_MAP).toBe('object');
  });

  it('should export ENGINE_STATE_TO_PHASE as a value through the barrel', async () => {
    const indexModule = await import('./index.js');
    expect(indexModule.ENGINE_STATE_TO_PHASE).toBeDefined();
    expect(typeof indexModule.ENGINE_STATE_TO_PHASE).toBe('object');
  });

  it('should export validation functions through the barrel', async () => {
    const indexModule = await import('./index.js');
    expect(typeof indexModule.validateSecurityConfig).toBe('function');
    expect(typeof indexModule.validateProviderName).toBe('function');
    expect(typeof indexModule.validateMaxBudgetUsd).toBe('function');
    expect(typeof indexModule.validateAgentsConfig).toBe('function');
  });

  it('should make WorkflowPhase usable as a type', () => {
    // Compile-time verification: if this compiles, the type is importable
    const phase: WorkflowPhase = 'CODE_GENERATION';
    expect(phase).toBe('CODE_GENERATION');
  });

  it('should make ProviderChainEntry usable as a type', () => {
    const entry: ProviderChainEntry = {
      provider: 'claude-code',
      model: 'claude-sonnet-4-5',
    };
    expect(entry.provider).toBe('claude-code');
  });

  it('should make PermissionMode usable as a type', () => {
    const mode1: PermissionMode = 'bypassPermissions';
    const mode2: PermissionMode = 'default';
    expect(mode1).toBe('bypassPermissions');
    expect(mode2).toBe('default');
  });

  it('should make SecurityConfig usable as a type', () => {
    const config: SecurityConfig = {
      sanitizeContent: true,
    };
    expect(config.sanitizeContent).toBe(true);
  });

  it('should make AgentsConfig usable as a type', () => {
    const config: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'claude-code' }],
      },
    };
    expect(config.defaults.providerChain).toHaveLength(1);
  });
});

// --- Verify main barrel (packages/shared/src/index.ts) chains exports ---

describe('Main barrel re-export chain', () => {
  it('should re-export types from the main shared barrel', async () => {
    // The main barrel at packages/shared/src/index.ts has:
    //   export * from './types/index.js'
    // which chains to:
    //   export * from './agent-config.js'
    //   export * from './security-config.js'
    const mainModule = await import('../index.js');
    expect(mainModule).toBeDefined();
    expect(mainModule.DEFAULT_PHASE_ROLE_MAP).toBeDefined();
    expect(mainModule.ENGINE_STATE_TO_PHASE).toBeDefined();
    expect(typeof mainModule.validateSecurityConfig).toBe('function');
    expect(typeof mainModule.validateAgentsConfig).toBe('function');
    expect(typeof mainModule.validateProviderName).toBe('function');
    expect(typeof mainModule.validateMaxBudgetUsd).toBe('function');
  });
});
