/**
 * @tamma/cost-monitor
 * LLM Cost Monitoring & Reporting for the Tamma platform
 */

// Types
export type {
  // Provider and Agent Types
  Provider,
  AgentType,
  TaskType,

  // Usage Records
  UsageRecord,
  UsageRecordInput,
  UsageAggregate,
  UsageFilter,
  GroupByDimension,

  // Pricing
  PricingTier,
  ModelPricing,
  ProviderPricing,
  PricingConfig,

  // Limits
  LimitScope,
  LimitPeriod,
  LimitAction,
  UsageLimit,
  UsageLimitInput,
  LimitContext,
  LimitCheckResult,

  // Alerts
  CostAlertType,
  AlertSeverity,
  AlertStatus,
  AlertChannel,
  CostAlert,
  AlertChannelConfig,

  // Reports
  ReportFormat,
  ReportOptions,
  ReportSchedule,
  CostReport,

  // Service Interfaces
  CostEstimateRequest,
  CostEstimate,
  ICostTracker,
  ICostStorage,
} from './types.js';

// Core Services
export { CostCalculator } from './cost-calculator.js';
export { UsageTracker } from './usage-tracker.js';
export type { UsageTrackerOptions } from './usage-tracker.js';
export { LimitManager } from './limit-manager.js';
export type { LimitManagerOptions } from './limit-manager.js';
export { AlertManager } from './alert-manager.js';
export type { AlertManagerOptions, AlertDeliveryHandler } from './alert-manager.js';
export { ReportGenerator } from './report-generator.js';
export type { ReportGeneratorOptions } from './report-generator.js';

// Main Service
export { CostTracker, createCostTracker } from './cost-tracker.js';
export type { CostTrackerOptions } from './cost-tracker.js';

// Storage
export { InMemoryStore } from './storage/in-memory-store.js';
export { FileStore, createFileStore } from './storage/file-store.js';

// Pricing Configuration
export {
  DEFAULT_PRICING_CONFIG,
  getModelPricing,
  calculateCost,
  getAvailableModels,
  findCheaperAlternatives,
  CURRENCY_RATES,
  convertCurrency,
  formatCost,
  getSupportedCurrencies,
} from './pricing-config.js';
export type { SupportedCurrency } from './pricing-config.js';
