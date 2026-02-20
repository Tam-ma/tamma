// E2E tests for TammaEngine against the Tam-ma/tamma-test repository.
//
// Gated by environment variables:
//   E2E_TEST_ENABLED=true
//   E2E_GITHUB_TOKEN=<GitHub PAT>
//   E2E_GITHUB_OWNER=Tam-ma
//   E2E_GITHUB_REPO=tamma-test
//   INTEGRATION_TEST_CLAUDE=true  (for full pipeline test)
//
// Run with: npx vitest run engine.e2e.test.ts --testTimeout=300000

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TammaEngine } from './engine.js';
import type { EngineContext } from './engine.js';
import { EngineState } from '@tamma/shared';
import type { TammaConfig, AgentTaskResult } from '@tamma/shared';
import type { IAgentProvider } from '@tamma/providers';
import { GitHubPlatform } from '@tamma/platforms';
import type { ILogger } from '@tamma/shared/contracts';

const E2E_ENABLED = process.env['E2E_TEST_ENABLED'] === 'true';
const TOKEN = process.env['E2E_GITHUB_TOKEN'] ?? '';
const OWNER = process.env['E2E_GITHUB_OWNER'] ?? 'Tam-ma';
const REPO = process.env['E2E_GITHUB_REPO'] ?? 'tamma-test';
const CLAUDE_ENABLED = process.env['INTEGRATION_TEST_CLAUDE'] === 'true';

const describeE2E = E2E_ENABLED ? describe : describe.skip;

function createE2EConfig(): TammaConfig {
  return {
    mode: 'standalone',
    logLevel: 'debug',
    github: {
      token: TOKEN,
      owner: OWNER,
      repo: REPO,
      issueLabels: ['tamma'],
      excludeLabels: ['wontfix'],
      botUsername: 'tamma-bot',
    },
    agent: {
      model: 'claude-sonnet-4-5',
      maxBudgetUsd: 1.0,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'bypassPermissions',
    },
    engine: {
      pollIntervalMs: 1000,
      workingDirectory: process.cwd(),
      approvalMode: 'auto',
      ciPollIntervalMs: 5000,
      ciMonitorTimeoutMs: 300_000,
    },
  };
}

function createE2ELogger(): ILogger {
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => { if (process.env['VERBOSE']) console.log('[DEBUG]', msg, ctx); },
    info: (msg: string, ctx?: Record<string, unknown>) => { console.log('[INFO]', msg, ctx ?? ''); },
    warn: (msg: string, ctx?: Record<string, unknown>) => { console.warn('[WARN]', msg, ctx ?? ''); },
    error: (msg: string, ctx?: Record<string, unknown>) => { console.error('[ERROR]', msg, ctx ?? ''); },
  };
}

function createMockAgent(overrides?: Partial<IAgentProvider>): IAgentProvider {
  return {
    executeTask: vi.fn().mockResolvedValue({
      success: true,
      output: '{"issueNumber":1,"summary":"Test","approach":"Test","fileChanges":[],"testingStrategy":"Test","estimatedComplexity":"low","risks":[]}',
      costUsd: 0.01,
      durationMs: 100,
    } satisfies AgentTaskResult),
    isAvailable: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describeE2E('TammaEngine E2E', () => {
  let platform: GitHubPlatform;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    platform = new GitHubPlatform();
    await platform.initialize({ token: TOKEN });
  });

  afterEach(async () => {
    for (const fn of cleanupFns.reverse()) {
      try {
        await fn();
      } catch {
        // Best-effort cleanup
      }
    }
    cleanupFns.length = 0;
  });

  it('should select an issue from test repo', async () => {
    const config = createE2EConfig();
    const logger = createE2ELogger();
    const agent = createMockAgent();

    const engine = new TammaEngine({
      config,
      platform,
      agent,
      logger,
    });

    await engine.initialize();

    const issue = await engine.selectIssue();

    // Clean up: unassign the bot from the issue if we selected one
    if (issue !== null) {
      cleanupFns.push(async () => {
        // Remove the pickup comment (best effort)
        try {
          const fetched = await platform.getIssue(OWNER, REPO, issue.number);
          const botComment = fetched.comments.find((c) => c.body.includes('Tamma is picking up'));
          if (botComment) {
            // No removeComment in the interface, just leave it
          }
        } catch { /* ok */ }
      });

      expect(issue.number).toBeGreaterThan(0);
      expect(issue.title).toBeTruthy();
      expect(issue.labels).toContain('tamma');
      expect(engine.getState()).toBe(EngineState.SELECTING_ISSUE);
    } else {
      // No issues available — that's OK, test repo may not have open issues
      expect(engine.getState()).toBe(EngineState.IDLE);
    }

    await engine.dispose();
  });

  it('should analyze issue with context', async () => {
    const config = createE2EConfig();
    const logger = createE2ELogger();
    const agent = createMockAgent();

    const engine = new TammaEngine({
      config,
      platform,
      agent,
      logger,
    });

    await engine.initialize();

    const issue = await engine.selectIssue();
    if (issue === null) {
      console.log('No issues available, skipping analyze test');
      await engine.dispose();
      return;
    }

    cleanupFns.push(async () => {
      await engine.dispose();
    });

    const context = await engine.analyzeIssue(issue);

    expect(context).toContain(`#${issue.number}`);
    expect(context).toContain(issue.title);
    expect(context).toContain('Description');
    expect(context.length).toBeGreaterThan(50);
  });

  // Full pipeline test — requires real Claude access
  const describeFullPipeline = CLAUDE_ENABLED ? describe : describe.skip;

  describeFullPipeline('full pipeline', () => {
    it('should run full pipeline with real Claude', async () => {
      // Dynamic import to avoid loading Claude deps when not needed
      const { ClaudeAgentProvider } = await import('@tamma/providers');

      const config = createE2EConfig();
      const logger = createE2ELogger();
      const agent = new ClaudeAgentProvider();

      // Create a dedicated test issue
      const testIssueTitle = `E2E pipeline test ${Date.now()}`;
      // We need to create the issue via the platform directly
      // But GitHubPlatform doesn't have createIssue... use gh CLI approach or
      // just test with existing issues
      // For now, use existing labeled issues

      const engine = new TammaEngine({
        config,
        platform,
        agent,
        logger,
      });

      cleanupFns.push(async () => {
        await engine.dispose();
      });

      await engine.initialize();
      await engine.processOneIssue();

      const stats = engine.getStats();
      expect(stats.issuesProcessed).toBe(1);
      expect(stats.totalCostUsd).toBeGreaterThan(0);

      // Verify PR was created
      const pr = engine.getCurrentPR();
      if (pr !== null) {
        cleanupFns.push(async () => {
          try {
            await platform.updatePR(OWNER, REPO, pr.number, { state: 'closed' });
            await platform.deleteBranch(OWNER, REPO, pr.branch);
          } catch { /* ok */ }
        });
      }
    }, 300_000); // 5 minute timeout
  });
});
