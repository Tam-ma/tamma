import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeAgentProvider } from './claude-agent-provider.js';
import type { AgentProgressEvent } from './agent-types.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

const mockedQuery = vi.mocked(query);

async function* createMockConversation(
  messages: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const msg of messages) {
    yield msg;
  }
}

describe('ClaudeAgentProvider', () => {
  let provider: ClaudeAgentProvider;

  beforeEach(() => {
    provider = new ClaudeAgentProvider();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  describe('executeTask', () => {
    it('should return success result on successful execution', async () => {
      mockedQuery.mockReturnValue(
        createMockConversation([
          {
            type: 'result',
            subtype: 'success',
            result: 'Task completed successfully',
            total_cost_usd: 0.05,
            uuid: 'test-uuid',
            session_id: 'test-session',
            duration_ms: 1000,
            duration_api_ms: 800,
            is_error: false,
            num_turns: 3,
            usage: {
              input_tokens: 100,
              output_tokens: 200,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            modelUsage: {},
            permission_denials: [],
          },
        ]) as any,
      );

      const result = await provider.executeTask({
        prompt: 'Write a hello world function',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed successfully');
      expect(result.costUsd).toBe(0.05);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should return failure result on error subtype', async () => {
      mockedQuery.mockReturnValue(
        createMockConversation([
          {
            type: 'result',
            subtype: 'error_during_execution',
            errors: ['Something went wrong'],
            total_cost_usd: 0.01,
            uuid: 'test-uuid',
            session_id: 'test-session',
            duration_ms: 500,
            duration_api_ms: 400,
            is_error: true,
            num_turns: 1,
            usage: {
              input_tokens: 50,
              output_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            modelUsage: {},
            permission_denials: [],
          },
        ]) as any,
      );

      const result = await provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
      expect(result.costUsd).toBe(0.01);
    });

    it('should handle thrown errors gracefully', async () => {
      mockedQuery.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      const result = await provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
      expect(result.costUsd).toBe(0);
    });

    it('should emit progress events for assistant messages', async () => {
      mockedQuery.mockReturnValue(
        createMockConversation([
          {
            type: 'assistant',
            uuid: 'msg-1',
            session_id: 'test-session',
            message: {
              content: [{ type: 'text', text: 'Working on it...' }],
            },
            parent_tool_use_id: null,
          },
          {
            type: 'assistant',
            uuid: 'msg-2',
            session_id: 'test-session',
            message: {
              content: [
                { type: 'tool_use', name: 'Write', id: 'tool-1', input: {} },
              ],
            },
            parent_tool_use_id: null,
          },
          {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            total_cost_usd: 0.02,
            uuid: 'result-uuid',
            session_id: 'test-session',
            duration_ms: 1000,
            duration_api_ms: 800,
            is_error: false,
            num_turns: 2,
            usage: {
              input_tokens: 100,
              output_tokens: 200,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            modelUsage: {},
            permission_denials: [],
          },
        ]) as any,
      );

      const events: AgentProgressEvent[] = [];
      await provider.executeTask(
        { prompt: 'Test', cwd: '/tmp' },
        (event) => events.push(event),
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.type === 'text')).toBe(true);
      expect(events.some((e) => e.type === 'tool_use')).toBe(true);
      expect(events.some((e) => e.type === 'cost_update')).toBe(true);
    });

    it('should pass configuration to query', async () => {
      mockedQuery.mockReturnValue(
        createMockConversation([
          {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            total_cost_usd: 0,
            uuid: 'test-uuid',
            session_id: 'test-session',
            duration_ms: 100,
            duration_api_ms: 80,
            is_error: false,
            num_turns: 1,
            usage: {
              input_tokens: 10,
              output_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            modelUsage: {},
            permission_denials: [],
          },
        ]) as any,
      );

      await provider.executeTask({
        prompt: 'Build something',
        cwd: '/workspace',
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write', 'Bash'],
        permissionMode: 'bypassPermissions',
      });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Build something',
          options: expect.objectContaining({
            cwd: '/workspace',
            model: 'claude-sonnet-4-5',
            maxBudgetUsd: 1.0,
            allowedTools: ['Read', 'Write', 'Bash'],
            permissionMode: 'bypassPermissions',
          }),
        }),
      );
    });
  });

  describe('isAvailable', () => {
    const originalEnv = process.env['ANTHROPIC_API_KEY'];

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env['ANTHROPIC_API_KEY'] = originalEnv;
      } else {
        delete process.env['ANTHROPIC_API_KEY'];
      }
    });

    it('should return true when ANTHROPIC_API_KEY is set', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-test-key';
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env['ANTHROPIC_API_KEY'];
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return false when ANTHROPIC_API_KEY is empty', async () => {
      process.env['ANTHROPIC_API_KEY'] = '';
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should resolve without error', async () => {
      await expect(provider.dispose()).resolves.toBeUndefined();
    });
  });
});
