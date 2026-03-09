/**
 * Cost-Monitor Types Unit Tests
 *
 * Compile-time and runtime assertions for the Provider and AgentType types.
 * Ensures:
 * - Provider type accepts all known provider identifiers including new ones
 * - AgentType imported from @tamma/shared is re-exported and usable
 * - Existing types (UsageRecordInput, UsageFilter, LimitContext) still compile
 */

import { describe, it, expect } from 'vitest';
import type {
  Provider,
  AgentType,
  UsageRecordInput,
  UsageFilter,
  LimitContext,
} from './types.js';

describe('Provider type', () => {
  it('should accept "anthropic"', () => {
    const p: Provider = 'anthropic';
    expect(p).toBe('anthropic');
  });

  it('should accept "openai"', () => {
    const p: Provider = 'openai';
    expect(p).toBe('openai');
  });

  it('should accept "openrouter"', () => {
    const p: Provider = 'openrouter';
    expect(p).toBe('openrouter');
  });

  it('should accept "google"', () => {
    const p: Provider = 'google';
    expect(p).toBe('google');
  });

  it('should accept "local"', () => {
    const p: Provider = 'local';
    expect(p).toBe('local');
  });

  it('should accept "claude-code"', () => {
    const p: Provider = 'claude-code';
    expect(p).toBe('claude-code');
  });

  it('should accept "opencode"', () => {
    const p: Provider = 'opencode';
    expect(p).toBe('opencode');
  });

  it('should accept "z-ai"', () => {
    const p: Provider = 'z-ai';
    expect(p).toBe('z-ai');
  });

  it('should accept "zen-mcp"', () => {
    const p: Provider = 'zen-mcp';
    expect(p).toBe('zen-mcp');
  });
});

describe('AgentType re-export', () => {
  it('should accept "implementer" as AgentType', () => {
    const a: AgentType = 'implementer';
    expect(a).toBe('implementer');
  });

  it('should accept "scrum_master" as AgentType', () => {
    const a: AgentType = 'scrum_master';
    expect(a).toBe('scrum_master');
  });

  it('should accept "architect" as AgentType', () => {
    const a: AgentType = 'architect';
    expect(a).toBe('architect');
  });

  it('should be the same type as AgentType from @tamma/shared', () => {
    // If these types diverge, this test will fail at compile time
    const sharedAgent: import('@tamma/shared').AgentType = 'reviewer';
    const costMonitorAgent: AgentType = sharedAgent;
    expect(costMonitorAgent).toBe('reviewer');
  });
});

describe('existing types still compile', () => {
  it('should compile UsageRecordInput with agentType from re-exported AgentType', () => {
    const input: UsageRecordInput = {
      projectId: 'proj-1',
      engineId: 'eng-1',
      agentType: 'implementer',
      taskId: 'task-1',
      taskType: 'implementation',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      latencyMs: 500,
      success: true,
    };
    expect(input.agentType).toBe('implementer');
    expect(input.provider).toBe('anthropic');
  });

  it('should compile UsageRecordInput with new provider type', () => {
    const input: UsageRecordInput = {
      projectId: 'proj-1',
      engineId: 'eng-1',
      agentType: 'tester',
      taskId: 'task-1',
      taskType: 'testing',
      provider: 'opencode',
      model: 'some-model',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      latencyMs: 500,
      success: true,
    };
    expect(input.provider).toBe('opencode');
  });

  it('should compile UsageFilter with agentType and provider', () => {
    const filter: UsageFilter = {
      agentType: 'reviewer',
      provider: 'zen-mcp',
    };
    expect(filter.agentType).toBe('reviewer');
    expect(filter.provider).toBe('zen-mcp');
  });

  it('should compile LimitContext with agentType and provider', () => {
    const ctx: LimitContext = {
      agentType: 'documenter',
      provider: 'z-ai',
    };
    expect(ctx.agentType).toBe('documenter');
    expect(ctx.provider).toBe('z-ai');
  });
});
