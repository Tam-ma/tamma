import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LimitManager } from './limit-manager.js';
import { UsageTracker } from './usage-tracker.js';
import { InMemoryStore } from './storage/in-memory-store.js';
import type { UsageLimitInput, CostAlert } from './types.js';

describe('LimitManager', () => {
  let limitManager: LimitManager;
  let usageTracker: UsageTracker;
  let storage: InMemoryStore;
  let alertCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = new InMemoryStore();
    usageTracker = new UsageTracker({ storage });
    alertCallback = vi.fn();
    limitManager = new LimitManager({
      storage,
      usageTracker,
      onAlert: alertCallback,
    });
  });

  const createTestLimit = (overrides: Partial<UsageLimitInput> = {}): UsageLimitInput => ({
    name: 'Test Limit',
    scope: 'global',
    period: 'monthly',
    limitUsd: 100,
    softThreshold: 0.7,
    hardThreshold: 1.0,
    action: 'warn',
    enabled: true,
    ...overrides,
  });

  describe('setLimit', () => {
    it('should create a new limit', async () => {
      const limit = await limitManager.setLimit(createTestLimit());

      expect(limit.id).toBeDefined();
      expect(limit.name).toBe('Test Limit');
      expect(limit.createdAt).toBeInstanceOf(Date);
      expect(limit.updatedAt).toBeInstanceOf(Date);
    });

    it('should validate threshold values', async () => {
      await expect(
        limitManager.setLimit(createTestLimit({ softThreshold: 1.5 }))
      ).rejects.toThrow('softThreshold');

      await expect(
        limitManager.setLimit(createTestLimit({ hardThreshold: -0.5 }))
      ).rejects.toThrow('hardThreshold');

      await expect(
        limitManager.setLimit(createTestLimit({ softThreshold: 0.9, hardThreshold: 0.5 }))
      ).rejects.toThrow('softThreshold cannot be greater');
    });

    it('should validate limit amount', async () => {
      await expect(
        limitManager.setLimit(createTestLimit({ limitUsd: 0 }))
      ).rejects.toThrow('limitUsd');

      await expect(
        limitManager.setLimit(createTestLimit({ limitUsd: -100 }))
      ).rejects.toThrow('limitUsd');
    });

    it('should persist limit to storage', async () => {
      await limitManager.setLimit(createTestLimit());

      const limits = await storage.getLimitConfigs();
      expect(limits.length).toBe(1);
    });
  });

  describe('updateLimit', () => {
    it('should update an existing limit', async () => {
      const limit = await limitManager.setLimit(createTestLimit());
      const updated = await limitManager.updateLimit(limit.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.id).toBe(limit.id);
      expect(updated.createdAt).toEqual(limit.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(limit.updatedAt.getTime());
    });

    it('should throw error for non-existent limit', async () => {
      await expect(
        limitManager.updateLimit('non-existent', { name: 'New Name' })
      ).rejects.toThrow('not found');
    });
  });

  describe('deleteLimit', () => {
    it('should delete a limit', async () => {
      const limit = await limitManager.setLimit(createTestLimit());
      await limitManager.deleteLimit(limit.id);

      const limits = await limitManager.getLimits();
      expect(limits.length).toBe(0);
    });
  });

  describe('getLimits', () => {
    it('should return all limits', async () => {
      await limitManager.setLimit(createTestLimit({ name: 'Limit 1' }));
      await limitManager.setLimit(createTestLimit({ name: 'Limit 2' }));

      const limits = await limitManager.getLimits();
      expect(limits.length).toBe(2);
    });
  });

  describe('checkLimit', () => {
    it('should allow calls within budget', async () => {
      await limitManager.setLimit(createTestLimit({
        scope: 'global',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
      }));

      const result = await limitManager.checkLimit({});

      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it('should warn at soft threshold', async () => {
      // Record usage to reach 75% of limit
      await usageTracker.recordUsage({
        projectId: 'test',
        engineId: 'test',
        agentType: 'implementer',
        taskId: 'test',
        taskType: 'implementation',
        provider: 'anthropic',
        model: 'claude-opus-4-20250514', // Expensive model
        inputTokens: 1000000, // $15
        outputTokens: 800000, // $60
        totalTokens: 1800000,
        latencyMs: 1000,
        success: true,
      });

      await limitManager.setLimit(createTestLimit({
        scope: 'global',
        limitUsd: 100, // $100 limit
        softThreshold: 0.7, // 70% = $70
        hardThreshold: 1.0,
      }));

      const result = await limitManager.checkLimit({ estimatedCostUsd: 1 });

      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Approaching');
    });

    it('should block at hard threshold with block action', async () => {
      // Record usage to exceed limit
      await usageTracker.recordUsage({
        projectId: 'test',
        engineId: 'test',
        agentType: 'implementer',
        taskId: 'test',
        taskType: 'implementation',
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        inputTokens: 1500000, // $22.50
        outputTokens: 1100000, // $82.50
        totalTokens: 2600000,
        latencyMs: 1000,
        success: true,
      });

      await limitManager.setLimit(createTestLimit({
        scope: 'global',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
        action: 'block',
      }));

      const result = await limitManager.checkLimit({ estimatedCostUsd: 5 });

      expect(result.allowed).toBe(false);
      expect(result.recommendedAction).toBe('abort');
      expect(result.triggeredLimits.length).toBeGreaterThan(0);
    });

    it('should check project-scoped limits', async () => {
      await limitManager.setLimit(createTestLimit({
        scope: 'project',
        scopeId: 'project-1',
        limitUsd: 50,
      }));

      const result = await limitManager.checkLimit({ projectId: 'project-1' });

      expect(result.allowed).toBe(true);
    });

    it('should ignore disabled limits', async () => {
      await limitManager.setLimit(createTestLimit({
        enabled: false,
        limitUsd: 0.01, // Very low limit
      }));

      const result = await limitManager.checkLimit({});

      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it('should trigger alert callback', async () => {
      // Record usage to trigger alert
      await usageTracker.recordUsage({
        projectId: 'test',
        engineId: 'test',
        agentType: 'implementer',
        taskId: 'test',
        taskType: 'implementation',
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        inputTokens: 1000000,
        outputTokens: 800000,
        totalTokens: 1800000,
        latencyMs: 1000,
        success: true,
      });

      await limitManager.setLimit(createTestLimit({
        scope: 'global',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
      }));

      await limitManager.checkLimit({ estimatedCostUsd: 1 });

      expect(alertCallback).toHaveBeenCalled();
      const alert: CostAlert = alertCallback.mock.calls[0][0];
      expect(alert.type).toBe('limit_approaching');
    });

    it('should suggest cheaper alternatives when approaching limits', async () => {
      await usageTracker.recordUsage({
        projectId: 'test',
        engineId: 'test',
        agentType: 'implementer',
        taskId: 'test',
        taskType: 'implementation',
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        inputTokens: 1200000,
        outputTokens: 900000,
        totalTokens: 2100000,
        latencyMs: 1000,
        success: true,
      });

      await limitManager.setLimit(createTestLimit({
        scope: 'global',
        limitUsd: 100,
        softThreshold: 0.7,
        hardThreshold: 1.0,
      }));

      const result = await limitManager.checkLimit({
        model: 'claude-opus-4-20250514',
        estimatedCostUsd: 5,
      });

      expect(result.recommendedAction).toBe('use_cheaper_model');
      expect(result.suggestedAlternatives).toBeDefined();
    });
  });
});
