import { describe, it, expect, vi } from 'vitest';
import { EngineState } from '@tamma/shared';
import { createCommandRegistry, executeSlashCommand } from './registry.js';
import { createLogEmitter } from '../log-emitter.js';
import type { CommandContext } from '../types.js';

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  const logEmitter = createLogEmitter();
  return {
    config: {
      mode: 'standalone',
      logLevel: 'info',
      github: {
        token: 'test',
        owner: 'test-owner',
        repo: 'test-repo',
        issueLabels: ['tamma'],
        excludeLabels: ['wontfix'],
        botUsername: 'tamma-bot',
      },
      agent: {
        model: 'claude-sonnet-4-5',
        maxBudgetUsd: 1.0,
        allowedTools: [],
        permissionMode: 'default',
      },
      engine: {
        pollIntervalMs: 300_000,
        workingDirectory: '.',
        approvalMode: 'cli',
        ciPollIntervalMs: 30_000,
        ciMonitorTimeoutMs: 3_600_000,
      },
    },
    stats: { issuesProcessed: 5, totalCostUsd: 1.23, startedAt: Date.now() - 60_000 },
    state: EngineState.IDLE,
    issue: null,
    logEmitter,
    platform: {} as any,
    showDebug: false,
    paused: false,
    setShowDebug: vi.fn(),
    setPaused: vi.fn(),
    shutdown: vi.fn(),
    skipIssue: vi.fn(),
    approveCurrentPlan: vi.fn(),
    rejectCurrentPlan: vi.fn(),
    ...overrides,
  };
}

describe('createCommandRegistry', () => {
  it('should register all expected commands', () => {
    const registry = createCommandRegistry();
    const expectedCommands = ['status', 'approve', 'reject', 'skip', 'pause', 'resume', 'stop', 'logs', 'config', 'help'];

    for (const name of expectedCommands) {
      expect(registry.has(name)).toBe(true);
    }
    expect(registry.size).toBe(expectedCommands.length);
  });
});

describe('executeSlashCommand', () => {
  it('should dispatch known commands', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/pause', registry, ctx);
    expect(ctx.setPaused).toHaveBeenCalledWith(true);
  });

  it('should handle /resume', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/resume', registry, ctx);
    expect(ctx.setPaused).toHaveBeenCalledWith(false);
  });

  it('should handle /stop', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/stop', registry, ctx);
    expect(ctx.shutdown).toHaveBeenCalled();
  });

  it('should handle /approve', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/approve', registry, ctx);
    expect(ctx.approveCurrentPlan).toHaveBeenCalled();
  });

  it('should handle /reject with args', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/reject needs more tests', registry, ctx);
    expect(ctx.rejectCurrentPlan).toHaveBeenCalledWith('needs more tests');
  });

  it('should handle /reject without args', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/reject', registry, ctx);
    expect(ctx.rejectCurrentPlan).toHaveBeenCalledWith(undefined);
  });

  it('should handle /skip', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/skip', registry, ctx);
    expect(ctx.skipIssue).toHaveBeenCalled();
  });

  it('should handle /logs toggle', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext({ showDebug: false });

    executeSlashCommand('/logs', registry, ctx);
    expect(ctx.setShowDebug).toHaveBeenCalledWith(true);
  });

  it('should warn on unknown command', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();
    const received: string[] = [];
    ctx.logEmitter.subscribe((entry) => { received.push(entry.message); });

    executeSlashCommand('/foobar', registry, ctx);
    expect(received[0]).toContain('Unknown command');
  });

  it('should warn on non-slash input', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();
    const received: string[] = [];
    ctx.logEmitter.subscribe((entry) => { received.push(entry.message); });

    executeSlashCommand('hello', registry, ctx);
    expect(received[0]).toContain('Unknown input');
  });

  it('should handle /help and list commands', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();
    const received: string[] = [];
    ctx.logEmitter.subscribe((entry) => { received.push(entry.message); });

    executeSlashCommand('/help', registry, ctx);
    expect(received[0]).toContain('Available commands');
    expect(received[0]).toContain('/status');
    expect(received[0]).toContain('/help');
  });

  it('should handle /status and show engine info', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext({
      state: EngineState.IMPLEMENTING,
      issue: { number: 42, title: 'Test issue' } as any,
    });
    const received: string[] = [];
    ctx.logEmitter.subscribe((entry) => { received.push(entry.message); });

    executeSlashCommand('/status', registry, ctx);
    expect(received[0]).toContain('#42');
    expect(received[0]).toContain('$1.23');
  });

  it('should handle /config and show config info', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();
    const received: string[] = [];
    ctx.logEmitter.subscribe((entry) => { received.push(entry.message); });

    executeSlashCommand('/config', registry, ctx);
    expect(received[0]).toContain('test-owner');
    expect(received[0]).toContain('test-repo');
    expect(received[0]).toContain('claude-sonnet-4-5');
  });

  it('should be case-insensitive for command names', () => {
    const registry = createCommandRegistry();
    const ctx = createMockContext();

    executeSlashCommand('/PAUSE', registry, ctx);
    expect(ctx.setPaused).toHaveBeenCalledWith(true);
  });
});
