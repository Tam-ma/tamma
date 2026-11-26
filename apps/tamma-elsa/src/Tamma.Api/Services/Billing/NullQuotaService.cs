using Tamma.Core.Billing;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 (AC10) — single-user mode no-op implementation of
/// <see cref="IQuotaService"/>. Every check returns Allowed with zero DB reads
/// and zero DCB events so single-user deployments rely exclusively on local
/// <c>BudgetConfig</c> caps.
/// </summary>
public sealed class NullQuotaService : IQuotaService
{
    private static readonly PlanQuota Unlimited = new(
        PlanSlug: "single-user",
        PlatformTokenAllowance: null,
        TokenOverage: OverageBehavior.AllowWithOverage,
        MaxSeats: null,
        MaxConcurrentWorkflows: null,
        MaxConnectedRepos: null,
        WarnThreshold: 0.8);

    public Task<PlanQuota> GetQuotaAsync(Guid tenantId, CancellationToken ct = default)
        => Task.FromResult(Unlimited);

    public Task<QuotaSnapshotDto> GetQuotaSnapshotAsync(Guid tenantId, CancellationToken ct = default)
        => Task.FromResult(new QuotaSnapshotDto(
            Plan: "single-user",
            Mode: BillingModeTokens.Byok,
            TokenAllowance: null,
            TokensUsed: 0L,
            OverageBehavior: nameof(OverageBehavior.AllowWithOverage),
            SeatsLimit: null,
            SeatsUsed: 1,
            ConcurrentLimit: null,
            ConcurrentUsed: 0,
            ReposLimit: null,
            ReposUsed: 0,
            ResetAt: null));

    public Task<QuotaDecision> CheckTokenQuotaAsync(
        Guid tenantId, string billingMode, long projectedTokens = 0, CancellationToken ct = default)
        => Task.FromResult(QuotaDecision.Allow(QuotaDimension.PlatformTokens));

    public Task<QuotaDecision> CheckConcurrentWorkflowQuotaAsync(Guid tenantId, CancellationToken ct = default)
        => Task.FromResult(QuotaDecision.Allow(QuotaDimension.ConcurrentWorkflows));

    public Task<QuotaDecision> CheckSeatQuotaAsync(Guid tenantId, CancellationToken ct = default)
        => Task.FromResult(QuotaDecision.Allow(QuotaDimension.Seats));

    public Task<QuotaDecision> CheckConnectedRepoQuotaAsync(Guid tenantId, CancellationToken ct = default)
        => Task.FromResult(QuotaDecision.Allow(QuotaDimension.ConnectedRepos));

    public void Invalidate(Guid tenantId)
    {
    }
}
