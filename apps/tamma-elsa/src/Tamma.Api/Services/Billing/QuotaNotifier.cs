using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tamma.Core.Billing;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 (AC7, AC13) — deduplicates <c>BILLING.QUOTA.WARN</c> and
/// <c>BILLING.QUOTA.EXCEEDED</c> emissions via the <c>quota_notifications</c>
/// CP ledger keyed by <c>(TenantId, WhichQuota, PeriodStart, Level)</c>.
/// Guarantees at-most-once emission per period even under hot concurrent loops.
/// </summary>
public sealed class QuotaNotifier
{
    public const string LevelWarn = "warn";
    public const string LevelExceeded = "exceeded";

    private readonly ControlPlaneDbContext _cp;
    private readonly IEventRepository _events;
    private readonly TimeProvider _clock;
    private readonly ILogger<QuotaNotifier> _logger;

    public QuotaNotifier(
        ControlPlaneDbContext cp,
        IEventRepository events,
        TimeProvider clock,
        ILogger<QuotaNotifier> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _events = events;
        _clock = clock;
        _logger = logger;
    }

    /// <summary>
    /// Record a threshold crossing if not already recorded for this
    /// <c>(tenantId, dimension, periodStartUtc, level)</c>, and emit the
    /// corresponding DCB event. Returns <c>true</c> if this call emitted the
    /// event, or <c>false</c> if it was deduplicated.
    /// </summary>
    public async Task<bool> NotifyAsync(
        Guid tenantId,
        QuotaDimension dimension,
        string level,
        string planSlug,
        string billingMode,
        DateTime periodStartUtc,
        long used,
        long limit,
        OverageBehavior overageBehavior,
        CancellationToken ct = default)
    {
        var whichQuota = dimension.ToWire();
        var periodStart = periodStartUtc.Kind == DateTimeKind.Utc
            ? periodStartUtc
            : DateTime.SpecifyKind(periodStartUtc, DateTimeKind.Utc);
        var now = _clock.GetUtcNow().UtcDateTime;

        // Fast-path check avoids throwing on common hot-loop repeat crossings.
        var alreadyRecorded = await _cp.QuotaNotifications
            .AsNoTracking()
            .AnyAsync(
                n => n.TenantId == tenantId
                     && n.WhichQuota == whichQuota
                     && n.PeriodStart == periodStart
                     && n.Level == level,
                ct)
            .ConfigureAwait(false);
        if (alreadyRecorded)
        {
            return false;
        }

        var row = new QuotaNotification
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            WhichQuota = whichQuota,
            PeriodStart = periodStart,
            Level = level,
            CreatedAt = now,
        };

        _cp.QuotaNotifications.Add(row);
        try
        {
            await _cp.SaveChangesAsync(ct).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            // Concurrent writer won the dedup key — detach and no-op cleanly.
            _cp.Entry(row).State = EntityState.Detached;
            return false;
        }

        var evt = level == LevelExceeded
            ? QuotaEvents.BuildExceeded(
                tenantId, dimension, planSlug, billingMode, periodStart, used, limit, overageBehavior, now)
            : QuotaEvents.BuildWarn(
                tenantId, dimension, planSlug, billingMode, periodStart, used, limit, now);

        await _events.AppendAsync(evt).ConfigureAwait(false);

        _logger.LogInformation(
            "Quota threshold event emitted: type={EventType} tenantId={TenantId} whichQuota={WhichQuota} "
            + "plan={Plan} mode={BillingMode} used={Used} limit={Limit}",
            evt.Type, tenantId, whichQuota, planSlug, billingMode, used, limit);

        return true;
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException pg && pg.SqlState == PostgresErrorCodes.UniqueViolation;
}
