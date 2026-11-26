namespace Tamma.Api.Services.Analytics;

/// <summary>
/// Story 36-7 (AC12) — DCB event constant(s) emitted by the cost-basis vs margin
/// analytics read view. Follows the <c>AGGREGATE.ACTION.STATUS</c> convention.
/// No <c>PRICING.*</c> events are ever emitted by this story (those are owned
/// by Story 34-5).
/// </summary>
public static class MarginAnalyticsEvents
{
    /// <summary>
    /// Best-effort read-audit event emitted whenever a tenant or platform margin
    /// view is queried. Tagged <c>{ scope, tenantId?, from, to, grain }</c>.
    /// </summary>
    public const string MarginViewed = "ANALYTICS.MARGIN.VIEWED";
}

/// <summary>
/// Trend aggregation grain for the Story 36-7 margin view.
/// </summary>
public enum MarginGrain
{
    /// <summary>Daily (UTC midnight) buckets — or hourly buckets when querying a sub-day window.</summary>
    Day,

    /// <summary>Calendar-month (UTC first-of-month midnight) buckets rolled up from daily rows.</summary>
    Month,
}

/// <summary>
/// Wire-format helpers for <see cref="MarginGrain"/>.
/// </summary>
public static class MarginGrainExtensions
{
    public static string ToWire(this MarginGrain grain) => grain switch
    {
        MarginGrain.Day => "day",
        MarginGrain.Month => "month",
        _ => "day",
    };

    /// <summary>
    /// Parses <c>grain</c> query parameter. Absent defaults to <see cref="MarginGrain.Day"/>;
    /// any unrecognized non-empty value returns <c>false</c> so the endpoint responds 400.
    /// </summary>
    public static bool TryParse(string? raw, out MarginGrain grain)
    {
        grain = MarginGrain.Day;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return true;
        }

        switch (raw.Trim().ToLowerInvariant())
        {
            case "day":
                grain = MarginGrain.Day;
                return true;
            case "month":
                grain = MarginGrain.Month;
                return true;
            default:
                return false;
        }
    }
}

/// <summary>
/// Story 36-7 (AC1, AC11) — top-level profitability summary for a window.
///
/// <para><b>Read-only contract (AC2):</b> <see cref="RevenueUsd"/> is the pure sum of
/// persisted <c>PlatformBilledUsd</c> (computed upstream by Story 34-5 and persisted by
/// Story 36-2), <see cref="CostUsd"/> is the pure sum of persisted <c>CostUsd</c>, and
/// <see cref="MarginUsd"/> = <see cref="RevenueUsd"/> − <see cref="CostUsd"/>. Nothing
/// is recomputed in this view.</para>
/// </summary>
public sealed record MarginSummary(
    decimal CostUsd,
    decimal RevenueUsd,
    decimal MarginUsd,
    decimal MarginPct,
    DateTime GeneratedAt)
{
    /// <summary>
    /// Zeroed constant for empty / pre-projection windows (AC11 — never null, never throws).
    /// </summary>
    public static MarginSummary Empty { get; } = new(0m, 0m, 0m, 0m, DateTime.UnixEpoch);

    /// <summary>
    /// Returns a zeroed summary stamped with <paramref name="generatedAtUtc"/>.
    /// </summary>
    public static MarginSummary EmptyAt(DateTime generatedAtUtc) =>
        new(0m, 0m, 0m, 0m, generatedAtUtc);

    /// <summary>
    /// Derives <see cref="MarginUsd"/> and <see cref="MarginPct"/> strictly from summed
    /// cost and revenue (4dp away-from-zero; <see cref="MarginPct"/> is 0 when revenue is 0).
    /// </summary>
    public static MarginSummary From(decimal cost, decimal revenue, DateTime generatedAtUtc)
    {
        var c = MarginMath.Round4(cost);
        var r = MarginMath.Round4(revenue);
        var m = MarginMath.Round4(r - c);
        return new MarginSummary(c, r, m, MarginMath.ComputeMarginPct(m, r), generatedAtUtc);
    }
}

/// <summary>
/// Story 36-7 (AC3, AC4) — per-dimension profitability slice.
///
/// <para><b>Reconciliation guarantee:</b> <see cref="Key"/> is <c>null</c> for
/// unattributed fact rows — never coerced to a sentinel and never dropped — so
/// <c>Σ(rows for a dimension) == Summary</c>. Revenue is persisted
/// <c>PlatformBilledUsd</c>, cost is persisted <c>CostUsd</c>, and margin is
/// <c>revenue − cost</c>; nothing is recomputed.</para>
/// </summary>
public sealed record MarginBreakdownRow(
    string Dimension,
    string? Key,
    decimal CostUsd,
    decimal RevenueUsd,
    decimal MarginUsd,
    decimal MarginPct)
{
    public static MarginBreakdownRow From(string dimension, string? key, decimal cost, decimal revenue)
    {
        var c = MarginMath.Round4(cost);
        var r = MarginMath.Round4(revenue);
        var m = MarginMath.Round4(r - c);
        return new MarginBreakdownRow(dimension, key, c, r, m, MarginMath.ComputeMarginPct(m, r));
    }
}

/// <summary>
/// Story 36-7 (AC5) — single UTC time bucket in a profitability trend series.
/// Revenue is persisted <c>PlatformBilledUsd</c>, cost is persisted <c>CostUsd</c>,
/// and margin is <c>revenue − cost</c>; nothing is recomputed.
/// </summary>
public sealed record MarginTrendPoint(
    DateTime Bucket,
    decimal CostUsd,
    decimal RevenueUsd,
    decimal MarginUsd,
    decimal MarginPct)
{
    public static MarginTrendPoint From(DateTime bucketUtc, decimal cost, decimal revenue)
    {
        var c = MarginMath.Round4(cost);
        var r = MarginMath.Round4(revenue);
        var m = MarginMath.Round4(r - c);
        return new MarginTrendPoint(bucketUtc, c, r, m, MarginMath.ComputeMarginPct(m, r));
    }
}

/// <summary>
/// Story 36-7 (AC1, AC3, AC5, AC6, AC11) — tenant-scoped cost-basis vs gross-margin report.
/// Revenue is persisted <c>PlatformBilledUsd</c>, cost is persisted <c>CostUsd</c>,
/// and margin is <c>revenue − cost</c>; nothing is recomputed.
/// </summary>
public sealed record TenantMarginReport(
    Guid TenantId,
    DateTime FromUtc,
    DateTime ToUtc,
    string Grain,
    MarginSummary Summary,
    IReadOnlyList<MarginBreakdownRow> Breakdowns,
    IReadOnlyList<MarginTrendPoint> Trend);

internal static class MarginMath
{
    internal static decimal Round4(decimal value) =>
        Math.Round(value, 4, MidpointRounding.AwayFromZero);

    internal static decimal ComputeMarginPct(decimal margin, decimal revenue) =>
        revenue == 0m ? 0m : Math.Round(margin / revenue, 4, MidpointRounding.AwayFromZero);
}
