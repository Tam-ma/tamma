import { describe, it, expect, beforeEach } from 'vitest';
import { UsageTracker } from './usage-tracker.js';
import { InMemoryStore } from './storage/in-memory-store.js';
import type { UsageRecordInput } from './types.js';

describe('UsageTracker', () => {
  let tracker: UsageTracker;
  let storage: InMemoryStore;

  beforeEach(() => {
    storage = new InMemoryStore();
    tracker = new UsageTracker({ storage });
  });

  const createTestUsage = (overrides: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
    projectId: 'test-project',
    engineId: 'test-engine',
    agentType: 'implementer',
    taskId: 'test-task',
    taskType: 'implementation',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    latencyMs: 1000,
    success: true,
    ...overrides,
  });

  describe('recordUsage', () => {
    it('should record usage and calculate costs', async () => {
      const record = await tracker.recordUsage(createTestUsage());

      expect(record.id).toBeDefined();
      expect(record.timestamp).toBeInstanceOf(Date);
      expect(record.projectId).toBe('test-project');
      expect(record.inputCostUsd).toBeGreaterThan(0);
      expect(record.outputCostUsd).toBeGreaterThan(0);
      expect(record.totalCostUsd).toBeGreaterThan(0);
    });

    it('should save records to storage', async () => {
      await tracker.recordUsage(createTestUsage());
      await tracker.recordUsage(createTestUsage());

      const records = await storage.getUsageRecords({});
      expect(records.length).toBe(2);
    });

    it('should generate unique IDs', async () => {
      const record1 = await tracker.recordUsage(createTestUsage());
      const record2 = await tracker.recordUsage(createTestUsage());

      expect(record1.id).not.toBe(record2.id);
    });

    it('should calculate correct costs for different models', async () => {
      const sonnetRecord = await tracker.recordUsage(createTestUsage({
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      const opusRecord = await tracker.recordUsage(createTestUsage({
        model: 'claude-opus-4-20250514',
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      // Opus should be more expensive
      expect(opusRecord.totalCostUsd).toBeGreaterThan(sonnetRecord.totalCostUsd);
    });

    it('should throw error for invalid input', async () => {
      await expect(
        tracker.recordUsage(createTestUsage({ projectId: '' }))
      ).rejects.toThrow('projectId');

      await expect(
        tracker.recordUsage(createTestUsage({ inputTokens: -1 }))
      ).rejects.toThrow('inputTokens');
    });
  });

  describe('getUsage', () => {
    beforeEach(async () => {
      await tracker.recordUsage(createTestUsage({ projectId: 'project-1' }));
      await tracker.recordUsage(createTestUsage({ projectId: 'project-2' }));
      await tracker.recordUsage(createTestUsage({ projectId: 'project-1', agentType: 'reviewer' }));
    });

    it('should return all records without filter', async () => {
      const records = await tracker.getUsage({});
      expect(records.length).toBe(3);
    });

    it('should filter by projectId', async () => {
      const records = await tracker.getUsage({ projectId: 'project-1' });
      expect(records.length).toBe(2);
    });

    it('should filter by agentType', async () => {
      const records = await tracker.getUsage({ agentType: 'reviewer' });
      expect(records.length).toBe(1);
    });

    it('should filter by multiple criteria', async () => {
      const records = await tracker.getUsage({
        projectId: 'project-1',
        agentType: 'implementer',
      });
      expect(records.length).toBe(1);
    });
  });

  describe('getAggregate', () => {
    beforeEach(async () => {
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 500,
      }));
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        model: 'claude-opus-4-20250514',
        inputTokens: 2000,
        outputTokens: 1000,
      }));
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-2',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 3000,
        outputTokens: 1500,
      }));
    });

    it('should aggregate by model', async () => {
      const aggregates = await tracker.getAggregate({}, ['model']);

      expect(aggregates.length).toBe(2);

      const sonnetAgg = aggregates.find(a => a.dimensionValue.includes('sonnet'));
      expect(sonnetAgg).toBeDefined();
      expect(sonnetAgg!.totalCalls).toBe(2);
    });

    it('should aggregate by project', async () => {
      const aggregates = await tracker.getAggregate({}, ['project']);

      expect(aggregates.length).toBe(2);

      const project1Agg = aggregates.find(a => a.dimensionValue === 'project-1');
      expect(project1Agg).toBeDefined();
      expect(project1Agg!.totalCalls).toBe(2);
    });

    it('should calculate correct totals', async () => {
      const aggregates = await tracker.getAggregate({}, ['project']);

      const project1Agg = aggregates.find(a => a.dimensionValue === 'project-1');
      expect(project1Agg!.totalInputTokens).toBe(3000);
      expect(project1Agg!.totalOutputTokens).toBe(1500);
    });
  });

  describe('getTotalCost', () => {
    it('should calculate total cost', async () => {
      await tracker.recordUsage(createTestUsage({
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));
      await tracker.recordUsage(createTestUsage({
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      const total = await tracker.getTotalCost({});

      // Claude Sonnet: $3 input + $15 output = $18 per million tokens
      expect(total).toBeCloseTo(36, 0);
    });

    it('should filter by project', async () => {
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-2',
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      const total = await tracker.getTotalCost({ projectId: 'project-1' });
      expect(total).toBeCloseTo(18, 0);
    });
  });

  describe('getProjectSummary', () => {
    beforeEach(async () => {
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        agentType: 'implementer',
        model: 'claude-sonnet-4-20250514',
      }));
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        agentType: 'reviewer',
        model: 'claude-opus-4-20250514',
      }));
    });

    it('should return project summary', async () => {
      const summary = await tracker.getProjectSummary('project-1');

      expect(summary.totalCalls).toBe(2);
      expect(summary.totalCostUsd).toBeGreaterThan(0);
      expect(summary.byModel.length).toBe(2);
      expect(summary.byAgentType.length).toBe(2);
    });
  });

  describe('getCurrentPeriodUsage', () => {
    it('should return usage for current day', async () => {
      await tracker.recordUsage(createTestUsage({
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      const dailyUsage = await tracker.getCurrentPeriodUsage('daily');
      expect(dailyUsage).toBeGreaterThan(0);
    });

    it('should filter by project', async () => {
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));
      await tracker.recordUsage(createTestUsage({
        projectId: 'project-2',
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      const usage = await tracker.getCurrentPeriodUsage('daily', 'project-1');
      expect(usage).toBeCloseTo(18, 0);
    });
  });
});
