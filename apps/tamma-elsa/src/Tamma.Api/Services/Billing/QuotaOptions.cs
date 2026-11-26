namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 — non-secret configuration knobs for plan quota enforcement.
/// Bound from <c>Billing:Quota</c>.
/// </summary>
public sealed class QuotaOptions
{
    public const string SectionName = "Billing:Quota";

    /// <summary>Fraction of a quota limit at which <c>BILLING.QUOTA.WARN</c> fires (0..1). Default 0.8 (80%).</summary>
    public double WarnThreshold { get; set; } = 0.8;

    /// <summary>Per-tenant resolved <see cref="Tamma.Core.Billing.PlanQuota"/> cache TTL in seconds. Default 60s.</summary>
    public int CacheTtlSeconds { get; set; } = 60;
}
