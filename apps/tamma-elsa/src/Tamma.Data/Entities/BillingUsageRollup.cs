namespace Tamma.Data.Entities;

/// <summary>
/// Story 35-3 — control-plane per-tenant per-billing-period usage rollup.
/// Token counts are split by billing mode so only platform-provided tokens
/// become Stripe meter events; BYOK tokens are recorded for analytics only.
///
/// <para>CP-resident (like <see cref="PlatformAnalyticsHourly"/>) so the flush
/// and reconciliation workers answer "what does this tenant owe this period"
/// without per-tenant fan-out. Idempotent upsert keyed by
/// <c>(TenantId, PeriodStart)</c> via
/// <c>UX_billing_usage_rollup_TenantId_PeriodStart</c>.</para>
/// </summary>
public class BillingUsageRollup
{
    /// <summary>Stable surrogate PK (server default <c>gen_random_uuid()</c>).</summary>
    public Guid Id { get; set; }

    /// <summary>Owning tenant — FK to <c>tenants.Id</c> (cascade on tenant purge).</summary>
    public Guid TenantId { get; set; }

    /// <summary>UTC first instant of the billing period (inclusive).</summary>
    public DateTime PeriodStart { get; set; }

    /// <summary>UTC end instant of the billing period (exclusive).</summary>
    public DateTime PeriodEnd { get; set; }

    /// <summary>Billable platform-provided input tokens accumulated in this period.</summary>
    public long PlatformInputTokens { get; set; }

    /// <summary>Billable platform-provided output tokens accumulated in this period.</summary>
    public long PlatformOutputTokens { get; set; }

    /// <summary>BYOK input tokens recorded for analytics only (never billed via Stripe meters).</summary>
    public long ByokInputTokens { get; set; }

    /// <summary>BYOK output tokens recorded for analytics only (never billed via Stripe meters).</summary>
    public long ByokOutputTokens { get; set; }

    /// <summary>Platform cost basis (no markup), 4dp — for ops and margin audit.</summary>
    public decimal PlatformCostUsd { get; set; }

    /// <summary>Platform billable sell amount computed by 34-5's <c>IUsagePricingEngine</c>, 4dp.</summary>
    public decimal BillableAmountUsd { get; set; }

    /// <summary>Last-known seat count (gauge) for the billing period.</summary>
    public int Seats { get; set; }

    /// <summary>Watermark into the source facts so recomputes are incremental and idempotent.</summary>
    public long LastSourceCursor { get; set; }

    /// <summary>UTC timestamp of the last rollup write/recompute.</summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>Navigation to the owning tenant.</summary>
    public Tenant? Tenant { get; set; }
}
