import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlertManager, AlertSender, createAlertManager } from './alert-manager.js';
import type { Alert } from '../types.js';

describe('AlertManager', () => {
  let manager: AlertManager;

  beforeEach(() => {
    manager = new AlertManager();
  });

  describe('send', () => {
    it('should create an alert with generated id and timestamp', async () => {
      const alert = await manager.send({
        type: 'approval_needed',
        severity: 'info',
        title: 'Test alert',
        details: 'Test details',
        taskId: 'task-1',
        actions: ['approve', 'reject'],
      });

      expect(alert.id).toBeDefined();
      expect(alert.createdAt).toBeDefined();
      expect(alert.acknowledged).toBe(false);
      expect(alert.title).toBe('Test alert');
    });

    it('should store alert in active list', async () => {
      await manager.send({
        type: 'approval_needed',
        severity: 'info',
        title: 'Test alert',
        details: 'Test details',
        actions: [],
      });

      const active = manager.getActiveAlerts();
      expect(active.length).toBe(1);
    });

    it('should respect config for sending alerts', async () => {
      manager = new AlertManager({
        onBlock: false,
        onMaxRetries: true,
        onApprovalNeeded: true,
        onReviewFailed: true,
        onCostLimitWarning: true,
        channels: [{ type: 'cli', enabled: true }],
      });

      // This alert type is disabled
      await manager.send({
        type: 'task_blocked',
        severity: 'warning',
        title: 'Blocked',
        details: 'Test',
        actions: [],
      });

      // Still stored but not broadcasted
      const all = manager.getAllAlerts();
      expect(all.length).toBe(1);
    });

    it('should notify listeners', async () => {
      const listener = vi.fn();
      manager.addListener(listener);

      await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Error',
        details: 'Test error',
        actions: [],
      });

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('getActiveAlerts', () => {
    it('should return only unacknowledged alerts', async () => {
      const alert1 = await manager.send({
        type: 'approval_needed',
        severity: 'info',
        title: 'Alert 1',
        details: '',
        actions: [],
      });

      await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Alert 2',
        details: '',
        actions: [],
      });

      await manager.acknowledge(alert1.id, 'user');

      const active = manager.getActiveAlerts();
      expect(active.length).toBe(1);
      expect(active[0]?.title).toBe('Alert 2');
    });

    it('should filter by taskId', async () => {
      await manager.send({
        type: 'approval_needed',
        severity: 'info',
        title: 'Alert 1',
        details: '',
        taskId: 'task-1',
        actions: [],
      });

      await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Alert 2',
        details: '',
        taskId: 'task-2',
        actions: [],
      });

      const active = manager.getActiveAlerts('task-1');
      expect(active.length).toBe(1);
      expect(active[0]?.taskId).toBe('task-1');
    });
  });

  describe('acknowledge', () => {
    it('should mark alert as acknowledged', async () => {
      const alert = await manager.send({
        type: 'approval_needed',
        severity: 'info',
        title: 'Test',
        details: '',
        actions: [],
      });

      await manager.acknowledge(alert.id, 'test-user');

      const updated = manager.getAlert(alert.id);
      expect(updated?.acknowledged).toBe(true);
      expect(updated?.acknowledgedBy).toBe('test-user');
      expect(updated?.acknowledgedAt).toBeDefined();
    });

    it('should throw for non-existent alert', async () => {
      await expect(
        manager.acknowledge('non-existent', 'user')
      ).rejects.toThrow('not found');
    });
  });

  describe('addListener/removeListener', () => {
    it('should add and remove listeners', async () => {
      const listener = vi.fn();
      manager.addListener(listener);

      await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Test',
        details: '',
        actions: [],
      });

      expect(listener).toHaveBeenCalledTimes(1);

      manager.removeListener(listener);

      await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Test 2',
        details: '',
        actions: [],
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      await manager.send({
        type: 'approval_needed',
        severity: 'info',
        title: 'Alert 1',
        details: '',
        actions: [],
      });

      const alert2 = await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Alert 2',
        details: '',
        actions: [],
      });

      await manager.send({
        type: 'review_failed',
        severity: 'warning',
        title: 'Alert 3',
        details: '',
        actions: [],
      });

      await manager.acknowledge(alert2.id, 'user');

      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.acknowledged).toBe(1);
      expect(stats.bySeverity.info).toBe(1);
      expect(stats.bySeverity.warning).toBe(1);
      expect(stats.bySeverity.critical).toBe(1);
      expect(stats.byType['approval_needed']).toBe(1);
      expect(stats.byType['error']).toBe(1);
    });
  });

  describe('clearAlerts', () => {
    it('should remove all alerts', async () => {
      await manager.send({
        type: 'error',
        severity: 'critical',
        title: 'Test',
        details: '',
        actions: [],
      });

      manager.clearAlerts();

      expect(manager.getAllAlerts().length).toBe(0);
    });
  });
});

describe('AlertSender', () => {
  let manager: AlertManager;
  let sender: AlertSender;

  beforeEach(() => {
    manager = new AlertManager();
    sender = manager.createAlertSender('task-1');
  });

  describe('approvalNeeded', () => {
    it('should send approval needed alert', async () => {
      const alert = await sender.approvalNeeded('Plan summary');

      expect(alert.type).toBe('approval_needed');
      expect(alert.severity).toBe('info');
      expect(alert.taskId).toBe('task-1');
      expect(alert.actions).toContain('approve');
      expect(alert.actions).toContain('reject');
    });
  });

  describe('taskBlocked', () => {
    it('should send task blocked alert', async () => {
      const alert = await sender.taskBlocked('Permission denied');

      expect(alert.type).toBe('task_blocked');
      expect(alert.severity).toBe('warning');
      expect(alert.details).toBe('Permission denied');
    });
  });

  describe('maxRetriesExceeded', () => {
    it('should send max retries alert', async () => {
      const alert = await sender.maxRetriesExceeded(3, 3);

      expect(alert.type).toBe('max_retries_exceeded');
      expect(alert.severity).toBe('critical');
      expect(alert.title).toContain('3/3');
    });
  });

  describe('reviewFailed', () => {
    it('should send review failed alert', async () => {
      const alert = await sender.reviewFailed(45, ['Issue 1', 'Issue 2']);

      expect(alert.type).toBe('review_failed');
      expect(alert.severity).toBe('warning');
      expect(alert.title).toContain('45%');
    });
  });

  describe('costLimitWarning', () => {
    it('should send warning for approaching limit', async () => {
      const alert = await sender.costLimitWarning(8, 10, 80);

      expect(alert.type).toBe('cost_limit_warning');
      expect(alert.severity).toBe('warning');
    });

    it('should send critical for exceeded limit', async () => {
      const alert = await sender.costLimitWarning(11, 10, 110);

      expect(alert.type).toBe('cost_limit_warning');
      expect(alert.severity).toBe('critical');
    });
  });

  describe('error', () => {
    it('should send error alert', async () => {
      const alert = await sender.error('Something went wrong');

      expect(alert.type).toBe('error');
      expect(alert.severity).toBe('critical');
      expect(alert.details).toBe('Something went wrong');
    });
  });

  describe('escalation', () => {
    it('should send escalation alert', async () => {
      const alert = await sender.escalation('Too many failures');

      expect(alert.type).toBe('escalation');
      expect(alert.severity).toBe('critical');
      expect(alert.actions).toContain('intervene');
    });
  });
});

describe('createAlertManager', () => {
  it('should create manager with default config', () => {
    const manager = createAlertManager();
    expect(manager).toBeInstanceOf(AlertManager);
  });

  it('should create manager with custom config', () => {
    const manager = createAlertManager({
      onBlock: false,
      onMaxRetries: false,
      onApprovalNeeded: true,
      onReviewFailed: true,
      onCostLimitWarning: false,
      channels: [],
    });
    expect(manager).toBeInstanceOf(AlertManager);
  });
});
