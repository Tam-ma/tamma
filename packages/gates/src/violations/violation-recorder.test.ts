import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViolationRecorder, createViolationRecorder } from './violation-recorder.js';
import type { PermissionViolation } from '../permissions/types.js';

describe('ViolationRecorder', () => {
  let recorder: ViolationRecorder;

  beforeEach(() => {
    recorder = new ViolationRecorder();
  });

  describe('record', () => {
    it('should record a violation with generated id and timestamp', async () => {
      const violation = await recorder.record({
        agentType: 'researcher',
        projectId: 'project-1',
        taskId: 'task-1',
        action: { type: 'tool', toolName: 'Write' },
        deniedPermission: {
          id: 'p-1',
          category: 'tool',
          resource: 'Write',
          action: 'deny',
        },
        reason: 'Write not allowed',
        severity: 'medium',
      });

      expect(violation.id).toBeDefined();
      expect(violation.timestamp).toBeInstanceOf(Date);
      expect(violation.agentType).toBe('researcher');
      expect(violation.repeated).toBe(false);
    });

    it('should mark violations as repeated when similar recent violations exist', async () => {
      // Record first violation
      await recorder.record({
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

      // Record similar violation
      const second = await recorder.record({
        agentType: 'researcher',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Edit' },
        deniedPermission: {
          id: 'p-2',
          category: 'tool',
          resource: 'Edit',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
      });

      expect(second.repeated).toBe(true);
      expect(second.repeatCount).toBe(2);
    });

    it('should respect maxViolations limit', async () => {
      const smallRecorder = new ViolationRecorder({ maxViolations: 3 });

      // Record 5 violations
      for (let i = 0; i < 5; i++) {
        await smallRecorder.record({
          agentType: 'researcher',
          projectId: 'project-1',
          action: { type: 'tool', toolName: `Tool${i}` },
          deniedPermission: {
            id: `p-${i}`,
            category: 'tool',
            resource: `Tool${i}`,
            action: 'deny',
          },
          reason: 'Test',
          severity: 'low',
        });
      }

      const violations = await smallRecorder.getViolations();
      expect(violations.length).toBe(3);
    });
  });

  describe('getViolations', () => {
    beforeEach(async () => {
      // Seed with test violations
      await recorder.record({
        agentType: 'researcher',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Write' },
        deniedPermission: {
          id: 'p-1',
          category: 'tool',
          resource: 'Write',
          action: 'deny',
        },
        reason: 'Test 1',
        severity: 'low',
      });

      await recorder.record({
        agentType: 'reviewer',
        projectId: 'project-1',
        action: { type: 'command', command: 'npm install' },
        deniedPermission: {
          id: 'p-2',
          category: 'command',
          resource: 'npm install',
          action: 'deny',
        },
        reason: 'Test 2',
        severity: 'medium',
      });

      await recorder.record({
        agentType: 'researcher',
        projectId: 'project-2',
        action: { type: 'tool', toolName: 'Bash' },
        deniedPermission: {
          id: 'p-3',
          category: 'tool',
          resource: 'Bash',
          action: 'deny',
        },
        reason: 'Test 3',
        severity: 'high',
      });
    });

    it('should return all violations without filter', async () => {
      const violations = await recorder.getViolations();
      expect(violations.length).toBe(3);
    });

    it('should filter by agentType', async () => {
      const violations = await recorder.getViolations({ agentType: 'researcher' });
      expect(violations.length).toBe(2);
      expect(violations.every((v) => v.agentType === 'researcher')).toBe(true);
    });

    it('should filter by projectId', async () => {
      const violations = await recorder.getViolations({ projectId: 'project-1' });
      expect(violations.length).toBe(2);
      expect(violations.every((v) => v.projectId === 'project-1')).toBe(true);
    });

    it('should filter by severity', async () => {
      const violations = await recorder.getViolations({
        severity: ['medium', 'high'],
      });
      expect(violations.length).toBe(2);
    });

    it('should limit results', async () => {
      const violations = await recorder.getViolations({ limit: 2 });
      expect(violations.length).toBe(2);
    });

    it('should sort by timestamp descending', async () => {
      const violations = await recorder.getViolations();
      for (let i = 1; i < violations.length; i++) {
        const current = violations[i];
        const previous = violations[i - 1];
        if (current && previous) {
          expect(current.timestamp.getTime()).toBeLessThanOrEqual(
            previous.timestamp.getTime(),
          );
        }
      }
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const violations = await recorder.getViolations({
        fromDate: hourAgo,
        toDate: now,
      });

      expect(violations.length).toBe(3); // All should be recent
    });
  });

  describe('getViolationCount', () => {
    it('should count violations for agent in project', async () => {
      await recorder.record({
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

      await recorder.record({
        agentType: 'researcher',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Bash' },
        deniedPermission: {
          id: 'p-2',
          category: 'tool',
          resource: 'Bash',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
      });

      const count = await recorder.getViolationCount('researcher', 'project-1');
      expect(count).toBe(2);
    });

    it('should respect time window', async () => {
      await recorder.record({
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

      // Count within last hour
      const count = await recorder.getViolationCount('researcher', 'project-1', 1);
      expect(count).toBe(1);
    });
  });

  describe('getViolationsBySeverity', () => {
    beforeEach(async () => {
      await recorder.record({
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
        severity: 'critical',
      });

      await recorder.record({
        agentType: 'researcher',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Bash' },
        deniedPermission: {
          id: 'p-2',
          category: 'tool',
          resource: 'Bash',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'low',
      });
    });

    it('should return violations of specified severity', async () => {
      const critical = await recorder.getViolationsBySeverity('critical');
      expect(critical.length).toBe(1);
      expect(critical[0]?.severity).toBe('critical');
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await recorder.record({
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
        severity: 'critical',
      });

      await recorder.record({
        agentType: 'researcher',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Bash' },
        deniedPermission: {
          id: 'p-2',
          category: 'tool',
          resource: 'Bash',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'low',
      });

      await recorder.record({
        agentType: 'reviewer',
        projectId: 'project-1',
        action: { type: 'command', command: 'test' },
        deniedPermission: {
          id: 'p-3',
          category: 'command',
          resource: 'test',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
      });
    });

    it('should return comprehensive statistics', () => {
      const stats = recorder.getStats();

      expect(stats.total).toBe(3);
      expect(stats.bySeverity.critical).toBe(1);
      expect(stats.bySeverity.low).toBe(1);
      expect(stats.bySeverity.medium).toBe(1);
      expect(stats.byAgentType['researcher']).toBe(2);
      expect(stats.byAgentType['reviewer']).toBe(1);
    });
  });

  describe('getRecentViolations', () => {
    it('should return most recent violations', async () => {
      for (let i = 0; i < 20; i++) {
        await recorder.record({
          agentType: 'researcher',
          projectId: 'project-1',
          action: { type: 'tool', toolName: `Tool${i}` },
          deniedPermission: {
            id: `p-${i}`,
            category: 'tool',
            resource: `Tool${i}`,
            action: 'deny',
          },
          reason: `Test ${i}`,
          severity: 'medium',
        });
      }

      const recent = await recorder.getRecentViolations(5);
      expect(recent.length).toBe(5);
    });
  });

  describe('clear', () => {
    it('should clear all violations', async () => {
      await recorder.record({
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

      recorder.clear();

      const violations = await recorder.getViolations();
      expect(violations.length).toBe(0);
    });
  });
});

describe('createViolationRecorder', () => {
  it('should create a recorder with default options', () => {
    const recorder = createViolationRecorder();
    expect(recorder).toBeInstanceOf(ViolationRecorder);
  });

  it('should create a recorder with custom options', () => {
    const recorder = createViolationRecorder({
      maxViolations: 100,
      repeatThresholdMinutes: 10,
    });
    expect(recorder).toBeInstanceOf(ViolationRecorder);
  });
});
