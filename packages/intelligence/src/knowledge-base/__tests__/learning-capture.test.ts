/**
 * Tests for Learning Capture
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LearningCaptureService, type TaskOutcome } from '../capture/learning-capture.js';
import { InMemoryKnowledgeStore } from '../stores/in-memory-store.js';

describe('LearningCaptureService', () => {
  let captureService: LearningCaptureService;
  let store: InMemoryKnowledgeStore;

  const createTestOutcome = (overrides?: Partial<TaskOutcome>): TaskOutcome => ({
    taskId: 'task-123',
    projectId: 'project-abc',
    taskType: 'implement_feature',
    taskDescription: 'Add new user authentication feature',
    outcome: 'success',
    output: 'Successfully implemented authentication',
    durationMs: 60000,
    changedFiles: ['src/auth/login.ts', 'src/auth/logout.ts'],
    technologies: ['typescript', 'express'],
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryKnowledgeStore();
    captureService = new LearningCaptureService(store);
  });

  describe('captureFromOutcome', () => {
    it('should capture learning from successful outcome', async () => {
      const outcome = createTestOutcome({ outcome: 'success' });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending).not.toBeNull();
      expect(pending!.status).toBe('pending');
      expect(pending!.outcome).toBe('success');
      expect(pending!.capturedBy).toBe('agent-1');
      expect(pending!.suggestedTitle).toContain('Successful');
    });

    it('should capture learning from failed outcome', async () => {
      const outcome = createTestOutcome({
        outcome: 'failure',
        error: 'Connection timeout occurred',
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending).not.toBeNull();
      expect(pending!.outcome).toBe('failure');
      expect(pending!.whatFailed).toBe('Connection timeout occurred');
      expect(pending!.suggestedTitle).toContain('Issue');
    });

    it('should capture learning from partial outcome', async () => {
      const outcome = createTestOutcome({
        outcome: 'partial',
        output: 'Some features completed',
        error: 'Tests failed',
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending).not.toBeNull();
      expect(pending!.outcome).toBe('partial');
      expect(pending!.suggestedTitle).toContain('Partial');
    });

    it('should not capture when autoCaptureSuccess is disabled', async () => {
      captureService.setConfig({ autoCaptureSuccess: false });

      const outcome = createTestOutcome({ outcome: 'success' });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending).toBeNull();
    });

    it('should not capture when autoCaptureFailure is disabled', async () => {
      captureService.setConfig({ autoCaptureFailure: false });

      const outcome = createTestOutcome({ outcome: 'failure' });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending).toBeNull();
    });

    it('should extract keywords from task outcome', async () => {
      const outcome = createTestOutcome({
        taskType: 'api_development',
        technologies: ['nodejs', 'express', 'mongodb'],
        changedFiles: ['src/api/users.ts', 'src/models/user.ts'],
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending).not.toBeNull();
      expect(pending!.suggestedKeywords).toContain('api_development');
      // Should include technologies
      expect(
        pending!.suggestedKeywords.some((k) =>
          ['nodejs', 'express', 'mongodb'].includes(k)
        )
      ).toBe(true);
    });

    it('should determine priority based on outcome', async () => {
      // Failed with retries should be higher priority
      const failedWithRetries = createTestOutcome({
        outcome: 'failure',
        retryCount: 3,
      });

      const pending = await captureService.captureFromOutcome(
        failedWithRetries,
        'agent-1'
      );

      expect(pending).not.toBeNull();
      expect(pending!.suggestedPriority).toBe('high');
    });
  });

  describe('captureExplicit', () => {
    it('should capture explicit learning', async () => {
      const pending = await captureService.captureExplicit(
        {
          taskId: 'task-456',
          projectId: 'my-project',
          outcome: 'success',
          description: 'Important insight discovered',
          whatWorked: 'Using caching improved performance',
          suggestedTitle: 'Cache API responses',
          suggestedDescription: 'Caching reduces response time significantly',
          suggestedKeywords: ['caching', 'performance', 'api'],
          suggestedPriority: 'high',
        },
        'admin'
      );

      expect(pending.id).toBeDefined();
      expect(pending.capturedBy).toBe('admin');
      expect(pending.suggestedTitle).toBe('Cache API responses');
    });

    it('should reject duplicate learnings', async () => {
      // First capture
      await captureService.captureExplicit(
        {
          taskId: 'task-1',
          projectId: 'my-project',
          outcome: 'success',
          description: 'First learning',
          suggestedTitle: 'Use caching for performance',
          suggestedDescription: 'Caching improves API response times',
          suggestedKeywords: ['caching', 'performance'],
          suggestedPriority: 'medium',
        },
        'admin'
      );

      // Approve it to make it a real entry
      const pending = await store.listPending();
      await store.create({
        id: 'approved-learning',
        type: 'learning',
        title: 'Use caching for performance',
        description: 'Caching improves API response times',
        scope: 'global',
        keywords: ['caching', 'performance'],
        priority: 'medium',
        source: 'task_success',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'admin',
        enabled: true,
        timesApplied: 0,
        timesHelpful: 0,
      });

      // Try to capture similar learning
      await expect(
        captureService.captureExplicit(
          {
            taskId: 'task-2',
            projectId: 'my-project',
            outcome: 'success',
            description: 'Similar learning',
            suggestedTitle: 'Use caching for performance', // Same title
            suggestedDescription: 'Caching improves API response times',
            suggestedKeywords: ['caching', 'performance'],
            suggestedPriority: 'medium',
          },
          'admin'
        )
      ).rejects.toThrow('similar learning already exists');
    });
  });

  describe('root cause extraction', () => {
    it('should identify timeout as root cause', async () => {
      const outcome = createTestOutcome({
        outcome: 'failure',
        error: 'Request timeout after 30 seconds',
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending!.rootCause).toContain('timed out');
    });

    it('should identify permission issues', async () => {
      const outcome = createTestOutcome({
        outcome: 'failure',
        error: 'Permission denied: cannot access file',
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending!.rootCause).toContain('Permission');
    });

    it('should identify not found errors', async () => {
      const outcome = createTestOutcome({
        outcome: 'failure',
        error: 'Resource not found: user ID 123',
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending!.rootCause).toContain('not found');
    });

    it('should use error message for unknown issues', async () => {
      const outcome = createTestOutcome({
        outcome: 'failure',
        error: 'Something unexpected happened',
      });

      const pending = await captureService.captureFromOutcome(outcome, 'agent-1');

      expect(pending!.rootCause).toBe('Something unexpected happened');
    });
  });

  describe('configuration', () => {
    it('should get and set config', () => {
      const initialConfig = captureService.getConfig();
      expect(initialConfig.autoCaptureSuccess).toBe(true);

      captureService.setConfig({
        autoCaptureSuccess: false,
        maxPendingDays: 60,
      });

      const updatedConfig = captureService.getConfig();
      expect(updatedConfig.autoCaptureSuccess).toBe(false);
      expect(updatedConfig.maxPendingDays).toBe(60);
    });
  });
});
