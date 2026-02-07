/**
 * Alert Manager Service
 *
 * Manages alerts for the Scrum Master, including sending,
 * tracking, and acknowledging alerts.
 *
 * @module @tamma/scrum-master/services/alert-manager
 */

import { nanoid } from 'nanoid';
import type {
  Alert,
  AlertType,
  AlertSeverity,
  IAlertManager,
} from '../types.js';
import type { AlertConfig, AlertChannel } from '../config.js';
import { DEFAULT_SCRUM_MASTER_CONFIG } from '../config.js';

export class AlertManager implements IAlertManager {
  private alerts: Map<string, Alert> = new Map();
  private config: AlertConfig;
  private listeners: Array<(alert: Alert) => void> = [];

  constructor(config?: Partial<AlertConfig>) {
    this.config = { ...DEFAULT_SCRUM_MASTER_CONFIG.alerts, ...config };
  }

  /**
   * Add a listener for new alerts
   */
  addListener(listener: (alert: Alert) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: (alert: Alert) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Check if an alert should be sent based on config
   */
  private shouldSendAlert(type: AlertType): boolean {
    switch (type) {
      case 'task_blocked':
        return this.config.onBlock;
      case 'max_retries_exceeded':
        return this.config.onMaxRetries;
      case 'approval_needed':
        return this.config.onApprovalNeeded;
      case 'review_failed':
        return this.config.onReviewFailed;
      case 'cost_limit_warning':
        return this.config.onCostLimitWarning;
      case 'error':
      case 'escalation':
        return true; // Always send error and escalation alerts
      default:
        return true;
    }
  }

  /**
   * Send an alert
   */
  async send(
    alertData: Omit<Alert, 'id' | 'createdAt' | 'acknowledged'>
  ): Promise<Alert> {
    // Check if alert should be sent
    if (!this.shouldSendAlert(alertData.type)) {
      // Create but don't broadcast
      const alert: Alert = {
        ...alertData,
        id: nanoid(),
        createdAt: new Date(),
        acknowledged: false,
      };
      this.alerts.set(alert.id, alert);
      return alert;
    }

    const alert: Alert = {
      ...alertData,
      id: nanoid(),
      createdAt: new Date(),
      acknowledged: false,
    };

    this.alerts.set(alert.id, alert);

    // Deliver through configured channels
    await this.deliverAlert(alert);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch {
        // Ignore listener errors
      }
    }

    return alert;
  }

  /**
   * Deliver alert through configured channels
   */
  private async deliverAlert(alert: Alert): Promise<void> {
    const enabledChannels = this.config.channels.filter((c) => c.enabled);

    for (const channel of enabledChannels) {
      try {
        await this.deliverToChannel(alert, channel);
      } catch (error) {
        // Log error but continue with other channels
        console.error(
          `Failed to deliver alert to ${channel.type}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  /**
   * Deliver to a specific channel
   */
  private async deliverToChannel(
    alert: Alert,
    channel: AlertChannel
  ): Promise<void> {
    switch (channel.type) {
      case 'cli':
        this.deliverToCli(alert);
        break;
      case 'webhook':
        if (channel.config?.['url']) {
          await this.deliverToWebhook(alert, channel.config['url'] as string);
        }
        break;
      case 'slack':
        // Placeholder for Slack integration
        break;
      case 'email':
        // Placeholder for email integration
        break;
    }
  }

  /**
   * Deliver alert to CLI (console)
   */
  private deliverToCli(alert: Alert): void {
    const prefix = this.getSeverityPrefix(alert.severity);
    console.log(`${prefix} [${alert.type}] ${alert.title}`);
    if (alert.details) {
      console.log(`   ${alert.details}`);
    }
    if (alert.actions.length > 0) {
      console.log(`   Actions: ${alert.actions.join(', ')}`);
    }
  }

  /**
   * Deliver alert to webhook
   */
  private async deliverToWebhook(alert: Alert, url: string): Promise<void> {
    const payload = {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      details: alert.details,
      taskId: alert.taskId,
      actions: alert.actions,
      createdAt: alert.createdAt.toISOString(),
    };

    // Note: In production, use proper fetch with timeout and retries
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Get severity prefix for CLI output
   */
  private getSeverityPrefix(severity: AlertSeverity): string {
    switch (severity) {
      case 'info':
        return '[INFO]';
      case 'warning':
        return '[WARN]';
      case 'critical':
        return '[CRITICAL]';
      default:
        return '[ALERT]';
    }
  }

  /**
   * Get active (unacknowledged) alerts
   */
  getActiveAlerts(taskId?: string): Alert[] {
    const alerts = Array.from(this.alerts.values()).filter(
      (a) => !a.acknowledged
    );

    if (taskId) {
      return alerts.filter((a) => a.taskId === taskId);
    }

    return alerts;
  }

  /**
   * Get all alerts
   */
  getAllAlerts(taskId?: string): Alert[] {
    const alerts = Array.from(this.alerts.values());

    if (taskId) {
      return alerts.filter((a) => a.taskId === taskId);
    }

    return alerts;
  }

  /**
   * Get alert by ID
   */
  getAlert(alertId: string): Alert | undefined {
    return this.alerts.get(alertId);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledge(alertId: string, acknowledgedBy: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
  }

  /**
   * Create a helper for sending specific alert types
   */
  createAlertSender(taskId: string): AlertSender {
    return new AlertSender(this, taskId);
  }

  /**
   * Clear all alerts (for testing)
   */
  clearAlerts(): void {
    this.alerts.clear();
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    total: number;
    active: number;
    acknowledged: number;
    bySeverity: Record<AlertSeverity, number>;
    byType: Record<string, number>;
  } {
    const alerts = Array.from(this.alerts.values());
    const active = alerts.filter((a) => !a.acknowledged);

    const bySeverity: Record<AlertSeverity, number> = {
      info: 0,
      warning: 0,
      critical: 0,
    };

    const byType: Record<string, number> = {};

    for (const alert of alerts) {
      bySeverity[alert.severity]++;
      byType[alert.type] = (byType[alert.type] ?? 0) + 1;
    }

    return {
      total: alerts.length,
      active: active.length,
      acknowledged: alerts.length - active.length,
      bySeverity,
      byType,
    };
  }
}

/**
 * Helper class for sending alerts for a specific task
 */
export class AlertSender {
  constructor(
    private manager: AlertManager,
    private taskId: string
  ) {}

  async approvalNeeded(planSummary: string): Promise<Alert> {
    return this.manager.send({
      type: 'approval_needed',
      severity: 'info',
      title: 'Plan approval required',
      details: planSummary,
      taskId: this.taskId,
      actions: ['approve', 'reject', 'modify'],
    });
  }

  async taskBlocked(reason: string): Promise<Alert> {
    return this.manager.send({
      type: 'task_blocked',
      severity: 'warning',
      title: 'Task blocked',
      details: reason,
      taskId: this.taskId,
      actions: ['resolve', 'escalate', 'cancel'],
    });
  }

  async maxRetriesExceeded(retryCount: number, maxRetries: number): Promise<Alert> {
    return this.manager.send({
      type: 'max_retries_exceeded',
      severity: 'critical',
      title: `Maximum retries exceeded (${retryCount}/${maxRetries})`,
      details: 'Task has failed multiple times and requires intervention',
      taskId: this.taskId,
      actions: ['retry', 'escalate', 'cancel'],
    });
  }

  async reviewFailed(score: number, issues: string[]): Promise<Alert> {
    return this.manager.send({
      type: 'review_failed',
      severity: 'warning',
      title: `Review failed (score: ${score}%)`,
      details: issues.slice(0, 3).join('; '),
      taskId: this.taskId,
      actions: ['retry', 'escalate', 'cancel'],
    });
  }

  async costLimitWarning(
    currentCost: number,
    limitCost: number,
    percentUsed: number
  ): Promise<Alert> {
    return this.manager.send({
      type: 'cost_limit_warning',
      severity: percentUsed >= 100 ? 'critical' : 'warning',
      title: `Cost limit ${percentUsed >= 100 ? 'exceeded' : 'warning'} (${percentUsed.toFixed(0)}%)`,
      details: `Current: $${currentCost.toFixed(4)}, Limit: $${limitCost.toFixed(2)}`,
      taskId: this.taskId,
      actions: ['continue', 'cancel'],
    });
  }

  async error(message: string): Promise<Alert> {
    return this.manager.send({
      type: 'error',
      severity: 'critical',
      title: 'Task error',
      details: message,
      taskId: this.taskId,
      actions: ['retry', 'escalate', 'cancel'],
    });
  }

  async escalation(reason: string): Promise<Alert> {
    return this.manager.send({
      type: 'escalation',
      severity: 'critical',
      title: 'Task escalated',
      details: reason,
      taskId: this.taskId,
      actions: ['intervene', 'cancel'],
    });
  }
}

/**
 * Create an alert manager with optional config
 */
export function createAlertManager(config?: Partial<AlertConfig>): AlertManager {
  return new AlertManager(config);
}
