/**
 * Health check unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  HealthChecker,
  pingServer,
  isOperational,
  isTransitional,
  isUnhealthy,
  type ServerHealthStatus,
} from '../../src/connections/health.js';
import type { ServerStatus, ServerInfo, ServerMetrics } from '../../src/types.js';

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
  });

  describe('recordCheck', () => {
    it('should record health check', () => {
      const status: ServerHealthStatus = {
        status: 'connected',
        latencyMs: 50,
        lastChecked: new Date(),
      };

      checker.recordCheck('server1', status);

      const latest = checker.getLatestStatus('server1');
      expect(latest).toEqual(status);
    });

    it('should maintain history', () => {
      const status1: ServerHealthStatus = {
        status: 'connected',
        lastChecked: new Date(),
      };
      const status2: ServerHealthStatus = {
        status: 'error',
        error: 'Connection failed',
        lastChecked: new Date(),
      };

      checker.recordCheck('server1', status1);
      checker.recordCheck('server1', status2);

      const history = checker.getHistory('server1');
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(status1);
      expect(history[1]).toEqual(status2);
    });

    it('should limit history size', () => {
      // Record more than maxHistorySize (100) entries
      for (let i = 0; i < 150; i++) {
        checker.recordCheck('server1', {
          status: 'connected',
          lastChecked: new Date(),
        });
      }

      const history = checker.getHistory('server1');
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getLatestStatus', () => {
    it('should return undefined for unknown server', () => {
      const status = checker.getLatestStatus('unknown');
      expect(status).toBeUndefined();
    });

    it('should return latest status', () => {
      checker.recordCheck('server1', {
        status: 'connecting',
        lastChecked: new Date(),
      });
      checker.recordCheck('server1', {
        status: 'connected',
        lastChecked: new Date(),
      });

      const latest = checker.getLatestStatus('server1');
      expect(latest?.status).toBe('connected');
    });
  });

  describe('getUptimePercentage', () => {
    it('should return 0 for unknown server', () => {
      expect(checker.getUptimePercentage('unknown')).toBe(0);
    });

    it('should calculate uptime correctly', () => {
      checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });
      checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });
      checker.recordCheck('server1', { status: 'error', lastChecked: new Date() });
      checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });

      const uptime = checker.getUptimePercentage('server1');
      expect(uptime).toBe(75); // 3 out of 4
    });

    it('should return 100 for always connected', () => {
      for (let i = 0; i < 10; i++) {
        checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });
      }

      expect(checker.getUptimePercentage('server1')).toBe(100);
    });

    it('should return 0 for never connected', () => {
      checker.recordCheck('server1', { status: 'error', lastChecked: new Date() });
      checker.recordCheck('server1', { status: 'disconnected', lastChecked: new Date() });

      expect(checker.getUptimePercentage('server1')).toBe(0);
    });
  });

  describe('getAverageLatency', () => {
    it('should return undefined for unknown server', () => {
      expect(checker.getAverageLatency('unknown')).toBeUndefined();
    });

    it('should return undefined if no latencies recorded', () => {
      checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });

      expect(checker.getAverageLatency('server1')).toBeUndefined();
    });

    it('should calculate average latency', () => {
      checker.recordCheck('server1', {
        status: 'connected',
        latencyMs: 100,
        lastChecked: new Date(),
      });
      checker.recordCheck('server1', {
        status: 'connected',
        latencyMs: 200,
        lastChecked: new Date(),
      });
      checker.recordCheck('server1', {
        status: 'connected',
        latencyMs: 300,
        lastChecked: new Date(),
      });

      const avg = checker.getAverageLatency('server1');
      expect(avg).toBe(200);
    });
  });

  describe('clearHistory', () => {
    it('should clear history for server', () => {
      checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });
      checker.recordCheck('server2', { status: 'connected', lastChecked: new Date() });

      checker.clearHistory('server1');

      expect(checker.getHistory('server1')).toHaveLength(0);
      expect(checker.getHistory('server2')).toHaveLength(1);
    });
  });

  describe('clearAllHistory', () => {
    it('should clear all history', () => {
      checker.recordCheck('server1', { status: 'connected', lastChecked: new Date() });
      checker.recordCheck('server2', { status: 'connected', lastChecked: new Date() });

      checker.clearAllHistory();

      expect(checker.getHistory('server1')).toHaveLength(0);
      expect(checker.getHistory('server2')).toHaveLength(0);
    });
  });

  describe('buildHealthCheckResult', () => {
    it('should build result from server infos', () => {
      const servers: ServerInfo[] = [
        {
          name: 'server1',
          transport: 'stdio',
          status: 'connected',
          capabilities: {},
          toolCount: 5,
          resourceCount: 3,
          promptCount: 1,
          metrics: {
            totalRequests: 100,
            successfulRequests: 95,
            failedRequests: 5,
            averageLatencyMs: 50,
          },
        },
        {
          name: 'server2',
          transport: 'sse',
          status: 'error',
          capabilities: {},
          toolCount: 0,
          resourceCount: 0,
          promptCount: 0,
          lastError: new Error('Connection failed'),
          metrics: {
            totalRequests: 10,
            successfulRequests: 0,
            failedRequests: 10,
            averageLatencyMs: 0,
          },
        },
      ];

      const result = checker.buildHealthCheckResult(servers);

      expect(result.healthy).toBe(false); // One server has error
      expect(result.servers['server1']?.status).toBe('connected');
      expect(result.servers['server1']?.latencyMs).toBe(50);
      expect(result.servers['server2']?.status).toBe('error');
      expect(result.servers['server2']?.error).toBe('Connection failed');
    });

    it('should return healthy true when all connected', () => {
      const servers: ServerInfo[] = [
        {
          name: 'server1',
          transport: 'stdio',
          status: 'connected',
          capabilities: {},
          toolCount: 0,
          resourceCount: 0,
          promptCount: 0,
          metrics: {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatencyMs: 0,
          },
        },
      ];

      const result = checker.buildHealthCheckResult(servers);

      expect(result.healthy).toBe(true);
    });
  });
});

describe('pingServer', () => {
  it('should return success for successful ping', async () => {
    const sendRequest = vi.fn().mockResolvedValue({});

    const result = await pingServer(sendRequest);

    expect(result.success).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('should return failure for failed ping', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('Connection failed'));

    const result = await pingServer(sendRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection failed');
  });

  it('should timeout after specified time', async () => {
    vi.useFakeTimers();

    const sendRequest = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10000))
    );

    const promise = pingServer(sendRequest, 1000);

    vi.advanceTimersByTime(1000);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');

    vi.useRealTimers();
  });
});

describe('Status helpers', () => {
  describe('isOperational', () => {
    it('should return true for connected', () => {
      expect(isOperational('connected')).toBe(true);
    });

    it('should return false for other states', () => {
      expect(isOperational('disconnected')).toBe(false);
      expect(isOperational('connecting')).toBe(false);
      expect(isOperational('reconnecting')).toBe(false);
      expect(isOperational('error')).toBe(false);
    });
  });

  describe('isTransitional', () => {
    it('should return true for connecting and reconnecting', () => {
      expect(isTransitional('connecting')).toBe(true);
      expect(isTransitional('reconnecting')).toBe(true);
    });

    it('should return false for other states', () => {
      expect(isTransitional('connected')).toBe(false);
      expect(isTransitional('disconnected')).toBe(false);
      expect(isTransitional('error')).toBe(false);
    });
  });

  describe('isUnhealthy', () => {
    it('should return true for disconnected and error', () => {
      expect(isUnhealthy('disconnected')).toBe(true);
      expect(isUnhealthy('error')).toBe(true);
    });

    it('should return false for other states', () => {
      expect(isUnhealthy('connected')).toBe(false);
      expect(isUnhealthy('connecting')).toBe(false);
      expect(isUnhealthy('reconnecting')).toBe(false);
    });
  });
});
