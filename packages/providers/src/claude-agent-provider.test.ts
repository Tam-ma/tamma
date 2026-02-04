import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeAgentProvider } from './claude-agent-provider.js';
import type { AgentProgressEvent } from './agent-types.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Mock promisify to return a function that calls execFile with a promise wrapper
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: vi.fn((fn: (...args: any[]) => void) => {
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, ...results: any[]) => {
            if (err) reject(err);
            else resolve(results[0]);
          });
        });
      };
    }),
  };
});

import { spawn, execFile } from 'node:child_process';

const mockedSpawn = vi.mocked(spawn);
const mockedExecFile = vi.mocked(execFile);

/**
 * Create a mock ChildProcess that emits stream-json lines on stdout
 * then exits with the given code. Uses setTimeout to ensure event
 * listeners are attached before data flows.
 */
function createMockProcess(
  stdoutLines: string[],
  exitCode: number,
  stderrData?: string,
): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_c, _e, cb) { cb(); } });

  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).stdin = stdin;
  (proc as any).pid = 12345;

  // Use setTimeout(0) to ensure event listeners are fully attached
  setTimeout(() => {
    for (const line of stdoutLines) {
      stdout.push(line + '\n');
    }
    if (stderrData !== undefined) {
      stderr.push(stderrData);
    }
    // Small delay between data and close to allow processing
    setTimeout(() => {
      stdout.push(null);
      stderr.push(null);
      proc.emit('close', exitCode);
    }, 5);
  }, 5);

  return proc;
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
    it('should return success result when claude exits 0 with result message', async () => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Task completed successfully',
        cost_usd: 0.05,
        session_id: 'test-session',
        duration_ms: 1000,
      });

      mockedSpawn.mockReturnValue(createMockProcess([resultMsg], 0));

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

    it('should return failure when claude exits non-zero with no result', async () => {
      mockedSpawn.mockReturnValue(
        createMockProcess([], 1, 'Error: authentication required'),
      );

      const result = await provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('authentication required');
    });

    it('should handle spawn errors gracefully', async () => {
      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
      (proc as any).stdout = new Readable({ read() {} });
      (proc as any).stderr = new Readable({ read() {} });
      (proc as any).stdin = stdin;

      mockedSpawn.mockReturnValue(proc);

      const promise = provider.executeTask({
        prompt: 'Do something',
        cwd: '/tmp/test',
      });

      setTimeout(() => {
        proc.emit('error', new Error('ENOENT: claude not found'));
      }, 5);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn claude');
    });

    it('should emit progress events for assistant messages', async () => {
      const assistantText = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Working on it...' }],
        },
      });
      const assistantTool = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Write' }],
        },
      });
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Done',
        cost_usd: 0.02,
      });

      mockedSpawn.mockReturnValue(
        createMockProcess([assistantText, assistantTool, resultMsg], 0),
      );

      const events: AgentProgressEvent[] = [];
      await provider.executeTask(
        { prompt: 'Test', cwd: '/tmp' },
        (event) => events.push(event),
      );

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.some((e) => e.type === 'text' && e.message === 'Working on it...')).toBe(true);
      expect(events.some((e) => e.type === 'tool_use' && e.message.includes('Write'))).toBe(true);
      expect(events.some((e) => e.type === 'cost_update')).toBe(true);
    });

    it('should build correct CLI arguments from config', async () => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Done',
        cost_usd: 0,
      });

      mockedSpawn.mockReturnValue(createMockProcess([resultMsg], 0));

      await provider.executeTask({
        prompt: 'Build something',
        cwd: '/workspace',
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: ['Read', 'Write', 'Bash'],
        permissionMode: 'bypassPermissions',
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p', 'Build something',
          '--output-format', 'stream-json',
          '--model', 'claude-sonnet-4-5',
          '--max-budget-usd', '1',
          '--allowedTools', 'Read,Write,Bash',
          '--dangerously-skip-permissions',
        ]),
        expect.objectContaining({ cwd: '/workspace' }),
      );
    });

    it('should pass --json-schema when outputFormat is provided', async () => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: '{"key":"value"}',
        cost_usd: 0,
      });

      mockedSpawn.mockReturnValue(createMockProcess([resultMsg], 0));

      const schema = { type: 'object', properties: { key: { type: 'string' } } };
      await provider.executeTask({
        prompt: 'Generate JSON',
        cwd: '/tmp',
        outputFormat: { type: 'json_schema', schema },
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--json-schema', JSON.stringify(schema),
        ]),
        expect.any(Object),
      );
    });

    it('should pass --resume when sessionId is provided', async () => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Continued',
        cost_usd: 0,
      });

      mockedSpawn.mockReturnValue(createMockProcess([resultMsg], 0));

      await provider.executeTask({
        prompt: 'Continue work',
        cwd: '/tmp',
        sessionId: 'session-abc-123',
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--resume', 'session-abc-123']),
        expect.any(Object),
      );
    });

    it('should handle non-JSON stdout lines gracefully', async () => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Done',
        cost_usd: 0,
      });

      mockedSpawn.mockReturnValue(
        createMockProcess(['Some plain text output', resultMsg], 0),
      );

      const events: AgentProgressEvent[] = [];
      const result = await provider.executeTask(
        { prompt: 'Test', cwd: '/tmp' },
        (event) => events.push(event),
      );

      expect(result.success).toBe(true);
      expect(events.some((e) => e.type === 'text' && e.message === 'Some plain text output')).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('should return true when claude --version succeeds', async () => {
      mockedExecFile.mockImplementation((...args: any[]) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
          cb(null, 'claude 1.0.0', '');
        }
        return undefined as any;
      });

      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false when claude is not installed', async () => {
      mockedExecFile.mockImplementation((...args: any[]) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
          cb(new Error('ENOENT'), '', '');
        }
        return undefined as any;
      });

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should resolve without error', async () => {
      await expect(provider.dispose()).resolves.toBeUndefined();
    });
  });
});
