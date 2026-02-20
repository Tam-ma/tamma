import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlertManager } from './alert-manager.js';
import { InMemoryStore } from './storage/in-memory-store.js';
import type { CostAlert, AlertChannelConfig } from './types.js';

describe('AlertManager', () => {
  let alertManager: AlertManager;
  let storage: InMemoryStore;

  beforeEach(() => {
    storage = new InMemoryStore();
    alertManager = new AlertManager({
      storage,
      channels: [{ type: 'cli', enabled: true }],
    });
  });

  describe('createAlert', () => {
    it('should create and save an alert', async () => {
      const alert = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      expect(alert.id).toBeDefined();
      expect(alert.status).toBe('active');
      expect(alert.createdAt).toBeInstanceOf(Date);
      expect(alert.deliveredTo).toContain('cli');
    });

    it('should save alert to storage', async () => {
      await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      const alerts = await storage.getAlerts();
      expect(alerts.length).toBe(1);
    });

    it('should deduplicate similar alerts', async () => {
      const alert1 = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      const alert2 = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Same alert',
        currentValue: 75,
        threshold: 100,
      });

      // Should return the existing alert
      expect(alert2.id).toBe(alert1.id);
    });

    it('should not deduplicate different alert types', async () => {
      const alert1 = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Approaching',
        currentValue: 70,
        threshold: 100,
      });

      const alert2 = await alertManager.createAlert({
        type: 'limit_exceeded',
        severity: 'critical',
        scope: 'global',
        message: 'Exceeded',
        currentValue: 100,
        threshold: 100,
      });

      expect(alert2.id).not.toBe(alert1.id);
    });
  });

  describe('getAlerts', () => {
    beforeEach(async () => {
      await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Alert 1',
        currentValue: 70,
        threshold: 100,
      });

      await alertManager.createAlert({
        type: 'limit_exceeded',
        severity: 'critical',
        scope: 'project',
        scopeId: 'project-1',
        message: 'Alert 2',
        currentValue: 110,
        threshold: 100,
      });
    });

    it('should return all alerts without filter', async () => {
      const alerts = await alertManager.getAlerts();
      expect(alerts.length).toBe(2);
    });

    it('should filter by status', async () => {
      const alerts = await alertManager.getAlerts({ status: 'active' });
      expect(alerts.length).toBe(2);
    });

    it('should filter by severity', async () => {
      const alerts = await alertManager.getAlerts({ severity: 'critical' });
      expect(alerts.length).toBe(1);
    });

    it('should filter by type', async () => {
      const alerts = await alertManager.getAlerts({ type: 'limit_exceeded' });
      expect(alerts.length).toBe(1);
    });

    it('should filter by scope', async () => {
      const alerts = await alertManager.getAlerts({ scope: 'project' });
      expect(alerts.length).toBe(1);
    });
  });

  describe('acknowledgeAlert', () => {
    it('should acknowledge an alert', async () => {
      const alert = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      await alertManager.acknowledgeAlert(alert.id, 'user@example.com');

      const alerts = await alertManager.getAlerts({ status: 'acknowledged' });
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.acknowledgedBy).toBe('user@example.com');
      expect(alerts[0]!.acknowledgedAt).toBeInstanceOf(Date);
    });
  });

  describe('resolveAlert', () => {
    it('should resolve an alert', async () => {
      const alert = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      await alertManager.resolveAlert(alert.id);

      const alerts = await alertManager.getAlerts({ status: 'resolved' });
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('autoResolveAlerts', () => {
    it('should auto-resolve alerts when value drops below threshold', async () => {
      await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 70,
      });

      const resolvedCount = await alertManager.autoResolveAlerts('global', undefined, 50);

      expect(resolvedCount).toBe(1);

      const activeAlerts = await alertManager.getActiveAlerts();
      expect(activeAlerts.length).toBe(0);
    });
  });

  describe('delivery handlers', () => {
    it('should use custom delivery handler', async () => {
      const mockHandler = vi.fn();

      alertManager.setDeliveryHandler('cli', mockHandler);

      await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      expect(mockHandler).toHaveBeenCalled();
    });

    it('should record delivery errors', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Delivery failed'));

      alertManager.setDeliveryHandler('cli', errorHandler);

      const alert = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      const alerts = await alertManager.getAlerts();
      const savedAlert = alerts.find(a => a.id === alert.id);

      expect(savedAlert?.deliveryErrors?.cli).toBe('Delivery failed');
    });

    it('should skip disabled channels', async () => {
      const mockHandler = vi.fn();

      alertManager.setChannels([{ type: 'cli', enabled: false }]);
      alertManager.setDeliveryHandler('cli', mockHandler);

      await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Test alert',
        currentValue: 70,
        threshold: 100,
      });

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('getAlertSummary', () => {
    beforeEach(async () => {
      // Create various alerts
      const alert1 = await alertManager.createAlert({
        type: 'limit_approaching',
        severity: 'info',
        scope: 'global',
        message: 'Info alert',
        currentValue: 70,
        threshold: 100,
      });

      await alertManager.createAlert({
        type: 'limit_exceeded',
        severity: 'critical',
        scope: 'project',
        scopeId: 'p1',
        message: 'Critical alert',
        currentValue: 110,
        threshold: 100,
      });

      await alertManager.createAlert({
        type: 'limit_warning',
        severity: 'warning',
        scope: 'project',
        scopeId: 'p2',
        message: 'Warning alert',
        currentValue: 90,
        threshold: 100,
      });

      // Acknowledge one
      await alertManager.acknowledgeAlert(alert1.id, 'user');
    });

    it('should return correct summary', async () => {
      const summary = await alertManager.getAlertSummary();

      expect(summary.active).toBe(2);
      expect(summary.acknowledged).toBe(1);
      expect(summary.resolved).toBe(0);
      expect(summary.bySeverity.info).toBe(1);
      expect(summary.bySeverity.warning).toBe(1);
      expect(summary.bySeverity.critical).toBe(1);
      expect(summary.byType.limit_approaching).toBe(1);
      expect(summary.byType.limit_exceeded).toBe(1);
      expect(summary.byType.limit_warning).toBe(1);
    });
  });

  describe('cleanupDeduplicationCache', () => {
    it('should clean up old entries', async () => {
      // This is mostly for coverage - actual functionality is internal
      alertManager.cleanupDeduplicationCache();
      // Should not throw
    });
  });

  describe('checkSpendingSpike', () => {
    it('should create alert when spending exceeds threshold', async () => {
      const alert = await alertManager.checkSpendingSpike(100, 40, 2.0);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('spending_spike');
      expect(alert!.severity).toBe('warning');
      expect(alert!.message).toContain('2.5x');
    });

    it('should create critical alert for severe spike', async () => {
      const alert = await alertManager.checkSpendingSpike(200, 40, 2.0);

      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('critical');
    });

    it('should not create alert when spending is normal', async () => {
      const alert = await alertManager.checkSpendingSpike(50, 40, 2.0);

      expect(alert).toBeNull();
    });

    it('should not create alert with no historical data', async () => {
      const alert = await alertManager.checkSpendingSpike(100, 0, 2.0);

      expect(alert).toBeNull();
    });
  });

  describe('recordRateLimitError', () => {
    it('should create alert when error count exceeds threshold', async () => {
      const alert = await alertManager.recordRateLimitError('anthropic', 6);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('rate_limit_errors');
      expect(alert!.scope).toBe('provider');
      expect(alert!.scopeId).toBe('anthropic');
    });

    it('should create critical alert for high error count', async () => {
      const alert = await alertManager.recordRateLimitError('anthropic', 12);

      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('critical');
    });

    it('should not create alert when error count is low', async () => {
      const alert = await alertManager.recordRateLimitError('anthropic', 3);

      expect(alert).toBeNull();
    });
  });

  describe('checkCostAnomaly', () => {
    it('should create alert for cost anomaly', async () => {
      const historicalCosts = [10, 12, 11, 10, 13, 9, 11, 10];
      const alert = await alertManager.checkCostAnomaly(30, historicalCosts, 2.0);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('cost_anomaly');
      expect(alert!.message).toContain('higher');
    });

    it('should not create alert for normal cost', async () => {
      const historicalCosts = [10, 12, 11, 10, 13, 9, 11, 10];
      const alert = await alertManager.checkCostAnomaly(11, historicalCosts, 2.0);

      expect(alert).toBeNull();
    });

    it('should not create alert with insufficient data', async () => {
      const historicalCosts = [10, 12, 11];
      const alert = await alertManager.checkCostAnomaly(50, historicalCosts, 2.0);

      expect(alert).toBeNull();
    });

    it('should handle all identical historical values', async () => {
      const historicalCosts = [10, 10, 10, 10, 10];
      const alert = await alertManager.checkCostAnomaly(15, historicalCosts, 2.0);

      // With stdDev = 0, should return null
      expect(alert).toBeNull();
    });
  });
});
