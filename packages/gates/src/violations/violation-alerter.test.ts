import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ViolationAlerter,
  createViolationAlerter,
  type ViolationAlert,
  type AlertHandler,
} from './violation-alerter.js';
import { ViolationRecorder } from './violation-recorder.js';
import type { PermissionViolation } from '../permissions/types.js';

describe('ViolationAlerter', () => {
  let recorder: ViolationRecorder;
  let alerter: ViolationAlerter;
  let alertHandler: AlertHandler;
  let receivedAlerts: ViolationAlert[];

  beforeEach(() => {
    recorder = new ViolationRecorder();
    receivedAlerts = [];
    alertHandler = (alert: ViolationAlert) => {
      receivedAlerts.push(alert);
    };
    alerter = new ViolationAlerter({
      violationRecorder: recorder,
      handlers: [alertHandler],
      defaultThresholds: {
        warning: 2,
        alert: 3,
        critical: 5,
        windowHours: 1,
      },
    });
  });

  async function recordViolation(): Promise<PermissionViolation> {
    return recorder.record({
      agentType: 'researcher',
      projectId: 'project-1',
      action: { type: 'tool', toolName: 'Write' },
      deniedPermission: {
        id: 'p-1',
        category: 'tool',
        resource: 'Write',
        action: 'deny',
      },
      reason: 'Test',
      severity: 'medium',
    });
  }

  describe('checkAndAlert', () => {
    it('should not alert when below warning threshold', async () => {
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(0);
    });

    it('should trigger warning alert at warning threshold', async () => {
      // Record 2 violations (warning threshold)
      await recordViolation();
      const violation = await recordViolation();

      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(1);
      expect(receivedAlerts[0]?.level).toBe('warning');
    });

    it('should trigger alert at alert threshold', async () => {
      // Record 3 violations (alert threshold)
      await recordViolation();
      await recordViolation();
      const violation = await recordViolation();

      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(1);
      expect(receivedAlerts[0]?.level).toBe('alert');
    });

    it('should trigger critical alert at critical threshold', async () => {
      // Record 5 violations (critical threshold)
      for (let i = 0; i < 4; i++) {
        await recordViolation();
      }
      const violation = await recordViolation();

      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(1);
      expect(receivedAlerts[0]?.level).toBe('critical');
    });

    it('should include violation details in alert', async () => {
      await recordViolation();
      const violation = await recordViolation();

      await alerter.checkAndAlert(violation);

      expect(receivedAlerts[0]?.agentType).toBe('researcher');
      expect(receivedAlerts[0]?.projectId).toBe('project-1');
      expect(receivedAlerts[0]?.violationCount).toBe(2);
    });

    it('should respect cooldown between alerts', async () => {
      // Trigger first alert
      await recordViolation();
      const v1 = await recordViolation();
      await alerter.checkAndAlert(v1);

      // Try to trigger another alert immediately
      const v2 = await recordViolation();
      await alerter.checkAndAlert(v2);

      // Should only have one alert due to cooldown
      expect(receivedAlerts.length).toBe(1);
    });

    it('should call all registered handlers', async () => {
      const secondHandler = vi.fn();
      alerter.addHandler(secondHandler);

      await recordViolation();
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(1);
      expect(secondHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle async handlers', async () => {
      const asyncResults: string[] = [];
      const asyncHandler = async (alert: ViolationAlert) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        asyncResults.push(alert.id);
      };
      alerter.addHandler(asyncHandler);

      await recordViolation();
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(asyncResults.length).toBe(1);
    });

    it('should continue if a handler throws', async () => {
      const errorHandler = () => {
        throw new Error('Handler error');
      };
      const afterErrorHandler = vi.fn();

      alerter.addHandler(errorHandler);
      alerter.addHandler(afterErrorHandler);

      await recordViolation();
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      // The first handler (alertHandler) and afterErrorHandler should be called
      expect(receivedAlerts.length).toBe(1);
      expect(afterErrorHandler).toHaveBeenCalled();
    });
  });

  describe('setThreshold', () => {
    it('should set custom threshold for agent type', async () => {
      alerter.setThreshold('researcher', 1, 1); // Alert after 1 violation

      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(1);
    });
  });

  describe('setFullThreshold', () => {
    it('should set complete threshold configuration', async () => {
      alerter.setFullThreshold({
        agentType: 'reviewer',
        warningThreshold: 1,
        alertThreshold: 2,
        criticalThreshold: 3,
        windowHours: 2,
      });

      // Record for reviewer
      const violation = await recorder.record({
        agentType: 'reviewer',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Write' },
        deniedPermission: {
          id: 'p-1',
          category: 'tool',
          resource: 'Write',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
      });

      await alerter.checkAndAlert(violation);

      expect(receivedAlerts.length).toBe(1);
      expect(receivedAlerts[0]?.level).toBe('warning');
    });
  });

  describe('addHandler / removeHandler', () => {
    it('should add a handler', () => {
      const newHandler = vi.fn();
      alerter.addHandler(newHandler);

      const stats = alerter.getAlertStats();
      // Original handler + new handler
      expect(stats.handlerCount).toBe(2);
    });

    it('should remove a handler', () => {
      const newHandler = vi.fn();
      alerter.addHandler(newHandler);
      const removed = alerter.removeHandler(newHandler);

      expect(removed).toBe(true);
      const stats = alerter.getAlertStats();
      expect(stats.handlerCount).toBe(1);
    });

    it('should return false when removing non-existent handler', () => {
      const nonExistent = vi.fn();
      const removed = alerter.removeHandler(nonExistent);
      expect(removed).toBe(false);
    });
  });

  describe('clearCooldown', () => {
    it('should allow immediate re-alerting after clearing', async () => {
      // Trigger first alert
      await recordViolation();
      const v1 = await recordViolation();
      await alerter.checkAndAlert(v1);

      // Clear cooldown
      alerter.clearCooldown();

      // Should be able to alert again
      const v2 = await recordViolation();
      await alerter.checkAndAlert(v2);

      expect(receivedAlerts.length).toBe(2);
    });
  });

  describe('getAlertStats', () => {
    it('should return current statistics', () => {
      alerter.setThreshold('researcher', 5, 1);
      alerter.setThreshold('reviewer', 3, 2);

      const stats = alerter.getAlertStats();

      expect(stats.thresholds.size).toBe(2);
      expect(stats.handlerCount).toBe(1);
      expect(stats.recentAlertCount).toBe(0);
    });
  });

  describe('alert message formatting', () => {
    it('should format warning message correctly', async () => {
      await recordViolation();
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(receivedAlerts[0]?.message).toContain('WARNING');
      expect(receivedAlerts[0]?.message).toContain('researcher');
      expect(receivedAlerts[0]?.message).toContain('2');
    });

    it('should format alert message correctly', async () => {
      for (let i = 0; i < 2; i++) {
        await recordViolation();
      }
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(receivedAlerts[0]?.message).toContain('ALERT');
    });

    it('should format critical message correctly', async () => {
      for (let i = 0; i < 4; i++) {
        await recordViolation();
      }
      const violation = await recordViolation();
      await alerter.checkAndAlert(violation);

      expect(receivedAlerts[0]?.message).toContain('CRITICAL');
    });
  });

  describe('different agent types', () => {
    it('should track violations per agent type separately', async () => {
      // Set low threshold for testing
      alerter.setThreshold('researcher', 2, 1);
      alerter.setThreshold('reviewer', 2, 1);

      // Record violations for researcher
      await recordViolation(); // researcher
      const researcherV = await recordViolation(); // researcher

      // Record violation for reviewer
      const reviewerV = await recorder.record({
        agentType: 'reviewer',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Bash' },
        deniedPermission: {
          id: 'p-1',
          category: 'tool',
          resource: 'Bash',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
      });

      await alerter.checkAndAlert(researcherV);
      await alerter.checkAndAlert(reviewerV);

      // Should only alert for researcher (2 violations)
      // Reviewer only has 1 violation
      expect(receivedAlerts.length).toBe(1);
      expect(receivedAlerts[0]?.agentType).toBe('researcher');
    });
  });
});

describe('createViolationAlerter', () => {
  it('should create an alerter with required options', () => {
    const recorder = new ViolationRecorder();
    const alerter = createViolationAlerter({ violationRecorder: recorder });
    expect(alerter).toBeInstanceOf(ViolationAlerter);
  });

  it('should create an alerter with custom defaults', () => {
    const recorder = new ViolationRecorder();
    const alerter = createViolationAlerter({
      violationRecorder: recorder,
      defaultThresholds: {
        warning: 1,
        alert: 2,
        critical: 3,
        windowHours: 0.5,
      },
    });
    expect(alerter).toBeInstanceOf(ViolationAlerter);
  });
});
