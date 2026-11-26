namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-3 — non-secret configuration knobs for usage metering, batch meter
/// event flushing, and hourly Stripe reconciliation. Bound from the
/// <c>Billing</c> configuration section (<c>Billing:MeterFlushIntervalSeconds</c>,
/// <c>Billing:ReconcileIntervalMinutes</c>, <c>Billing:DriftToleranceUsd</c>).
/// </summary>
public sealed class BillingUsageOptions
{
    /// <summary>Configuration section name (shared with <see cref="BillingOptions"/>).</summary>
    public const string SectionName = BillingOptions.SectionName;

    /// <summary>Cadence in seconds between <c>billing.meter_flush</c> runs. Default 60s.</summary>
    public int MeterFlushIntervalSeconds { get; set; } = 60;

    /// <summary>Cadence in minutes between <c>billing.usage_reconcile</c> runs. Default 60m (hourly).</summary>
    public int ReconcileIntervalMinutes { get; set; } = 60;

    /// <summary>Maximum allowable USD drift before emitting <c>BILLING.USAGE.RECONCILIATION_MISMATCH</c>.</summary>
    public decimal DriftToleranceUsd { get; set; } = 0.01m;

    /// <summary>Maximum allowable token-count drift before emitting a reconciliation mismatch.</summary>
    public long DriftToleranceTokens { get; set; } = 100L;

    /// <summary>Maximum pending buffer rows flushed per cycle (well under Stripe's 1,000 events/sec limit).</summary>
    public int MeterFlushBatchSize { get; set; } = 200;

    /// <summary>Warn threshold for unreported buffer backlog depth.</summary>
    public int UnreportedBacklogWarnThreshold { get; set; } = 500;
}
