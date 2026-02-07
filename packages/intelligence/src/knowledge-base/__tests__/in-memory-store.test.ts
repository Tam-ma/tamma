/**
 * Tests for In-Memory Knowledge Store
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKnowledgeStore } from '../stores/in-memory-store.js';
import type { KnowledgeEntry, PendingLearning } from '@tamma/shared';

describe('InMemoryKnowledgeStore', () => {
  let store: InMemoryKnowledgeStore;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id-1',
    type: 'recommendation',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: ['test', 'keyword'],
    priority: 'medium',
    source: 'manual',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    createdBy: 'test-user',
    enabled: true,
    timesApplied: 0,
    timesHelpful: 0,
    ...overrides,
  });

  const createTestPendingLearning = (
    overrides?: Partial<PendingLearning>
  ): PendingLearning => ({
    id: 'pending-id-1',
    taskId: 'task-123',
    projectId: 'project-abc',
    outcome: 'success',
    description: 'Task completed successfully',
    suggestedTitle: 'Successful approach',
    suggestedDescription: 'This approach worked well',
    suggestedKeywords: ['test', 'success'],
    suggestedPriority: 'medium',
    capturedAt: new Date('2024-01-01'),
    capturedBy: 'system',
    status: 'pending',
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryKnowledgeStore();
  });

  describe('CRUD operations', () => {
    it('should create and retrieve an entry', async () => {
      const entry = createTestEntry();
      const created = await store.create(entry);

      expect(created).toEqual(entry);

      const retrieved = await store.get(entry.id);
      expect(retrieved).toEqual(entry);
    });

    it('should update an entry', async () => {
      const entry = createTestEntry();
      await store.create(entry);

      const updated = await store.update(entry.id, {
        title: 'Updated Title',
        description: 'Updated description',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.description).toBe('Updated description');
      expect(updated.id).toBe(entry.id);
    });

    it('should throw when updating non-existent entry', async () => {
      await expect(
        store.update('non-existent', { title: 'New' })
      ).rejects.toThrow('Knowledge entry not found');
    });

    it('should delete an entry', async () => {
      const entry = createTestEntry();
      await store.create(entry);

      await store.delete(entry.id);

      const retrieved = await store.get(entry.id);
      expect(retrieved).toBeNull();
    });

    it('should throw when deleting non-existent entry', async () => {
      await expect(store.delete('non-existent')).rejects.toThrow(
        'Knowledge entry not found'
      );
    });

    it('should return null for non-existent entry', async () => {
      const retrieved = await store.get('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('list with filters', () => {
    beforeEach(async () => {
      await store.create(
        createTestEntry({
          id: 'rec-1',
          type: 'recommendation',
          priority: 'high',
          scope: 'global',
        })
      );
      await store.create(
        createTestEntry({
          id: 'pro-1',
          type: 'prohibition',
          priority: 'critical',
          scope: 'project',
          projectId: 'project-a',
        })
      );
      await store.create(
        createTestEntry({
          id: 'learn-1',
          type: 'learning',
          priority: 'low',
          scope: 'global',
          enabled: false,
        })
      );
    });

    it('should list all entries', async () => {
      const { entries, total } = await store.list();
      expect(entries).toHaveLength(3);
      expect(total).toBe(3);
    });

    it('should filter by type', async () => {
      const { entries } = await store.list({ types: ['recommendation'] });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe('rec-1');
    });

    it('should filter by multiple types', async () => {
      const { entries } = await store.list({
        types: ['recommendation', 'learning'],
      });
      expect(entries).toHaveLength(2);
    });

    it('should filter by scope', async () => {
      const { entries } = await store.list({ scopes: ['project'] });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe('pro-1');
    });

    it('should filter by enabled status', async () => {
      const { entries } = await store.list({ enabled: true });
      expect(entries).toHaveLength(2);
    });

    it('should filter by minimum priority', async () => {
      const { entries } = await store.list({ priority: 'high' });
      expect(entries).toHaveLength(2); // high and critical
    });

    it('should apply pagination', async () => {
      const { entries, hasMore } = await store.list({ limit: 2, offset: 0 });
      expect(entries).toHaveLength(2);
      expect(hasMore).toBe(true);

      const { entries: nextPage } = await store.list({ limit: 2, offset: 2 });
      expect(nextPage).toHaveLength(1);
    });

    it('should filter by search text', async () => {
      await store.create(
        createTestEntry({
          id: 'search-test',
          title: 'TypeScript Best Practice',
          keywords: ['typescript', 'best-practice'],
        })
      );

      const { entries } = await store.list({ search: 'typescript' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe('search-test');
    });
  });

  describe('search', () => {
    it('should search by text in title and description', async () => {
      await store.create(
        createTestEntry({
          id: 'entry-1',
          title: 'Security Guidelines',
          description: 'Guidelines for secure coding',
          keywords: ['security'],
        })
      );
      await store.create(
        createTestEntry({
          id: 'entry-2',
          title: 'Performance Tips',
          description: 'Tips for better performance',
          keywords: ['performance'],
        })
      );

      const results = await store.search({ search: 'security' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('entry-1');
    });

    it('should search by keywords', async () => {
      await store.create(
        createTestEntry({
          id: 'entry-1',
          title: 'API Design',
          keywords: ['rest', 'api', 'design'],
        })
      );

      const results = await store.search({ search: 'rest' });
      expect(results).toHaveLength(1);
    });
  });

  describe('searchByEmbedding', () => {
    it('should search by embedding similarity', async () => {
      await store.create(
        createTestEntry({
          id: 'entry-1',
          embedding: [0.1, 0.2, 0.3],
        })
      );
      await store.create(
        createTestEntry({
          id: 'entry-2',
          embedding: [0.9, 0.8, 0.7],
        })
      );
      await store.create(
        createTestEntry({
          id: 'entry-3',
          // No embedding
        })
      );

      const results = await store.searchByEmbedding([0.1, 0.2, 0.3], {
        topK: 10,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.entry.id).toBe('entry-1');
      expect(results[0]!.score).toBeCloseTo(1, 5); // Exact match should be ~1
    });

    it('should filter by threshold', async () => {
      await store.create(
        createTestEntry({
          id: 'entry-1',
          embedding: [0.1, 0.2, 0.3],
        })
      );
      await store.create(
        createTestEntry({
          id: 'entry-2',
          embedding: [0.9, 0.8, 0.7],
        })
      );

      const results = await store.searchByEmbedding([0.1, 0.2, 0.3], {
        topK: 10,
        threshold: 0.99, // Very high threshold
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.entry.id).toBe('entry-1');
    });

    it('should respect topK limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create(
          createTestEntry({
            id: `entry-${i}`,
            embedding: [i * 0.1, i * 0.1, i * 0.1],
          })
        );
      }

      const results = await store.searchByEmbedding([0.3, 0.3, 0.3], {
        topK: 2,
      });

      expect(results).toHaveLength(2);
    });
  });

  describe('pending learnings', () => {
    it('should create and retrieve pending learning', async () => {
      const learning = createTestPendingLearning();
      const created = await store.createPending(learning);

      expect(created).toEqual(learning);

      const retrieved = await store.getPending(learning.id);
      expect(retrieved).toEqual(learning);
    });

    it('should update pending learning', async () => {
      const learning = createTestPendingLearning();
      await store.createPending(learning);

      const updated = await store.updatePending(learning.id, {
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: 'admin',
      });

      expect(updated.status).toBe('approved');
      expect(updated.reviewedBy).toBe('admin');
    });

    it('should list pending learnings with filters', async () => {
      await store.createPending(
        createTestPendingLearning({
          id: 'pending-1',
          status: 'pending',
          projectId: 'project-a',
        })
      );
      await store.createPending(
        createTestPendingLearning({
          id: 'pending-2',
          status: 'approved',
          projectId: 'project-a',
        })
      );
      await store.createPending(
        createTestPendingLearning({
          id: 'pending-3',
          status: 'pending',
          projectId: 'project-b',
        })
      );

      // Filter by status
      let results = await store.listPending({ status: 'pending' });
      expect(results).toHaveLength(2);

      // Filter by project
      results = await store.listPending({ projectId: 'project-a' });
      expect(results).toHaveLength(2);

      // Combined filter
      results = await store.listPending({
        status: 'pending',
        projectId: 'project-a',
      });
      expect(results).toHaveLength(1);
    });

    it('should delete pending learning', async () => {
      const learning = createTestPendingLearning();
      await store.createPending(learning);

      await store.deletePending(learning.id);

      const retrieved = await store.getPending(learning.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('stats', () => {
    it('should increment times applied', async () => {
      const entry = createTestEntry({ timesApplied: 5 });
      await store.create(entry);

      await store.incrementApplied(entry.id);

      const updated = await store.get(entry.id);
      expect(updated!.timesApplied).toBe(6);
      expect(updated!.lastApplied).toBeInstanceOf(Date);
    });

    it('should record helpfulness', async () => {
      const entry = createTestEntry({ timesHelpful: 3 });
      await store.create(entry);

      await store.recordHelpfulness(entry.id, true);
      let updated = await store.get(entry.id);
      expect(updated!.timesHelpful).toBe(4);

      await store.recordHelpfulness(entry.id, false);
      updated = await store.get(entry.id);
      expect(updated!.timesHelpful).toBe(4); // Not incremented when not helpful
    });
  });

  describe('testing helpers', () => {
    it('should clear all data', async () => {
      await store.create(createTestEntry());
      await store.createPending(createTestPendingLearning());

      store.clear();

      expect(store.getEntryCount()).toBe(0);
      expect(store.getPendingCount()).toBe(0);
    });

    it('should return counts', async () => {
      await store.create(createTestEntry({ id: 'e1' }));
      await store.create(createTestEntry({ id: 'e2' }));
      await store.createPending(createTestPendingLearning({ id: 'p1' }));

      expect(store.getEntryCount()).toBe(2);
      expect(store.getPendingCount()).toBe(1);
    });
  });
});
