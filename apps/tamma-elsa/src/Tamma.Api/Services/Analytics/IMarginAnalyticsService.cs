namespace Tamma.Api.Services.Analytics;

/// <summary>
/// Story 36-7 (AC1, AC2) — tenant-scoped read port for the cost-basis vs margin
/// analytics view.
///
/// <para><b>Boundary (AC2):</b> reads already-persisted <c>CostUsd</c> and
/// <c>PlatformBilledUsd</c> columns from the tenant's Story 36-1 fact tables
/// (<c>analytics_usage_daily</c> / <c>analytics_usage_hourly</c>), whose values
/// were computed by Story 34-5 and persisted by Story 36-2. Implementations
/// MUST NOT recompute pricing, read margin policies, or call the 34-5 pricing
/// namespace.</para>
/// </summary>
public interface IMarginAnalyticsService
{
    /// <summary>
    /// Computes the tenant's profitability view over the half-open UTC window
    /// <c>[fromUtc, toUtc)</c>. Returns a zeroed report (never null, never throws)
    /// when no fact rows exist in the window (AC11).
    /// </summary>
    Task<TenantMarginReport> GetTenantMarginAsync(
        Guid tenantId,
        DateTime fromUtc,
        DateTime toUtc,
        MarginGrain grain = MarginGrain.Day,
        bool emitAuditEvent = true,
        CancellationToken ct = default);
}
