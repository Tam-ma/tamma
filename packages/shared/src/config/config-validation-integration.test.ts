/**
 * Integration tests for the full config validation and normalization flow.
 *
 * Verifies Task 4 of Story 9-1:
 * - validateAgentsConfig and validateSecurityConfig work together with normalizeAgentsConfig
 * - Full config pipeline: create config -> normalize -> validate
 * - All exports are accessible from config/index.ts and the main barrel
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeAgentsConfig,
  validateAgentsConfig,
  validateSecurityConfig,
  validateProviderName,
  validateMaxBudgetUsd,
} from './index.js';
import type { TammaConfig } from '../types/index.js';
import type { AgentsConfig } from '../types/agent-config.js';
import type { SecurityConfig } from '../types/security-config.js';
import { TammaError } from '../errors.js';

// --- Helpers ---

/**
 * Creates a minimal valid TammaConfig for testing.
 */
function createMinimalConfig(overrides?: Partial<TammaConfig>): TammaConfig {
  return {
    mode: 'standalone',
    logLevel: 'info',
    github: {
      authMode: 'pat' as const,
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

// --- Config barrel exports accessibility ---

describe('config/index.ts exports', () => {
  it('should export normalizeAgentsConfig function', () => {
    expect(typeof normalizeAgentsConfig).toBe('function');
  });

  it('should export validateAgentsConfig function', () => {
    expect(typeof validateAgentsConfig).toBe('function');
  });

  it('should export validateSecurityConfig function', () => {
    expect(typeof validateSecurityConfig).toBe('function');
  });

  it('should export validateProviderName function', () => {
    expect(typeof validateProviderName).toBe('function');
  });

  it('should export validateMaxBudgetUsd function', () => {
    expect(typeof validateMaxBudgetUsd).toBe('function');
  });
});

// --- Main barrel re-exports config module ---

describe('Main barrel re-exports config module', () => {
  it('should re-export all config functions from the main barrel', async () => {
    const mainModule = await import('../index.js');
    expect(typeof mainModule.normalizeAgentsConfig).toBe('function');
    expect(typeof mainModule.validateAgentsConfig).toBe('function');
    expect(typeof mainModule.validateSecurityConfig).toBe('function');
    expect(typeof mainModule.validateProviderName).toBe('function');
    expect(typeof mainModule.validateMaxBudgetUsd).toBe('function');
  });
});

// --- Full config flow: normalize -> validate ---

describe('Full config flow: normalize then validate', () => {
  it('should normalize legacy config and pass validation', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'default',
      },
    });

    const normalized = normalizeAgentsConfig(config);

    // Should not throw
    expect(() => validateAgentsConfig(normalized)).not.toThrow();

    // Verify the normalized result has valid structure
    expect(normalized.defaults.providerChain).toHaveLength(1);
    expect(normalized.defaults.providerChain[0]?.provider).toBe('claude-code');
    expect(normalized.defaults.providerChain[0]?.model).toBe('claude-sonnet-4-5');
  });

  it('should normalize legacy openai config and pass validation', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'gpt-4o',
        provider: 'openai',
        maxBudgetUsd: 2.0,
        allowedTools: ['Read'],
        permissionMode: 'default',
      },
    });

    const normalized = normalizeAgentsConfig(config);
    expect(() => validateAgentsConfig(normalized)).not.toThrow();
    expect(normalized.defaults.providerChain[0]?.provider).toBe('openrouter');
  });

  it('should normalize legacy local config and pass validation', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'llama3.1:70b',
        provider: 'local',
        maxBudgetUsd: 0,
        allowedTools: [],
        permissionMode: 'default',
      },
    });

    const normalized = normalizeAgentsConfig(config);
    expect(() => validateAgentsConfig(normalized)).not.toThrow();
    expect(normalized.defaults.providerChain[0]?.provider).toBe('local');
  });

  it('should normalize config with agents field and pass validation', () => {
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
        implementer: {
          providerChain: [
            { provider: 'claude-code', model: 'claude-sonnet-4-5' },
            { provider: 'opencode' },
          ],
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          maxBudgetUsd: 5.0,
        },
      },
    };

    const config = createMinimalConfig({ agents });
    const normalized = normalizeAgentsConfig(config);

    expect(() => validateAgentsConfig(normalized)).not.toThrow();
    expect(normalized.defaults.providerChain).toHaveLength(2);
    expect(normalized.roles?.architect?.maxBudgetUsd).toBe(2.0);
    expect(normalized.roles?.implementer?.providerChain).toHaveLength(2);
  });

  it('should detect invalid provider names in normalized config', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: '__proto__' }],
      },
    };

    const config = createMinimalConfig({ agents });
    const normalized = normalizeAgentsConfig(config);

    expect(() => validateAgentsConfig(normalized)).toThrow(TammaError);
  });

  it('should detect empty provider chain after normalization when agents is set', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [],
      },
    };

    const config = createMinimalConfig({ agents });
    const normalized = normalizeAgentsConfig(config);

    expect(() => validateAgentsConfig(normalized)).toThrow(TammaError);
  });

  it('should detect invalid maxBudgetUsd in normalized config', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'claude-code' }],
        maxBudgetUsd: -5,
      },
    };

    const config = createMinimalConfig({ agents });
    const normalized = normalizeAgentsConfig(config);

    expect(() => validateAgentsConfig(normalized)).toThrow(TammaError);
  });
});

// --- Full config flow: security validation ---

describe('Full config flow: security validation', () => {
  it('should validate a valid security config', () => {
    const security: SecurityConfig = {
      sanitizeContent: true,
      validateUrls: true,
      gateActions: false,
      maxFetchSizeBytes: 1048576,
      blockedCommandPatterns: ['rm\\s+-rf', 'sudo\\s+'],
    };

    expect(() => validateSecurityConfig(security)).not.toThrow();
  });

  it('should validate an empty security config', () => {
    expect(() => validateSecurityConfig({})).not.toThrow();
  });

  it('should reject invalid regex in security config', () => {
    const security: SecurityConfig = {
      blockedCommandPatterns: ['[invalid-regex'],
    };

    expect(() => validateSecurityConfig(security)).toThrow(TammaError);
  });

  it('should reject out-of-range maxFetchSizeBytes', () => {
    const security: SecurityConfig = {
      maxFetchSizeBytes: -1,
    };

    expect(() => validateSecurityConfig(security)).toThrow(TammaError);
  });

  it('should accept maxFetchSizeBytes at 1 GiB boundary', () => {
    const security: SecurityConfig = {
      maxFetchSizeBytes: 1_073_741_824,
    };

    expect(() => validateSecurityConfig(security)).not.toThrow();
  });

  it('should reject maxFetchSizeBytes above 1 GiB', () => {
    const security: SecurityConfig = {
      maxFetchSizeBytes: 1_073_741_825,
    };

    expect(() => validateSecurityConfig(security)).toThrow(TammaError);
  });
});

// --- Full config flow: combined agents + security validation ---

describe('Full config flow: combined agents and security validation', () => {
  it('should validate both agents and security together from a complete config', () => {
    const config = createMinimalConfig({
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
        },
      },
      security: {
        sanitizeContent: true,
        validateUrls: true,
        maxFetchSizeBytes: 1048576,
        blockedCommandPatterns: ['rm\\s+-rf'],
      },
    });

    const normalized = normalizeAgentsConfig(config);
    expect(() => validateAgentsConfig(normalized)).not.toThrow();

    if (config.security) {
      expect(() => validateSecurityConfig(config.security)).not.toThrow();
    }
  });

  it('should handle the full example config from the story spec', () => {
    // This mirrors the example JSON from the story specification
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
    });

    // Normalize: agents is present, so it takes priority over legacy agent
    const normalized = normalizeAgentsConfig(config);

    // Validate agents config
    expect(() => validateAgentsConfig(normalized)).not.toThrow();

    // Validate security config
    if (config.security) {
      expect(() => validateSecurityConfig(config.security)).not.toThrow();
    }

    // Verify normalized structure
    expect(normalized.defaults.providerChain).toHaveLength(2);
    expect(normalized.defaults.providerChain[0]?.provider).toBe('openrouter');
    expect(normalized.defaults.providerChain[0]?.model).toBe('z-ai/z1-mini');
    expect(normalized.defaults.providerChain[1]?.provider).toBe('opencode');
    expect(normalized.roles?.architect?.maxBudgetUsd).toBe(2.0);
    expect(normalized.roles?.implementer?.providerChain).toHaveLength(2);
    expect(normalized.roles?.implementer?.maxBudgetUsd).toBe(5.0);
  });

  it('should work with legacy-only config (no agents, no security)', () => {
    const config = createMinimalConfig();

    // Normalize from legacy
    const normalized = normalizeAgentsConfig(config);

    // Validate
    expect(() => validateAgentsConfig(normalized)).not.toThrow();

    // No security config to validate
    expect(config.security).toBeUndefined();

    // Verify legacy mapping
    expect(normalized.defaults.providerChain[0]?.provider).toBe('claude-code');
    expect(normalized.defaults.providerChain[0]?.model).toBe('claude-sonnet-4-5');
    expect(normalized.defaults.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
    expect(normalized.defaults.maxBudgetUsd).toBe(1.0);
    expect(normalized.defaults.permissionMode).toBe('default');
  });
});

// --- Immutability guarantees ---

describe('Config flow immutability', () => {
  it('should not mutate the original config during normalize + validate', () => {
    const agents: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'claude-code', model: 'claude-sonnet-4-5' }],
        maxBudgetUsd: 1.0,
      },
    };

    const config = createMinimalConfig({ agents });
    const originalAgents = structuredClone(config.agents);

    const normalized = normalizeAgentsConfig(config);
    validateAgentsConfig(normalized);

    // Mutating the normalized result should not affect the original
    normalized.defaults.providerChain.push({ provider: 'opencode' });
    expect(config.agents).toEqual(originalAgents);
  });

  it('should not mutate legacy config during normalize + validate', () => {
    const config = createMinimalConfig({
      agent: {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write'],
        permissionMode: 'default',
      },
    });

    const originalAgent = structuredClone(config.agent);

    const normalized = normalizeAgentsConfig(config);
    validateAgentsConfig(normalized);

    // Mutating the normalized result should not affect the original
    normalized.defaults.allowedTools?.push('Bash');
    expect(config.agent).toEqual(originalAgent);
  });
});

// --- Provider name validation edge cases ---

describe('Provider name validation edge cases', () => {
  it('should validate all provider names from the example config', () => {
    const providerNames = [
      'claude-code',
      'openrouter',
      'opencode',
      'zen-mcp',
      'local',
    ];

    for (const name of providerNames) {
      expect(() => validateProviderName(name)).not.toThrow();
    }
  });

  it('should reject prototype pollution attempts', () => {
    const forbidden = ['__proto__', 'constructor', 'prototype'];
    for (const name of forbidden) {
      expect(() => validateProviderName(name)).toThrow(TammaError);
    }
  });

  it('should enforce lowercase alphanumeric start', () => {
    expect(() => validateProviderName('a-valid-name')).not.toThrow();
    expect(() => validateProviderName('0-numeric-start')).not.toThrow();
    expect(() => validateProviderName('-invalid-start')).toThrow(TammaError);
    expect(() => validateProviderName('_invalid-start')).toThrow(TammaError);
    expect(() => validateProviderName('Uppercase')).toThrow(TammaError);
  });
});

// --- Budget validation edge cases ---

describe('Budget validation edge cases', () => {
  it('should accept zero budget', () => {
    expect(() => validateMaxBudgetUsd(0)).not.toThrow();
  });

  it('should accept maximum budget', () => {
    expect(() => validateMaxBudgetUsd(100)).not.toThrow();
  });

  it('should reject NaN budget', () => {
    expect(() => validateMaxBudgetUsd(NaN)).toThrow(TammaError);
  });

  it('should reject infinite budget', () => {
    expect(() => validateMaxBudgetUsd(Infinity)).toThrow(TammaError);
    expect(() => validateMaxBudgetUsd(-Infinity)).toThrow(TammaError);
  });

  it('should reject negative budget', () => {
    expect(() => validateMaxBudgetUsd(-0.01)).toThrow(TammaError);
  });

  it('should reject over-limit budget', () => {
    expect(() => validateMaxBudgetUsd(100.01)).toThrow(TammaError);
  });

  it('should accept fractional budget within range', () => {
    expect(() => validateMaxBudgetUsd(0.50)).not.toThrow();
    expect(() => validateMaxBudgetUsd(99.99)).not.toThrow();
  });
});
