import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PHASE_ROLE_MAP,
  ENGINE_STATE_TO_PHASE,
  validateSecurityConfig,
  validateProviderName,
  validateMaxBudgetUsd,
  validateAgentsConfig,
} from './agent-config.js';
import type {
  WorkflowPhase,
  PermissionMode,
  IProviderChainEntry,
  ProviderChainEntry,
  IAgentRoleConfig,
  AgentRoleConfig,
  IAgentsConfig,
  AgentsConfig,
  AgentType,
} from './agent-config.js';
import type { SecurityConfig } from './security-config.js';
import { TammaError } from '../errors.js';

// --- WorkflowPhase ---

describe('WorkflowPhase', () => {
  it('should have exactly 8 phases in DEFAULT_PHASE_ROLE_MAP', () => {
    const phases = Object.keys(DEFAULT_PHASE_ROLE_MAP);
    expect(phases).toHaveLength(8);
  });

  it('should include all 8 workflow phases', () => {
    const expectedPhases: WorkflowPhase[] = [
      'ISSUE_SELECTION',
      'CONTEXT_ANALYSIS',
      'PLAN_GENERATION',
      'CODE_GENERATION',
      'PR_CREATION',
      'CODE_REVIEW',
      'TEST_EXECUTION',
      'STATUS_MONITORING',
    ];

    for (const phase of expectedPhases) {
      expect(DEFAULT_PHASE_ROLE_MAP).toHaveProperty(phase);
    }
  });
});

// --- DEFAULT_PHASE_ROLE_MAP ---

describe('DEFAULT_PHASE_ROLE_MAP', () => {
  const VALID_AGENT_TYPES: AgentType[] = [
    'scrum_master',
    'architect',
    'researcher',
    'analyst',
    'planner',
    'implementer',
    'reviewer',
    'tester',
    'documenter',
  ];

  it('should map every phase to a valid AgentType', () => {
    for (const [_phase, role] of Object.entries(DEFAULT_PHASE_ROLE_MAP)) {
      expect(VALID_AGENT_TYPES).toContain(role);
    }
  });

  it('should map specific phases to their expected roles', () => {
    expect(DEFAULT_PHASE_ROLE_MAP.ISSUE_SELECTION).toBe('scrum_master');
    expect(DEFAULT_PHASE_ROLE_MAP.CONTEXT_ANALYSIS).toBe('analyst');
    expect(DEFAULT_PHASE_ROLE_MAP.PLAN_GENERATION).toBe('architect');
    expect(DEFAULT_PHASE_ROLE_MAP.CODE_GENERATION).toBe('implementer');
    expect(DEFAULT_PHASE_ROLE_MAP.PR_CREATION).toBe('implementer');
    expect(DEFAULT_PHASE_ROLE_MAP.CODE_REVIEW).toBe('reviewer');
    expect(DEFAULT_PHASE_ROLE_MAP.TEST_EXECUTION).toBe('tester');
    expect(DEFAULT_PHASE_ROLE_MAP.STATUS_MONITORING).toBe('scrum_master');
  });

  it('should be frozen (immutable)', () => {
    expect(Object.isFrozen(DEFAULT_PHASE_ROLE_MAP)).toBe(true);
  });

  it('should not allow mutation', () => {
    expect(() => {
      // @ts-expect-error -- testing runtime immutability
      DEFAULT_PHASE_ROLE_MAP.ISSUE_SELECTION = 'tester';
    }).toThrow();
  });
});

// --- ENGINE_STATE_TO_PHASE ---

describe('ENGINE_STATE_TO_PHASE', () => {
  it('should have exactly 6 entries', () => {
    const entries = Object.keys(ENGINE_STATE_TO_PHASE);
    expect(entries).toHaveLength(6);
  });

  it('should map engine states to valid workflow phases', () => {
    const validPhases: WorkflowPhase[] = [
      'ISSUE_SELECTION',
      'CONTEXT_ANALYSIS',
      'PLAN_GENERATION',
      'CODE_GENERATION',
      'PR_CREATION',
      'CODE_REVIEW',
      'TEST_EXECUTION',
      'STATUS_MONITORING',
    ];

    for (const [_state, phase] of Object.entries(ENGINE_STATE_TO_PHASE)) {
      expect(validPhases).toContain(phase);
    }
  });

  it('should map specific states to their expected phases', () => {
    expect(ENGINE_STATE_TO_PHASE['SELECTING_ISSUE']).toBe('ISSUE_SELECTION');
    expect(ENGINE_STATE_TO_PHASE['ANALYZING']).toBe('CONTEXT_ANALYSIS');
    expect(ENGINE_STATE_TO_PHASE['PLANNING']).toBe('PLAN_GENERATION');
    expect(ENGINE_STATE_TO_PHASE['IMPLEMENTING']).toBe('CODE_GENERATION');
    expect(ENGINE_STATE_TO_PHASE['CREATING_PR']).toBe('PR_CREATION');
    expect(ENGINE_STATE_TO_PHASE['MONITORING']).toBe('STATUS_MONITORING');
  });

  it('should be frozen (immutable)', () => {
    expect(Object.isFrozen(ENGINE_STATE_TO_PHASE)).toBe(true);
  });

  it('should not allow mutation', () => {
    expect(() => {
      // @ts-expect-error -- testing runtime immutability
      ENGINE_STATE_TO_PHASE['SELECTING_ISSUE'] = 'CODE_REVIEW';
    }).toThrow();
  });

  it('should not have entries for CODE_REVIEW or TEST_EXECUTION', () => {
    // These are sub-phases within the implementation cycle
    expect(Object.values(ENGINE_STATE_TO_PHASE)).not.toContain('CODE_REVIEW');
    expect(Object.values(ENGINE_STATE_TO_PHASE)).not.toContain('TEST_EXECUTION');
  });
});

// --- Type Conformance Tests ---

describe('Type conformance', () => {
  it('should allow constructing a valid ProviderChainEntry', () => {
    const entry: ProviderChainEntry = {
      provider: 'claude-code',
      model: 'claude-sonnet-4-5',
      apiKeyRef: 'ANTHROPIC_API_KEY',
      config: { baseUrl: 'https://api.anthropic.com', timeout: 30000 },
    };

    expect(entry.provider).toBe('claude-code');
    expect(entry.model).toBe('claude-sonnet-4-5');
    expect(entry.apiKeyRef).toBe('ANTHROPIC_API_KEY');
    expect(entry.config).toBeDefined();
  });

  it('should allow constructing a ProviderChainEntry with only provider', () => {
    const entry: ProviderChainEntry = {
      provider: 'opencode',
    };

    expect(entry.provider).toBe('opencode');
    expect(entry.model).toBeUndefined();
    expect(entry.apiKeyRef).toBeUndefined();
    expect(entry.config).toBeUndefined();
  });

  it('should allow IProviderChainEntry and ProviderChainEntry to be interchangeable', () => {
    const entry: IProviderChainEntry = { provider: 'zen-mcp' };
    const alias: ProviderChainEntry = entry;
    expect(alias.provider).toBe('zen-mcp');
  });

  it('should allow constructing a valid AgentRoleConfig', () => {
    const config: AgentRoleConfig = {
      providerChain: [
        { provider: 'openrouter', model: 'z-ai/z1-mini' },
        { provider: 'opencode' },
      ],
      allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
      maxBudgetUsd: 5.0,
      permissionMode: 'default',
      systemPrompt: 'You are an expert developer.',
      providerPrompts: { openrouter: 'Specialized prompt for openrouter' },
    };

    expect(config.providerChain).toHaveLength(2);
    expect(config.allowedTools).toHaveLength(4);
    expect(config.maxBudgetUsd).toBe(5.0);
    expect(config.permissionMode).toBe('default');
    expect(config.systemPrompt).toBeDefined();
    expect(config.providerPrompts).toBeDefined();
  });

  it('should allow PermissionMode in AgentRoleConfig.permissionMode', () => {
    const mode1: PermissionMode = 'bypassPermissions';
    const mode2: PermissionMode = 'default';

    const config1: AgentRoleConfig = {
      providerChain: [{ provider: 'test' }],
      permissionMode: mode1,
    };

    const config2: AgentRoleConfig = {
      providerChain: [{ provider: 'test' }],
      permissionMode: mode2,
    };

    expect(config1.permissionMode).toBe('bypassPermissions');
    expect(config2.permissionMode).toBe('default');
  });

  it('should allow constructing a valid AgentsConfig', () => {
    const config: AgentsConfig = {
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
      phaseRoleMap: {
        CODE_GENERATION: 'architect',
      },
    };

    expect(config.defaults.providerChain).toHaveLength(2);
    expect(config.roles?.architect?.maxBudgetUsd).toBe(2.0);
    expect(config.roles?.implementer?.providerChain).toHaveLength(2);
    expect(config.phaseRoleMap?.CODE_GENERATION).toBe('architect');
  });

  it('should allow constructing a minimal AgentsConfig with only defaults', () => {
    const config: AgentsConfig = {
      defaults: {
        providerChain: [{ provider: 'claude-code' }],
      },
    };

    expect(config.defaults.providerChain).toHaveLength(1);
    expect(config.roles).toBeUndefined();
    expect(config.phaseRoleMap).toBeUndefined();
  });

  it('should allow IAgentsConfig and AgentsConfig to be interchangeable', () => {
    const config: IAgentsConfig = {
      defaults: { providerChain: [{ provider: 'test' }] },
    };
    const alias: AgentsConfig = config;
    expect(alias.defaults.providerChain).toHaveLength(1);
  });

  it('should allow constructing a valid SecurityConfig', () => {
    const config: SecurityConfig = {
      sanitizeContent: true,
      validateUrls: true,
      gateActions: false,
      maxFetchSizeBytes: 1048576,
      blockedCommandPatterns: ['rm\\s+-rf', 'sudo\\s+'],
    };

    expect(config.sanitizeContent).toBe(true);
    expect(config.validateUrls).toBe(true);
    expect(config.gateActions).toBe(false);
    expect(config.maxFetchSizeBytes).toBe(1048576);
    expect(config.blockedCommandPatterns).toHaveLength(2);
  });

  it('should allow constructing an empty SecurityConfig', () => {
    const config: SecurityConfig = {};
    expect(config.sanitizeContent).toBeUndefined();
    expect(config.validateUrls).toBeUndefined();
    expect(config.gateActions).toBeUndefined();
    expect(config.maxFetchSizeBytes).toBeUndefined();
    expect(config.blockedCommandPatterns).toBeUndefined();
  });
});

// --- Validation: SecurityConfig ---

describe('validateSecurityConfig', () => {
  it('should accept valid config', () => {
    expect(() =>
      validateSecurityConfig({
        sanitizeContent: true,
        validateUrls: true,
        maxFetchSizeBytes: 1048576,
        blockedCommandPatterns: ['rm\\s+-rf'],
      }),
    ).not.toThrow();
  });

  it('should accept empty config', () => {
    expect(() => validateSecurityConfig({})).not.toThrow();
  });

  it('should reject blockedCommandPatterns exceeding 100 patterns', () => {
    const patterns = Array.from({ length: 101 }, (_, i) => `pattern${i}`);
    expect(() =>
      validateSecurityConfig({ blockedCommandPatterns: patterns }),
    ).toThrow(TammaError);
  });

  it('should reject blockedCommandPattern exceeding 500 chars', () => {
    const longPattern = 'a'.repeat(501);
    expect(() =>
      validateSecurityConfig({ blockedCommandPatterns: [longPattern] }),
    ).toThrow(TammaError);
  });

  it('should throw CONFIG.INVALID_REGEX for invalid regex patterns', () => {
    try {
      validateSecurityConfig({ blockedCommandPatterns: ['[invalid'] });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TammaError);
      expect((error as TammaError).code).toBe('CONFIG.INVALID_REGEX');
    }
  });

  it('should accept maxFetchSizeBytes at boundary values', () => {
    expect(() => validateSecurityConfig({ maxFetchSizeBytes: 0 })).not.toThrow();
    expect(() =>
      validateSecurityConfig({ maxFetchSizeBytes: 1_073_741_824 }),
    ).not.toThrow();
  });

  it('should reject maxFetchSizeBytes below 0', () => {
    expect(() =>
      validateSecurityConfig({ maxFetchSizeBytes: -1 }),
    ).toThrow(TammaError);
  });

  it('should reject maxFetchSizeBytes above 1 GiB', () => {
    expect(() =>
      validateSecurityConfig({ maxFetchSizeBytes: 1_073_741_825 }),
    ).toThrow(TammaError);
  });

  it('should reject NaN maxFetchSizeBytes', () => {
    expect(() =>
      validateSecurityConfig({ maxFetchSizeBytes: NaN }),
    ).toThrow(TammaError);
  });

  it('should reject Infinity maxFetchSizeBytes', () => {
    expect(() =>
      validateSecurityConfig({ maxFetchSizeBytes: Infinity }),
    ).toThrow(TammaError);
  });
});

// --- Validation: Provider Name ---

describe('validateProviderName', () => {
  it('should accept valid provider names', () => {
    expect(() => validateProviderName('claude-code')).not.toThrow();
    expect(() => validateProviderName('openrouter')).not.toThrow();
    expect(() => validateProviderName('zen-mcp')).not.toThrow();
    expect(() => validateProviderName('opencode')).not.toThrow();
    expect(() => validateProviderName('local')).not.toThrow();
    expect(() => validateProviderName('a')).not.toThrow();
    expect(() => validateProviderName('provider_with_underscore')).not.toThrow();
    expect(() => validateProviderName('0-starts-with-digit')).not.toThrow();
  });

  it('should reject __proto__', () => {
    expect(() => validateProviderName('__proto__')).toThrow(TammaError);
  });

  it('should reject constructor', () => {
    expect(() => validateProviderName('constructor')).toThrow(TammaError);
  });

  it('should reject prototype', () => {
    expect(() => validateProviderName('prototype')).toThrow(TammaError);
  });

  it('should reject names starting with special characters', () => {
    expect(() => validateProviderName('-starts-with-dash')).toThrow(TammaError);
    expect(() => validateProviderName('_starts-with-underscore')).toThrow(TammaError);
  });

  it('should reject empty string', () => {
    expect(() => validateProviderName('')).toThrow(TammaError);
  });

  it('should reject names with uppercase letters', () => {
    expect(() => validateProviderName('ClaudeCode')).toThrow(TammaError);
  });

  it('should reject names longer than 64 characters', () => {
    const longName = 'a'.repeat(65);
    expect(() => validateProviderName(longName)).toThrow(TammaError);
  });

  it('should accept names of exactly 64 characters', () => {
    const maxName = 'a'.repeat(64);
    expect(() => validateProviderName(maxName)).not.toThrow();
  });

  it('should reject names with spaces', () => {
    expect(() => validateProviderName('has space')).toThrow(TammaError);
  });

  it('should throw with code CONFIG.INVALID_PROVIDER_NAME', () => {
    try {
      validateProviderName('__proto__');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TammaError);
      expect((error as TammaError).code).toBe('CONFIG.INVALID_PROVIDER_NAME');
    }
  });
});

// --- Validation: maxBudgetUsd ---

describe('validateMaxBudgetUsd', () => {
  it('should accept valid budget values', () => {
    expect(() => validateMaxBudgetUsd(0)).not.toThrow();
    expect(() => validateMaxBudgetUsd(1.5)).not.toThrow();
    expect(() => validateMaxBudgetUsd(100)).not.toThrow();
    expect(() => validateMaxBudgetUsd(50)).not.toThrow();
  });

  it('should reject NaN', () => {
    expect(() => validateMaxBudgetUsd(NaN)).toThrow(TammaError);
  });

  it('should reject Infinity', () => {
    expect(() => validateMaxBudgetUsd(Infinity)).toThrow(TammaError);
  });

  it('should reject -Infinity', () => {
    expect(() => validateMaxBudgetUsd(-Infinity)).toThrow(TammaError);
  });

  it('should reject negative values', () => {
    expect(() => validateMaxBudgetUsd(-1)).toThrow(TammaError);
  });

  it('should reject values above the upper bound', () => {
    expect(() => validateMaxBudgetUsd(101)).toThrow(TammaError);
  });

  it('should accept custom upper bound', () => {
    expect(() => validateMaxBudgetUsd(200, 500)).not.toThrow();
    expect(() => validateMaxBudgetUsd(501, 500)).toThrow(TammaError);
  });
});

// --- Validation: AgentsConfig ---

describe('validateAgentsConfig', () => {
  it('should accept valid config', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
      }),
    ).not.toThrow();
  });

  it('should reject empty provider chain in defaults', () => {
    try {
      validateAgentsConfig({
        defaults: {
          providerChain: [],
        },
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TammaError);
      expect((error as TammaError).code).toBe('CONFIG.EMPTY_PROVIDER_CHAIN');
    }
  });

  it('should reject invalid provider names in defaults', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: '__proto__' }],
        },
      }),
    ).toThrow(TammaError);
  });

  it('should reject invalid maxBudgetUsd in defaults', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
          maxBudgetUsd: NaN,
        },
      }),
    ).toThrow(TammaError);
  });

  it('should validate role overrides', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
        roles: {
          architect: {
            providerChain: [{ provider: 'openrouter' }],
            maxBudgetUsd: 2.0,
          },
        },
      }),
    ).not.toThrow();
  });

  it('should reject invalid provider names in role overrides', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
        roles: {
          architect: {
            providerChain: [{ provider: 'INVALID_NAME' }],
          },
        },
      }),
    ).toThrow(TammaError);
  });

  it('should reject invalid maxBudgetUsd in role overrides', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
        roles: {
          architect: {
            maxBudgetUsd: Infinity,
          },
        },
      }),
    ).toThrow(TammaError);
  });

  it('should accept config with phaseRoleMap', () => {
    expect(() =>
      validateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'claude-code' }],
        },
        phaseRoleMap: {
          CODE_GENERATION: 'architect',
        },
      }),
    ).not.toThrow();
  });
});

// --- Exports Accessibility ---

describe('Module exports', () => {
  it('should export DEFAULT_PHASE_ROLE_MAP as a value', () => {
    expect(typeof DEFAULT_PHASE_ROLE_MAP).toBe('object');
  });

  it('should export ENGINE_STATE_TO_PHASE as a value', () => {
    expect(typeof ENGINE_STATE_TO_PHASE).toBe('object');
  });

  it('should export validation functions', () => {
    expect(typeof validateSecurityConfig).toBe('function');
    expect(typeof validateProviderName).toBe('function');
    expect(typeof validateMaxBudgetUsd).toBe('function');
    expect(typeof validateAgentsConfig).toBe('function');
  });
});
