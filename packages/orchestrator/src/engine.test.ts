import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TammaEngine } from './engine.js';
import type { EngineContext } from './engine.js';
import {
  EngineState,
  type TammaConfig,
  type IssueData,
  type DevelopmentPlan,
} from '@tamma/shared';
import type { IAgentProvider } from '@tamma/providers';
import type { IGitPlatform } from '@tamma/platforms';
import type { ILogger } from '@tamma/shared/contracts';

function createMockConfig(): TammaConfig {
  return {
    mode: 'standalone',
    logLevel: 'debug',
    github: {
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
      permissionMode: 'bypassPermissions',
    },
    engine: {
      pollIntervalMs: 100,
      workingDirectory: '/tmp/test-workspace',
      maxRetries: 3,
      approvalMode: 'auto',
    },
  };
}

function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockAgent(): IAgentProvider {
  return {
    executeTask: vi.fn().mockResolvedValue({
      success: true,
      output: '{"issueNumber":42,"summary":"Fix auth","approach":"Update handler","fileChanges":[],"testingStrategy":"Unit tests","estimatedComplexity":"low","risks":[]}',
      costUsd: 0.05,
      durationMs: 1000,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPlatform(): IGitPlatform {
  return {
    platformName: 'github',
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    getRepository: vi.fn().mockResolvedValue({
      owner: 'test-owner',
      name: 'test-repo',
      fullName: 'test-owner/test-repo',
      defaultBranch: 'main',
      url: 'https://github.com/test-owner/test-repo',
      isPrivate: false,
    }),
    getBranch: vi.fn().mockRejectedValue(new Error('Not found')),
    createBranch: vi.fn().mockResolvedValue({
      name: 'feature/42-fix-auth',
      sha: 'abc123',
      isProtected: false,
    }),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    createPR: vi.fn().mockResolvedValue({
      number: 99,
      title: 'feat: Fix auth (#42)',
      body: 'PR body',
      state: 'open',
      head: 'feature/42-fix-auth',
      base: 'main',
      url: 'https://github.com/test-owner/test-repo/pull/99',
      mergeable: true,
      labels: ['tamma-automated'],
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z',
    }),
    getPR: vi.fn().mockResolvedValue({
      number: 99,
      state: 'open',
      head: 'feature/42-fix-auth',
      base: 'main',
    }),
    updatePR: vi.fn().mockResolvedValue({}),
    mergePR: vi.fn().mockResolvedValue({
      merged: true,
      sha: 'merge-sha',
      message: 'Merged',
    }),
    addPRComment: vi.fn().mockResolvedValue({ id: 1, author: 'bot', body: '', createdAt: '' }),
    getIssue: vi.fn().mockResolvedValue({
      number: 42,
      title: 'Fix authentication bug',
      body: 'Auth is broken. See #10',
      state: 'open',
      labels: ['tamma'],
      assignees: [],
      url: 'https://github.com/test-owner/test-repo/issues/42',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      comments: [{ id: 1, author: 'user', body: 'Related to #20', createdAt: '2024-01-01T12:00:00Z' }],
    }),
    listIssues: vi.fn().mockResolvedValue({
      data: [
        {
          number: 42,
          title: 'Fix authentication bug',
          body: 'Auth is broken. See #10',
          state: 'open',
          labels: ['tamma'],
          assignees: [],
          url: 'https://github.com/test-owner/test-repo/issues/42',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          comments: [],
        },
      ],
      totalCount: 1,
      hasNextPage: false,
      page: 1,
    }),
    updateIssue: vi.fn().mockResolvedValue({}),
    addIssueComment: vi.fn().mockResolvedValue({ id: 2, author: 'bot', body: '', createdAt: '' }),
    assignIssue: vi.fn().mockResolvedValue({}),
    getCIStatus: vi.fn().mockResolvedValue({
      state: 'success',
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      pendingCount: 0,
    }),
  };
}

function createEngine(overrides?: Partial<EngineContext>): {
  engine: TammaEngine;
  config: TammaConfig;
  logger: ILogger;
  agent: IAgentProvider;
  platform: IGitPlatform;
} {
  const config = createMockConfig();
  const logger = createMockLogger();
  const agent = createMockAgent();
  const platform = createMockPlatform();

  const engine = new TammaEngine({
    config,
    logger,
    agent,
    platform,
    ...overrides,
  });

  return { engine, config, logger, agent, platform };
}

describe('TammaEngine', () => {
  describe('initialize', () => {
    it('should succeed when agent is available', async () => {
      const { engine } = createEngine();
      await expect(engine.initialize()).resolves.toBeUndefined();
    });

    it('should throw when agent is not available', async () => {
      const agent = createMockAgent();
      vi.mocked(agent.isAvailable).mockResolvedValue(false);
      const { engine } = createEngine({ agent });
      await expect(engine.initialize()).rejects.toThrow('not available');
    });
  });

  describe('getState', () => {
    it('should start in IDLE state', () => {
      const { engine } = createEngine();
      expect(engine.getState()).toBe(EngineState.IDLE);
    });
  });

  describe('selectIssue', () => {
    it('should select oldest issue with matching labels', async () => {
      const { engine, platform } = createEngine();
      const issue = await engine.selectIssue();

      expect(issue).not.toBeNull();
      expect(issue!.number).toBe(42);
      expect(platform.assignIssue).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        42,
        ['tamma-bot'],
      );
      expect(platform.addIssueComment).toHaveBeenCalled();
    });

    it('should return null when no issues found', async () => {
      const platform = createMockPlatform();
      vi.mocked(platform.listIssues).mockResolvedValue({
        data: [],
        totalCount: 0,
        hasNextPage: false,
        page: 1,
      });
      const { engine } = createEngine({ platform });

      const issue = await engine.selectIssue();
      expect(issue).toBeNull();
      expect(engine.getState()).toBe(EngineState.IDLE);
    });

    it('should filter out issues with exclude labels', async () => {
      const platform = createMockPlatform();
      vi.mocked(platform.listIssues).mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'Excluded',
            body: '',
            state: 'open',
            labels: ['tamma', 'wontfix'],
            assignees: [],
            url: '',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            comments: [],
          },
        ],
        totalCount: 1,
        hasNextPage: false,
        page: 1,
      });
      const { engine } = createEngine({ platform });

      const issue = await engine.selectIssue();
      expect(issue).toBeNull();
    });
  });

  describe('analyzeIssue', () => {
    it('should build context with issue details and related issues', async () => {
      const { engine } = createEngine();
      const issue: IssueData = {
        number: 42,
        title: 'Fix auth',
        body: 'See #10',
        labels: ['tamma'],
        url: 'https://example.com/42',
        comments: [],
        relatedIssueNumbers: [10],
        createdAt: '2024-01-01T00:00:00Z',
      };

      const context = await engine.analyzeIssue(issue);
      expect(context).toContain('#42');
      expect(context).toContain('Fix auth');
    });
  });

  describe('generatePlan', () => {
    it('should return parsed plan from agent', async () => {
      const { engine } = createEngine();
      const issue: IssueData = {
        number: 42,
        title: 'Fix auth',
        body: 'Auth broken',
        labels: ['tamma'],
        url: '',
        comments: [],
        relatedIssueNumbers: [],
        createdAt: '2024-01-01T00:00:00Z',
      };

      const plan = await engine.generatePlan(issue, 'context text');
      expect(plan.issueNumber).toBe(42);
      expect(plan.summary).toBe('Fix auth');
    });

    it('should throw on agent failure', async () => {
      const agent = createMockAgent();
      vi.mocked(agent.executeTask).mockResolvedValue({
        success: false,
        output: '',
        costUsd: 0,
        durationMs: 100,
        error: 'Agent failed',
      });
      const { engine } = createEngine({ agent });

      await expect(
        engine.generatePlan(
          {
            number: 1,
            title: 'Test',
            body: '',
            labels: [],
            url: '',
            comments: [],
            relatedIssueNumbers: [],
            createdAt: '',
          },
          'context',
        ),
      ).rejects.toThrow('Plan generation failed');
    });
  });

  describe('awaitApproval', () => {
    it('should skip approval in auto mode', async () => {
      const { engine } = createEngine();
      const plan: DevelopmentPlan = {
        issueNumber: 42,
        summary: 'Fix auth',
        approach: 'Update handler',
        fileChanges: [],
        testingStrategy: 'Unit tests',
        estimatedComplexity: 'low',
        risks: [],
      };

      await expect(engine.awaitApproval(plan)).resolves.toBeUndefined();
    });
  });

  describe('createBranch', () => {
    it('should create branch with slugified name', async () => {
      const { engine, platform } = createEngine();
      const issue: IssueData = {
        number: 42,
        title: 'Fix Authentication Bug',
        body: '',
        labels: [],
        url: '',
        comments: [],
        relatedIssueNumbers: [],
        createdAt: '',
      };

      const branch = await engine.createBranch(issue);
      expect(branch).toMatch(/^feature\/42-fix-authentication-bug/);
      expect(platform.createBranch).toHaveBeenCalled();
    });

    it('should handle branch name conflicts', async () => {
      const platform = createMockPlatform();
      vi.mocked(platform.getBranch)
        .mockResolvedValueOnce({ name: 'existing', sha: 'abc', isProtected: false })
        .mockRejectedValueOnce(new Error('Not found'));

      const { engine } = createEngine({ platform });
      const issue: IssueData = {
        number: 42,
        title: 'Fix Auth',
        body: '',
        labels: [],
        url: '',
        comments: [],
        relatedIssueNumbers: [],
        createdAt: '',
      };

      const branch = await engine.createBranch(issue);
      expect(branch).toContain('-1');
    });
  });

  describe('implementCode', () => {
    it('should call agent with implementation prompt', async () => {
      const { engine, agent } = createEngine();
      vi.mocked(agent.executeTask).mockResolvedValue({
        success: true,
        output: 'Implementation complete',
        costUsd: 0.5,
        durationMs: 5000,
      });

      const result = await engine.implementCode(
        {
          number: 42,
          title: 'Fix auth',
          body: 'Auth broken',
          labels: [],
          url: '',
          comments: [],
          relatedIssueNumbers: [],
          createdAt: '',
        },
        {
          issueNumber: 42,
          summary: 'Fix auth',
          approach: 'Update handler',
          fileChanges: [
            { filePath: 'src/auth.ts', action: 'modify', description: 'Fix handler' },
          ],
          testingStrategy: 'Unit tests',
          estimatedComplexity: 'low',
          risks: [],
        },
        'feature/42-fix-auth',
      );

      expect(result.success).toBe(true);
      expect(agent.executeTask).toHaveBeenCalled();
    });
  });

  describe('createPR', () => {
    it('should create PR with issue link', async () => {
      const { engine, platform } = createEngine();
      const pr = await engine.createPR(
        {
          number: 42,
          title: 'Fix auth',
          body: '',
          labels: [],
          url: '',
          comments: [],
          relatedIssueNumbers: [],
          createdAt: '',
        },
        {
          issueNumber: 42,
          summary: 'Fix auth',
          approach: 'Update handler',
          fileChanges: [],
          testingStrategy: 'Unit tests',
          estimatedComplexity: 'low',
          risks: [],
        },
        'feature/42-fix-auth',
      );

      expect(pr.number).toBe(99);
      expect(platform.createPR).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        expect.objectContaining({
          body: expect.stringContaining('Closes #42'),
        }),
      );
    });
  });

  describe('monitorAndMerge', () => {
    it('should merge when CI passes', async () => {
      const { engine, platform } = createEngine();

      await engine.monitorAndMerge(
        {
          number: 99,
          url: 'https://github.com/test-owner/test-repo/pull/99',
          title: 'Fix auth',
          body: '',
          branch: 'feature/42-fix-auth',
          status: 'open',
        },
        {
          number: 42,
          title: 'Fix auth',
          body: '',
          labels: [],
          url: '',
          comments: [],
          relatedIssueNumbers: [],
          createdAt: '',
        },
      );

      expect(platform.mergePR).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        99,
        expect.objectContaining({ mergeMethod: 'squash' }),
      );
      expect(platform.deleteBranch).toHaveBeenCalled();
      expect(platform.updateIssue).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        42,
        expect.objectContaining({ state: 'closed' }),
      );
    });

    it('should throw when CI fails', async () => {
      const platform = createMockPlatform();
      vi.mocked(platform.getCIStatus).mockResolvedValue({
        state: 'failure',
        totalCount: 1,
        successCount: 0,
        failureCount: 1,
        pendingCount: 0,
      });
      const { engine } = createEngine({ platform });

      await expect(
        engine.monitorAndMerge(
          {
            number: 99,
            url: '',
            title: '',
            body: '',
            branch: 'feature/42-fix',
            status: 'open',
          },
          {
            number: 42,
            title: '',
            body: '',
            labels: [],
            url: '',
            comments: [],
            relatedIssueNumbers: [],
            createdAt: '',
          },
        ),
      ).rejects.toThrow('CI checks failed');
    });
  });

  describe('processOneIssue', () => {
    it('should execute full pipeline', async () => {
      const { engine, platform, agent } = createEngine();
      await engine.processOneIssue();

      expect(platform.listIssues).toHaveBeenCalled();
      expect(platform.assignIssue).toHaveBeenCalled();
      expect(agent.executeTask).toHaveBeenCalledTimes(2); // plan + implement
      expect(platform.createPR).toHaveBeenCalled();
      expect(platform.mergePR).toHaveBeenCalled();
      expect(engine.getState()).toBe(EngineState.IDLE);
    });

    it('should handle no issues gracefully', async () => {
      const platform = createMockPlatform();
      vi.mocked(platform.listIssues).mockResolvedValue({
        data: [],
        totalCount: 0,
        hasNextPage: false,
        page: 1,
      });
      const { engine } = createEngine({ platform });

      await engine.processOneIssue();
      expect(engine.getState()).toBe(EngineState.IDLE);
    });

    it('should reset state on error', async () => {
      const agent = createMockAgent();
      vi.mocked(agent.executeTask).mockResolvedValue({
        success: false,
        output: '',
        costUsd: 0,
        durationMs: 0,
        error: 'Failed',
      });
      const { engine } = createEngine({ agent });

      await expect(engine.processOneIssue()).rejects.toThrow();
      expect(engine.getState()).toBe(EngineState.IDLE);
    });
  });

  describe('dispose', () => {
    it('should stop running and clean up', async () => {
      const { engine, agent, platform } = createEngine();
      await engine.dispose();

      expect(agent.dispose).toHaveBeenCalled();
      expect(platform.dispose).toHaveBeenCalled();
    });
  });
});
