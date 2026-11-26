using Microsoft.AspNetCore.Mvc;
using Tamma.Api.Services.Analytics;
using Tamma.Data;

namespace Tamma.Api.Endpoints.Analytics;

/// <summary>
/// Story 36-7 (AC6, AC9, AC10) — tenant-scoped gross-margin analytics endpoint:
/// <c>GET /api/v1/orgs/{tenantId}/analytics/margin</c> (<c>MemberAccess</c>).
///
/// <para>Resolves the acting tenant strictly from <see cref="ITenantContext.TenantId"/>
/// (SaaS JWT claim or single-user sole tenant). A cross-tenant route
/// <c>{tenantId}</c> returns <c>404 Not Found</c> so tenant A can never read or
/// probe tenant B's margin.</para>
/// </summary>
public static class MarginAnalyticsEndpoints
{
    private const int MaxRangeDays = 365;

    public static async Task<IResult> GetTenantMargin(
        Guid tenantId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? grain,
        ITenantContext tenantContext,
        IMarginAnalyticsService marginAnalytics,
        TimeProvider timeProvider,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var log = loggerFactory.CreateLogger("Tamma.Api.Endpoints.Analytics.MarginAnalyticsEndpoints");

        if (tenantContext.TenantId is not Guid callerTenantId || callerTenantId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        // Strict tenant scoping (AC6): cross-tenant request returns 404.
        if (callerTenantId != tenantId)
        {
            log.LogWarning(
                "Cross-tenant margin request rejected with 404: callerTenantId={CallerTenantId} routeTenantId={RouteTenantId}",
                callerTenantId, tenantId);
            return Results.NotFound(new { error = "Organization not found." });
        }

        if (!MarginGrainExtensions.TryParse(grain, out var parsedGrain))
        {
            return Results.BadRequest(new { error = "grain must be one of: day, month" });
        }

        var (ok, fromUtc, toUtc, error) = ResolveWindow(from, to, timeProvider);
        if (!ok)
        {
            return Results.BadRequest(new { error });
        }

        var report = await marginAnalytics.GetTenantMarginAsync(
            callerTenantId,
            fromUtc,
            toUtc,
            parsedGrain,
            emitAuditEvent: true,
            ct);

        return Results.Ok(report);
    }

    internal static (bool Ok, DateTime FromUtc, DateTime ToUtc, string? Error) ResolveWindow(
        DateTime? from,
        DateTime? to,
        TimeProvider timeProvider)
    {
        var nowUtc = timeProvider.GetUtcNow().UtcDateTime;
        var monthStart = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var nextMonthStart = monthStart.AddMonths(1);

        var effectiveFrom = NormalizeUtc(from ?? monthStart);
        var effectiveTo = NormalizeUtc(to ?? nextMonthStart);

        if (effectiveFrom >= effectiveTo)
        {
            return (false, effectiveFrom, effectiveTo, "from must be strictly earlier than to");
        }

        if ((effectiveTo - effectiveFrom) > TimeSpan.FromDays(MaxRangeDays))
        {
            return (false, effectiveFrom, effectiveTo, $"window cannot exceed {MaxRangeDays} days");
        }

        return (true, effectiveFrom, effectiveTo, null);
    }

    private static DateTime NormalizeUtc(DateTime dt) => dt.Kind switch
    {
        DateTimeKind.Utc => dt,
        DateTimeKind.Local => dt.ToUniversalTime(),
        _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc),
    };
}
