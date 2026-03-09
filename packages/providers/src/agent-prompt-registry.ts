/**
 * Agent Prompt Registry
 *
 * Resolves system prompt templates with a multi-level fallback chain
 * and {{variable}} interpolation. The registry stores role preambles
 * (static system context); the engine appends dynamic content after rendering.
 *
 * Resolution chain (first non-undefined wins):
 * 1. roles[role].providerPrompts?.[providerName]
 * 2. roles[role].systemPrompt
 * 3. defaults.providerPrompts?.[providerName]
 * 4. defaults.systemPrompt
 * 5. builtinTemplates[role]
 * 6. GENERIC_FALLBACK
 *
 * Story 9-6: Agent Prompt Registry
 */

import type { AgentType, AgentsConfig } from '@tamma/shared';
import type { ILogger } from '@tamma/shared/contracts';

/**
 * Built-in role preambles extracted from engine.ts.
 * These are the static system context prefixes; the engine appends
 * dynamic content (issue details, plan data, etc.) after rendering.
 *
 * Frozen to prevent accidental mutation of module-level constant.
 */
const BUILTIN_TEMPLATES: Partial<Record<AgentType, string>> = Object.freeze({
  architect: 'You are analyzing a GitHub issue to create a development plan.\n\n{{context}}',
  implementer: 'You are an autonomous coding agent. Implement the following plan for issue #{{issueNumber}}.',
  reviewer: 'You are a code reviewer. Review the changes for correctness, style, and security.',
  tester: 'You are a testing agent. Write and run tests for the described changes.',
  analyst: 'You are analyzing project context to understand codebase structure and conventions.',
  scrum_master: 'You are a project coordinator. Select the most appropriate issue to work on next.',
  researcher: 'You are a research agent. Investigate and gather information about the topic at hand.',
  planner: 'You are a planning agent. Create structured plans and organize work breakdown.',
  documenter: 'You are a documentation agent. Write clear, comprehensive documentation for the codebase.',
});

const GENERIC_FALLBACK = 'You are an AI assistant working on a software development task.';

/** Maximum rendered template length (1MB). Templates exceeding this are truncated with a warning. */
const MAX_TEMPLATE_LENGTH = 1_000_000;

/** Maximum variable value length (100KB). Variables exceeding this are skipped with a warning. */
const MAX_VAR_VALUE_LENGTH = 100_000;

/** Keys that cannot be used as role names or provider names (prototype pollution guard). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface AgentPromptRegistryOptions {
  config: AgentsConfig;
  logger?: ILogger;
  immutableRoles?: ReadonlySet<string>;
}

export interface IAgentPromptRegistry {
  render(role: AgentType, providerName: string, vars?: Record<string, string>): string;
  resolveTemplate(role: AgentType, providerName: string): string;
  registerBuiltin(role: string, template: string): void;
}

export class AgentPromptRegistry implements IAgentPromptRegistry {
  private readonly config: AgentsConfig;
  private readonly logger?: ILogger;
  private readonly immutableRoles: ReadonlySet<string>;
  private builtinTemplates: Record<string, string>;

  constructor(options: AgentPromptRegistryOptions) {
    this.config = options.config;
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
    this.immutableRoles = options.immutableRoles ?? new Set();
    // Use Object.create(null) for prototype-free backing (prototype pollution guard)
    this.builtinTemplates = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(BUILTIN_TEMPLATES)) {
      if (value !== undefined) {
        this.builtinTemplates[key] = value;
      }
    }
  }

  /**
   * Resolve the template for a role+provider and render it with variables.
   *
   * Resolution chain (first non-undefined wins):
   * 1. roles[role].providerPrompts?.[providerName]
   * 2. roles[role].systemPrompt
   * 3. defaults.providerPrompts?.[providerName]
   * 4. defaults.systemPrompt
   * 5. builtinTemplates[role]
   * 6. GENERIC_FALLBACK
   *
   * Variable replacement is done in a single pass to prevent recursive
   * expansion (template injection). If variable A's value contains {{B}},
   * B will NOT be expanded.
   */
  render(
    role: AgentType,
    providerName: string,
    vars: Record<string, string> = {},
  ): string {
    const template = this.resolveTemplate(role, providerName);
    return this._interpolate(template, vars);
  }

  /** Resolve without rendering -- returns the raw template string. */
  resolveTemplate(role: AgentType, providerName: string): string {
    // Validate providerName against prototype pollution
    if (FORBIDDEN_KEYS.has(providerName)) {
      throw new Error(`Cannot resolve template with forbidden provider name: ${providerName}`);
    }

    // 1. Per-provider-per-role
    const roleConfig = this.config.roles?.[role];
    if (roleConfig?.providerPrompts !== undefined) {
      if (Object.hasOwn(roleConfig.providerPrompts, providerName)) {
        const prompt = roleConfig.providerPrompts[providerName];
        if (prompt !== undefined) return prompt;
      }
    }

    // 2. Per-role system prompt
    if (roleConfig?.systemPrompt !== undefined) {
      return roleConfig.systemPrompt;
    }

    // 3. Per-provider default
    if (this.config.defaults.providerPrompts !== undefined) {
      if (Object.hasOwn(this.config.defaults.providerPrompts, providerName)) {
        const prompt = this.config.defaults.providerPrompts[providerName];
        if (prompt !== undefined) return prompt;
      }
    }

    // 4. Global default system prompt
    if (this.config.defaults.systemPrompt !== undefined) {
      return this.config.defaults.systemPrompt;
    }

    // 5. Built-in template for role
    const builtin = this.builtinTemplates[role];
    if (builtin !== undefined) return builtin;

    // 6. Generic fallback
    return GENERIC_FALLBACK;
  }

  /**
   * Register or override a built-in template (for testing or plugins).
   *
   * Rejects forbidden keys (__proto__, constructor, prototype) to prevent
   * prototype pollution. Rejects overriding immutable roles (e.g., reviewer).
   * Logs WARN when overriding an existing template, INFO when adding new.
   */
  registerBuiltin(role: string, template: string): void {
    if (FORBIDDEN_KEYS.has(role)) {
      throw new Error(`Cannot register template with forbidden key: ${role}`);
    }
    if (this.immutableRoles.has(role)) {
      throw new Error(`Cannot override immutable role template: ${role}`);
    }
    if (this.builtinTemplates[role] !== undefined) {
      this.logger?.warn('Overriding existing built-in template', { role });
    } else {
      this.logger?.info('Registering new built-in template', { role });
    }
    this.builtinTemplates[role] = template;
  }

  /**
   * Replace `{{key}}` placeholders with values from vars in a single pass.
   *
   * Uses a single regex replacement to prevent recursive expansion:
   * if variable A's value contains `{{B}}`, B will NOT be expanded.
   * This prevents template injection where user-controlled values could
   * reference internal template variables like `{{systemPrompt}}`.
   *
   * Variables whose values exceed MAX_VAR_VALUE_LENGTH are skipped with
   * a warning log.
   */
  private _interpolate(template: string, vars: Record<string, string>): string {
    // Pre-filter vars to skip oversized values
    const validVars = new Map<string, string>();
    for (const [key, value] of Object.entries(vars)) {
      if (value.length > MAX_VAR_VALUE_LENGTH) {
        this.logger?.warn('Skipping variable exceeding MAX_VAR_VALUE_LENGTH', {
          key,
          valueLength: value.length,
          limit: MAX_VAR_VALUE_LENGTH,
        });
        continue;
      }
      validVars.set(key, value);
    }

    // Single-pass replacement: match all {{...}} and replace if key is in vars
    let result = template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      const value = validVars.get(key);
      if (value !== undefined) {
        return value;
      }
      // Leave unmatched placeholders as-is
      return `{{${key}}}`;
    });

    // Truncate if rendered template exceeds MAX_TEMPLATE_LENGTH
    if (result.length > MAX_TEMPLATE_LENGTH) {
      this.logger?.warn('Rendered template exceeds MAX_TEMPLATE_LENGTH, truncating', {
        length: result.length,
        limit: MAX_TEMPLATE_LENGTH,
      });
      result = result.slice(0, MAX_TEMPLATE_LENGTH);
    }
    return result;
  }
}

