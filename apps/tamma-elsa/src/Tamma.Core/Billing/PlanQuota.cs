namespace Tamma.Core.Billing;

/// <summary>
/// Story 35-6 — behaviour when a tenant exhausts its period platform-token
/// allowance. Free tiers <see cref="HardBlock"/> (HTTP 402); paid tiers
/// <see cref="AllowWithOverage"/> so Story 35-3 meters and bills overage usage.
/// </summary>
public enum OverageBehavior
{
    /// <summary>Reject further platform-provided LLM calls once the allowance is exhausted.</summary>
    HardBlock,

    /// <summary>Allow calls past the allowance; Story 35-3 meters overage spend.</summary>
    AllowWithOverage,
}

/// <summary>
/// Story 35-6 — effective per-period quota resolved for a tenant from its active
/// subscription and plan catalog (<c>Plan.Quotas</c> JSON + <c>PlanEntitlement</c>
/// children). A <c>null</c> limit means unlimited for that dimension.
/// </summary>
public sealed record PlanQuota(
    string PlanSlug,
    long? PlatformTokenAllowance,
    OverageBehavior TokenOverage,
    int? MaxSeats,
    int? MaxConcurrentWorkflows,
    int? MaxConnectedRepos,
    double WarnThreshold = 0.8)
{
    /// <summary>
    /// Conservative free-tier fallback used when <c>Plan.Quotas</c> JSON is
    /// malformed — fail-closed, never silently unlimited.
    /// </summary>
    public static PlanQuota FreeDefault(double warnThreshold = 0.8) => new(
        PlanSlug: "free",
        PlatformTokenAllowance: 100_000L,
        TokenOverage: OverageBehavior.HardBlock,
        MaxSeats: 1,
        MaxConcurrentWorkflows: 1,
        MaxConnectedRepos: 1,
        WarnThreshold: warnThreshold);
}
