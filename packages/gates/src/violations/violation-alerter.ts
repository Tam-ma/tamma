/**
 * Violation alerter for threshold-based alerting
 * @module @tamma/gates/violations/violation-alerter
 */

import type {
  AgentType,
  PermissionViolation,
  IViolationAlerter,
  IViolationRecorder,
} from '../permissions/types.js';
import type { ILogger } from '@tamma/shared';

/**
 * Alert level based on severity
 */
export type AlertLevel = 'warning' | 'alert' | 'critical';

/**
 * Alert notification
 */
export interface ViolationAlert {
  id: string;
  level: AlertLevel;
  agentType: AgentType;
  projectId: string;
  violationCount: number;
  threshold: number;
  windowHours: number;
  message: string;
  timestamp: Date;
  violations: PermissionViolation[];
}

/**
 * Threshold configuration for an agent type
 */
export interface AlertThreshold {
  agentType: AgentType;
  warningThreshold: number;
  alertThreshold: number;
  criticalThreshold: number;
  windowHours: number;
}

/**
 * Alert handler function type
 */
export type AlertHandler = (alert: ViolationAlert) => void | Promise<void>;

/**
 * Options for the violation alerter
 */
export interface ViolationAlerterOptions {
  violationRecorder: IViolationRecorder;
  logger?: ILogger;
  /**
   * Default thresholds if not set per agent type
   */
  defaultThresholds?: {
    warning: number;
    alert: number;
    critical: number;
    windowHours: number;
  };
  /**
   * Alert handlers to call when alerts are triggered
   */
  handlers?: AlertHandler[];
}

/**
 * Alerter for detecting and notifying about repeated violations
 */
export class ViolationAlerter implements IViolationAlerter {
  private readonly violationRecorder: IViolationRecorder;
  private readonly logger?: ILogger;
  private readonly thresholds: Map<AgentType, AlertThreshold>;
  private readonly handlers: AlertHandler[];
  private readonly recentAlerts: Map<string, Date>; // Track recent alerts to avoid spam
  private readonly alertCooldownMs = 15 * 60 * 1000; // 15 minutes between similar alerts

  private readonly defaultThresholds: {
    warning: number;
    alert: number;
    critical: number;
    windowHours: number;
  };

  constructor(options: ViolationAlerterOptions) {
    this.violationRecorder = options.violationRecorder;
    this.logger = options.logger;
    this.thresholds = new Map();
    this.handlers = options.handlers ?? [];
    this.recentAlerts = new Map();
    this.defaultThresholds = options.defaultThresholds ?? {
      warning: 3,
      alert: 5,
      critical: 10,
      windowHours: 1,
    };
  }

  /**
   * Check and potentially trigger alerts for a new violation
   */
  async checkAndAlert(violation: PermissionViolation): Promise<void> {
    const threshold = this.getThreshold(violation.agentType);
    const count = await this.violationRecorder.getViolationCount(
      violation.agentType,
      violation.projectId,
      threshold.windowHours,
    );

    // Determine alert level
    let level: AlertLevel | null = null;
    let triggeredThreshold = 0;

    if (count >= threshold.criticalThreshold) {
      level = 'critical';
      triggeredThreshold = threshold.criticalThreshold;
    } else if (count >= threshold.alertThreshold) {
      level = 'alert';
      triggeredThreshold = threshold.alertThreshold;
    } else if (count >= threshold.warningThreshold) {
      level = 'warning';
      triggeredThreshold = threshold.warningThreshold;
    }

    if (level) {
      await this.triggerAlert(
        level,
        violation.agentType,
        violation.projectId,
        count,
        triggeredThreshold,
        threshold.windowHours,
      );
    }
  }

  /**
   * Set threshold for a specific agent type
   */
  setThreshold(
    agentType: AgentType,
    threshold: number,
    windowHours: number,
  ): void {
    const existing = this.thresholds.get(agentType);

    this.thresholds.set(agentType, {
      agentType,
      warningThreshold: existing?.warningThreshold ?? threshold,
      alertThreshold: threshold,
      criticalThreshold: existing?.criticalThreshold ?? threshold * 2,
      windowHours,
    });
  }

  /**
   * Set full threshold configuration for an agent type
   */
  setFullThreshold(config: AlertThreshold): void {
    this.thresholds.set(config.agentType, config);
  }

  /**
   * Add an alert handler
   */
  addHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove an alert handler
   */
  removeHandler(handler: AlertHandler): boolean {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get threshold for an agent type (or default)
   */
  private getThreshold(agentType: AgentType): AlertThreshold {
    const configured = this.thresholds.get(agentType);
    if (configured) {
      return configured;
    }

    return {
      agentType,
      warningThreshold: this.defaultThresholds.warning,
      alertThreshold: this.defaultThresholds.alert,
      criticalThreshold: this.defaultThresholds.critical,
      windowHours: this.defaultThresholds.windowHours,
    };
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(
    level: AlertLevel,
    agentType: AgentType,
    projectId: string,
    count: number,
    threshold: number,
    windowHours: number,
  ): Promise<void> {
    // Check cooldown — key is agent+project only, so escalations are also suppressed
    const alertKey = `${agentType}:${projectId}`;
    const lastAlert = this.recentAlerts.get(alertKey);

    if (lastAlert && Date.now() - lastAlert.getTime() < this.alertCooldownMs) {
      this.logger?.debug(`Alert on cooldown: ${alertKey}`);
      return;
    }

    // Get recent violations for context
    const violations = await this.violationRecorder.getViolations({
      agentType,
      projectId,
      fromDate: new Date(Date.now() - windowHours * 60 * 60 * 1000),
      limit: 10,
    });

    const alert: ViolationAlert = {
      id: `${alertKey}:${Date.now()}`,
      level,
      agentType,
      projectId,
      violationCount: count,
      threshold,
      windowHours,
      message: this.formatAlertMessage(level, agentType, count, threshold, windowHours),
      timestamp: new Date(),
      violations,
    };

    // Update cooldown
    this.recentAlerts.set(alertKey, new Date());

    // Log the alert
    const logMethod = level === 'critical' ? 'error' : level === 'alert' ? 'warn' : 'info';
    this.logger?.[logMethod](alert.message, {
      level,
      agentType,
      projectId,
      count,
      threshold,
    });

    // Call all handlers
    for (const handler of this.handlers) {
      try {
        await handler(alert);
      } catch (error) {
        this.logger?.error('Alert handler failed', { error, alertId: alert.id });
      }
    }
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(
    level: AlertLevel,
    agentType: AgentType,
    count: number,
    threshold: number,
    windowHours: number,
  ): string {
    const levelPrefix = {
      warning: 'WARNING',
      alert: 'ALERT',
      critical: 'CRITICAL ALERT',
    }[level];

    return `[${levelPrefix}] Agent ${agentType} has ${count} permission violations in the last ${windowHours} hour(s) (threshold: ${threshold})`;
  }

  /**
   * Clear cooldown for testing
   */
  clearCooldown(): void {
    this.recentAlerts.clear();
  }

  /**
   * Get current alert statistics
   */
  getAlertStats(): {
    thresholds: Map<AgentType, AlertThreshold>;
    recentAlertCount: number;
    handlerCount: number;
  } {
    return {
      thresholds: new Map(this.thresholds),
      recentAlertCount: this.recentAlerts.size,
      handlerCount: this.handlers.length,
    };
  }
}

/**
 * Create a violation alerter with the given options
 */
export function createViolationAlerter(
  options: ViolationAlerterOptions,
): ViolationAlerter {
  return new ViolationAlerter(options);
}
