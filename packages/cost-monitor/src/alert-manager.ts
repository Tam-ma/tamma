/**
 * Alert Manager Service
 * Manages cost alerts and notifications
 */

import { nanoid } from 'nanoid';
import type {
  ICostStorage,
  CostAlert,
  CostAlertType,
  AlertSeverity,
  AlertStatus,
  AlertChannel,
  AlertChannelConfig,
  LimitScope,
} from './types.js';

/**
 * Alert delivery handler type
 */
export type AlertDeliveryHandler = (alert: CostAlert, channel: AlertChannelConfig) => Promise<void>;

/**
 * Options for the alert manager
 */
export interface AlertManagerOptions {
  storage: ICostStorage;
  channels?: AlertChannelConfig[];
  deliveryHandlers?: Partial<Record<AlertChannel, AlertDeliveryHandler>>;
  deduplicationWindowMs?: number;
}

/**
 * Default delivery handlers
 */
const defaultDeliveryHandlers: Partial<Record<AlertChannel, AlertDeliveryHandler>> = {
  cli: async (alert) => {
    const severityEmoji = {
      info: 'INFO',
      warning: 'WARN',
      critical: 'CRIT',
    };
    console.log(`[COST ALERT] [${severityEmoji[alert.severity]}] ${alert.message}`);
  },
  webhook: async (alert, channel) => {
    if (!channel.url) {
      throw new Error('Webhook URL not configured');
    }
    const response = await fetch(channel.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        scope: alert.scope,
        scopeId: alert.scopeId,
        message: alert.message,
        currentValue: alert.currentValue,
        threshold: alert.threshold,
        createdAt: alert.createdAt.toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
    }
  },
  slack: async (alert, channel) => {
    if (!channel.url) {
      throw new Error('Slack webhook URL not configured');
    }
    const emoji = alert.severity === 'critical' ? ':rotating_light:' :
                  alert.severity === 'warning' ? ':warning:' : ':information_source:';
    const color = alert.severity === 'critical' ? '#dc3545' :
                  alert.severity === 'warning' ? '#ffc107' : '#17a2b8';

    const response = await fetch(channel.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channel.channel,
        attachments: [
          {
            color,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `${emoji} *Cost Alert: ${alert.type.replace(/_/g, ' ').toUpperCase()}*\n${alert.message}`,
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `*Scope:* ${alert.scope}${alert.scopeId ? ` (${alert.scopeId})` : ''} | *Value:* $${alert.currentValue.toFixed(2)} | *Threshold:* $${alert.threshold.toFixed(2)}`,
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Slack delivery failed: ${response.status} ${response.statusText}`);
    }
  },
  email: async (alert, channel) => {
    // Email delivery requires an external service like Resend
    // This is a placeholder that logs the intent - real implementation would use Resend API
    if (!channel.recipients || channel.recipients.length === 0) {
      throw new Error('No email recipients configured');
    }
    console.log(`[EMAIL ALERT] Would send to ${channel.recipients.join(', ')}: ${alert.message}`);
    // In production, use:
    // const resend = new Resend(process.env.RESEND_API_KEY);
    // await resend.emails.send({ ... });
  },
};

/**
 * Alert Manager for managing cost alerts
 */
export class AlertManager {
  private readonly storage: ICostStorage;
  private readonly channels: AlertChannelConfig[];
  private readonly deliveryHandlers: Partial<Record<AlertChannel, AlertDeliveryHandler>>;
  private readonly deduplicationWindowMs: number;
  private recentAlerts: Map<string, Date> = new Map();

  constructor(options: AlertManagerOptions) {
    this.storage = options.storage;
    this.channels = options.channels ?? [{ type: 'cli', enabled: true }];
    this.deliveryHandlers = {
      ...defaultDeliveryHandlers,
      ...options.deliveryHandlers,
    };
    this.deduplicationWindowMs = options.deduplicationWindowMs ?? 3600000; // 1 hour default
  }

  /**
   * Create and deliver a new alert
   */
  async createAlert(params: {
    type: CostAlertType;
    severity: AlertSeverity;
    scope: LimitScope;
    scopeId?: string;
    message: string;
    currentValue: number;
    threshold: number;
  }): Promise<CostAlert> {
    // Check for duplicate
    const dedupKey = this.getDeduplicationKey(params);
    if (this.isDuplicate(dedupKey)) {
      const existingAlerts = await this.storage.getAlerts({ status: 'active' });
      const existing = existingAlerts.find(
        (a) => a.type === params.type && a.scope === params.scope && a.scopeId === params.scopeId
      );
      if (existing) {
        return existing;
      }
    }

    const alert: CostAlert = {
      id: nanoid(),
      ...params,
      status: 'active',
      createdAt: new Date(),
      deliveredTo: [],
    };

    // Save the alert
    await this.storage.saveAlert(alert);

    // Mark as recent for deduplication
    this.recentAlerts.set(dedupKey, new Date());

    // Deliver to channels
    await this.deliverAlert(alert);

    return alert;
  }

  /**
   * Get alerts with optional filtering
   */
  async getAlerts(filter?: {
    status?: AlertStatus;
    severity?: AlertSeverity;
    type?: CostAlertType;
    scope?: LimitScope;
  }): Promise<CostAlert[]> {
    const storageFilter: { status?: AlertStatus } = {};
    if (filter?.status) {
      storageFilter.status = filter.status;
    }
    const alerts = await this.storage.getAlerts(storageFilter);

    return alerts.filter((alert) => {
      if (filter?.severity && alert.severity !== filter.severity) return false;
      if (filter?.type && alert.type !== filter.type) return false;
      if (filter?.scope && alert.scope !== filter.scope) return false;
      return true;
    });
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(): Promise<CostAlert[]> {
    return this.getAlerts({ status: 'active' });
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    await this.storage.updateAlert(alertId, {
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedBy,
    });
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    await this.storage.updateAlert(alertId, {
      status: 'resolved',
      resolvedAt: new Date(),
    });
  }

  /**
   * Auto-resolve alerts when condition is met
   */
  async autoResolveAlerts(scope: LimitScope, scopeId?: string, currentValue?: number): Promise<number> {
    const activeAlerts = await this.getAlerts({
      status: 'active',
      scope,
    });

    let resolvedCount = 0;

    for (const alert of activeAlerts) {
      // Check if scopeId matches
      if (scopeId && alert.scopeId !== scopeId) continue;

      // Check if value is now below threshold
      if (currentValue !== undefined && currentValue < alert.threshold) {
        await this.resolveAlert(alert.id);
        resolvedCount++;
      }
    }

    return resolvedCount;
  }

  /**
   * Configure alert channels
   */
  setChannels(channels: AlertChannelConfig[]): void {
    this.channels.length = 0;
    this.channels.push(...channels);
  }

  /**
   * Add a delivery handler for a channel
   */
  setDeliveryHandler(channel: AlertChannel, handler: AlertDeliveryHandler): void {
    this.deliveryHandlers[channel] = handler;
  }

  /**
   * Deliver an alert to all enabled channels
   */
  private async deliverAlert(alert: CostAlert): Promise<void> {
    const deliveryErrors: Partial<Record<AlertChannel, string>> = {};

    for (const channel of this.channels) {
      if (!channel.enabled) continue;

      const handler = this.deliveryHandlers[channel.type];
      if (!handler) {
        deliveryErrors[channel.type] = 'No handler configured';
        continue;
      }

      try {
        await handler(alert, channel);
        alert.deliveredTo.push(channel.type);
      } catch (error) {
        deliveryErrors[channel.type] = error instanceof Error ? error.message : 'Unknown error';
      }
    }

    // Update alert with delivery results
    if (Object.keys(deliveryErrors).length > 0) {
      await this.storage.updateAlert(alert.id, {
        deliveredTo: alert.deliveredTo,
        deliveryErrors,
      });
    }
  }

  /**
   * Generate a deduplication key for an alert
   */
  private getDeduplicationKey(params: {
    type: CostAlertType;
    scope: LimitScope;
    scopeId?: string;
  }): string {
    return `${params.type}:${params.scope}:${params.scopeId ?? 'global'}`;
  }

  /**
   * Check if an alert is a duplicate
   */
  private isDuplicate(dedupKey: string): boolean {
    const lastSent = this.recentAlerts.get(dedupKey);
    if (!lastSent) return false;

    const elapsed = Date.now() - lastSent.getTime();
    if (elapsed > this.deduplicationWindowMs) {
      this.recentAlerts.delete(dedupKey);
      return false;
    }

    return true;
  }

  /**
   * Clear old deduplication entries
   */
  cleanupDeduplicationCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.recentAlerts) {
      if (now - timestamp.getTime() > this.deduplicationWindowMs) {
        this.recentAlerts.delete(key);
      }
    }
  }

  /**
   * Get alert summary
   */
  async getAlertSummary(): Promise<{
    active: number;
    acknowledged: number;
    resolved: number;
    bySeverity: Record<AlertSeverity, number>;
    byType: Partial<Record<CostAlertType, number>>;
  }> {
    const allAlerts = await this.storage.getAlerts();

    const summary = {
      active: 0,
      acknowledged: 0,
      resolved: 0,
      bySeverity: { info: 0, warning: 0, critical: 0 } as Record<AlertSeverity, number>,
      byType: {} as Partial<Record<CostAlertType, number>>,
    };

    for (const alert of allAlerts) {
      switch (alert.status) {
        case 'active':
          summary.active++;
          break;
        case 'acknowledged':
          summary.acknowledged++;
          break;
        case 'resolved':
          summary.resolved++;
          break;
      }

      summary.bySeverity[alert.severity]++;
      summary.byType[alert.type] = (summary.byType[alert.type] ?? 0) + 1;
    }

    return summary;
  }

  /**
   * Check for spending spike based on historical data
   * A spike is detected when current period spending exceeds the average by a threshold multiplier
   */
  async checkSpendingSpike(
    currentPeriodCost: number,
    historicalAverage: number,
    spikeThreshold = 2.0 // Default: 2x normal spending
  ): Promise<CostAlert | null> {
    if (historicalAverage <= 0) {
      return null; // Not enough historical data
    }

    const ratio = currentPeriodCost / historicalAverage;

    if (ratio >= spikeThreshold) {
      return this.createAlert({
        type: 'spending_spike',
        severity: ratio >= spikeThreshold * 1.5 ? 'critical' : 'warning',
        scope: 'global',
        message: `Spending spike detected: Current spending ($${currentPeriodCost.toFixed(2)}) is ${ratio.toFixed(1)}x the historical average ($${historicalAverage.toFixed(2)})`,
        currentValue: currentPeriodCost,
        threshold: historicalAverage * spikeThreshold,
      });
    }

    return null;
  }

  /**
   * Record a rate limit error and potentially create an alert
   */
  async recordRateLimitError(
    provider: string,
    errorCount: number,
    windowMinutes = 60
  ): Promise<CostAlert | null> {
    // Alert if more than 5 rate limit errors in the window
    const errorThreshold = 5;

    if (errorCount >= errorThreshold) {
      return this.createAlert({
        type: 'rate_limit_errors',
        severity: errorCount >= errorThreshold * 2 ? 'critical' : 'warning',
        scope: 'provider',
        scopeId: provider,
        message: `Rate limit errors detected: ${errorCount} errors from ${provider} in the last ${windowMinutes} minutes`,
        currentValue: errorCount,
        threshold: errorThreshold,
      });
    }

    return null;
  }

  /**
   * Check for cost anomalies using statistical analysis
   * Uses standard deviation to detect outliers
   */
  async checkCostAnomaly(
    currentCost: number,
    historicalCosts: number[],
    stdDevMultiplier = 2.0 // Alert if cost is more than 2 std deviations from mean
  ): Promise<CostAlert | null> {
    if (historicalCosts.length < 5) {
      return null; // Not enough data for statistical analysis
    }

    const mean = historicalCosts.reduce((a, b) => a + b, 0) / historicalCosts.length;
    const squaredDiffs = historicalCosts.map(cost => Math.pow(cost - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    // Avoid division by zero
    if (stdDev === 0) {
      return null;
    }

    const zScore = (currentCost - mean) / stdDev;

    if (Math.abs(zScore) >= stdDevMultiplier) {
      const direction = zScore > 0 ? 'higher' : 'lower';
      return this.createAlert({
        type: 'cost_anomaly',
        severity: Math.abs(zScore) >= stdDevMultiplier * 1.5 ? 'critical' : 'warning',
        scope: 'global',
        message: `Cost anomaly detected: Current cost ($${currentCost.toFixed(2)}) is ${Math.abs(zScore).toFixed(1)} standard deviations ${direction} than the mean ($${mean.toFixed(2)})`,
        currentValue: currentCost,
        threshold: mean + (stdDevMultiplier * stdDev * Math.sign(zScore)),
      });
    }

    return null;
  }
}
