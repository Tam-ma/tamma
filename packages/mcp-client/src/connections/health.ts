/**
 * @tamma/mcp-client
 * Health check utilities
 */

import type { ServerStatus, HealthCheckResult, ServerInfo } from '../types.js';

/**
 * Health check options
 */
export interface HealthCheckOptions {
  /** Timeout for each server check in ms (default: 5000) */
  timeoutMs?: number;
  /** Include detailed metrics in result (default: false) */
  includeMetrics?: boolean;
}

/**
 * Default health check options
 */
const DEFAULT_OPTIONS: Required<HealthCheckOptions> = {
  timeoutMs: 5000,
  includeMetrics: false,
};

/**
 * Server health status
 */
export interface ServerHealthStatus {
  status: ServerStatus;
  latencyMs?: number;
  error?: string;
  lastChecked: Date;
}

/**
 * Health checker for MCP servers
 *
 * Provides utilities for checking the health of MCP server connections.
 */
export class HealthChecker {
  private readonly statusHistory = new Map<string, ServerHealthStatus[]>();
  private readonly maxHistorySize = 100;

  /**
   * Record a health check result
   */
  recordCheck(serverName: string, status: ServerHealthStatus): void {
    let history = this.statusHistory.get(serverName);

    if (!history) {
      history = [];
      this.statusHistory.set(serverName, history);
    }

    history.push(status);

    // Trim history
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }
  }

  /**
   * Get the latest health status for a server
   */
  getLatestStatus(serverName: string): ServerHealthStatus | undefined {
    const history = this.statusHistory.get(serverName);
    return history?.[history.length - 1];
  }

  /**
   * Get health history for a server
   */
  getHistory(serverName: string): ServerHealthStatus[] {
    return this.statusHistory.get(serverName) ?? [];
  }

  /**
   * Calculate uptime percentage for a server
   */
  getUptimePercentage(serverName: string): number {
    const history = this.statusHistory.get(serverName);

    if (!history || history.length === 0) {
      return 0;
    }

    const connectedCount = history.filter(
      (s) => s.status === 'connected'
    ).length;

    return (connectedCount / history.length) * 100;
  }

  /**
   * Calculate average latency for a server
   */
  getAverageLatency(serverName: string): number | undefined {
    const history = this.statusHistory.get(serverName);

    if (!history || history.length === 0) {
      return undefined;
    }

    const latencies = history
      .map((s) => s.latencyMs)
      .filter((l): l is number => l !== undefined);

    if (latencies.length === 0) {
      return undefined;
    }

    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  /**
   * Clear history for a server
   */
  clearHistory(serverName: string): void {
    this.statusHistory.delete(serverName);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.statusHistory.clear();
  }

  /**
   * Build a health check result from server infos
   */
  buildHealthCheckResult(servers: ServerInfo[]): HealthCheckResult {
    const serverResults: Record<string, {
      status: ServerStatus;
      latencyMs?: number;
      error?: string;
    }> = {};

    let allHealthy = true;

    for (const server of servers) {
      serverResults[server.name] = {
        status: server.status,
        latencyMs: server.metrics.averageLatencyMs || undefined,
        error: server.lastError?.message,
      };

      if (server.status !== 'connected') {
        allHealthy = false;
      }
    }

    return {
      healthy: allHealthy,
      servers: serverResults,
    };
  }
}

/**
 * Create a ping function for checking server responsiveness
 */
export async function pingServer(
  sendRequest: (method: string) => Promise<unknown>,
  timeoutMs: number = DEFAULT_OPTIONS.timeoutMs
): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Ping timed out')), timeoutMs);
    });

    // Race between ping and timeout
    await Promise.race([
      sendRequest('ping'),
      timeoutPromise,
    ]);

    const latencyMs = Date.now() - startTime;

    return { success: true, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Check if a status indicates the server is operational
 */
export function isOperational(status: ServerStatus): boolean {
  return status === 'connected';
}

/**
 * Check if a status indicates the server is in a transitional state
 */
export function isTransitional(status: ServerStatus): boolean {
  return status === 'connecting' || status === 'reconnecting';
}

/**
 * Check if a status indicates a problem
 */
export function isUnhealthy(status: ServerStatus): boolean {
  return status === 'disconnected' || status === 'error';
}
