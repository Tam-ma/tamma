/**
 * In-memory implementation of ICostStorage
 * Used for development and testing
 */

import type {
  ICostStorage,
  UsageRecord,
  UsageFilter,
  UsageAggregate,
  UsageLimit,
  CostAlert,
  AlertStatus,
  ReportSchedule,
  GroupByDimension,
} from '../types.js';

/**
 * In-memory storage implementation for cost data
 */
export class InMemoryStore implements ICostStorage {
  private usageRecords: UsageRecord[] = [];
  private limits: Map<string, UsageLimit> = new Map();
  private alerts: Map<string, CostAlert> = new Map();
  private reportSchedules: Map<string, ReportSchedule> = new Map();

  // --- Usage Records ---

  async saveUsageRecord(record: UsageRecord): Promise<void> {
    this.usageRecords.push(record);
  }

  async getUsageRecords(filter: UsageFilter): Promise<UsageRecord[]> {
    return this.usageRecords.filter((record) => this.matchesFilter(record, filter));
  }

  private matchesFilter(record: UsageRecord, filter: UsageFilter): boolean {
    if (filter.startDate && record.timestamp < filter.startDate) {
      return false;
    }
    if (filter.endDate && record.timestamp > filter.endDate) {
      return false;
    }
    if (filter.projectId && record.projectId !== filter.projectId) {
      return false;
    }
    if (filter.engineId && record.engineId !== filter.engineId) {
      return false;
    }
    if (filter.agentType && record.agentType !== filter.agentType) {
      return false;
    }
    if (filter.taskType && record.taskType !== filter.taskType) {
      return false;
    }
    if (filter.provider && record.provider !== filter.provider) {
      return false;
    }
    if (filter.model && record.model !== filter.model) {
      return false;
    }
    if (filter.success !== undefined && record.success !== filter.success) {
      return false;
    }
    return true;
  }

  // --- Limits ---

  async saveLimitConfig(limit: UsageLimit): Promise<void> {
    this.limits.set(limit.id, limit);
  }

  async getLimitConfigs(): Promise<UsageLimit[]> {
    return Array.from(this.limits.values());
  }

  async deleteLimitConfig(id: string): Promise<void> {
    this.limits.delete(id);
  }

  // --- Alerts ---

  async saveAlert(alert: CostAlert): Promise<void> {
    this.alerts.set(alert.id, alert);
  }

  async updateAlert(id: string, updates: Partial<CostAlert>): Promise<void> {
    const existing = this.alerts.get(id);
    if (existing) {
      this.alerts.set(id, { ...existing, ...updates });
    }
  }

  async getAlerts(filter?: { status?: AlertStatus }): Promise<CostAlert[]> {
    const alerts = Array.from(this.alerts.values());
    if (filter?.status) {
      return alerts.filter((alert) => alert.status === filter.status);
    }
    return alerts;
  }

  // --- Report Schedules ---

  async saveReportSchedule(schedule: ReportSchedule): Promise<void> {
    this.reportSchedules.set(schedule.id, schedule);
  }

  async getReportSchedules(): Promise<ReportSchedule[]> {
    return Array.from(this.reportSchedules.values());
  }

  async deleteReportSchedule(id: string): Promise<void> {
    this.reportSchedules.delete(id);
  }

  // --- Aggregation ---

  async aggregateUsage(
    filter: UsageFilter,
    groupBy: GroupByDimension[]
  ): Promise<UsageAggregate[]> {
    const filteredRecords = await this.getUsageRecords(filter);

    if (filteredRecords.length === 0) {
      return [];
    }

    // Group records by dimension(s)
    const groups = new Map<string, UsageRecord[]>();

    for (const record of filteredRecords) {
      const key = this.getGroupKey(record, groupBy);
      const existing = groups.get(key) || [];
      existing.push(record);
      groups.set(key, existing);
    }

    // Calculate aggregates for each group
    const aggregates: UsageAggregate[] = [];

    for (const [key, records] of groups) {
      const totalCostUsd = records.reduce((sum, r) => sum + r.totalCostUsd, 0);
      const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
      const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
      const successfulCalls = records.filter((r) => r.success).length;
      const totalLatency = records.reduce((sum, r) => sum + r.latencyMs, 0);

      const timestamps = records.map((r) => r.timestamp.getTime());
      const minTimestamp = Math.min(...timestamps);
      const maxTimestamp = Math.max(...timestamps);

      aggregates.push({
        dimension: groupBy[0] ?? 'all',
        dimensionValue: key,
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        totalInputTokens,
        totalOutputTokens,
        totalCalls: records.length,
        successRate: records.length > 0 ? successfulCalls / records.length : 0,
        avgLatencyMs: records.length > 0 ? totalLatency / records.length : 0,
        period: {
          start: new Date(minTimestamp),
          end: new Date(maxTimestamp),
        },
      });
    }

    return aggregates;
  }

  private getGroupKey(record: UsageRecord, groupBy: GroupByDimension[]): string {
    const parts: string[] = [];

    for (const dimension of groupBy) {
      switch (dimension) {
        case 'provider':
          parts.push(record.provider);
          break;
        case 'model':
          parts.push(record.model);
          break;
        case 'project':
          parts.push(record.projectId);
          break;
        case 'agent_type':
          parts.push(record.agentType);
          break;
        case 'task_type':
          parts.push(record.taskType);
          break;
        case 'hour':
          parts.push(this.formatDateHour(record.timestamp));
          break;
        case 'day':
          parts.push(this.formatDateDay(record.timestamp));
          break;
        case 'week':
          parts.push(this.formatDateWeek(record.timestamp));
          break;
        case 'month':
          parts.push(this.formatDateMonth(record.timestamp));
          break;
      }
    }

    return parts.join('|') || 'all';
  }

  private formatDateHour(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}`;
  }

  private formatDateDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private formatDateWeek(date: Date): string {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
  }

  private formatDateMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  // --- Persistence (file-based for MVP) ---

  async flush(): Promise<void> {
    // No-op for in-memory store
    // Override in file-based implementation
  }

  async load(): Promise<void> {
    // No-op for in-memory store
    // Override in file-based implementation
  }

  // --- Helper Methods for Testing ---

  clear(): void {
    this.usageRecords = [];
    this.limits.clear();
    this.alerts.clear();
    this.reportSchedules.clear();
  }

  getRecordCount(): number {
    return this.usageRecords.length;
  }

  getLimitCount(): number {
    return this.limits.size;
  }

  getAlertCount(): number {
    return this.alerts.size;
  }
}
