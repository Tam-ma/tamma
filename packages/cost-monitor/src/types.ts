/**
 * Type definitions for the LLM Cost Monitoring & Reporting system
 * @tamma/cost-monitor
 */

// --- Provider and Agent Types ---

/**
 * LLM Provider identifiers
 */
export type Provider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'local'
  | 'claude-code';

/**
 * Agent types in the Tamma system
 */
export type AgentType =
  | 'scrum_master'
  | 'architect'
  | 'researcher'
  | 'analyst'
  | 'planner'
  | 'implementer'
  | 'reviewer'
  | 'tester'
  | 'documenter';

/**
 * Task types for categorization
 */
export type TaskType =
  | 'analysis'
  | 'planning'
  | 'implementation'
  | 'review'
  | 'testing'
  | 'documentation'
  | 'research';

// --- Usage Records ---

/**
 * Individual usage record for a single LLM call
 */
export interface UsageRecord {
  id: string;
  timestamp: Date;

  // Context
  projectId: string;
  engineId: string;
  agentType: AgentType;
  taskId: string;
  taskType: TaskType;

  // Provider details
  provider: Provider;
  model: string;

  // Usage metrics
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;

  // Cost
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;

  // Metadata
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  traceId?: string;
}

/**
 * Input for creating a usage record (without auto-generated fields)
 */
export type UsageRecordInput = Omit<UsageRecord, 'id' | 'timestamp' | 'inputCostUsd' | 'outputCostUsd' | 'totalCostUsd'>;

/**
 * Aggregated usage data
 */
export interface UsageAggregate {
  dimension: string;
  dimensionValue: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * Filter criteria for usage queries
 */
export interface UsageFilter {
  startDate?: Date;
  endDate?: Date;
  projectId?: string;
  engineId?: string;
  agentType?: AgentType;
  taskType?: TaskType;
  provider?: Provider;
  model?: string;
  success?: boolean;
}

/**
 * Grouping dimension for aggregation
 */
export type GroupByDimension =
  | 'provider'
  | 'model'
  | 'project'
  | 'agent_type'
  | 'task_type'
  | 'hour'
  | 'day'
  | 'week'
  | 'month';

// --- Pricing Types ---

/**
 * Pricing tier for different usage patterns
 */
export type PricingTier = 'standard' | 'batch' | 'cached';

/**
 * Pricing for a specific model
 */
export interface ModelPricing {
  inputPer1MTokens: number;   // USD per 1M input tokens
  outputPer1MTokens: number;  // USD per 1M output tokens
  contextWindow: number;       // Maximum context size
  tier?: PricingTier;
  cacheReadPer1MTokens?: number;
  cacheWritePer1MTokens?: number;
}

/**
 * Provider pricing configuration
 */
export interface ProviderPricing {
  models: Record<string, ModelPricing>;
  defaultModel: string;
}

/**
 * Complete pricing configuration
 */
export interface PricingConfig {
  providers: Partial<Record<Provider, ProviderPricing>>;
  lastUpdated: Date;
  currency: string;
}

// --- Limit Types ---

/**
 * Scope for usage limits
 */
export type LimitScope =
  | 'global'
  | 'project'
  | 'provider'
  | 'agent_type'
  | 'model';

/**
 * Time period for limits
 */
export type LimitPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Action to take when limit is reached
 */
export type LimitAction = 'warn' | 'throttle' | 'block';

/**
 * Usage limit definition
 */
export interface UsageLimit {
  id: string;
  name: string;
  scope: LimitScope;
  scopeId?: string;  // Project ID, provider name, etc.

  period: LimitPeriod;
  limitUsd: number;

  softThreshold: number;  // e.g., 0.7 for 70%
  hardThreshold: number;  // e.g., 1.0 for 100%

  action: LimitAction;
  enabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a usage limit
 */
export type UsageLimitInput = Omit<UsageLimit, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Context for checking limits
 */
export interface LimitContext {
  projectId?: string;
  provider?: Provider;
  agentType?: AgentType;
  model?: string;
  estimatedCostUsd?: number;
}

/**
 * Result of a limit check
 */
export interface LimitCheckResult {
  allowed: boolean;
  currentUsageUsd: number;
  limitUsd: number;
  percentUsed: number;
  warnings: string[];
  triggeredLimits: UsageLimit[];
  recommendedAction: 'proceed' | 'use_cheaper_model' | 'wait' | 'abort';
  suggestedAlternatives?: {
    model: string;
    estimatedSavings: number;
  }[];
}

// --- Alert Types ---

/**
 * Types of cost alerts
 */
export type CostAlertType =
  | 'limit_approaching'    // Soft threshold reached
  | 'limit_warning'        // Hard threshold imminent
  | 'limit_exceeded'       // Hard threshold exceeded
  | 'spending_spike'       // Unusual increase detected
  | 'rate_limit_errors'    // Provider rate limits hit
  | 'cost_anomaly';        // Statistical anomaly

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Alert status
 */
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

/**
 * Alert delivery channel
 */
export type AlertChannel = 'cli' | 'webhook' | 'email' | 'slack';

/**
 * Cost alert definition
 */
export interface CostAlert {
  id: string;
  type: CostAlertType;
  severity: AlertSeverity;

  // Context
  scope: LimitScope;
  scopeId?: string;

  // Details
  message: string;
  currentValue: number;
  threshold: number;

  // Status
  status: AlertStatus;
  createdAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;

  // Delivery
  deliveredTo: AlertChannel[];
  deliveryErrors?: Partial<Record<AlertChannel, string>>;
}

/**
 * Alert channel configuration
 */
export interface AlertChannelConfig {
  type: AlertChannel;
  enabled: boolean;
  url?: string;        // For webhook
  channel?: string;    // For Slack
  recipients?: string[]; // For email
}

// --- Report Types ---

/**
 * Report format options
 */
export type ReportFormat = 'json' | 'csv';

/**
 * Report options
 */
export interface ReportOptions {
  period: LimitPeriod;
  startDate?: Date;
  endDate?: Date;
  groupBy?: GroupByDimension[];
  includeBreakdown: boolean;
  includeTrends: boolean;
  includeForecasting: boolean;
  format: ReportFormat;
}

/**
 * Report schedule configuration
 */
export interface ReportSchedule {
  id: string;
  name: string;
  cron: string;        // Cron expression
  options: ReportOptions;
  recipients: string[];
  enabled: boolean;
}

/**
 * Generated cost report
 */
export interface CostReport {
  id: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };

  // Summary
  summary: {
    totalCostUsd: number;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgCostPerCall: number;
    successRate: number;
  };

  // Breakdowns
  byProvider?: UsageAggregate[];
  byProject?: UsageAggregate[];
  byAgentType?: UsageAggregate[];
  byModel?: UsageAggregate[];

  // Trends
  trends?: {
    daily: { date: string; costUsd: number }[];
    weekOverWeek: number; // Percentage change
    monthOverMonth: number;
  };

  // Forecasting
  forecast?: {
    projectedMonthEndUsd: number;
    confidence: number;
    budgetStatus: 'under' | 'on_track' | 'over';
  };

  // Optimization
  recommendations?: string[];
}

// --- Service Interfaces ---

/**
 * Cost estimation request
 */
export interface CostEstimateRequest {
  provider: Provider;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

/**
 * Cost estimation result
 */
export interface CostEstimate {
  provider: Provider;
  model: string;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  alternatives?: {
    model: string;
    provider: Provider;
    totalCostUsd: number;
    savings: number;
  }[];
}

/**
 * Main cost tracker service interface
 */
export interface ICostTracker {
  // Tracking
  recordUsage(usage: UsageRecordInput): Promise<UsageRecord>;

  // Queries
  getUsage(filter: UsageFilter): Promise<UsageRecord[]>;
  getAggregate(
    filter: UsageFilter,
    groupBy: GroupByDimension[]
  ): Promise<UsageAggregate[]>;

  // Limits
  checkLimit(context: LimitContext): Promise<LimitCheckResult>;
  setLimit(limit: UsageLimitInput): Promise<UsageLimit>;
  updateLimit(id: string, updates: Partial<UsageLimit>): Promise<UsageLimit>;
  deleteLimit(id: string): Promise<void>;
  getLimits(): Promise<UsageLimit[]>;

  // Alerts
  getAlerts(filter?: { status?: AlertStatus; severity?: AlertSeverity }): Promise<CostAlert[]>;
  acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void>;
  resolveAlert(alertId: string): Promise<void>;

  // Reports
  generateReport(options: ReportOptions): Promise<CostReport>;
  scheduleReport(schedule: Omit<ReportSchedule, 'id'>): Promise<ReportSchedule>;
  getScheduledReports(): Promise<ReportSchedule[]>;
  deleteScheduledReport(id: string): Promise<void>;

  // Estimation
  estimateCost(request: CostEstimateRequest): Promise<CostEstimate>;

  // Configuration
  updatePricing(config: Partial<PricingConfig>): Promise<void>;
  getPricing(): Promise<PricingConfig>;

  // Lifecycle
  dispose(): Promise<void>;
}

/**
 * Storage interface for cost data
 */
export interface ICostStorage {
  // Usage records
  saveUsageRecord(record: UsageRecord): Promise<void>;
  getUsageRecords(filter: UsageFilter): Promise<UsageRecord[]>;

  // Limits
  saveLimitConfig(limit: UsageLimit): Promise<void>;
  getLimitConfigs(): Promise<UsageLimit[]>;
  deleteLimitConfig(id: string): Promise<void>;

  // Alerts
  saveAlert(alert: CostAlert): Promise<void>;
  updateAlert(id: string, updates: Partial<CostAlert>): Promise<void>;
  getAlerts(filter?: { status?: AlertStatus }): Promise<CostAlert[]>;

  // Reports
  saveReportSchedule(schedule: ReportSchedule): Promise<void>;
  getReportSchedules(): Promise<ReportSchedule[]>;
  deleteReportSchedule(id: string): Promise<void>;

  // Aggregation queries
  aggregateUsage(
    filter: UsageFilter,
    groupBy: GroupByDimension[]
  ): Promise<UsageAggregate[]>;

  // Persistence
  flush(): Promise<void>;
  load(): Promise<void>;
}
