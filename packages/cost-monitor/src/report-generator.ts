/**
 * Report Generator Service
 * Generates cost reports and analytics
 */

import { nanoid } from 'nanoid';
import type {
  ICostStorage,
  CostReport,
  ReportOptions,
  ReportSchedule,
  UsageFilter,
  UsageAggregate,
  LimitPeriod,
} from './types.js';

/**
 * Options for the report generator
 */
export interface ReportGeneratorOptions {
  storage: ICostStorage;
}

/**
 * Report Generator for creating cost reports
 */
export class ReportGenerator {
  private readonly storage: ICostStorage;

  constructor(options: ReportGeneratorOptions) {
    this.storage = options.storage;
  }

  /**
   * Generate a cost report
   */
  async generateReport(options: ReportOptions): Promise<CostReport> {
    const { startDate, endDate } = this.calculateReportPeriod(options);

    const filter: UsageFilter = {
      startDate,
      endDate,
    };

    // Get all usage records for the period
    const records = await this.storage.getUsageRecords(filter);

    // Calculate summary
    const totalCostUsd = records.reduce((sum, r) => sum + r.totalCostUsd, 0);
    const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
    const successfulCalls = records.filter((r) => r.success).length;

    const report: CostReport = {
      id: nanoid(),
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      summary: {
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        totalCalls: records.length,
        totalInputTokens,
        totalOutputTokens,
        avgCostPerCall: records.length > 0 ? Number((totalCostUsd / records.length).toFixed(6)) : 0,
        successRate: records.length > 0 ? successfulCalls / records.length : 0,
      },
    };

    // Add breakdowns if requested
    if (options.includeBreakdown) {
      report.byProvider = await this.storage.aggregateUsage(filter, ['provider']);
      report.byProject = await this.storage.aggregateUsage(filter, ['project']);
      report.byAgentType = await this.storage.aggregateUsage(filter, ['agent_type']);
      report.byModel = await this.storage.aggregateUsage(filter, ['model']);
    }

    // Add trends if requested
    if (options.includeTrends) {
      report.trends = await this.calculateTrends(filter, options.period);
    }

    // Add forecasting if requested
    if (options.includeForecasting) {
      report.forecast = this.calculateForecast(records, options.period);
    }

    // Add recommendations
    report.recommendations = this.generateRecommendations(report);

    return report;
  }

  /**
   * Calculate the report period based on options
   */
  private calculateReportPeriod(options: ReportOptions): { startDate: Date; endDate: Date } {
    if (options.startDate && options.endDate) {
      return { startDate: options.startDate, endDate: options.endDate };
    }

    const now = new Date();
    const endDate = options.endDate ?? now;
    let startDate: Date;

    switch (options.period) {
      case 'daily':
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        break;
      case 'weekly':
        const dayOfWeek = endDate.getDay();
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - dayOfWeek);
        break;
      case 'monthly':
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        break;
      default:
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    }

    return { startDate: options.startDate ?? startDate, endDate };
  }

  /**
   * Calculate usage trends
   */
  private async calculateTrends(
    filter: UsageFilter,
    _period: LimitPeriod
  ): Promise<{
    daily: { date: string; costUsd: number }[];
    weekOverWeek: number;
    monthOverMonth: number;
  }> {
    // Get daily aggregates
    const dailyAggregates = await this.storage.aggregateUsage(filter, ['day']);

    const daily = dailyAggregates.map((agg) => ({
      date: agg.dimensionValue,
      costUsd: agg.totalCostUsd,
    }));

    // Sort by date
    daily.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate week-over-week change
    const weekOverWeek = this.calculatePeriodChange(dailyAggregates, 7);

    // Calculate month-over-month change
    const monthOverMonth = this.calculatePeriodChange(dailyAggregates, 30);

    return { daily, weekOverWeek, monthOverMonth };
  }

  /**
   * Calculate percentage change between periods
   */
  private calculatePeriodChange(aggregates: UsageAggregate[], daysAgo: number): number {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const olderCutoff = new Date(cutoffDate.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    let currentPeriodCost = 0;
    let previousPeriodCost = 0;

    for (const agg of aggregates) {
      const aggDate = new Date(agg.dimensionValue);

      if (aggDate >= cutoffDate && aggDate <= now) {
        currentPeriodCost += agg.totalCostUsd;
      } else if (aggDate >= olderCutoff && aggDate < cutoffDate) {
        previousPeriodCost += agg.totalCostUsd;
      }
    }

    if (previousPeriodCost === 0) {
      return currentPeriodCost > 0 ? 100 : 0;
    }

    return ((currentPeriodCost - previousPeriodCost) / previousPeriodCost) * 100;
  }

  /**
   * Calculate usage forecast
   */
  private calculateForecast(
    records: { totalCostUsd: number; timestamp: Date }[],
    _period: LimitPeriod
  ): {
    projectedMonthEndUsd: number;
    confidence: number;
    budgetStatus: 'under' | 'on_track' | 'over';
  } {
    if (records.length === 0) {
      return {
        projectedMonthEndUsd: 0,
        confidence: 0,
        budgetStatus: 'under',
      };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Calculate days elapsed and total days in month
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)));
    const totalDays = monthEnd.getDate();

    // Calculate current month spending
    const monthRecords = records.filter((r) => r.timestamp >= monthStart);
    const currentMonthCost = monthRecords.reduce((sum, r) => sum + r.totalCostUsd, 0);

    // Simple linear projection
    const dailyRate = currentMonthCost / daysElapsed;
    const projectedMonthEndUsd = dailyRate * totalDays;

    // Confidence based on data points and time elapsed
    const dataPointConfidence = Math.min(1, monthRecords.length / 100);
    const timeConfidence = daysElapsed / totalDays;
    const confidence = (dataPointConfidence + timeConfidence) / 2;

    // Budget status (assuming 80% is on track, anything below is under, above is over)
    // This is simplified - in real implementation, we'd compare against actual budgets
    const budgetStatus: 'under' | 'on_track' | 'over' = 'on_track';

    return {
      projectedMonthEndUsd: Number(projectedMonthEndUsd.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      budgetStatus,
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(report: CostReport): string[] {
    const recommendations: string[] = [];

    // Check for expensive models
    if (report.byModel) {
      const expensiveModels = report.byModel
        .filter((m) => m.totalCalls > 10)
        .sort((a, b) => {
          const avgA = a.totalCostUsd / a.totalCalls;
          const avgB = b.totalCostUsd / b.totalCalls;
          return avgB - avgA;
        });

      if (expensiveModels.length > 0) {
        const topModel = expensiveModels[0];
        if (topModel) {
          const avgCost = topModel.totalCostUsd / topModel.totalCalls;
          if (avgCost > 0.1) {
            recommendations.push(
              `Consider using a cheaper model for ${topModel.dimensionValue} tasks (avg cost: $${avgCost.toFixed(4)}/call)`
            );
          }
        }
      }
    }

    // Check success rate
    if (report.summary.successRate < 0.95 && report.summary.totalCalls > 10) {
      recommendations.push(
        `Success rate is ${(report.summary.successRate * 100).toFixed(1)}%. Investigate failed calls to reduce wasted spend.`
      );
    }

    // Check for high-cost agents
    if (report.byAgentType) {
      const highCostAgents = report.byAgentType
        .filter((a) => a.totalCostUsd > report.summary.totalCostUsd * 0.3)
        .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

      for (const agent of highCostAgents) {
        recommendations.push(
          `The ${agent.dimensionValue} agent accounts for ${((agent.totalCostUsd / report.summary.totalCostUsd) * 100).toFixed(1)}% of costs. Review if this is expected.`
        );
      }
    }

    // Check for caching opportunities
    this.checkCachingOpportunities(report, recommendations);

    // Check for inefficient token usage
    this.checkTokenEfficiency(report, recommendations);

    // Add general recommendations if nothing specific
    if (recommendations.length === 0) {
      if (report.summary.totalCostUsd > 0) {
        recommendations.push('Usage appears normal. Continue monitoring for anomalies.');
      } else {
        recommendations.push('No usage recorded for this period.');
      }
    }

    return recommendations;
  }

  /**
   * Check for caching opportunities based on usage patterns
   */
  private checkCachingOpportunities(report: CostReport, recommendations: string[]): void {
    // Models that support caching (Anthropic Claude models)
    const cachingModels = ['claude-sonnet', 'claude-opus', 'claude-haiku'];

    if (report.byModel) {
      for (const modelAgg of report.byModel) {
        const isCachingSupported = cachingModels.some(m => modelAgg.dimensionValue.includes(m));

        if (isCachingSupported && modelAgg.totalCalls > 20) {
          // High call volume on caching-supported models
          const avgInputTokens = modelAgg.totalInputTokens / modelAgg.totalCalls;

          // If average input is large (>10k tokens), caching could help
          if (avgInputTokens > 10000) {
            const potentialSavings = modelAgg.totalCostUsd * 0.3; // Estimate 30% savings with caching
            recommendations.push(
              `Consider enabling prompt caching for ${modelAgg.dimensionValue}. High input token volume (${Math.round(avgInputTokens).toLocaleString()} avg tokens/call) suggests potential savings of ~$${potentialSavings.toFixed(2)}.`
            );
          }
        }
      }
    }

    // Check for repeated patterns across agent types
    if (report.byAgentType) {
      const highVolumeAgents = report.byAgentType.filter(a => a.totalCalls > 50);
      for (const agent of highVolumeAgents) {
        const avgInputTokens = agent.totalInputTokens / agent.totalCalls;
        if (avgInputTokens > 5000) {
          recommendations.push(
            `The ${agent.dimensionValue} agent has high call volume (${agent.totalCalls} calls) with large prompts. Consider implementing context caching or prompt optimization.`
          );
        }
      }
    }
  }

  /**
   * Check for inefficient token usage patterns
   */
  private checkTokenEfficiency(report: CostReport, recommendations: string[]): void {
    // Check input/output ratio - very low output relative to input may indicate inefficiency
    if (report.summary.totalInputTokens > 0 && report.summary.totalOutputTokens > 0) {
      const ratio = report.summary.totalOutputTokens / report.summary.totalInputTokens;

      // If output is less than 5% of input, might be inefficient
      if (ratio < 0.05 && report.summary.totalCalls > 10) {
        recommendations.push(
          `Low output-to-input token ratio detected (${(ratio * 100).toFixed(1)}%). This may indicate overly large prompts or context. Consider optimizing prompts to reduce input token usage.`
        );
      }
    }

    // Check for models being used for simple tasks
    if (report.byModel && report.byAgentType) {
      const avgOutputPerCall = report.summary.totalOutputTokens / report.summary.totalCalls;

      // If using expensive models for short outputs, suggest cheaper models
      if (avgOutputPerCall < 500) {
        const expensiveModels = report.byModel.filter(m =>
          m.dimensionValue.includes('opus') || m.dimensionValue.includes('gpt-4')
        );

        for (const model of expensiveModels) {
          const modelAvgOutput = model.totalOutputTokens / model.totalCalls;
          if (modelAvgOutput < 500 && model.totalCalls > 5) {
            recommendations.push(
              `${model.dimensionValue} is being used for short responses (avg ${Math.round(modelAvgOutput)} tokens). Consider using a faster, cheaper model like claude-3-5-haiku or gpt-4o-mini for these tasks.`
            );
          }
        }
      }
    }
  }

  /**
   * Format report as CSV
   */
  formatAsCsv(report: CostReport): string {
    const lines: string[] = [];

    // Header
    lines.push('Cost Report');
    lines.push(`Generated,${report.generatedAt.toISOString()}`);
    lines.push(`Period Start,${report.period.start.toISOString()}`);
    lines.push(`Period End,${report.period.end.toISOString()}`);
    lines.push('');

    // Summary
    lines.push('Summary');
    lines.push(`Total Cost (USD),${report.summary.totalCostUsd}`);
    lines.push(`Total Calls,${report.summary.totalCalls}`);
    lines.push(`Total Input Tokens,${report.summary.totalInputTokens}`);
    lines.push(`Total Output Tokens,${report.summary.totalOutputTokens}`);
    lines.push(`Avg Cost Per Call,${report.summary.avgCostPerCall}`);
    lines.push(`Success Rate,${(report.summary.successRate * 100).toFixed(2)}%`);
    lines.push('');

    // Breakdowns
    if (report.byModel && report.byModel.length > 0) {
      lines.push('By Model');
      lines.push('Model,Cost (USD),Calls,Input Tokens,Output Tokens');
      for (const agg of report.byModel) {
        lines.push(`${agg.dimensionValue},${agg.totalCostUsd},${agg.totalCalls},${agg.totalInputTokens},${agg.totalOutputTokens}`);
      }
      lines.push('');
    }

    if (report.byProvider && report.byProvider.length > 0) {
      lines.push('By Provider');
      lines.push('Provider,Cost (USD),Calls,Input Tokens,Output Tokens');
      for (const agg of report.byProvider) {
        lines.push(`${agg.dimensionValue},${agg.totalCostUsd},${agg.totalCalls},${agg.totalInputTokens},${agg.totalOutputTokens}`);
      }
      lines.push('');
    }

    // Recommendations
    if (report.recommendations && report.recommendations.length > 0) {
      lines.push('Recommendations');
      for (const rec of report.recommendations) {
        lines.push(`"${rec}"`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format report as JSON
   */
  formatAsJson(report: CostReport): string {
    return JSON.stringify(report, null, 2);
  }

  // --- Report Scheduling ---

  /**
   * Schedule a recurring report
   */
  async scheduleReport(schedule: Omit<ReportSchedule, 'id'>): Promise<ReportSchedule> {
    const fullSchedule: ReportSchedule = {
      ...schedule,
      id: nanoid(),
    };

    await this.storage.saveReportSchedule(fullSchedule);
    return fullSchedule;
  }

  /**
   * Get all scheduled reports
   */
  async getScheduledReports(): Promise<ReportSchedule[]> {
    return this.storage.getReportSchedules();
  }

  /**
   * Delete a scheduled report
   */
  async deleteScheduledReport(id: string): Promise<void> {
    await this.storage.deleteReportSchedule(id);
  }

  /**
   * Run a scheduled report
   */
  async runScheduledReport(scheduleId: string): Promise<CostReport> {
    const schedules = await this.storage.getReportSchedules();
    const schedule = schedules.find((s) => s.id === scheduleId);

    if (!schedule) {
      throw new Error(`Report schedule ${scheduleId} not found`);
    }

    return this.generateReport(schedule.options);
  }
}
