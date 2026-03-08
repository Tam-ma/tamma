import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeProvider } from './opencode-provider.js';
import type { AgentProgressEvent } from './agent-types.js';

// Mock the @opencode-ai/sdk module
const mockSessionCreate = vi.fn();
const mockSessionPrompt = vi.fn();
const mockSessionAbort = vi.fn();
const mockHealth = vi.fn();

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn().mockImplementation(() => ({
    session: {
      create: mockSessionCreate,
      prompt: mockSessionPrompt,
      abort: mockSessionAbort,
    },
    global: {
      health: mockHealth,
    },
  })),
}));

describe('OpenCodeProvider', () => {
  let provider: OpenCodeProvider;

  beforeEach(() => {
    provider = new OpenCodeProvider();
    vi.clearAllMocks();

    // Default mock implementations
    mockSessionCreate.mockResolvedValue({
      data: { id: 'session-test-123' },
    });
    mockSessionPrompt.mockResolvedValue({
      data: {
        parts: [{ type: 'text', text: 'Task completed successfully' }],
        info: {},
      },
    });
    mockHealth.mockResolvedValue({
      data: { version: '1.0.0' },
    });
  });

  afterEach(async () => {
    await provider.dispose();
  });

  describe('executeTask', () => {
    it('should create session and return success result', async () => {
      await provider.initialize({ apiKey: '' });

      const result = await provider.executeTask({
        prompt: 'Write a hello world function',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed successfully');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(mockSessionCreate).toHaveBeenCalledTimes(1);
      expect(mockSessionPrompt).toHaveBeenCalledWith({
        path: { id: 'session-test-123' },
        body: {
          parts: [{ type: 'text', text: 'Write a hello world function' }],
        },
      });
    });

    it('should return failure when SDK throws', async () => {
      await provider.initialize({ apiKey: '' });
      mockSessionPrompt.mockRejectedValue(new Error('Connection refused'));

      const result = await provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should retry on transient error then succeed', async () => {
      await provider.initialize({ apiKey: '' });

      mockSessionPrompt
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({
          data: { parts: [{ type: 'text', text: 'Recovered' }] },
        });

      const result = await provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Recovered');
      // Called once per attempt (session create + prompt each time)
      expect(mockSessionPrompt).toHaveBeenCalledTimes(2);
    }, 15000);

    it('should not retry on non-transient error', async () => {
      await provider.initialize({ apiKey: '' });
      mockSessionPrompt.mockRejectedValue(new Error('Invalid schema'));

      const result = await provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid schema');
      expect(mockSessionPrompt).toHaveBeenCalledTimes(1);
    });

    it('should emit progress events', async () => {
      await provider.initialize({ apiKey: '' });
      const events: AgentProgressEvent[] = [];

      await provider.executeTask(
        { prompt: 'Test', cwd: '/tmp' },
        (event) => events.push(event),
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.type === 'progress' && e.message.includes('session'))).toBe(true);
      expect(events.some((e) => e.type === 'text')).toBe(true);
    });

    it('should pass outputFormat as json schema', async () => {
      await provider.initialize({ apiKey: '' });
      const schema = { type: 'object', properties: { key: { type: 'string' } } };

      await provider.executeTask({
        prompt: 'Generate JSON',
        cwd: '/tmp',
        outputFormat: { type: 'json_schema', schema },
      });

      expect(mockSessionPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            format: { type: 'json_schema', schema },
          }),
        }),
      );
    });

    it('should resume existing session when sessionId provided', async () => {
      await provider.initialize({ apiKey: '' });

      await provider.executeTask({
        prompt: 'Continue work',
        cwd: '/tmp',
        sessionId: 'existing-session-456',
      });

      // Should NOT create a new session
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockSessionPrompt).toHaveBeenCalledWith({
        path: { id: 'existing-session-456' },
        body: {
          parts: [{ type: 'text', text: 'Continue work' }],
        },
      });
    });

    it('should handle multi-part response', async () => {
      await provider.initialize({ apiKey: '' });
      mockSessionPrompt.mockResolvedValue({
        data: {
          parts: [
            { type: 'text', text: 'Part 1' },
            { type: 'tool_use', name: 'Write' },
            { type: 'text', text: 'Part 2' },
          ],
        },
      });

      const result = await provider.executeTask({
        prompt: 'Test',
        cwd: '/tmp',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Part 1\nPart 2');
    });
  });

  describe('ICLIAgentProvider compliance', () => {
    it('should expose name and type', () => {
      expect(provider.name).toBe('opencode');
      expect(provider.type).toBe('cli-agent');
    });

    it('should expose capabilities', () => {
      expect(provider.capabilities).toEqual({
        fileOperations: true,
        commandExecution: true,
        gitOperations: true,
        browserAutomation: false,
        mcpSupport: true,
        sessionResume: true,
        structuredOutput: true,
        streaming: false,
      });
    });

    it('should delegate execute to executeTask', async () => {
      await provider.initialize({ apiKey: '' });
      const spy = vi.spyOn(provider, 'executeTask').mockResolvedValue({
        success: true,
        output: 'test',
        costUsd: 0,
        durationMs: 100,
      });

      const config = { prompt: 'test', cwd: '/tmp' };
      await provider.execute(config);
      expect(spy).toHaveBeenCalledWith(config, undefined);
    });

    it('should support resumeSession', async () => {
      await provider.initialize({ apiKey: '' });
      const spy = vi.spyOn(provider, 'executeTask').mockResolvedValue({
        success: true,
        output: 'resumed',
        costUsd: 0,
        durationMs: 50,
      });

      await provider.resumeSession('session-123', 'continue please');
      expect(spy).toHaveBeenCalledWith(
        { prompt: 'continue please', cwd: '.', sessionId: 'session-123' },
        undefined,
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when SDK health check succeeds', async () => {
      await provider.initialize({ apiKey: '' });
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false when SDK health check fails', async () => {
      await provider.initialize({ apiKey: '' });
      mockHealth.mockRejectedValue(new Error('Connection refused'));
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should resolve without error', async () => {
      await provider.initialize({ apiKey: '' });
      await expect(provider.dispose()).resolves.toBeUndefined();
    });

    it('should clear internal state', async () => {
      await provider.initialize({ apiKey: '' });
      await provider.dispose();
      // After dispose, ensureClient will re-import SDK
      // This tests that sdkClient is nulled
      mockSessionCreate.mockResolvedValue({ data: { id: 'new-session' } });
      const result = await provider.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.success).toBe(true);
    });
  });
});
