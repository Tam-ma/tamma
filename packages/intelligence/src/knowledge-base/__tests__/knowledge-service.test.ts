/**
 * Tests for Knowledge Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeService } from '../knowledge-service.js';
import { InMemoryKnowledgeStore } from '../stores/in-memory-store.js';
import type { KnowledgeEntry, CreateKnowledgeEntry } from '@tamma/shared';

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let store: InMemoryKnowledgeStore;

  const createTestEntryData = (
    overrides?: Partial<CreateKnowledgeEntry>
  ): CreateKnowledgeEntry => ({
    type: 'recommendation',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: ['test', 'keyword'],
    priority: 'medium',
    source: 'manual',
    createdBy: 'test-user',
    enabled: true,
    ...overrides,
  });

  beforeEach(async () => {
    store = new InMemoryKnowledgeStore();
    service = new KnowledgeService(store);
    await service.initialize();
  });

  describe('lifecycle', () => {
    it('should initialize successfully', async () => {
      const newService = new KnowledgeService();
      await newService.initialize();
      await newService.dispose();
    });

    it('should accept config on initialization', async () => {
      const newService = new KnowledgeService();
      await newService.initialize({
        matching: {
          useSemantic: false,
          semanticThreshold: 0.8,
          keywordBoost: 2.0,
          maxKeywordDistance: 3,
        },
      });
      await newService.dispose();
    });
  });

  describe('CRUD operations', () => {
    it('should add a knowledge entry', async () => {
      const entryData = createTestEntryData();

      const created = await service.addKnowledge(entryData);

      expect(created.id).toBeDefined();
      expect(created.title).toBe(entryData.title);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.timesApplied).toBe(0);
    });

    it('should get a knowledge entry by ID', async () => {
      const created = await service.addKnowledge(createTestEntryData());

      const retrieved = await service.getKnowledge(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should return null for non-existent entry', async () => {
      const retrieved = await service.getKnowledge('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should update a knowledge entry', async () => {
      const created = await service.addKnowledge(createTestEntryData());

      const updated = await service.updateKnowledge(created.id, {
        title: 'Updated Title',
        priority: 'high',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.priority).toBe('high');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it('should throw when updating non-existent entry', async () => {
      await expect(
        service.updateKnowledge('non-existent', { title: 'New' })
      ).rejects.toThrow();
    });

    it('should delete a knowledge entry', async () => {
      const created = await service.addKnowledge(createTestEntryData());

      await service.deleteKnowledge(created.id);

      const retrieved = await service.getKnowledge(created.id);
      expect(retrieved).toBeNull();
    });

    it('should list knowledge entries', async () => {
      await service.addKnowledge(createTestEntryData({ title: 'Entry 1' }));
      await service.addKnowledge(createTestEntryData({ title: 'Entry 2' }));
      await service.addKnowledge(createTestEntryData({ title: 'Entry 3' }));

      const { entries, total } = await service.listKnowledge();

      expect(entries).toHaveLength(3);
      expect(total).toBe(3);
    });

    it('should list with filters', async () => {
      await service.addKnowledge(
        createTestEntryData({ type: 'recommendation' })
      );
      await service.addKnowledge(createTestEntryData({ type: 'prohibition' }));
      await service.addKnowledge(createTestEntryData({ type: 'learning' }));

      const { entries } = await service.listKnowledge({
        types: ['recommendation', 'learning'],
      });

      expect(entries).toHaveLength(2);
    });
  });

  describe('getRelevantKnowledge', () => {
    beforeEach(async () => {
      // Add test entries
      await service.addKnowledge(
        createTestEntryData({
          type: 'recommendation',
          title: 'Use TypeScript strict mode',
          keywords: ['typescript', 'strict', 'type'],
        })
      );
      await service.addKnowledge(
        createTestEntryData({
          type: 'prohibition',
          title: 'Never commit .env files',
          keywords: ['env', 'secrets', 'git'],
          patterns: ['\\.env'],
          priority: 'critical',
        })
      );
      await service.addKnowledge(
        createTestEntryData({
          type: 'learning',
          title: 'API rate limiting patterns',
          keywords: ['api', 'rate', 'limit'],
        })
      );
    });

    it('should return relevant knowledge for query', async () => {
      const result = await service.getRelevantKnowledge({
        taskType: 'implement_feature',
        taskDescription: 'Add new TypeScript API endpoint',
        projectId: 'my-project',
        agentType: 'implementer',
      });

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });

    it('should include critical warnings', async () => {
      const result = await service.getRelevantKnowledge({
        taskType: 'update_config',
        taskDescription: 'Update environment configuration',
        projectId: 'my-project',
        agentType: 'implementer',
        filePaths: ['.env.local'],
      });

      expect(result.criticalWarnings.length).toBeGreaterThan(0);
    });

    it('should respect maxResults', async () => {
      // Add many recommendations
      for (let i = 0; i < 20; i++) {
        await service.addKnowledge(
          createTestEntryData({
            type: 'recommendation',
            title: `Recommendation ${i}`,
            keywords: ['typescript'],
          })
        );
      }

      const result = await service.getRelevantKnowledge({
        taskType: 'code',
        taskDescription: 'Write TypeScript code',
        projectId: 'my-project',
        agentType: 'implementer',
        maxResults: 5,
      });

      expect(result.recommendations.length).toBeLessThanOrEqual(5);
    });

    it('should filter by scope', async () => {
      await service.addKnowledge(
        createTestEntryData({
          type: 'recommendation',
          title: 'Project-specific rule',
          scope: 'project',
          projectId: 'other-project',
          keywords: ['typescript'],
        })
      );

      const result = await service.getRelevantKnowledge({
        taskType: 'code',
        taskDescription: 'Write TypeScript',
        projectId: 'my-project',
        agentType: 'implementer',
      });

      // Should not include the project-specific rule for other project
      const hasOtherProjectRule = result.recommendations.some(
        (r) => r.title === 'Project-specific rule'
      );
      expect(hasOtherProjectRule).toBe(false);
    });
  });

  describe('learning capture', () => {
    it('should capture a learning', async () => {
      const pending = await service.captureLearning({
        taskId: 'task-123',
        projectId: 'my-project',
        outcome: 'success',
        description: 'Task completed successfully',
        whatWorked: 'Used caching for performance',
        suggestedTitle: 'Caching improves performance',
        suggestedDescription: 'Using Redis caching improved API response time',
        suggestedKeywords: ['caching', 'redis', 'performance'],
        suggestedPriority: 'medium',
      });

      expect(pending.id).toBeDefined();
      expect(pending.status).toBe('pending');
      expect(pending.capturedAt).toBeInstanceOf(Date);
    });

    it('should list pending learnings', async () => {
      await service.captureLearning({
        taskId: 'task-1',
        projectId: 'project-a',
        outcome: 'success',
        description: 'Success',
        suggestedTitle: 'Learning 1',
        suggestedDescription: 'Description 1',
        suggestedKeywords: ['test'],
        suggestedPriority: 'low',
      });
      await service.captureLearning({
        taskId: 'task-2',
        projectId: 'project-b',
        outcome: 'failure',
        description: 'Failure',
        suggestedTitle: 'Learning 2',
        suggestedDescription: 'Description 2',
        suggestedKeywords: ['test'],
        suggestedPriority: 'medium',
      });

      const pending = await service.getPendingLearnings();

      expect(pending).toHaveLength(2);
    });

    it('should approve a pending learning', async () => {
      const pending = await service.captureLearning({
        taskId: 'task-123',
        projectId: 'my-project',
        outcome: 'success',
        description: 'Success',
        suggestedTitle: 'Good pattern',
        suggestedDescription: 'This pattern worked well',
        suggestedKeywords: ['pattern', 'success'],
        suggestedPriority: 'medium',
      });

      const approved = await service.approveLearning(pending.id);

      expect(approved.type).toBe('learning');
      expect(approved.title).toBe('Good pattern');
      expect(approved.source).toBe('task_success');

      // Pending should be marked as approved
      const pendingList = await service.getPendingLearnings();
      expect(pendingList.find((p) => p.id === pending.id)).toBeUndefined();
    });

    it('should approve with edits', async () => {
      const pending = await service.captureLearning({
        taskId: 'task-123',
        projectId: 'my-project',
        outcome: 'success',
        description: 'Success',
        suggestedTitle: 'Original title',
        suggestedDescription: 'Original description',
        suggestedKeywords: ['original'],
        suggestedPriority: 'low',
      });

      const approved = await service.approveLearning(pending.id, {
        title: 'Edited title',
        priority: 'high',
        keywords: ['edited', 'improved'],
      });

      expect(approved.title).toBe('Edited title');
      expect(approved.priority).toBe('high');
      expect(approved.keywords).toContain('edited');
    });

    it('should reject a pending learning', async () => {
      const pending = await service.captureLearning({
        taskId: 'task-123',
        projectId: 'my-project',
        outcome: 'failure',
        description: 'Failure',
        suggestedTitle: 'Bad learning',
        suggestedDescription: 'Not useful',
        suggestedKeywords: ['bad'],
        suggestedPriority: 'low',
      });

      await service.rejectLearning(pending.id, 'Not actionable');

      const pendingList = await service.getPendingLearnings();
      expect(pendingList.find((p) => p.id === pending.id)).toBeUndefined();
    });
  });

  describe('feedback', () => {
    it('should record application', async () => {
      const entry = await service.addKnowledge(createTestEntryData());

      await service.recordApplication(entry.id, 'task-123', true);

      const updated = await service.getKnowledge(entry.id);
      expect(updated!.timesApplied).toBe(1);
      expect(updated!.timesHelpful).toBe(1);
    });

    it('should track unhelpful feedback', async () => {
      const entry = await service.addKnowledge(createTestEntryData());

      await service.recordApplication(entry.id, 'task-123', false);

      const updated = await service.getKnowledge(entry.id);
      expect(updated!.timesApplied).toBe(1);
      expect(updated!.timesHelpful).toBe(0);
    });
  });

  describe('import/export', () => {
    it('should import knowledge entries', async () => {
      const entries: CreateKnowledgeEntry[] = [
        createTestEntryData({ title: 'Import 1' }),
        createTestEntryData({ title: 'Import 2' }),
        createTestEntryData({ title: 'Import 3' }),
      ];

      const result = await service.importKnowledge(entries);

      expect(result.imported).toBe(3);
      expect(result.errors).toHaveLength(0);

      const { total } = await service.listKnowledge();
      expect(total).toBe(3);
    });

    it('should skip duplicates during import', async () => {
      await service.addKnowledge(createTestEntryData({ title: 'Existing' }));

      const entries: CreateKnowledgeEntry[] = [
        createTestEntryData({ title: 'Existing' }), // Duplicate
        createTestEntryData({ title: 'New Entry' }),
      ];

      const result = await service.importKnowledge(entries);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should export knowledge entries', async () => {
      await service.addKnowledge(
        createTestEntryData({ type: 'recommendation', title: 'Rec 1' })
      );
      await service.addKnowledge(
        createTestEntryData({ type: 'prohibition', title: 'Pro 1' })
      );
      await service.addKnowledge(
        createTestEntryData({ type: 'learning', title: 'Learn 1' })
      );

      const exported = await service.exportKnowledge();

      expect(exported).toHaveLength(3);
    });

    it('should export with filter', async () => {
      await service.addKnowledge(
        createTestEntryData({ type: 'recommendation' })
      );
      await service.addKnowledge(createTestEntryData({ type: 'prohibition' }));
      await service.addKnowledge(createTestEntryData({ type: 'learning' }));

      const exported = await service.exportKnowledge({
        types: ['recommendation'],
      });

      expect(exported).toHaveLength(1);
      expect(exported[0]!.type).toBe('recommendation');
    });
  });

  describe('maintenance', () => {
    it('should prune expired entries', async () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2); // 2 years old

      await store.create({
        id: 'old-entry',
        type: 'learning',
        title: 'Old entry',
        description: 'This is old',
        scope: 'global',
        keywords: ['old'],
        priority: 'low',
        source: 'manual',
        createdAt: oldDate,
        updatedAt: oldDate,
        createdBy: 'test',
        enabled: true,
        timesApplied: 0, // Never applied
        timesHelpful: 0,
      });

      await service.addKnowledge(createTestEntryData({ title: 'New entry' }));

      const pruned = await service.pruneExpired();

      expect(pruned).toBe(1);

      const { total } = await service.listKnowledge();
      expect(total).toBe(1);
    });

    it('should not prune frequently used entries', async () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2);

      await store.create({
        id: 'frequently-used',
        type: 'recommendation',
        title: 'Frequently used',
        description: 'This is used a lot',
        scope: 'global',
        keywords: ['useful'],
        priority: 'high',
        source: 'manual',
        createdAt: oldDate,
        updatedAt: oldDate,
        createdBy: 'test',
        enabled: true,
        timesApplied: 100, // Frequently applied
        timesHelpful: 90,
      });

      const pruned = await service.pruneExpired();

      expect(pruned).toBe(0);
    });
  });

  describe('checkBeforeTask', () => {
    it('should check task against knowledge base', async () => {
      await service.addKnowledge(
        createTestEntryData({
          type: 'prohibition',
          title: 'No direct DB access',
          keywords: ['database', 'direct'],
          priority: 'high',
        })
      );

      const result = await service.checkBeforeTask(
        {
          taskId: 'task-1',
          type: 'implement',
          description: 'Access database directly',
          projectId: 'my-project',
          agentType: 'implementer',
        },
        {
          summary: 'Direct DB query',
          approach: 'Query database directly',
          fileChanges: [
            { path: 'src/db.ts', action: 'modify', description: 'Add query' },
          ],
        }
      );

      expect(result.canProceed).toBeDefined();
    });
  });
});
