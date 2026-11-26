using Tamma.Core.Billing;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 — BYOK-aware plan quota and usage-limit enforcement service.
/// In SaaS mode backed by <see cref="QuotaService"/> (local CP/tenant rollups +
/// short-TTL cache, never calling Stripe synchronously); in single-user mode
/// backed by <see cref="NullQuotaService"/> (every check returns Allowed).
/// </summary>
public interface IQuotaService
{
    /// <summary>Resolve the effective <see cref="PlanQuota"/> for a tenant (cached, &lt;= 100ms).</summary>
    Task<PlanQuota> GetQuotaAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Return full resolved quota limits and live usage counters for admin/org observability.</summary>
    Task<QuotaSnapshotDto> GetQuotaSnapshotAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Gate a platform-provided LLM call. BYOK (<c>billingMode == "byok"</c>)
    /// short-circuits to Allowed with zero rollup reads. HardBlock over
    /// allowance denies with HTTP 402; AllowWithOverage permits so 35-3 meters
    /// overage. Emits deduped WARN/EXCEEDED DCB events.
    /// </summary>
    Task<QuotaDecision> CheckTokenQuotaAsync(
        Guid tenantId, string billingMode, long projectedTokens = 0, CancellationToken ct = default);

    /// <summary>Gate workflow dispatch on the tenant's concurrent-workflow cap (HTTP 429).</summary>
    Task<QuotaDecision> CheckConcurrentWorkflowQuotaAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Gate member invite on the tenant's seat cap (HTTP 429).</summary>
    Task<QuotaDecision> CheckSeatQuotaAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Gate repo connection on the tenant's connected-repo cap (HTTP 429).</summary>
    Task<QuotaDecision> CheckConnectedRepoQuotaAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Evict cached <see cref="PlanQuota"/> for <paramref name="tenantId"/> immediately on subscription/seat/mode change.</summary>
    void Invalidate(Guid tenantId);
}
