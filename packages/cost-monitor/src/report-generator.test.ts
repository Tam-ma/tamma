import { describe, it, expect, beforeEach } from 'vitest';
import { ReportGenerator } from './report-generator.js';
import { UsageTracker } from './usage-tracker.js';
import { InMemoryStore } from './storage/in-memory-store.js';
import type { UsageRecordInput } from './types.js';

describe('ReportGenerator', () => {
  let reportGenerator: ReportGenerator;
  let usageTracker: UsageTracker;
  let storage: InMemoryStore;

  beforeEach(() => {
    storage = new InMemoryStore();
    usageTracker = new UsageTracker({ storage });
    reportGenerator = new ReportGenerator({ storage });
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

  describe('generateReport', () => {
    beforeEach(async () => {
      // Add some test data
      await usageTracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        agentType: 'implementer',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100000,
        outputTokens: 50000,
      }));

      await usageTracker.recordUsage(createTestUsage({
        projectId: 'project-1',
        agentType: 'reviewer',
        model: 'claude-opus-4-20250514',
        inputTokens: 50000,
        outputTokens: 25000,
      }));

      await usageTracker.recordUsage(createTestUsage({
        projectId: 'project-2',
        agentType: 'implementer',
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 75000,
        outputTokens: 35000,
        success: false,
      }));
    });

    it('should generate a basic report', async () => {
      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.id).toBeDefined();
      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.period.start).toBeInstanceOf(Date);
      expect(report.period.end).toBeInstanceOf(Date);
      expect(report.summary.totalCalls).toBe(3);
      expect(report.summary.totalCostUsd).toBeGreaterThan(0);
    });

    it('should calculate summary metrics correctly', async () => {
      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.summary.totalCalls).toBe(3);
      expect(report.summary.totalInputTokens).toBe(225000);
      expect(report.summary.totalOutputTokens).toBe(110000);
      expect(report.summary.successRate).toBeCloseTo(2 / 3, 2);
      // Use toBeCloseTo for floating point comparison
      expect(report.summary.avgCostPerCall).toBeCloseTo(report.summary.totalCostUsd / 3, 5);
    });

    it('should include breakdowns when requested', async () => {
      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.byProvider).toBeDefined();
      expect(report.byProvider!.length).toBe(2); // anthropic and openai

      expect(report.byProject).toBeDefined();
      expect(report.byProject!.length).toBe(2); // project-1 and project-2

      expect(report.byAgentType).toBeDefined();
      expect(report.byAgentType!.length).toBe(2); // implementer and reviewer

      expect(report.byModel).toBeDefined();
      expect(report.byModel!.length).toBe(3); // sonnet, opus, gpt-4o
    });

    it('should include trends when requested', async () => {
      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: true,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.trends).toBeDefined();
      expect(report.trends!.daily).toBeDefined();
      expect(typeof report.trends!.weekOverWeek).toBe('number');
      expect(typeof report.trends!.monthOverMonth).toBe('number');
    });

    it('should include forecasting when requested', async () => {
      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: true,
        format: 'json',
      });

      expect(report.forecast).toBeDefined();
      expect(typeof report.forecast!.projectedMonthEndUsd).toBe('number');
      expect(typeof report.forecast!.confidence).toBe('number');
      expect(['under', 'on_track', 'over']).toContain(report.forecast!.budgetStatus);
    });

    it('should include recommendations', async () => {
      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations!.length).toBeGreaterThan(0);
    });

    it('should use custom date range', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        startDate,
        endDate,
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.period.start).toEqual(startDate);
      expect(report.period.end).toEqual(endDate);
    });

    it('should handle empty data', async () => {
      const emptyStorage = new InMemoryStore();
      const emptyGenerator = new ReportGenerator({ storage: emptyStorage });

      const report = await emptyGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.summary.totalCalls).toBe(0);
      expect(report.summary.totalCostUsd).toBe(0);
      expect(report.summary.successRate).toBe(0);
    });
  });

  describe('formatAsCsv', () => {
    it('should format report as CSV', async () => {
      await usageTracker.recordUsage(createTestUsage());

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'csv',
      });

      const csv = reportGenerator.formatAsCsv(report);

      expect(csv).toContain('Cost Report');
      expect(csv).toContain('Summary');
      expect(csv).toContain('Total Cost (USD)');
      expect(csv).toContain('Total Calls');
    });

    it('should include model breakdown in CSV', async () => {
      await usageTracker.recordUsage(createTestUsage({ model: 'claude-sonnet-4-20250514' }));
      await usageTracker.recordUsage(createTestUsage({ model: 'claude-opus-4-20250514' }));

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'csv',
      });

      const csv = reportGenerator.formatAsCsv(report);

      expect(csv).toContain('By Model');
      expect(csv).toContain('claude-sonnet');
      expect(csv).toContain('claude-opus');
    });
  });

  describe('formatAsJson', () => {
    it('should format report as JSON', async () => {
      await usageTracker.recordUsage(createTestUsage());

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      const json = reportGenerator.formatAsJson(report);

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(report.id);
    });
  });

  describe('report scheduling', () => {
    it('should schedule a report', async () => {
      const schedule = await reportGenerator.scheduleReport({
        name: 'Weekly Report',
        cron: '0 9 * * 1',
        options: {
          period: 'weekly',
          includeBreakdown: true,
          includeTrends: true,
          includeForecasting: false,
          format: 'json',
        },
        recipients: ['team@example.com'],
        enabled: true,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe('Weekly Report');
    });

    it('should list scheduled reports', async () => {
      await reportGenerator.scheduleReport({
        name: 'Report 1',
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

      await reportGenerator.scheduleReport({
        name: 'Report 2',
        cron: '0 9 1 * *',
        options: {
          period: 'monthly',
          includeBreakdown: true,
          includeTrends: true,
          includeForecasting: true,
          format: 'json',
        },
        recipients: [],
        enabled: true,
      });

      const schedules = await reportGenerator.getScheduledReports();
      expect(schedules.length).toBe(2);
    });

    it('should delete a scheduled report', async () => {
      const schedule = await reportGenerator.scheduleReport({
        name: 'To Delete',
        cron: '0 9 * * 1',
        options: {
          period: 'weekly',
          includeBreakdown: false,
          includeTrends: false,
          includeForecasting: false,
          format: 'json',
        },
        recipients: [],
        enabled: true,
      });

      await reportGenerator.deleteScheduledReport(schedule.id);

      const schedules = await reportGenerator.getScheduledReports();
      expect(schedules.length).toBe(0);
    });

    it('should run a scheduled report', async () => {
      await usageTracker.recordUsage(createTestUsage());

      const schedule = await reportGenerator.scheduleReport({
        name: 'Runnable Report',
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

      const report = await reportGenerator.runScheduledReport(schedule.id);

      expect(report.id).toBeDefined();
      expect(report.summary.totalCalls).toBe(1);
    });

    it('should throw error for non-existent schedule', async () => {
      await expect(
        reportGenerator.runScheduledReport('non-existent')
      ).rejects.toThrow('not found');
    });
  });

  describe('recommendations', () => {
    it('should recommend cheaper models for expensive usage', async () => {
      // Add many calls with expensive model
      for (let i = 0; i < 20; i++) {
        await usageTracker.recordUsage(createTestUsage({
          model: 'claude-opus-4-20250514',
          inputTokens: 100000,
          outputTokens: 50000,
        }));
      }

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations!.some(r => r.includes('cheaper'))).toBe(true);
    });

    it('should flag low success rate', async () => {
      // Add calls with failures
      for (let i = 0; i < 15; i++) {
        await usageTracker.recordUsage(createTestUsage({
          success: i < 5, // Only 5/15 = 33% success
        }));
      }

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: false,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations!.some(r => r.includes('Success rate'))).toBe(true);
    });

    it('should recommend caching for high-volume Claude models with large inputs', async () => {
      // Add many calls with large input tokens
      for (let i = 0; i < 25; i++) {
        await usageTracker.recordUsage(createTestUsage({
          model: 'claude-sonnet-4-20250514',
          inputTokens: 15000, // Large input
          outputTokens: 500,
        }));
      }

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations!.some(r => r.includes('caching'))).toBe(true);
    });

    it('should flag low output-to-input token ratio', async () => {
      // Add calls with very high input but low output
      for (let i = 0; i < 15; i++) {
        await usageTracker.recordUsage(createTestUsage({
          inputTokens: 50000,
          outputTokens: 500, // Only 1% of input
        }));
      }

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations!.some(r => r.includes('output-to-input') || r.includes('prompts'))).toBe(true);
    });

    it('should suggest cheaper models for short responses with expensive models', async () => {
      // Add calls with expensive model but short responses
      for (let i = 0; i < 10; i++) {
        await usageTracker.recordUsage(createTestUsage({
          model: 'claude-opus-4-20250514',
          inputTokens: 1000,
          outputTokens: 100, // Very short response
        }));
      }

      const report = await reportGenerator.generateReport({
        period: 'monthly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      });

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations!.some(r => r.includes('short') || r.includes('haiku') || r.includes('mini'))).toBe(true);
    });
  });
});
