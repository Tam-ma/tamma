namespace Tamma.Data.Entities;

/// <summary>
/// Story 35-6 (AC13) — control-plane deduplication ledger ensuring
/// <c>BILLING.QUOTA.WARN</c> and <c>BILLING.QUOTA.EXCEEDED</c> DCB events are
/// emitted at most once per <c>(TenantId, WhichQuota, PeriodStart, Level)</c>.
/// A unique index <c>IX_quota_notifications_dedup</c> enforces idempotency
/// even under concurrent hot-loop LLM requests.
/// </summary>
public class QuotaNotification
{
    /// <summary>Stable surrogate PK (server default <c>gen_random_uuid()</c>).</summary>
    public Guid Id { get; set; }

    /// <summary>Owning tenant — FK to <c>tenants.Id</c> (cascade on tenant purge).</summary>
    public Guid TenantId { get; set; }

    /// <summary>Canonical quota dimension wire key (<c>platform_tokens</c>, <c>concurrent_workflows</c>, <c>seats</c>, <c>connected_repos</c>).</summary>
    public string WhichQuota { get; set; } = null!;

    /// <summary>UTC billing-period start (or calendar-day/month anchor for cap checks).</summary>
    public DateTime PeriodStart { get; set; }

    /// <summary>Threshold level (<c>warn</c> | <c>exceeded</c>), pinned by a CHECK constraint.</summary>
    public string Level { get; set; } = null!;

    /// <summary>UTC creation timestamp.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Navigation to the owning tenant.</summary>
    public Tenant? Tenant { get; set; }
}
