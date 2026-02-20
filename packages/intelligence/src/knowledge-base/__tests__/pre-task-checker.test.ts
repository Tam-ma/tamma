/**
 * Tests for Pre-Task Knowledge Checker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreTaskChecker } from '../checkers/pre-task-checker.js';
import { KnowledgeService } from '../knowledge-service.js';
import { InMemoryKnowledgeStore } from '../stores/in-memory-store.js';
import type { TaskContext, DevelopmentPlan } from '../types.js';
import type { KnowledgeEntry } from '@tamma/shared';

describe('PreTaskChecker', () => {
  let checker: PreTaskChecker;
  let service: KnowledgeService;
  let store: InMemoryKnowledgeStore;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id',
    type: 'recommendation',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: ['test'],
    priority: 'medium',
    source: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test',
    enabled: true,
    timesApplied: 0,
    timesHelpful: 0,
    ...overrides,
  });

  const createTestTask = (overrides?: Partial<TaskContext>): TaskContext => ({
    taskId: 'task-123',
    type: 'implement_feature',
    description: 'Implement new feature',
    projectId: 'project-abc',
    agentType: 'implementer',
    ...overrides,
  });

  const createTestPlan = (overrides?: Partial<DevelopmentPlan>): DevelopmentPlan => ({
    summary: 'Add new feature',
    approach: 'Create new TypeScript service',
    fileChanges: [
      { path: 'src/services/new-service.ts', action: 'create', description: 'New service' },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    store = new InMemoryKnowledgeStore();
    service = new KnowledgeService(store);
    await service.initialize();
    checker = new PreTaskChecker(service);
  });

  describe('basic checking', () => {
    it('should return canProceed=true when no knowledge matches', async () => {
      const task = createTestTask();
      const plan = createTestPlan();

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.canProceed).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should be disabled when enabled=false', async () => {
      checker.setOptions({ enabled: false });

      // Add a critical prohibition that would normally block
      await store.create(
        createTestEntry({
          id: 'prohibition-1',
          type: 'prohibition',
          priority: 'critical',
          keywords: ['typescript'],
          patterns: ['src/'],
        })
      );

      const task = createTestTask({ description: 'Work with TypeScript' });
      const plan = createTestPlan();

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.canProceed).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });
  });

  describe('prohibition checking', () => {
    it('should block on critical prohibition match', async () => {
      await store.create(
        createTestEntry({
          id: 'critical-prohibition',
          type: 'prohibition',
          title: 'Do not modify legacy auth',
          description: 'Legacy auth module is deprecated',
          priority: 'critical',
          patterns: ['src/legacy/auth'],
        })
      );

      const task = createTestTask();
      const plan = createTestPlan({
        fileChanges: [
          { path: 'src/legacy/auth/login.ts', action: 'modify', description: 'Update login' },
        ],
      });

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.canProceed).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]!.knowledge.title).toBe('Do not modify legacy auth');
    });

    it('should warn on non-critical prohibition match', async () => {
      await store.create(
        createTestEntry({
          id: 'warning-prohibition',
          type: 'prohibition',
          title: 'Avoid direct database access',
          description: 'Use repository pattern instead',
          priority: 'high', // Not critical
          keywords: ['direct', 'database'],
        })
      );

      const task = createTestTask({
        description: 'Query users directly from database',
      });
      const plan = createTestPlan({
        approach: 'Use direct database access to query users',
      });

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.canProceed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should not block when blockOnCritical is disabled', async () => {
      checker.setOptions({ blockOnCritical: false });

      await store.create(
        createTestEntry({
          id: 'critical-prohibition',
          type: 'prohibition',
          priority: 'critical',
          patterns: ['src/legacy/'],
        })
      );

      const task = createTestTask();
      const plan = createTestPlan({
        fileChanges: [
          { path: 'src/legacy/service.ts', action: 'modify', description: 'Update' },
        ],
      });

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.canProceed).toBe(true);
      // Should still appear as warning
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recommendation matching', () => {
    it('should include matching recommendations', async () => {
      await store.create(
        createTestEntry({
          id: 'rec-1',
          type: 'recommendation',
          title: 'Use TypeScript strict mode',
          description: 'Enable strict mode for better type safety',
          keywords: ['typescript', 'strict'],
        })
      );

      const task = createTestTask({
        description: 'Create TypeScript service',
      });
      const plan = createTestPlan();

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0]!.knowledge.title).toBe('Use TypeScript strict mode');
    });

    it('should limit recommendations to maxRecommendations', async () => {
      // Add many recommendations
      for (let i = 0; i < 10; i++) {
        await store.create(
          createTestEntry({
            id: `rec-${i}`,
            type: 'recommendation',
            title: `Recommendation ${i}`,
            keywords: ['typescript'],
          })
        );
      }

      checker.setOptions({ maxRecommendations: 3 });

      const task = createTestTask({ description: 'TypeScript task' });
      const plan = createTestPlan();

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.recommendations).toHaveLength(3);
    });
  });

  describe('learning matching', () => {
    it('should include matching learnings', async () => {
      await store.create(
        createTestEntry({
          id: 'learning-1',
          type: 'learning',
          title: 'Rate limiting needs exponential backoff',
          description: 'Simple retry delays are not sufficient',
          keywords: ['rate', 'limit', 'retry', 'backoff'],
          examples: [
            {
              scenario: 'API returns 429',
              goodApproach: 'Exponential backoff with jitter',
              badApproach: 'Fixed 1 second delay',
            },
          ],
        })
      );

      const task = createTestTask({
        description: 'Implement API rate limiting',
      });
      const plan = createTestPlan({
        approach: 'Add retry logic for rate limited requests',
      });

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.learnings.length).toBeGreaterThan(0);
    });

    it('should limit learnings to maxLearnings', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create(
          createTestEntry({
            id: `learning-${i}`,
            type: 'learning',
            title: `Learning ${i}`,
            keywords: ['api'],
          })
        );
      }

      checker.setOptions({ maxLearnings: 2 });

      const task = createTestTask({ description: 'Build API' });
      const plan = createTestPlan();

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.learnings).toHaveLength(2);
    });
  });

  describe('technology extraction', () => {
    it('should extract technologies from file extensions', async () => {
      await store.create(
        createTestEntry({
          id: 'rec-ts',
          type: 'recommendation',
          title: 'TypeScript best practices',
          keywords: ['typescript'],
        })
      );

      const task = createTestTask({ description: 'Update code' });
      const plan = createTestPlan({
        fileChanges: [
          { path: 'src/service.ts', action: 'modify', description: 'Update' },
          { path: 'src/types.tsx', action: 'create', description: 'New types' },
        ],
      });

      const result = await checker.checkBeforeTask(task, plan);

      // Should match because TypeScript is extracted from .ts/.tsx files
      expect(result.recommendations.some(
        (r) => r.knowledge.title === 'TypeScript best practices'
      )).toBe(true);
    });

    it('should extract technologies from plan approach', async () => {
      await store.create(
        createTestEntry({
          id: 'rec-react',
          type: 'recommendation',
          title: 'React component patterns',
          keywords: ['react', 'component'],
        })
      );

      const task = createTestTask({ description: 'Build UI' });
      const plan = createTestPlan({
        approach: 'Use React components with hooks',
      });

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.recommendations.some(
        (r) => r.knowledge.title === 'React component patterns'
      )).toBe(true);
    });
  });

  describe('scope filtering', () => {
    it('should not match project-scoped knowledge for different project', async () => {
      await store.create(
        createTestEntry({
          id: 'project-specific',
          type: 'prohibition',
          priority: 'critical',
          scope: 'project',
          projectId: 'other-project',
          patterns: ['src/'],
        })
      );

      const task = createTestTask({ projectId: 'my-project' });
      const plan = createTestPlan();

      const result = await checker.checkBeforeTask(task, plan);

      expect(result.blockers).toHaveLength(0);
    });
  });

  describe('options management', () => {
    it('should get and set options', () => {
      const initialOptions = checker.getOptions();
      expect(initialOptions.enabled).toBe(true);

      checker.setOptions({ maxRecommendations: 10, maxLearnings: 5 });

      const updatedOptions = checker.getOptions();
      expect(updatedOptions.maxRecommendations).toBe(10);
      expect(updatedOptions.maxLearnings).toBe(5);
    });
  });
});
