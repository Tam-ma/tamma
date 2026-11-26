using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Analytics;

/// <summary>
/// Story 36-7 (AC1–AC5, AC11, AC12) — tenant-scoped cost-basis vs gross-margin
/// read service over the Story 36-1 per-tenant fact tables
/// (<c>analytics_usage_daily</c> for whole-day windows; <c>analytics_usage_hourly</c>
/// for sub-day windows).
///
/// <para><b>Strict read-only / no-recompute boundary (AC2):</b>
/// <c>PlatformBilledUsd</c> is owned by <b>Story 34-5</b> (Cost→Price Markup Engine)
/// and persisted once at projection time by <b>Story 36-2</b> (Dimensional Analytics
/// Projection). This service performs ONLY summation and subtraction
/// (<c>Σ PlatformBilledUsd − Σ CostUsd</c>) over those stored columns and takes
/// ZERO dependency on the Story 34-5 pricing namespace, margin policies, rate sheets,
/// or secret cabinets.</para>
/// </summary>
public sealed class MarginAnalyticsService : IMarginAnalyticsService
{
    public const string DimensionProvider = "provider";
    public const string DimensionAgent = "agent";
    public const string DimensionWorkflow = "workflow";
    public const string DimensionCostBasis = "costBasis";

    private readonly ITenantDbContextFactory _tenantDbFactory;
    private readonly IEventRepository? _events;
    private readonly TimeProvider _clock;
    private readonly ILogger<MarginAnalyticsService> _logger;

    public MarginAnalyticsService(
        ITenantDbContextFactory tenantDbFactory,
        IEventRepository? events,
        TimeProvider clock,
        ILogger<MarginAnalyticsService> logger)
    {
        _tenantDbFactory = tenantDbFactory ?? throw new ArgumentNullException(nameof(tenantDbFactory));
        _events = events;
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <inheritdoc />
    public async Task<TenantMarginReport> GetTenantMarginAsync(
        Guid tenantId,
        DateTime fromUtc,
        DateTime toUtc,
        MarginGrain grain = MarginGrain.Day,
        bool emitAuditEvent = true,
        CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var now = _clock.GetUtcNow().UtcDateTime;
        var normFrom = EnsureUtc(fromUtc);
        var normTo = EnsureUtc(toUtc);
        var grainWire = grain.ToWire();

        if (normTo <= normFrom)
        {
            if (emitAuditEvent)
            {
                await TryEmitViewedAsync(tenantId, normFrom, normTo, grainWire, now, ct).ConfigureAwait(false);
            }

            return new TenantMarginReport(
                tenantId,
                normFrom,
                normTo,
                grainWire,
                MarginSummary.EmptyAt(now),
                Array.Empty<MarginBreakdownRow>(),
                Array.Empty<MarginTrendPoint>());
        }

        // Daily grain for whole-day (or multi-day) windows; hourly only for sub-day windows (AC1).
        var useHourly = (normTo - normFrom) < TimeSpan.FromDays(1);
        _logger.LogDebug(
            "Margin query source selected: tenantId={TenantId} source={Source} from={From:o} to={To:o} grain={Grain}",
            tenantId, useHourly ? "hourly" : "daily", normFrom, normTo, grainWire);

        List<MarginFactRow> rows;
        try
        {
            await using var db = await _tenantDbFactory.CreateAsync(tenantId, ct).ConfigureAwait(false);
            rows = useHourly
                ? await LoadHourlyAsync(db, normFrom, normTo, ct).ConfigureAwait(false)
                : await LoadDailyAsync(db, normFrom, normTo, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(
                ex,
                "Tenant margin read failed: tenantId={TenantId} from={From:o} to={To:o} grain={Grain}",
                tenantId, normFrom, normTo, grainWire);
            throw;
        }

        if (rows.Count == 0)
        {
            _logger.LogInformation(
                "Margin query served (empty): scope=tenant tenantId={TenantId} from={From:o} to={To:o} grain={Grain} rowsRead=0 costUsd=0 revenueUsd=0 marginUsd=0 durationMs={DurationMs}",
                tenantId, normFrom, normTo, grainWire, sw.ElapsedMilliseconds);

            if (emitAuditEvent)
            {
                await TryEmitViewedAsync(tenantId, normFrom, normTo, grainWire, now, ct).ConfigureAwait(false);
            }

            return new TenantMarginReport(
                tenantId,
                normFrom,
                normTo,
                grainWire,
                MarginSummary.EmptyAt(now),
                Array.Empty<MarginBreakdownRow>(),
                Array.Empty<MarginTrendPoint>());
        }

        decimal totalCost = 0m;
        decimal totalRevenue = 0m;
        foreach (var row in rows)
        {
            totalCost += row.CostUsd;
            totalRevenue += row.PlatformBilledUsd;
        }

        var summary = MarginSummary.From(totalCost, totalRevenue, now);

        // Per-dimension breakdowns (AC3, AC4) — NULL keys preserved, never coerced or dropped.
        var byProvider = BuildBreakdown(rows, DimensionProvider, r => r.Provider);
        var byAgent = BuildBreakdown(rows, DimensionAgent, r => r.AgentId);
        var byWorkflow = BuildBreakdown(rows, DimensionWorkflow, r => r.WorkflowDefinitionId?.ToString("D"));
        var byCostBasis = BuildBreakdown(rows, DimensionCostBasis, r => FormatCostBasis(r.CostBasis));

        var breakdowns = new List<MarginBreakdownRow>(
            byProvider.Count + byAgent.Count + byWorkflow.Count + byCostBasis.Count);
        breakdowns.AddRange(byProvider);
        breakdowns.AddRange(byAgent);
        breakdowns.AddRange(byWorkflow);
        breakdowns.AddRange(byCostBasis);

        // Trend series (AC5) — lossless rollup to daily (or hourly on sub-day) or monthly buckets.
        var trend = BuildTrend(rows, grain, useHourly);

        _logger.LogDebug(
            "Margin breakdown sizes: tenantId={TenantId} providers={Providers} agents={Agents} workflows={Workflows} costBases={CostBases} trendBuckets={TrendBuckets}",
            tenantId, byProvider.Count, byAgent.Count, byWorkflow.Count, byCostBasis.Count, trend.Count);

        _logger.LogInformation(
            "Margin query served: scope=tenant tenantId={TenantId} from={From:o} to={To:o} grain={Grain} rowsRead={RowsRead} costUsd={CostUsd} revenueUsd={RevenueUsd} marginUsd={MarginUsd} durationMs={DurationMs}",
            tenantId, normFrom, normTo, grainWire, rows.Count,
            summary.CostUsd, summary.RevenueUsd, summary.MarginUsd, sw.ElapsedMilliseconds);

        if (emitAuditEvent)
        {
            await TryEmitViewedAsync(tenantId, normFrom, normTo, grainWire, now, ct).ConfigureAwait(false);
        }

        return new TenantMarginReport(
            tenantId,
            normFrom,
            normTo,
            grainWire,
            summary,
            breakdowns,
            trend);
    }

    private static async Task<List<MarginFactRow>> LoadDailyAsync(
        TenantDbContext db, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
    {
        return await db.AnalyticsUsageDaily
            .AsNoTracking()
            .Where(r => r.Day >= fromUtc && r.Day < toUtc)
            .Select(r => new MarginFactRow(
                r.Day,
                r.Provider,
                r.AgentId,
                r.WorkflowDefinitionId,
                r.CostBasis,
                r.CostUsd,
                r.PlatformBilledUsd))
            .ToListAsync(ct)
            .ConfigureAwait(false);
    }

    private static async Task<List<MarginFactRow>> LoadHourlyAsync(
        TenantDbContext db, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
    {
        return await db.AnalyticsUsageHourly
            .AsNoTracking()
            .Where(r => r.Hour >= fromUtc && r.Hour < toUtc)
            .Select(r => new MarginFactRow(
                r.Hour,
                r.Provider,
                r.AgentId,
                r.WorkflowDefinitionId,
                r.CostBasis,
                r.CostUsd,
                r.PlatformBilledUsd))
            .ToListAsync(ct)
            .ConfigureAwait(false);
    }

    private static List<MarginBreakdownRow> BuildBreakdown(
        List<MarginFactRow> rows,
        string dimension,
        Func<MarginFactRow, string?> keySelector)
    {
        return rows
            .GroupBy(keySelector)
            .OrderBy(g => g.Key is null ? 1 : 0)
            .ThenBy(g => g.Key, StringComparer.Ordinal)
            .Select(g =>
            {
                decimal cost = 0m;
                decimal revenue = 0m;
                foreach (var item in g)
                {
                    cost += item.CostUsd;
                    revenue += item.PlatformBilledUsd;
                }

                return MarginBreakdownRow.From(dimension, g.Key, cost, revenue);
            })
            .ToList();
    }

    private static List<MarginTrendPoint> BuildTrend(
        List<MarginFactRow> rows, MarginGrain grain, bool useHourly)
    {
        return rows
            .GroupBy(r => BucketFor(r.Timestamp, grain, useHourly))
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                decimal cost = 0m;
                decimal revenue = 0m;
                foreach (var item in g)
                {
                    cost += item.CostUsd;
                    revenue += item.PlatformBilledUsd;
                }

                return MarginTrendPoint.From(g.Key, cost, revenue);
            })
            .ToList();
    }

    private static DateTime BucketFor(DateTime ts, MarginGrain grain, bool useHourly)
    {
        var utc = EnsureUtc(ts);
        if (grain == MarginGrain.Month)
        {
            return new DateTime(utc.Year, utc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        }

        if (useHourly)
        {
            return new DateTime(utc.Year, utc.Month, utc.Day, utc.Hour, 0, 0, DateTimeKind.Utc);
        }

        return new DateTime(utc.Year, utc.Month, utc.Day, 0, 0, 0, DateTimeKind.Utc);
    }

    private static string FormatCostBasis(CostBasis basis) => basis switch
    {
        CostBasis.Byok => "byok",
        CostBasis.Platform => "platform",
        _ => basis.ToString().ToLowerInvariant(),
    };

    private static DateTime EnsureUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    private async Task TryEmitViewedAsync(
        Guid tenantId,
        DateTime fromUtc,
        DateTime toUtc,
        string grain,
        DateTime now,
        CancellationToken ct)
    {
        if (_events is null)
        {
            return;
        }

        try
        {
            var evt = new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = MarginAnalyticsEvents.MarginViewed,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, string?>
                {
                    ["scope"] = "tenant",
                    ["tenantId"] = tenantId.ToString("D"),
                    ["from"] = fromUtc.ToString("O"),
                    ["to"] = toUtc.ToString("O"),
                    ["grain"] = grain,
                }),
                Data = JsonSerializer.Serialize(new
                {
                    scope = "tenant",
                    tenantId = tenantId.ToString("D"),
                    from = fromUtc,
                    to = toUtc,
                    grain,
                }),
                Metadata = """{"workflowVersion":"1.0.0","eventSource":"system"}""",
                CreatedAt = now,
            };

            await _events.AppendAsync(evt).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex,
                "ANALYTICS.MARGIN.VIEWED emit failed (best-effort, swallowed): scope=tenant tenantId={TenantId}",
                tenantId);
        }
    }

    private readonly record struct MarginFactRow(
        DateTime Timestamp,
        string? Provider,
        string? AgentId,
        Guid? WorkflowDefinitionId,
        CostBasis CostBasis,
        decimal CostUsd,
        decimal PlatformBilledUsd);
}
