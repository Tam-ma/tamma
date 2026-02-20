/**
 * Tests for Duplicate Detector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateDetector } from '../capture/duplicate-detector.js';
import { InMemoryKnowledgeStore } from '../stores/in-memory-store.js';
import type { LearningCapture, KnowledgeEntry } from '@tamma/shared';

describe('DuplicateDetector', () => {
  let detector: DuplicateDetector;
  let store: InMemoryKnowledgeStore;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id',
    type: 'learning',
    title: 'Test Learning',
    description: 'Test description for learning',
    scope: 'global',
    keywords: ['test', 'learning', 'knowledge'],
    priority: 'medium',
    source: 'task_success',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test',
    enabled: true,
    timesApplied: 0,
    timesHelpful: 0,
    ...overrides,
  });

  const createTestCapture = (
    overrides?: Partial<LearningCapture>
  ): LearningCapture => ({
    taskId: 'task-123',
    projectId: 'project-abc',
    outcome: 'success',
    description: 'Task completed successfully',
    suggestedTitle: 'Test Learning',
    suggestedDescription: 'Test description for learning',
    suggestedKeywords: ['test', 'learning', 'knowledge'],
    suggestedPriority: 'medium',
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryKnowledgeStore();
    detector = new DuplicateDetector(store);
  });

  describe('isDuplicate', () => {
    it('should return false when no existing entries', async () => {
      const capture = createTestCapture();

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(false);
    });

    it('should detect duplicate by title', async () => {
      await store.create(
        createTestEntry({
          title: 'Use caching for performance',
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Use caching for performance', // Same title
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(true);
    });

    it('should detect near-duplicate titles', async () => {
      await store.create(
        createTestEntry({
          title: 'Caching improves API performance',
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Caching improves API performance significantly', // Similar
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(true);
    });

    it('should detect duplicate by description', async () => {
      await store.create(
        createTestEntry({
          title: 'Different Title',
          description: 'Adding Redis caching reduced API latency by 50%',
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Another Title',
        suggestedDescription: 'Adding Redis caching reduced API latency by 50%', // Same description
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(true);
    });

    it('should detect duplicate by keyword overlap', async () => {
      await store.create(
        createTestEntry({
          title: 'Different Title',
          description: 'Different description',
          keywords: ['redis', 'caching', 'performance', 'api', 'latency'],
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Another Title',
        suggestedDescription: 'Another description about caching',
        suggestedKeywords: ['redis', 'caching', 'performance', 'api', 'latency'], // Same keywords
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(true);
    });

    it('should not flag entries with different content as duplicate', async () => {
      await store.create(
        createTestEntry({
          title: 'Database optimization tips',
          description: 'Index your frequently queried columns',
          keywords: ['database', 'index', 'query', 'sql'],
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'API caching strategies',
        suggestedDescription: 'Use Redis for caching API responses',
        suggestedKeywords: ['api', 'redis', 'cache', 'http'],
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(false);
    });

    it('should only check enabled learnings', async () => {
      await store.create(
        createTestEntry({
          title: 'Disabled Learning',
          description: 'This is disabled',
          enabled: false,
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Disabled Learning',
        suggestedDescription: 'This is disabled',
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(false);
    });

    it('should only check learning type entries', async () => {
      await store.create(
        createTestEntry({
          type: 'recommendation', // Not a learning
          title: 'Same Title',
          description: 'Same description',
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Same Title',
        suggestedDescription: 'Same description',
      });

      const isDuplicate = await detector.isDuplicate(capture);

      expect(isDuplicate).toBe(false);
    });
  });

  describe('findSimilar', () => {
    it('should return empty array when no similar entries', async () => {
      const capture = createTestCapture();

      const similar = await detector.findSimilar(capture);

      expect(similar).toHaveLength(0);
    });

    it('should return similar entries', async () => {
      await store.create(
        createTestEntry({
          id: 'similar-1',
          title: 'Caching improves performance',
          keywords: ['caching', 'performance'],
        })
      );
      await store.create(
        createTestEntry({
          id: 'different-1',
          title: 'Database indexing',
          keywords: ['database', 'index'],
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Caching improves API performance',
        suggestedKeywords: ['caching', 'performance', 'api'],
      });

      const similar = await detector.findSimilar(capture);

      expect(similar).toHaveLength(1);
      expect(similar[0]!.id).toBe('similar-1');
    });
  });

  describe('getSimilarityScore', () => {
    it('should return high score for identical entries', () => {
      const entry = createTestEntry({
        title: 'Test Title',
        description: 'Test Description',
        keywords: ['test', 'keywords'],
      });

      const capture = createTestCapture({
        suggestedTitle: 'Test Title',
        suggestedDescription: 'Test Description',
        suggestedKeywords: ['test', 'keywords'],
      });

      const score = detector.getSimilarityScore(capture, entry);

      expect(score).toBeGreaterThan(0.9);
    });

    it('should return low score for different entries', () => {
      const entry = createTestEntry({
        title: 'Database optimization',
        description: 'Index your tables',
        keywords: ['database', 'sql', 'index'],
      });

      const capture = createTestCapture({
        suggestedTitle: 'API caching',
        suggestedDescription: 'Use Redis for caching',
        suggestedKeywords: ['api', 'redis', 'cache'],
      });

      const score = detector.getSimilarityScore(capture, entry);

      expect(score).toBeLessThan(0.5);
    });
  });

  describe('options', () => {
    it('should respect keywordOverlapThreshold', async () => {
      const strictDetector = new DuplicateDetector(store, {
        keywordOverlapThreshold: 0.9, // Very strict
      });

      await store.create(
        createTestEntry({
          title: 'Different title',
          description: 'Different description',
          keywords: ['redis', 'caching', 'performance'],
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Another title',
        suggestedDescription: 'Another description about caching',
        suggestedKeywords: ['redis', 'caching', 'api'], // 2/3 overlap
      });

      const isDuplicate = await strictDetector.isDuplicate(capture);

      expect(isDuplicate).toBe(false); // Below 0.9 threshold
    });

    it('should respect titleSimilarityThreshold', async () => {
      const strictDetector = new DuplicateDetector(store, {
        titleSimilarityThreshold: 0.95, // Very strict
      });

      await store.create(
        createTestEntry({
          title: 'Use Redis caching for APIs',
        })
      );

      const capture = createTestCapture({
        suggestedTitle: 'Use Redis caching for API performance', // Similar but not 95%
      });

      const isDuplicate = await strictDetector.isDuplicate(capture);

      expect(isDuplicate).toBe(false);
    });

    it('should respect projectScopeOnly option', async () => {
      const projectScopedDetector = new DuplicateDetector(store, {
        projectScopeOnly: true,
      });

      await store.create(
        createTestEntry({
          id: 'other-project',
          title: 'Same Title',
          description: 'Same description',
          projectId: 'other-project',
        })
      );

      const capture = createTestCapture({
        projectId: 'my-project',
        suggestedTitle: 'Same Title',
        suggestedDescription: 'Same description',
      });

      // This is testing that with projectScopeOnly, it would only check same project
      // In current implementation, it filters by projectId if set
      const isDuplicate = await projectScopedDetector.isDuplicate(capture);

      // Should not find duplicate from other project
      expect(isDuplicate).toBe(false);
    });

    it('should get and set options', () => {
      const initialOptions = detector.getOptions();
      expect(initialOptions.keywordOverlapThreshold).toBe(0.7);

      detector.setOptions({ keywordOverlapThreshold: 0.9 });

      const updatedOptions = detector.getOptions();
      expect(updatedOptions.keywordOverlapThreshold).toBe(0.9);
    });
  });
});
