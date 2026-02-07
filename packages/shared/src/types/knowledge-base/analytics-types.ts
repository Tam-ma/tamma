/**
 * Analytics & Reporting Types
 *
 * Types for knowledge base analytics, quality metrics, and cost analysis.
 */

/** Usage analytics for a time period */
export interface UsageAnalytics {
  period: { start: string; end: string };
  totalQueries: number;
  totalTokensRetrieved: number;
  avgLatencyMs: number;
  sourceBreakdown: Record<string, SourceUsage>;
}

/** Usage details per source */
export interface SourceUsage {
  queries: number;
  tokensRetrieved: number;
  avgLatencyMs: number;
  cacheHitRate: number;
}

/** Quality analytics for a time period */
export interface QualityAnalytics {
  period: { start: string; end: string };
  totalFeedback: number;
  relevanceRate: number;
  avgRelevanceScore: number;
  topPerformingSources: string[];
  improvementTrend: number;
}

/** Cost analytics for a time period */
export interface CostAnalytics {
  period: { start: string; end: string };
  totalCostUsd: number;
  embeddingCostUsd: number;
  indexingCostUsd: number;
  breakdown: CostBreakdownItem[];
}

/** Cost breakdown for a single category */
export interface CostBreakdownItem {
  category: string;
  costUsd: number;
  units: number;
  unitCostUsd: number;
}

/** Analytics period filter */
export interface AnalyticsPeriodFilter {
  start: string;
  end: string;
}
