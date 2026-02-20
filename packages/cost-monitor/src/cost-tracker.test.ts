import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker, createCostTracker } from './cost-tracker.js';
import { InMemoryStore } from './storage/in-memory-store.js';
import type { UsageRecordInput } from './types.js';

describe('CostTracker', () => {
  let costTracker: CostTracker;
  let storage: InMemoryStore;

  beforeEach(() => {
    storage = new InMemoryStore();
    costTracker = new CostTracker({ storage });
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

  describe('integration', () => {
    it('should provide a complete cost tracking workflow', async () => {
      // 1. Set up a limit
      const limit = await costTracker.setLimit({
        name: 'Test Limit',
        scope: 'global',
        period: 'monthly',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
        action: 'warn',
        enabled: true,
      });

      expect(limit.id).toBeDefined();

      // 2. Check limit before usage
      const checkBefore = await costTracker.checkLimit({});
      expect(checkBefore.allowed).toBe(true);
      expect(checkBefore.currentUsageUsd).toBe(0);

      // 3. Record usage
      const record = await costTracker.recordUsage(createTestUsage({
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      expect(record.totalCostUsd).toBeGreaterThan(0);

      // 4. Check limit after usage
      const checkAfter = await costTracker.checkLimit({});
      expect(checkAfter.currentUsageUsd).toBeGreaterThan(0);

      // 5. Get usage data
      const usage = await costTracker.getUsage({});
      expect(usage.length).toBe(1);

      // 6. Generate a report
      const report = await costTracker.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.summary.totalCalls).toBe(1);
      expect(report.summary.totalCostUsd).toEqual(record.totalCostUsd);
    });

    it('should handle alerts when limits are exceeded', async () => {
      // Set a very low limit
      await costTracker.setLimit({
        name: 'Low Limit',
        scope: 'global',
        period: 'monthly',
        limitUsd: 1,
        softThreshold: 0.5,
        hardThreshold: 1.0,
        action: 'warn',
        enabled: true,
      });

      // Record usage that exceeds the limit
      await costTracker.recordUsage(createTestUsage({
        inputTokens: 1000000,
        outputTokens: 1000000,
      }));

      // Check limits
      await costTracker.checkLimit({ estimatedCostUsd: 1 });

      // Verify alerts were created
      const alerts = await costTracker.getAlerts({ status: 'active' });
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  describe('recordUsage', () => {
    it('should record usage with calculated costs', async () => {
      const record = await costTracker.recordUsage(createTestUsage());

      expect(record.id).toBeDefined();
      expect(record.inputCostUsd).toBeGreaterThan(0);
      expect(record.outputCostUsd).toBeGreaterThan(0);
      // Use toBeCloseTo for floating point comparison
      expect(record.totalCostUsd).toBeCloseTo(record.inputCostUsd + record.outputCostUsd, 6);
    });
  });

  describe('getUsage', () => {
    it('should filter usage records', async () => {
      await costTracker.recordUsage(createTestUsage({ projectId: 'project-1' }));
      await costTracker.recordUsage(createTestUsage({ projectId: 'project-2' }));

      const usage = await costTracker.getUsage({ projectId: 'project-1' });
      expect(usage.length).toBe(1);
    });
  });

  describe('getAggregate', () => {
    it('should aggregate usage by dimension', async () => {
      await costTracker.recordUsage(createTestUsage({ model: 'claude-sonnet-4-20250514' }));
      await costTracker.recordUsage(createTestUsage({ model: 'claude-opus-4-20250514' }));

      const aggregates = await costTracker.getAggregate({}, ['model']);
      expect(aggregates.length).toBe(2);
    });
  });

  describe('limits', () => {
    it('should manage limits', async () => {
      const limit = await costTracker.setLimit({
        name: 'Test',
        scope: 'global',
        period: 'monthly',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
        action: 'warn',
        enabled: true,
      });

      const limits = await costTracker.getLimits();
      expect(limits.length).toBe(1);

      await costTracker.updateLimit(limit.id, { name: 'Updated' });
      const updated = await costTracker.getLimits();
      expect(updated[0]!.name).toBe('Updated');

      await costTracker.deleteLimit(limit.id);
      const deleted = await costTracker.getLimits();
      expect(deleted.length).toBe(0);
    });
  });

  describe('alerts', () => {
    it('should manage alerts', async () => {
      // Create a condition that triggers an alert
      await costTracker.setLimit({
        name: 'Low Limit',
        scope: 'global',
        period: 'monthly',
        limitUsd: 0.01,
        softThreshold: 0.5,
        hardThreshold: 1.0,
        action: 'warn',
        enabled: true,
      });

      await costTracker.recordUsage(createTestUsage());
      await costTracker.checkLimit({});

      const alerts = await costTracker.getAlerts();
      if (alerts.length > 0) {
        await costTracker.acknowledgeAlert(alerts[0]!.id, 'test-user');
        const acknowledged = await costTracker.getAlerts({ status: 'acknowledged' });
        expect(acknowledged.length).toBe(1);

        await costTracker.resolveAlert(alerts[0]!.id);
        const resolved = await costTracker.getAlerts({ status: 'resolved' });
        expect(resolved.length).toBe(1);
      }
    });
  });

  describe('reports', () => {
    it('should generate and format reports', async () => {
      await costTracker.recordUsage(createTestUsage());

      const report = await costTracker.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      const csv = costTracker.formatReportAsCsv(report);
      expect(csv).toContain('Cost Report');

      const json = costTracker.formatReportAsJson(report);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should manage scheduled reports', async () => {
      const schedule = await costTracker.scheduleReport({
        name: 'Weekly',
        cron: '0 9 * * 1',
        options: {
          period: 'weekly',
          includeBreakdown: true,
          includeTrends: false,
          includeForecasting: false,
          format: 'json',
        },
        recipients: [],
        enabled: true,
      });

      const schedules = await costTracker.getScheduledReports();
      expect(schedules.length).toBe(1);

      await costTracker.deleteScheduledReport(schedule.id);
      const after = await costTracker.getScheduledReports();
      expect(after.length).toBe(0);
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost and provide alternatives', async () => {
      const estimate = await costTracker.estimateCost({
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        estimatedInputTokens: 100000,
        estimatedOutputTokens: 50000,
      });

      expect(estimate.totalCostUsd).toBeGreaterThan(0);
      expect(estimate.alternatives).toBeDefined();
    });
  });

  describe('pricing', () => {
    it('should get and update pricing', async () => {
      const pricing = await costTracker.getPricing();
      expect(pricing.providers).toBeDefined();

      await costTracker.updatePricing({
        lastUpdated: new Date(),
      });

      const updated = await costTracker.getPricing();
      expect(updated.lastUpdated).toBeDefined();
    });
  });

  describe('convenience methods', () => {
    it('should get total cost', async () => {
      await costTracker.recordUsage(createTestUsage());
      await costTracker.recordUsage(createTestUsage());

      const total = await costTracker.getTotalCost({});
      expect(total).toBeGreaterThan(0);
    });

    it('should get project summary', async () => {
      await costTracker.recordUsage(createTestUsage({ projectId: 'test-project' }));

      const summary = await costTracker.getProjectSummary('test-project');
      expect(summary.totalCalls).toBe(1);
    });

    it('should get current period usage', async () => {
      await costTracker.recordUsage(createTestUsage());

      const usage = await costTracker.getCurrentPeriodUsage('daily');
      expect(usage).toBeGreaterThan(0);
    });

    it('should get alert summary', async () => {
      const summary = await costTracker.getAlertSummary();
      expect(summary.active).toBeDefined();
      expect(summary.bySeverity).toBeDefined();
    });
  });

  describe('component access', () => {
    it('should provide access to internal components', () => {
      expect(costTracker.getCalculator()).toBeDefined();
      expect(costTracker.getUsageTracker()).toBeDefined();
      expect(costTracker.getLimitManager()).toBeDefined();
      expect(costTracker.getAlertManager()).toBeDefined();
      expect(costTracker.getReportGenerator()).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('should dispose cleanly', async () => {
      await costTracker.recordUsage(createTestUsage());
      await expect(costTracker.dispose()).resolves.not.toThrow();
    });
  });

  describe('createCostTracker factory', () => {
    it('should create a cost tracker with defaults', () => {
      const tracker = createCostTracker();
      expect(tracker).toBeInstanceOf(CostTracker);
    });

    it('should create a cost tracker with custom options', () => {
      const tracker = createCostTracker({
        alertChannels: [{ type: 'cli', enabled: true }],
      });
      expect(tracker).toBeInstanceOf(CostTracker);
    });
  });
});
