import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from './in-memory-store.js';
import { FileStore } from './file-store.js';
import { unlink, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { UsageRecord, UsageLimit, CostAlert, ReportSchedule } from '../types.js';

describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  const createTestRecord = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
    id: 'test-id-' + Math.random().toString(36).substring(7),
    timestamp: new Date(),
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
    inputCostUsd: 0.003,
    outputCostUsd: 0.0075,
    totalCostUsd: 0.0105,
    latencyMs: 1000,
    success: true,
    ...overrides,
  });

  describe('usage records', () => {
    it('should save and retrieve usage records', async () => {
      const record = createTestRecord();
      await store.saveUsageRecord(record);

      const records = await store.getUsageRecords({});
      expect(records.length).toBe(1);
      expect(records[0]!.id).toBe(record.id);
    });

    it('should filter by date range', async () => {
      const oldRecord = createTestRecord({
        timestamp: new Date('2024-01-01'),
      });
      const newRecord = createTestRecord({
        timestamp: new Date('2025-01-15'),
      });

      await store.saveUsageRecord(oldRecord);
      await store.saveUsageRecord(newRecord);

      const filtered = await store.getUsageRecords({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0]!.id).toBe(newRecord.id);
    });

    it('should filter by project', async () => {
      await store.saveUsageRecord(createTestRecord({ projectId: 'project-1' }));
      await store.saveUsageRecord(createTestRecord({ projectId: 'project-2' }));

      const filtered = await store.getUsageRecords({ projectId: 'project-1' });
      expect(filtered.length).toBe(1);
    });

    it('should filter by multiple criteria', async () => {
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-1',
        agentType: 'implementer',
      }));
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-1',
        agentType: 'reviewer',
      }));
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-2',
        agentType: 'implementer',
      }));

      const filtered = await store.getUsageRecords({
        projectId: 'project-1',
        agentType: 'implementer',
      });
      expect(filtered.length).toBe(1);
    });
  });

  describe('limits', () => {
    const createTestLimit = (): UsageLimit => ({
      id: 'limit-' + Math.random().toString(36).substring(7),
      name: 'Test Limit',
      scope: 'global',
      period: 'monthly',
      limitUsd: 100,
      softThreshold: 0.7,
      hardThreshold: 1.0,
      action: 'warn',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should save and retrieve limits', async () => {
      const limit = createTestLimit();
      await store.saveLimitConfig(limit);

      const limits = await store.getLimitConfigs();
      expect(limits.length).toBe(1);
      expect(limits[0]!.id).toBe(limit.id);
    });

    it('should delete limits', async () => {
      const limit = createTestLimit();
      await store.saveLimitConfig(limit);
      await store.deleteLimitConfig(limit.id);

      const limits = await store.getLimitConfigs();
      expect(limits.length).toBe(0);
    });

    it('should update existing limits', async () => {
      const limit = createTestLimit();
      await store.saveLimitConfig(limit);

      limit.name = 'Updated Name';
      await store.saveLimitConfig(limit);

      const limits = await store.getLimitConfigs();
      expect(limits.length).toBe(1);
      expect(limits[0]!.name).toBe('Updated Name');
    });
  });

  describe('alerts', () => {
    const createTestAlert = (): CostAlert => ({
      id: 'alert-' + Math.random().toString(36).substring(7),
      type: 'limit_approaching',
      severity: 'info',
      scope: 'global',
      message: 'Test alert',
      currentValue: 70,
      threshold: 100,
      status: 'active',
      createdAt: new Date(),
      deliveredTo: [],
    });

    it('should save and retrieve alerts', async () => {
      const alert = createTestAlert();
      await store.saveAlert(alert);

      const alerts = await store.getAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.id).toBe(alert.id);
    });

    it('should filter alerts by status', async () => {
      const activeAlert = createTestAlert();
      const resolvedAlert = { ...createTestAlert(), status: 'resolved' as const };

      await store.saveAlert(activeAlert);
      await store.saveAlert(resolvedAlert);

      const activeAlerts = await store.getAlerts({ status: 'active' });
      expect(activeAlerts.length).toBe(1);
    });

    it('should update alerts', async () => {
      const alert = createTestAlert();
      await store.saveAlert(alert);

      await store.updateAlert(alert.id, {
        status: 'acknowledged',
        acknowledgedBy: 'test-user',
      });

      const alerts = await store.getAlerts();
      expect(alerts[0]!.status).toBe('acknowledged');
      expect(alerts[0]!.acknowledgedBy).toBe('test-user');
    });
  });

  describe('report schedules', () => {
    const createTestSchedule = (): ReportSchedule => ({
      id: 'schedule-' + Math.random().toString(36).substring(7),
      name: 'Weekly Report',
      cron: '0 9 * * 1',
      options: {
        period: 'weekly',
        includeBreakdown: true,
        includeTrends: false,
        includeForecasting: false,
        format: 'json',
      },
      recipients: ['test@example.com'],
      enabled: true,
    });

    it('should save and retrieve schedules', async () => {
      const schedule = createTestSchedule();
      await store.saveReportSchedule(schedule);

      const schedules = await store.getReportSchedules();
      expect(schedules.length).toBe(1);
      expect(schedules[0]!.id).toBe(schedule.id);
    });

    it('should delete schedules', async () => {
      const schedule = createTestSchedule();
      await store.saveReportSchedule(schedule);
      await store.deleteReportSchedule(schedule.id);

      const schedules = await store.getReportSchedules();
      expect(schedules.length).toBe(0);
    });
  });

  describe('aggregation', () => {
    beforeEach(async () => {
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        totalCostUsd: 0.01,
      }));
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-1',
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        inputTokens: 2000,
        totalCostUsd: 0.05,
      }));
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-2',
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 1500,
        totalCostUsd: 0.02,
      }));
    });

    it('should aggregate by provider', async () => {
      const aggregates = await store.aggregateUsage({}, ['provider']);

      expect(aggregates.length).toBe(2);

      const anthropicAgg = aggregates.find(a => a.dimensionValue === 'anthropic');
      expect(anthropicAgg).toBeDefined();
      expect(anthropicAgg!.totalCalls).toBe(2);
    });

    it('should aggregate by model', async () => {
      const aggregates = await store.aggregateUsage({}, ['model']);

      expect(aggregates.length).toBe(3);
    });

    it('should aggregate by project', async () => {
      const aggregates = await store.aggregateUsage({}, ['project']);

      expect(aggregates.length).toBe(2);

      const project1Agg = aggregates.find(a => a.dimensionValue === 'project-1');
      expect(project1Agg!.totalCostUsd).toBeCloseTo(0.06, 5);
    });

    it('should calculate success rate', async () => {
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-3',
        success: false,
      }));
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-3',
        success: true,
      }));

      const aggregates = await store.aggregateUsage({ projectId: 'project-3' }, ['project']);

      expect(aggregates.length).toBe(1);
      expect(aggregates[0]!.successRate).toBe(0.5);
    });

    it('should calculate average latency', async () => {
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-4',
        latencyMs: 1000,
      }));
      await store.saveUsageRecord(createTestRecord({
        projectId: 'project-4',
        latencyMs: 2000,
      }));

      const aggregates = await store.aggregateUsage({ projectId: 'project-4' }, ['project']);

      expect(aggregates[0]!.avgLatencyMs).toBe(1500);
    });
  });

  describe('helper methods', () => {
    it('should clear all data', async () => {
      await store.saveUsageRecord(createTestRecord());
      await store.saveLimitConfig({
        id: 'limit-1',
        name: 'Test',
        scope: 'global',
        period: 'monthly',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
        action: 'warn',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      store.clear();

      expect(store.getRecordCount()).toBe(0);
      expect(store.getLimitCount()).toBe(0);
    });

    it('should report counts', async () => {
      await store.saveUsageRecord(createTestRecord());
      await store.saveUsageRecord(createTestRecord());

      expect(store.getRecordCount()).toBe(2);
    });
  });
});

describe('FileStore', () => {
  let store: FileStore;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), 'cost-monitor-test-' + Math.random().toString(36).substring(7));
    await mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'cost-data.json');
    store = new FileStore(testFilePath, 0); // Disable auto-flush for tests
  });

  afterEach(async () => {
    await store.dispose();
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  const createTestRecord = (): UsageRecord => ({
    id: 'test-id-' + Math.random().toString(36).substring(7),
    timestamp: new Date(),
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
    inputCostUsd: 0.003,
    outputCostUsd: 0.0075,
    totalCostUsd: 0.0105,
    latencyMs: 1000,
    success: true,
  });

  it('should persist data to file', async () => {
    const record = createTestRecord();
    await store.saveUsageRecord(record);
    await store.flush();

    expect(existsSync(testFilePath)).toBe(true);
  });

  it('should load data from file', async () => {
    const record = createTestRecord();
    await store.saveUsageRecord(record);
    await store.flush();

    // Create a new store and load data
    const newStore = new FileStore(testFilePath, 0);
    await newStore.load();

    const records = await newStore.getUsageRecords({});
    expect(records.length).toBe(1);
    expect(records[0]!.id).toBe(record.id);

    await newStore.dispose();
  });

  it('should preserve date objects after load', async () => {
    const record = createTestRecord();
    await store.saveUsageRecord(record);
    await store.flush();

    const newStore = new FileStore(testFilePath, 0);
    await newStore.load();

    const records = await newStore.getUsageRecords({});
    expect(records[0]!.timestamp).toBeInstanceOf(Date);

    await newStore.dispose();
  });

  it('should handle non-existent file on load', async () => {
    const nonExistentPath = join(testDir, 'non-existent.json');
    const newStore = new FileStore(nonExistentPath, 0);

    // Should not throw
    await expect(newStore.load()).resolves.not.toThrow();

    await newStore.dispose();
  });

  it('should get file path', () => {
    expect(store.getFilePath()).toBe(testFilePath);
  });

  it('should create directory if it does not exist', async () => {
    const deepPath = join(testDir, 'deep', 'nested', 'cost-data.json');
    const deepStore = new FileStore(deepPath, 0);

    await deepStore.saveUsageRecord(createTestRecord());
    await deepStore.flush();

    expect(existsSync(deepPath)).toBe(true);

    await deepStore.dispose();
  });

  it('should handle limits, alerts, and schedules', async () => {
    await store.saveLimitConfig({
      id: 'limit-1',
      name: 'Test Limit',
      scope: 'global',
      period: 'monthly',
      limitUsd: 100,
      softThreshold: 0.7,
      hardThreshold: 1.0,
      action: 'warn',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveAlert({
      id: 'alert-1',
      type: 'limit_approaching',
      severity: 'info',
      scope: 'global',
      message: 'Test',
      currentValue: 70,
      threshold: 100,
      status: 'active',
      createdAt: new Date(),
      deliveredTo: [],
    });

    await store.saveReportSchedule({
      id: 'schedule-1',
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

    await store.flush();

    // Load into new store
    const newStore = new FileStore(testFilePath, 0);
    await newStore.load();

    const limits = await newStore.getLimitConfigs();
    expect(limits.length).toBe(1);

    const alerts = await newStore.getAlerts();
    expect(alerts.length).toBe(1);

    const schedules = await newStore.getReportSchedules();
    expect(schedules.length).toBe(1);

    await newStore.dispose();
  });
});
