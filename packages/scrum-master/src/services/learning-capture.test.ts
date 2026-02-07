import { describe, it, expect, beforeEach } from 'vitest';
import { LearningCaptureService, createLearningCapture } from './learning-capture.js';
import type { TaskLoopContext, Task, ScrumMasterPlan, ImplementationResult, ReviewResult } from '../types.js';

describe('LearningCaptureService', () => {
  let service: LearningCaptureService;

  const createMockTask = (): Task => ({
    id: 'task-1',
    projectId: 'project-1',
    title: 'Test task',
    description: 'Test description',
    type: 'feature',
    priority: 'medium',
    labels: ['typescript', 'api'],
    createdAt: new Date(),
  });

  const createMockPlan = (): ScrumMasterPlan => ({
    taskId: 'task-1',
    summary: 'Test plan',
    approach: 'TDD approach',
    fileChanges: [
      { path: 'src/test.ts', action: 'modify', description: 'Update', estimatedLines: 50 },
    ],
    testingStrategy: 'Unit tests',
    complexity: 'medium',
    estimatedTokens: 5000,
    estimatedCostUsd: 0.5,
    risks: [],
    dependencies: [],
    generatedAt: new Date(),
    version: 1,
  });

  const createMockImplementation = (success = true): ImplementationResult => ({
    success,
    output: 'Implementation output',
    costUsd: 0.1,
    durationMs: 30000,
    filesModified: ['src/test.ts'],
    testsRun: 5,
    testsPassed: success ? 5 : 3,
    error: success ? undefined : 'Test failure',
    sessionId: 'session-1',
  });

  const createMockReview = (passed = true): ReviewResult => ({
    passed,
    score: passed ? 85 : 45,
    issues: passed
      ? []
      : [
          { severity: 'error', category: 'code', message: 'Missing error handling' },
          { severity: 'warning', category: 'test', message: 'Low test coverage' },
        ],
    suggestions: [],
    qualityChecks: [
      { name: 'tests', passed: true, message: 'Tests passing' },
      { name: 'lint', passed, message: passed ? 'No lint errors' : 'Lint errors found' },
    ],
  });

  const createMockContext = (
    options: { success?: boolean; retryCount?: number; withBlockers?: boolean } = {}
  ): TaskLoopContext => ({
    task: createMockTask(),
    plan: createMockPlan(),
    implementation: createMockImplementation(options.success ?? true),
    review: createMockReview(options.success ?? true),
    learnings: [],
    blockers: options.withBlockers
      ? [
          {
            id: 'blocker-1',
            type: 'timeout',
            message: 'Operation timed out',
            taskId: 'task-1',
            timestamp: new Date(),
            resolved: true,
            resolvedAt: new Date(),
            resolution: 'Increased timeout',
            escalated: false,
          },
        ]
      : [],
    retryCount: options.retryCount ?? 0,
    maxRetries: 3,
    startTime: new Date(Date.now() - 60000),
    errors: [],
    costBudgetUsd: 10,
    currentCostUsd: 0.5,
  });

  beforeEach(() => {
    service = new LearningCaptureService();
  });

  describe('extractLearnings', () => {
    it('should extract learnings from successful task', async () => {
      const context = createMockContext({ success: true });
      const learnings = await service.extractLearnings(context);

      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings.some((l) => l.type === 'success')).toBe(true);
    });

    it('should extract learnings from failed task', async () => {
      const context = createMockContext({ success: false });
      const learnings = await service.extractLearnings(context);

      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings.some((l) => l.type === 'failure')).toBe(true);
    });

    it('should extract learnings from retried task', async () => {
      const context = createMockContext({ success: true, retryCount: 2 });
      const learnings = await service.extractLearnings(context);

      expect(learnings.some((l) => l.type === 'improvement')).toBe(true);
    });

    it('should extract learnings from blockers', async () => {
      const context = createMockContext({ success: true, withBlockers: true });
      const learnings = await service.extractLearnings(context);

      expect(learnings.some((l) => l.type === 'improvement')).toBe(true);
    });

    it('should not capture if config disables it', async () => {
      service = new LearningCaptureService({
        captureSuccess: false,
        captureFailure: false,
        requireApproval: true,
        minRelevanceScore: 0.7,
      });

      const context = createMockContext({ success: true });
      const learnings = await service.extractLearnings(context);

      expect(learnings.length).toBe(0);
    });

    it('should include keywords from task', async () => {
      const context = createMockContext({ success: true });
      const learnings = await service.extractLearnings(context);

      const successLearning = learnings.find((l) => l.type === 'success');
      expect(successLearning?.keywords).toContain('feature');
    });
  });

  describe('submitLearning', () => {
    it('should store learning locally when no knowledge service', async () => {
      const learning = {
        taskId: 'task-1',
        type: 'success' as const,
        title: 'Test learning',
        description: 'Test description',
        keywords: ['test'],
        priority: 'medium' as const,
        suggestedKnowledgeType: 'learning' as const,
        status: 'pending' as const,
      };

      await service.submitLearning(learning);

      expect(service.getCapturedLearnings()).toContain(learning);
    });
  });

  describe('detectSuccessPatterns', () => {
    it('should detect fast completion pattern', async () => {
      const context = createMockContext({ success: true });
      context.implementation!.durationMs = 15000; // 15 seconds

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns).toContain('Fast completion (< 30s)');
    });

    it('should detect low cost pattern', async () => {
      const context = createMockContext({ success: true });
      context.implementation!.costUsd = 0.05;

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns).toContain('Low cost (< $0.10)');
    });

    it('should detect 100% test pass rate', async () => {
      const context = createMockContext({ success: true });
      context.implementation!.testsRun = 10;
      context.implementation!.testsPassed = 10;

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns).toContain('100% test pass rate');
    });

    it('should detect first-attempt success', async () => {
      const context = createMockContext({ success: true, retryCount: 0 });

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns).toContain('First-attempt success');
    });

    it('should detect no blockers', async () => {
      const context = createMockContext({ success: true, withBlockers: false });

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns).toContain('No blockers encountered');
    });

    it('should detect high review score', async () => {
      const context = createMockContext({ success: true });
      context.review!.score = 95;

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns.some((p) => p.includes('High review score'))).toBe(true);
    });

    it('should return empty for failed tasks', async () => {
      const context = createMockContext({ success: false });

      const patterns = await service.detectSuccessPatterns(context);

      expect(patterns.length).toBe(0);
    });
  });

  describe('detectFailurePatterns', () => {
    it('should detect implementation failure', async () => {
      const context = createMockContext({ success: false });
      context.implementation!.success = false;
      context.implementation!.error = 'Compilation error';

      const patterns = await service.detectFailurePatterns(context);

      expect(patterns).toContain('Implementation failed');
    });

    it('should detect review failure', async () => {
      const context = createMockContext({ success: false });

      const patterns = await service.detectFailurePatterns(context);

      expect(patterns.some((p) => p.includes('Review failed'))).toBe(true);
    });

    it('should detect multiple retries', async () => {
      const context = createMockContext({ success: true, retryCount: 2 });

      const patterns = await service.detectFailurePatterns(context);

      expect(patterns).toContain('Required 2 retries');
    });

    it('should detect blockers', async () => {
      const context = createMockContext({ success: true, withBlockers: true });

      const patterns = await service.detectFailurePatterns(context);

      expect(patterns.some((p) => p.includes('Blockers'))).toBe(true);
    });

    it('should detect cost overrun', async () => {
      const context = createMockContext({ success: true });
      context.costBudgetUsd = 1.0;
      context.currentCostUsd = 0.9; // 90%

      const patterns = await service.detectFailurePatterns(context);

      expect(patterns).toContain('Near/over cost budget');
    });
  });

  describe('getLearningsForTask', () => {
    it('should return learnings for specific task', async () => {
      const context1 = createMockContext({ success: true });
      const context2 = createMockContext({ success: true });
      context2.task.id = 'task-2';

      await service.extractLearnings(context1);
      await service.extractLearnings(context2);

      const learnings = service.getLearningsForTask('task-1');

      expect(learnings.every((l) => l.taskId === 'task-1')).toBe(true);
    });
  });

  describe('clearCapturedLearnings', () => {
    it('should clear all captured learnings', async () => {
      const context = createMockContext({ success: true });
      await service.extractLearnings(context);

      expect(service.getCapturedLearnings().length).toBeGreaterThan(0);

      service.clearCapturedLearnings();

      expect(service.getCapturedLearnings().length).toBe(0);
    });
  });
});

describe('createLearningCapture', () => {
  it('should create service with default config', () => {
    const service = createLearningCapture();
    expect(service).toBeInstanceOf(LearningCaptureService);
  });

  it('should create service with custom config', () => {
    const service = createLearningCapture({
      captureSuccess: false,
      captureFailure: true,
      requireApproval: false,
      minRelevanceScore: 0.5,
    });
    expect(service).toBeInstanceOf(LearningCaptureService);
  });
});
