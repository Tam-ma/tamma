/**
 * Knowledge Base Analytics Service Contract
 *
 * Defines the interface for usage, quality, and cost analytics.
 */

import type {
  UsageAnalytics,
  QualityAnalytics,
  CostAnalytics,
  AnalyticsPeriodFilter,
} from '../../types/knowledge-base/analytics-types.js';

export interface IKBAnalyticsService {
  getUsageAnalytics(period: AnalyticsPeriodFilter): Promise<UsageAnalytics>;
  getQualityAnalytics(period: AnalyticsPeriodFilter): Promise<QualityAnalytics>;
  getCostAnalytics(period: AnalyticsPeriodFilter): Promise<CostAnalytics>;
}
