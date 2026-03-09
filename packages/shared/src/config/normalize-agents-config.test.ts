import { describe, it, expect } from 'vitest';
import { normalizeAgentsConfig } from './normalize-agents-config.js';
import type { TammaConfig } from '../types/index.js';
import type { AgentsConfig } from '../types/agent-config.js';

// --- Helpers ---

/**
 * Creates a minimal valid TammaConfig for testing.
 * Callers can override specific fields.
 */
function createMinimalConfig(overrides?: Partial<TammaConfig>): TammaConfig {
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
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'default',
    },
    engine: {
      pollIntervalMs: 300_000,
      workingDirectory: '/tmp/test',
      approvalMode: 'cli',
      ciPollIntervalMs: 30_000,
      ciMonitorTimeoutMs: 3_600_000,
    },
    ...overrides,
  };
}

// --- Path 1: config.agents is set ---

describe('normalizeAgentsConfig - config.agents present', () => {
  it('should return a deep clone of config.agents when it is defined', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [
          { provider: 'openrouter', model: 'z-ai/z1-mini' },
          { provider: 'opencode' },
        ],
        maxBudgetUsd: 1.0,
      },
      roles: {
        architect: {
          providerChain: [{ provider: 'openrouter', model: 'anthropic/claude-opus-4' }],
          maxBudgetUsd: 2.0,
        },
      },
    };

    const config = createMinimalConfig({ agents });
    const result = normalizeAgentsConfig(config);

    // Should be a deep clone -- not the same reference
    expect(result).not.toBe(config.agents);
    expect(result).toEqual(agents);
  });

  it('should not share references with the original config.agents', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'claude-code', model: 'claude-sonnet-4-5' }],
        allowedTools: ['Read', 'Write'],
      },
    };

    const config = createMinimalConfig({ agents });
    const result = normalizeAgentsConfig(config);

    // Mutating the result should not affect the original
    result.defaults.providerChain.push({ provider: 'opencode' });
    expect(config.agents?.defaults.providerChain).toHaveLength(1);

    result.defaults.allowedTools?.push('Bash');
    expect(config.agents?.defaults.allowedTools).toHaveLength(2);
  });

  it('should preserve all fields including roles and phaseRoleMap', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'claude-code' }],
        maxBudgetUsd: 5.0,
        permissionMode: 'bypassPermissions',
        systemPrompt: 'You are a senior developer.',
        providerPrompts: { 'claude-code': 'Specialized prompt' },
      },
      roles: {
        implementer: {
          providerChain: [{ provider: 'opencode' }],
          allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
          maxBudgetUsd: 10.0,
        },
        reviewer: {
          providerChain: [{ provider: 'openrouter', model: 'gpt-4o' }],
        },
      },
      phaseRoleMap: {
        CODE_GENERATION: 'architect',
        CODE_REVIEW: 'reviewer',
      },
    };

    const config = createMinimalConfig({ agents });
    const result = normalizeAgentsConfig(config);

    expect(result).toEqual(agents);
    expect(result.roles?.implementer?.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Bash']);
    expect(result.phaseRoleMap?.CODE_GENERATION).toBe('architect');
  });

  it('should handle minimal agents config with only defaults', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'local' }],
      },
    };

    const config = createMinimalConfig({ agents });
    const result = normalizeAgentsConfig(config);

    expect(result).toEqual(agents);
    expect(result.roles).toBeUndefined();
    expect(result.phaseRoleMap).toBeUndefined();
  });

  it('should preserve apiKeyRef in provider chain entries', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [
          { provider: 'openrouter', model: 'z-ai/z1-mini', apiKeyRef: 'OPENROUTER_API_KEY' },
        ],
      },
    };

    const config = createMinimalConfig({ agents });
    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain[0]?.apiKeyRef).toBe('OPENROUTER_API_KEY');
  });

  it('should preserve config field in provider chain entries', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [
          {
            provider: 'openrouter',
            config: { baseUrl: 'https://custom.endpoint.com', timeout: 60000 },
          },
        ],
      },
    };

    const config = createMinimalConfig({ agents });
    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain[0]?.config).toEqual({
      baseUrl: 'https://custom.endpoint.com',
      timeout: 60000,
    });
  });
});

// --- Path 2: Legacy config.agent only ---

describe('normalizeAgentsConfig - legacy config.agent', () => {
  it('should map provider anthropic to claude-code', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read'],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain).toHaveLength(1);
    expect(result.defaults.providerChain[0]?.provider).toBe('claude-code');
  });

  it('should map provider openai to openrouter', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'gpt-4o',
        provider: 'openai',
        maxBudgetUsd: 2.0,
        allowedTools: ['Read', 'Write'],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain).toHaveLength(1);
    expect(result.defaults.providerChain[0]?.provider).toBe('openrouter');
  });

  it('should map provider local to local', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'llama3.1:70b',
        provider: 'local',
        maxBudgetUsd: 0,
        allowedTools: [],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain).toHaveLength(1);
    expect(result.defaults.providerChain[0]?.provider).toBe('local');
  });

  it('should default to anthropic (claude-code) when provider is undefined', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain[0]?.provider).toBe('claude-code');
  });

  it('should include model from legacy agent.model', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-opus-4',
        provider: 'anthropic',
        maxBudgetUsd: 5.0,
        allowedTools: [],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.providerChain[0]?.model).toBe('claude-opus-4');
  });

  it('should include allowedTools from legacy config', () => {
    const tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: tools,
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.allowedTools).toEqual(tools);
  });

  it('should copy allowedTools (not reference the original array)', () => {
    const tools = ['Read', 'Write'];
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: tools,
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    // Mutating the result should not affect the original
    result.defaults.allowedTools?.push('Bash');
    expect(config.agent.allowedTools).toHaveLength(2);
  });

  it('should include maxBudgetUsd from legacy config', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 7.5,
        allowedTools: [],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.maxBudgetUsd).toBe(7.5);
  });

  it('should include permissionMode from legacy config', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.permissionMode).toBe('bypassPermissions');
  });

  it('should not set roles or phaseRoleMap in legacy conversion', () => {
    const config = createMinimalConfig();
    const result = normalizeAgentsConfig(config);

    expect(result.roles).toBeUndefined();
    expect(result.phaseRoleMap).toBeUndefined();
  });

  it('should not mutate the input config object', () => {
    const config = createMinimalConfig();
    const originalAgent = structuredClone(config.agent);

    normalizeAgentsConfig(config);

    expect(config.agent).toEqual(originalAgent);
    expect(config.agents).toBeUndefined();
  });

  it('should handle empty allowedTools array', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: [],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.allowedTools).toEqual([]);
  });

  it('should handle zero maxBudgetUsd', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 0,
        allowedTools: [],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result.defaults.maxBudgetUsd).toBe(0);
  });
});

// --- Path 3: Neither agents nor agent ---

describe('normalizeAgentsConfig - sensible defaults', () => {
  it('should return sensible defaults when config has no agents field', () => {
    // config.agent is always required on TammaConfig, but let's test the fallback
    // when we explicitly set agents to undefined
    const config = createMinimalConfig();
    // config already has agent field, so this will use path 2 (legacy).
    // To test path 3, we need to simulate a config without agent.
    // Since agent is required on TammaConfig, path 3 is technically unreachable
    // in strict typing, but we test it for defensive programming.
    const configWithoutAgent = {
      ...config,
      agent: undefined as unknown as TammaConfig['agent'],
    } as TammaConfig;

    // Overwrite agents too
    delete (configWithoutAgent as Record<string, unknown>)['agents'];

    const result = normalizeAgentsConfig(configWithoutAgent);

    expect(result.defaults.providerChain).toHaveLength(1);
    expect(result.defaults.providerChain[0]?.provider).toBe('claude-code');
    expect(result.defaults.providerChain[0]?.model).toBe('claude-sonnet-4-5');
    expect(result.defaults.maxBudgetUsd).toBe(1.0);
    expect(result.defaults.permissionMode).toBe('default');
  });

  it('should return a deep clone of defaults (not the same reference)', () => {
    const configWithoutAgent = {
      ...createMinimalConfig(),
      agent: undefined as unknown as TammaConfig['agent'],
    } as TammaConfig;
    delete (configWithoutAgent as Record<string, unknown>)['agents'];

    const result1 = normalizeAgentsConfig(configWithoutAgent);
    const result2 = normalizeAgentsConfig(configWithoutAgent);

    expect(result1).not.toBe(result2);
    expect(result1).toEqual(result2);

    // Mutating one should not affect the other
    result1.defaults.providerChain.push({ provider: 'opencode' });
    expect(result2.defaults.providerChain).toHaveLength(1);
  });
});

// --- LEGACY_PROVIDER_MAP coverage ---

describe('LEGACY_PROVIDER_MAP coverage', () => {
  it('should cover all three AIProviderType values', () => {
    const providerTypes: Array<'anthropic' | 'openai' | 'local'> = ['anthropic', 'openai', 'local'];
    const expectedMappings: Record<string, string> = {
      anthropic: 'claude-code',
      openai: 'openrouter',
      local: 'local',
    };

    for (const providerType of providerTypes) {
      const config = createMinimalConfig({
        agent: {
          model: 'test-model',
          provider: providerType,
          maxBudgetUsd: 1.0,
          allowedTools: [],
          permissionMode: 'default',
        },
      });

      const result = normalizeAgentsConfig(config);
      expect(result.defaults.providerChain[0]?.provider).toBe(expectedMappings[providerType]);
    }
  });
});

// --- Never throws guarantee ---

describe('normalizeAgentsConfig - never throws', () => {
  it('should not throw for a normal config', () => {
    const config = createMinimalConfig();
    expect(() => normalizeAgentsConfig(config)).not.toThrow();
  });

  it('should not throw for config with agents', () => {
    const config = createMinimalConfig({
      agents: {
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
      },
    });
    expect(() => normalizeAgentsConfig(config)).not.toThrow();
  });

  it('should not throw for config with empty agents defaults', () => {
    const config = createMinimalConfig({
      agents: {
        defaults: {
          providerChain: [],
        },
      },
    });
    // normalizeAgentsConfig does not validate -- it only normalizes
    expect(() => normalizeAgentsConfig(config)).not.toThrow();
  });
});

// --- Integration-style tests ---

describe('normalizeAgentsConfig - integration scenarios', () => {
  it('should handle the example config from the story spec', () => {
    const config = createMinimalConfig({
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
            providerChain: [{ provider: 'openrouter', model: 'anthropic/claude-opus-4' }],
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
    });

    const result = normalizeAgentsConfig(config);

    // When agents is present, it wins over legacy agent
    expect(result.defaults.providerChain).toHaveLength(2);
    expect(result.defaults.providerChain[0]?.provider).toBe('openrouter');
    expect(result.defaults.providerChain[0]?.model).toBe('z-ai/z1-mini');
    expect(result.roles?.architect?.maxBudgetUsd).toBe(2.0);
    expect(result.roles?.implementer?.providerChain).toHaveLength(2);
  });

  it('should produce correct output for legacy anthropic config', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result).toEqual({
      defaults: {
        providerChain: [{ provider: 'claude-code', model: 'claude-sonnet-4-5' }],
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        maxBudgetUsd: 1.0,
        permissionMode: 'default',
      },
    });
  });

  it('should produce correct output for legacy openai config', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'gpt-4o',
        provider: 'openai',
        maxBudgetUsd: 2.0,
        allowedTools: ['Read'],
        permissionMode: 'default',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result).toEqual({
      defaults: {
        providerChain: [{ provider: 'openrouter', model: 'gpt-4o' }],
        allowedTools: ['Read'],
        maxBudgetUsd: 2.0,
        permissionMode: 'default',
      },
    });
  });

  it('should produce correct output for legacy local config', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'llama3.1:70b',
        provider: 'local',
        maxBudgetUsd: 0,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
      },
    });

    const result = normalizeAgentsConfig(config);

    expect(result).toEqual({
      defaults: {
        providerChain: [{ provider: 'local', model: 'llama3.1:70b' }],
        allowedTools: [],
        maxBudgetUsd: 0,
        permissionMode: 'bypassPermissions',
      },
    });
  });
});
