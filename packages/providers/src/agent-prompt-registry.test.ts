/**
 * Test suite for AgentPromptRegistry
 *
 * Tests:
 * - Built-in templates cover all 9 AgentType roles
 * - 6-level resolution chain with comprehensive fallthrough tests
 * - {{variable}} interpolation via render()
 * - Security guards (forbidden keys, immutable roles, Object.hasOwn)
 * - Size limits (MAX_VAR_VALUE_LENGTH, MAX_TEMPLATE_LENGTH)
 * - Null-safety with minimal config
 * - Empty-string semantics at every resolution level
 * - registerBuiltin() override, logging, and security behavior
 * - Prototype pollution protection
 *
 * Story 9-6: Agent Prompt Registry (Task 1 + Task 2 + Task 3)
 */

import { describe, it, expect, vi } from 'vitest';
import type { AgentType, AgentsConfig } from '@tamma/shared';
import type { ILogger } from '@tamma/shared/contracts';
import {
  AgentPromptRegistry,
  type IAgentPromptRegistry,
  type AgentPromptRegistryOptions,
} from './agent-prompt-registry.js';

// --- Helpers ---

/** All 9 AgentType values */
const ALL_AGENT_TYPES: AgentType[] = [
  'architect',
  'implementer',
  'reviewer',
  'tester',
  'analyst',
  'scrum_master',
  'researcher',
  'planner',
  'documenter',
];

/** The expected GENERIC_FALLBACK text */
const GENERIC_FALLBACK_TEXT = 'You are an AI assistant working on a software development task.';

/** Minimal AgentsConfig with no roles, no systemPrompt, no providerPrompts */
function minimalConfig(): AgentsConfig {
  return { defaults: { providerChain: [] } };
}

/** Create a mock logger */
function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Create a registry with minimal config and optional logger */
function createRegistry(
  configOverrides?: Partial<AgentsConfig>,
  logger?: ILogger,
  immutableRoles?: ReadonlySet<string>,
): AgentPromptRegistry {
  const config: AgentsConfig = {
    ...minimalConfig(),
    ...configOverrides,
    defaults: {
      ...minimalConfig().defaults,
      ...configOverrides?.defaults,
    },
  };
  const options: AgentPromptRegistryOptions = { config };
  if (logger !== undefined) {
    options.logger = logger;
  }
  if (immutableRoles !== undefined) {
    options.immutableRoles = immutableRoles;
  }
  return new AgentPromptRegistry(options);
}

// --- Tests ---

describe('AgentPromptRegistry', () => {
  describe('interface and constructor', () => {
    it('should implement IAgentPromptRegistry interface', () => {
      const registry: IAgentPromptRegistry = createRegistry();
      expect(typeof registry.render).toBe('function');
      expect(typeof registry.resolveTemplate).toBe('function');
      expect(typeof registry.registerBuiltin).toBe('function');
    });

    it('should accept AgentPromptRegistryOptions (not bare AgentsConfig)', () => {
      const options: AgentPromptRegistryOptions = {
        config: minimalConfig(),
      };
      const registry = new AgentPromptRegistry(options);
      expect(registry).toBeInstanceOf(AgentPromptRegistry);
    });

    it('should not throw with a valid AgentPromptRegistryOptions', () => {
      expect(() => createRegistry()).not.toThrow();
    });

    it('should accept optional logger and immutableRoles', () => {
      const logger = createMockLogger();
      const immutableRoles = new Set(['reviewer']);
      const options: AgentPromptRegistryOptions = {
        config: minimalConfig(),
        logger,
        immutableRoles,
      };
      const registry = new AgentPromptRegistry(options);
      expect(registry).toBeInstanceOf(AgentPromptRegistry);
    });
  });

  describe('built-in templates', () => {
    it('should have built-in templates for all 9 AgentType roles', () => {
      const registry = createRegistry();
      for (const role of ALL_AGENT_TYPES) {
        const template = registry.resolveTemplate(role, 'some-provider');
        // Should NOT be the generic fallback since all 9 roles have built-ins
        expect(template).not.toBe(GENERIC_FALLBACK_TEXT);
        expect(template.length).toBeGreaterThan(0);
      }
    });

    it('each built-in template should be a non-empty string', () => {
      const registry = createRegistry();
      for (const role of ALL_AGENT_TYPES) {
        const template = registry.resolveTemplate(role, 'any-provider');
        expect(typeof template).toBe('string');
        expect(template.length).toBeGreaterThan(0);
      }
    });

    it('architect template should contain {{context}} placeholder', () => {
      const registry = createRegistry();
      const template = registry.resolveTemplate('architect', 'test-provider');
      expect(template).toContain('{{context}}');
    });

    it('implementer template should contain {{issueNumber}} placeholder', () => {
      const registry = createRegistry();
      const template = registry.resolveTemplate('implementer', 'test-provider');
      expect(template).toContain('{{issueNumber}}');
    });
  });

  describe('resolveTemplate - 6-level resolution chain', () => {
    // --- Level 1: per-provider-per-role ---
    it('level 1: returns roles[role].providerPrompts[providerName] when set', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          architect: {
            providerPrompts: { 'claude-code': 'Provider-specific architect prompt' },
            systemPrompt: 'Role-level prompt',
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Provider-specific architect prompt');
    });

    it('level 1 fallthrough: falls through to level 2 when providerPrompts exists but has no entry for the provider', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          architect: {
            providerPrompts: { 'other-provider': 'Other prompt' },
            systemPrompt: 'Role-level system prompt',
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Role-level system prompt');
    });

    // --- Level 2: per-role systemPrompt ---
    it('level 2: returns roles[role].systemPrompt when no provider-specific match', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          architect: {
            systemPrompt: 'Architect system prompt',
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Architect system prompt');
    });

    it('level 2 fallthrough: falls through to level 3 when roles[role] exists but has no systemPrompt', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'claude-code': 'Default provider prompt' },
        },
        roles: {
          architect: {
            // No providerPrompts, no systemPrompt -- just empty role config
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Default provider prompt');
    });

    // --- Level 3: per-provider default ---
    it('level 3: returns defaults.providerPrompts[providerName] when role has no prompt config', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'claude-code': 'Default prompt for claude-code' },
          systemPrompt: 'Global default prompt',
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Default prompt for claude-code');
    });

    it('level 3 fallthrough: falls through to level 4 when defaults.providerPrompts exists but has no entry for the provider', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'other-provider': 'Other provider prompt' },
          systemPrompt: 'Global default system prompt',
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Global default system prompt');
    });

    // --- Level 4: global default systemPrompt ---
    it('level 4: returns defaults.systemPrompt when no provider-specific default match', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          systemPrompt: 'Global default system prompt only',
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('Global default system prompt only');
    });

    it('level 4 fallthrough: falls through to level 5 when defaults has no systemPrompt', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          // no systemPrompt, no providerPrompts
        },
      });
      const result = registry.resolveTemplate('architect', 'any-provider');
      // Should get the built-in architect template
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    // --- Level 5: built-in template ---
    it('level 5: returns builtinTemplates[role] when no config-level prompt exists', () => {
      const registry = createRegistry();
      const result = registry.resolveTemplate('architect', 'any-provider');
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    it('level 5: returns builtinTemplates for each of the 9 built-in roles', () => {
      const registry = createRegistry();
      for (const role of ALL_AGENT_TYPES) {
        const template = registry.resolveTemplate(role, 'any-provider');
        expect(template).not.toBe(GENERIC_FALLBACK_TEXT);
      }
    });

    // --- Level 6: GENERIC_FALLBACK ---
    it('level 6: returns GENERIC_FALLBACK when role has no built-in template and no config', () => {
      // All 9 AgentType roles have built-ins. To test GENERIC_FALLBACK,
      // we cast an unknown role string to AgentType. This simulates a future
      // scenario where a new AgentType is added without a built-in template.
      const registry = createRegistry();
      const unknownRole = 'unknown_future_role' as AgentType;
      const result = registry.resolveTemplate(unknownRole, 'any-provider');
      expect(result).toBe(GENERIC_FALLBACK_TEXT);
    });

    it('level 6: GENERIC_FALLBACK is used when all preceding levels are exhausted', () => {
      // Use minimal config (no roles, no defaults.systemPrompt, no defaults.providerPrompts)
      // and a non-existent role
      const registry = new AgentPromptRegistry({ config: minimalConfig() });
      const result = registry.resolveTemplate('unknown_role' as AgentType, 'any-provider');
      expect(result).toBe(GENERIC_FALLBACK_TEXT);
    });
  });

  describe('resolveTemplate - null-safety edge cases', () => {
    it('config.roles is undefined -- resolution skips levels 1 and 2', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        // no roles
      });
      const result = registry.resolveTemplate('architect', 'provider');
      // Should fall through to built-in (level 5)
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    it('config.roles[role] is undefined -- resolution skips levels 1 and 2', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          // Define a role for reviewer, but not for architect
          reviewer: { systemPrompt: 'Reviewer prompt' },
        },
      });
      const result = registry.resolveTemplate('architect', 'provider');
      // architect has no role config, should fall through to built-in
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    it('config.roles[role] exists but providerPrompts is undefined -- resolution skips level 1', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          architect: {
            // No providerPrompts, no systemPrompt
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'provider');
      // Should skip levels 1 and 2, fall through to built-in (level 5)
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    it('config.defaults.providerPrompts is undefined -- resolution skips level 3', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          // no providerPrompts
          // no systemPrompt
        },
      });
      const result = registry.resolveTemplate('architect', 'provider');
      // Should skip level 3, skip level 4, fall through to built-in (level 5)
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    it('config.defaults.systemPrompt is undefined -- resolution skips level 4', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'other-provider': 'Not matching' },
          // no systemPrompt
        },
      });
      const result = registry.resolveTemplate('architect', 'some-provider');
      // Level 3 doesn't match (wrong provider), level 4 skipped (no systemPrompt)
      // Falls through to built-in (level 5)
      expect(result).toContain('You are analyzing a GitHub issue');
    });

    it('works correctly with minimal config: { defaults: { providerChain: [] } }', () => {
      const registry = new AgentPromptRegistry({ config: minimalConfig() });
      for (const role of ALL_AGENT_TYPES) {
        const template = registry.resolveTemplate(role, 'any-provider');
        expect(typeof template).toBe('string');
        expect(template.length).toBeGreaterThan(0);
      }
    });
  });

  describe('resolveTemplate - empty string semantics', () => {
    it('empty string at level 1 (providerPrompts) is returned as valid, not skipped', () => {
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          architect: {
            providerPrompts: { 'claude-code': '' },
            systemPrompt: 'Should not reach this',
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('');
    });

    it('empty string at level 2 (systemPrompt) is returned as valid, not skipped', () => {
      const registry = createRegistry({
        defaults: { providerChain: [], systemPrompt: 'Should not reach this' },
        roles: {
          architect: {
            systemPrompt: '',
          },
        },
      });
      const result = registry.resolveTemplate('architect', 'provider');
      expect(result).toBe('');
    });

    it('empty string at level 3 (defaults.providerPrompts) is returned as valid, not skipped', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'claude-code': '' },
          systemPrompt: 'Should not reach this',
        },
      });
      const result = registry.resolveTemplate('architect', 'claude-code');
      expect(result).toBe('');
    });

    it('empty string at level 4 (defaults.systemPrompt) is returned as valid, not skipped', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          systemPrompt: '',
        },
      });
      const result = registry.resolveTemplate('architect', 'provider');
      expect(result).toBe('');
    });
  });

  describe('resolveTemplate - security guards', () => {
    it('throws for providerName = "__proto__"', () => {
      const registry = createRegistry();
      expect(() => registry.resolveTemplate('architect', '__proto__')).toThrow(
        'Cannot resolve template with forbidden provider name: __proto__',
      );
    });

    it('throws for providerName = "constructor"', () => {
      const registry = createRegistry();
      expect(() => registry.resolveTemplate('architect', 'constructor')).toThrow(
        'Cannot resolve template with forbidden provider name: constructor',
      );
    });

    it('throws for providerName = "prototype"', () => {
      const registry = createRegistry();
      expect(() => registry.resolveTemplate('architect', 'prototype')).toThrow(
        'Cannot resolve template with forbidden provider name: prototype',
      );
    });

    it('Object.hasOwn() guards on role-level providerPrompts prevent prototype chain lookups', () => {
      // Create a config where providerPrompts is a regular object.
      // Inherited properties like 'toString' should NOT be matched.
      const registry = createRegistry({
        defaults: { providerChain: [] },
        roles: {
          architect: {
            providerPrompts: { 'legit-provider': 'Legit prompt' },
            systemPrompt: 'Role system prompt',
          },
        },
      });
      // 'toString' is inherited from Object.prototype -- should NOT be found by Object.hasOwn
      const result = registry.resolveTemplate('architect', 'toString');
      // Should fall through level 1 (Object.hasOwn returns false) to level 2
      expect(result).toBe('Role system prompt');
    });

    it('Object.hasOwn() guards on defaults.providerPrompts prevent prototype chain lookups', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'legit-provider': 'Legit prompt' },
          systemPrompt: 'Global default',
        },
      });
      // 'hasOwnProperty' is inherited from Object.prototype
      const result = registry.resolveTemplate('architect', 'hasOwnProperty');
      // Should fall through level 3 (Object.hasOwn returns false) to level 4
      expect(result).toBe('Global default');
    });
  });

  describe('render - variable interpolation', () => {
    it('replaces {{context}} with provided value', () => {
      const registry = createRegistry();
      const result = registry.render('architect', 'provider', {
        context: 'Issue #42: Fix the bug',
      });
      expect(result).toContain('Issue #42: Fix the bug');
      expect(result).not.toContain('{{context}}');
    });

    it('replaces {{issueNumber}} with provided value', () => {
      const registry = createRegistry();
      const result = registry.render('implementer', 'provider', {
        issueNumber: '42',
      });
      expect(result).toContain('issue #42');
      expect(result).not.toContain('{{issueNumber}}');
    });

    it('replaces multiple variables in one template', () => {
      const configWithCustom: AgentsConfig = {
        defaults: {
          providerChain: [],
        },
        roles: {
          architect: {
            systemPrompt: 'Hello {{name}}, your task is {{task}}.',
          },
        },
      };
      const registry = new AgentPromptRegistry({ config: configWithCustom });
      const result = registry.render('architect', 'provider', {
        name: 'Agent',
        task: 'build a feature',
      });
      expect(result).toBe('Hello Agent, your task is build a feature.');
    });

    it('leaves {{placeholders}} unchanged when no vars provided', () => {
      const registry = createRegistry();
      const result = registry.render('architect', 'provider');
      expect(result).toContain('{{context}}');
    });

    it('leaves {{placeholders}} unchanged when vars is empty object', () => {
      const registry = createRegistry();
      const result = registry.render('architect', 'provider', {});
      expect(result).toContain('{{context}}');
    });

    it('leaves unmatched {{placeholders}} as-is in rendered output', () => {
      const registry = createRegistry();
      const result = registry.render('architect', 'provider', {
        unrelatedKey: 'value',
      });
      // {{context}} should still be present since {{unrelatedKey}} is not in the template
      expect(result).toContain('{{context}}');
    });

    it('handles values containing regex special characters', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Pattern: {{pattern}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        pattern: '$1.00 + 2^3 = (8) [test]',
      });
      expect(result).toBe('Pattern: $1.00 + 2^3 = (8) [test]');
    });

    it('handles iterative expansion: variable A containing {{B}} gets B expanded', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Start: {{a}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        a: 'Hello {{b}}',
        b: 'World',
      });
      expect(result).toBe('Start: Hello World');
    });

    it('replaces the same {{var}} appearing twice in a template', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Hello {{name}}, welcome {{name}}!' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        name: 'Agent',
      });
      expect(result).toBe('Hello Agent, welcome Agent!');
    });

    it('replaces {{context}} with empty string value', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Start: {{context}} end' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        context: '',
      });
      expect(result).toBe('Start:  end');
    });

    it('handles keys with special characters gracefully (no crash)', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Template with no matching placeholder' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      // Keys with special chars -- they just won't match any placeholder, but must not crash
      const result = registry.render('architect', 'provider', {
        'key.with.dots': 'value1',
        'key[0]': 'value2',
        'key$special': 'value3',
      });
      expect(result).toBe('Template with no matching placeholder');
    });

    it('handles regex special characters: foo$bar^baz.*', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Data: {{context}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        context: 'foo$bar^baz.*',
      });
      // split+join should handle regex special chars literally
      expect(result).toBe('Data: foo$bar^baz.*');
    });

    it('handles values with $& and $1 regex replacement patterns literally', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Cost: {{amount}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        amount: '$& $1 $2',
      });
      // With regex-based replace, $& and $1 would be interpreted.
      // split+join treats them literally.
      expect(result).toBe('Cost: $& $1 $2');
    });

    it('unused vars are ignored silently -- template unchanged', () => {
      const registry = createRegistry();
      const templateBefore = registry.resolveTemplate('reviewer', 'provider');
      const result = registry.render('reviewer', 'provider', {
        unused: 'value',
        another_unused: 'other',
      });
      expect(result).toBe(templateBefore);
    });
  });

  describe('render - size limits', () => {
    it('skips variables whose values exceed MAX_VAR_VALUE_LENGTH (100KB) with warning', () => {
      const logger = createMockLogger();
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Data: {{data}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config, logger });
      const oversizedValue = 'x'.repeat(100_001);
      const result = registry.render('architect', 'provider', {
        data: oversizedValue,
      });
      // Should NOT have replaced the placeholder
      expect(result).toBe('Data: {{data}}');
      // Should have logged a warning
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping variable exceeding MAX_VAR_VALUE_LENGTH',
        expect.objectContaining({
          key: 'data',
          valueLength: 100_001,
          limit: 100_000,
        }),
      );
    });

    it('allows variables exactly at MAX_VAR_VALUE_LENGTH (100KB)', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: '{{data}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const exactValue = 'x'.repeat(100_000);
      const result = registry.render('architect', 'provider', {
        data: exactValue,
      });
      expect(result).toBe(exactValue);
    });

    it('truncates rendered templates exceeding MAX_TEMPLATE_LENGTH (1MB) with warning', () => {
      const logger = createMockLogger();
      const repeatedConfig: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: '{{data}}'.repeat(20) },
        },
      };
      const registry = new AgentPromptRegistry({ config: repeatedConfig, logger });
      const largeValue = 'x'.repeat(100_000);
      // 20 * 100_000 = 2_000_000 > 1_000_000
      const result = registry.render('architect', 'provider', {
        data: largeValue,
      });
      expect(result.length).toBe(1_000_000);
      expect(logger.warn).toHaveBeenCalledWith(
        'Rendered template exceeds MAX_TEMPLATE_LENGTH, truncating',
        expect.objectContaining({
          length: 2_000_000,
          limit: 1_000_000,
        }),
      );
    });

    it('skips only the oversized variable -- others are applied normally', () => {
      const logger = createMockLogger();
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'A={{a}} B={{b}} C={{c}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config, logger });
      const oversizedValue = 'x'.repeat(100_001);
      const result = registry.render('architect', 'provider', {
        a: 'alpha',
        b: oversizedValue,
        c: 'gamma',
      });
      // 'b' should be skipped, but 'a' and 'c' should be replaced
      expect(result).toBe('A=alpha B={{b}} C=gamma');
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping variable exceeding MAX_VAR_VALUE_LENGTH',
        expect.objectContaining({ key: 'b' }),
      );
    });
  });

  describe('registerBuiltin', () => {
    it('overrides an existing built-in template (e.g., architect) -- logs WARN', () => {
      const logger = createMockLogger();
      const registry = createRegistry(undefined, logger);
      const originalTemplate = registry.resolveTemplate('architect', 'provider');
      registry.registerBuiltin('architect', 'New architect prompt: {{context}}');
      const newTemplate = registry.resolveTemplate('architect', 'provider');
      expect(newTemplate).toBe('New architect prompt: {{context}}');
      expect(newTemplate).not.toBe(originalTemplate);
      expect(logger.warn).toHaveBeenCalledWith(
        'Overriding existing built-in template',
        { role: 'architect' },
      );
    });

    it('adds a template for a role not in BUILTIN_TEMPLATES (custom role) -- logs INFO', () => {
      const logger = createMockLogger();
      const registry = createRegistry(undefined, logger);
      registry.registerBuiltin('custom_agent', 'Custom agent prompt');
      expect(logger.info).toHaveBeenCalledWith(
        'Registering new built-in template',
        { role: 'custom_agent' },
      );
    });

    it('after registerBuiltin(), resolveTemplate() returns the new template at level 5', () => {
      const registry = createRegistry();
      // Override the architect built-in
      registry.registerBuiltin('architect', 'Overridden architect template');
      // With no config-level prompts, resolveTemplate should return the new built-in
      const result = registry.resolveTemplate('architect', 'any-provider');
      expect(result).toBe('Overridden architect template');
    });

    it('does not affect the module-level BUILTIN_TEMPLATES constant (second instance test)', () => {
      // Modify built-ins on one instance
      const registry1 = createRegistry();
      const originalTemplate = registry1.resolveTemplate('architect', 'provider');
      registry1.registerBuiltin('architect', 'Modified architect on instance 1');

      // A new instance should still have the original built-in template
      const registry2 = createRegistry();
      const template2 = registry2.resolveTemplate('architect', 'provider');
      expect(template2).toBe(originalTemplate);
      expect(template2).not.toBe('Modified architect on instance 1');
    });

    it('rejects forbidden key: __proto__', () => {
      const registry = createRegistry();
      expect(() => registry.registerBuiltin('__proto__', 'bad')).toThrow(
        'Cannot register template with forbidden key: __proto__',
      );
    });

    it('rejects forbidden key: constructor', () => {
      const registry = createRegistry();
      expect(() => registry.registerBuiltin('constructor', 'bad')).toThrow(
        'Cannot register template with forbidden key: constructor',
      );
    });

    it('rejects forbidden key: prototype', () => {
      const registry = createRegistry();
      expect(() => registry.registerBuiltin('prototype', 'bad')).toThrow(
        'Cannot register template with forbidden key: prototype',
      );
    });

    it('rejects overriding a role in immutableRoles set with thrown error', () => {
      const immutableRoles = new Set(['reviewer', 'implementer']);
      const registry = createRegistry(undefined, undefined, immutableRoles);
      expect(() => registry.registerBuiltin('reviewer', 'New reviewer prompt')).toThrow(
        'Cannot override immutable role template: reviewer',
      );
      expect(() => registry.registerBuiltin('implementer', 'New impl prompt')).toThrow(
        'Cannot override immutable role template: implementer',
      );
    });

    it('allows overriding non-immutable roles even when immutableRoles is set', () => {
      const immutableRoles = new Set(['reviewer']);
      const registry = createRegistry(undefined, undefined, immutableRoles);
      // architect is not in immutableRoles, should succeed
      expect(() => registry.registerBuiltin('architect', 'New architect')).not.toThrow();
      expect(registry.resolveTemplate('architect', 'provider')).toBe('New architect');
    });

    it('logs WARN when overriding an existing template', () => {
      const logger = createMockLogger();
      const registry = createRegistry(undefined, logger);
      registry.registerBuiltin('architect', 'Overridden architect prompt');
      expect(logger.warn).toHaveBeenCalledWith(
        'Overriding existing built-in template',
        { role: 'architect' },
      );
    });

    it('logs INFO when adding a new template', () => {
      const logger = createMockLogger();
      const registry = createRegistry(undefined, logger);
      registry.registerBuiltin('my_new_role', 'Brand new template');
      expect(logger.info).toHaveBeenCalledWith(
        'Registering new built-in template',
        { role: 'my_new_role' },
      );
    });
  });

  describe('GENERIC_FALLBACK behavior', () => {
    it('all 9 built-in roles do not return GENERIC_FALLBACK', () => {
      const registry = createRegistry();
      for (const role of ALL_AGENT_TYPES) {
        const template = registry.resolveTemplate(role, 'provider');
        expect(template).not.toBe(GENERIC_FALLBACK_TEXT);
      }
    });

    it('returns GENERIC_FALLBACK for a role with no built-in and no config', () => {
      const registry = createRegistry();
      // Cast an unknown role to simulate a role not in BUILTIN_TEMPLATES
      const result = registry.resolveTemplate('nonexistent_role' as AgentType, 'provider');
      expect(result).toBe(GENERIC_FALLBACK_TEXT);
    });
  });

  describe('prototype pollution protection', () => {
    it('builtinTemplates backing store has no prototype chain (Object.create(null))', () => {
      const registry = createRegistry();
      // If the backing store had Object.prototype, resolving 'toString' as a role
      // would find a function on the prototype chain instead of returning undefined.
      // With Object.create(null), the lookup should produce undefined at level 5,
      // falling through to GENERIC_FALLBACK.
      const result = registry.resolveTemplate('toString' as AgentType, 'provider');
      expect(result).toBe(GENERIC_FALLBACK_TEXT);
    });

    it('providerPrompts property access does not traverse prototype chain', () => {
      // Create config with providerPrompts that is a regular object.
      // Properties inherited from Object.prototype (e.g., valueOf) should not match.
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'my-provider': 'My prompt' },
        },
      });
      // 'valueOf' is inherited from Object.prototype
      const result = registry.resolveTemplate('architect', 'valueOf');
      // Should NOT find 'valueOf' on the prototype chain, should fall through to built-in
      expect(result).toContain('You are analyzing a GitHub issue');
    });
  });

  describe('BUILTIN_TEMPLATES frozen check', () => {
    it('modifications via registerBuiltin on one instance do not affect new instances', () => {
      const registry1 = createRegistry();
      const template1 = registry1.resolveTemplate('architect', 'provider');

      // Modify via registerBuiltin on registry1
      registry1.registerBuiltin('architect', 'Modified architect');
      expect(registry1.resolveTemplate('architect', 'provider')).toBe('Modified architect');

      // A new registry should still have the original template
      const registry2 = createRegistry();
      const template2 = registry2.resolveTemplate('architect', 'provider');
      expect(template2).toBe(template1);
    });
  });

  describe('no regex usage in interpolation', () => {
    it('values with regex replacement patterns ($1, $&, $$) are substituted literally', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: { systemPrompt: 'Match: {{val}}' },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      // These patterns would be interpreted by String.prototype.replace() with regex
      expect(registry.render('architect', 'provider', { val: '$1' })).toBe('Match: $1');
      expect(registry.render('architect', 'provider', { val: '$&' })).toBe('Match: $&');
      expect(registry.render('architect', 'provider', { val: '$$' })).toBe('Match: $$');
      expect(registry.render('architect', 'provider', { val: "$'" })).toBe("Match: $'");
      expect(registry.render('architect', 'provider', { val: '$`' })).toBe('Match: $`');
    });
  });

  describe('render - integration with resolution chain', () => {
    it('render() uses per-provider-per-role template (level 1) and interpolates vars into it', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: {
            providerPrompts: {
              'claude-code': 'Provider-specific prompt for {{context}}',
            },
            systemPrompt: 'Should not use this',
          },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'claude-code', {
        context: 'my feature',
      });
      expect(result).toBe('Provider-specific prompt for my feature');
    });

    it('render() uses GENERIC_FALLBACK (level 6) when nothing configured -- vars have no effect (no placeholders in fallback)', () => {
      const registry = createRegistry();
      const unknownRole = 'unknown_role' as AgentType;
      const result = registry.render(unknownRole, 'provider', {
        context: 'should not appear',
      });
      // GENERIC_FALLBACK has no {{placeholders}}, so vars are irrelevant
      expect(result).toBe(GENERIC_FALLBACK_TEXT);
    });

    it('render() uses per-role systemPrompt (level 2) with variable interpolation', () => {
      const config: AgentsConfig = {
        defaults: { providerChain: [] },
        roles: {
          architect: {
            systemPrompt: 'Role prompt with {{context}} and {{extra}}',
          },
        },
      };
      const registry = new AgentPromptRegistry({ config });
      const result = registry.render('architect', 'provider', {
        context: 'issue details',
        extra: 'additional info',
      });
      expect(result).toBe('Role prompt with issue details and additional info');
    });
  });

  describe('render - full end-to-end scenario', () => {
    it('realistic AgentsConfig: different roles and providers resolve and render correctly', () => {
      const config: AgentsConfig = {
        defaults: {
          providerChain: [],
          systemPrompt: 'Default: handle {{task}}',
          providerPrompts: {
            'openai': 'OpenAI default: handle {{task}}',
          },
        },
        roles: {
          architect: {
            providerPrompts: {
              'claude-code': 'Claude architect: analyze {{context}} for issue #{{issueNumber}}',
            },
            systemPrompt: 'Generic architect: analyze {{context}}',
          },
          implementer: {
            systemPrompt: 'Implement plan for issue #{{issueNumber}}: {{plan}}',
          },
          reviewer: {
            // No custom prompts -- falls through to defaults or built-in
          },
        },
      };
      const registry = new AgentPromptRegistry({ config });

      // architect + claude-code -> level 1 (provider-specific)
      const r1 = registry.render('architect', 'claude-code', {
        context: 'feature request',
        issueNumber: '42',
      });
      expect(r1).toBe('Claude architect: analyze feature request for issue #42');

      // architect + openai -> level 2 (per-role systemPrompt, since no providerPrompts entry for 'openai')
      const r2 = registry.render('architect', 'openai', {
        context: 'bug report',
      });
      expect(r2).toBe('Generic architect: analyze bug report');

      // implementer + any-provider -> level 2 (per-role systemPrompt)
      const r3 = registry.render('implementer', 'any-provider', {
        issueNumber: '99',
        plan: 'add caching layer',
      });
      expect(r3).toBe('Implement plan for issue #99: add caching layer');

      // reviewer + openai -> level 3 (defaults.providerPrompts['openai'])
      const r4 = registry.render('reviewer', 'openai', {
        task: 'code review',
      });
      expect(r4).toBe('OpenAI default: handle code review');

      // reviewer + unknown-provider -> level 4 (defaults.systemPrompt)
      const r5 = registry.render('reviewer', 'unknown-provider', {
        task: 'review PR',
      });
      expect(r5).toBe('Default: handle review PR');

      // tester (no role config) + unknown-provider (no default providerPrompts match)
      // -> level 4 (defaults.systemPrompt)
      const r6 = registry.render('tester', 'some-provider', {
        task: 'testing',
      });
      expect(r6).toBe('Default: handle testing');
    });
  });

  describe('resolution chain priority - comprehensive priority tests', () => {
    it('level 1 takes priority over levels 2-6', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'my-provider': 'Level 3 prompt' },
          systemPrompt: 'Level 4 prompt',
        },
        roles: {
          architect: {
            providerPrompts: { 'my-provider': 'Level 1 prompt' },
            systemPrompt: 'Level 2 prompt',
          },
        },
      });
      expect(registry.resolveTemplate('architect', 'my-provider')).toBe('Level 1 prompt');
    });

    it('level 2 takes priority over levels 3-6 when level 1 misses', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'my-provider': 'Level 3 prompt' },
          systemPrompt: 'Level 4 prompt',
        },
        roles: {
          architect: {
            providerPrompts: { 'other-provider': 'Level 1 for other' },
            systemPrompt: 'Level 2 prompt',
          },
        },
      });
      expect(registry.resolveTemplate('architect', 'my-provider')).toBe('Level 2 prompt');
    });

    it('level 3 takes priority over levels 4-6 when levels 1-2 miss', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'my-provider': 'Level 3 prompt' },
          systemPrompt: 'Level 4 prompt',
        },
      });
      expect(registry.resolveTemplate('architect', 'my-provider')).toBe('Level 3 prompt');
    });

    it('level 4 takes priority over levels 5-6 when levels 1-3 miss', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          providerPrompts: { 'other-provider': 'Level 3 for other' },
          systemPrompt: 'Level 4 prompt',
        },
      });
      expect(registry.resolveTemplate('architect', 'my-provider')).toBe('Level 4 prompt');
    });

    it('level 5 takes priority over level 6 when levels 1-4 miss', () => {
      const registry = createRegistry({
        defaults: {
          providerChain: [],
          // no providerPrompts, no systemPrompt
        },
      });
      const result = registry.resolveTemplate('architect', 'my-provider');
      expect(result).not.toBe(GENERIC_FALLBACK_TEXT);
      expect(result).toContain('You are analyzing a GitHub issue');
    });
  });
});

describe('AgentPromptRegistry exports', () => {
  it('AgentPromptRegistry, IAgentPromptRegistry, and AgentPromptRegistryOptions are exported from the module', async () => {
    const mod = await import('./agent-prompt-registry.js');
    expect(mod.AgentPromptRegistry).toBeDefined();
    // Type exports are not available at runtime, but we verify the class is constructable
    const instance = new mod.AgentPromptRegistry({
      config: { defaults: { providerChain: [] } },
    });
    expect(instance).toBeInstanceOf(mod.AgentPromptRegistry);
    expect(typeof instance.render).toBe('function');
    expect(typeof instance.resolveTemplate).toBe('function');
    expect(typeof instance.registerBuiltin).toBe('function');
  });
});
