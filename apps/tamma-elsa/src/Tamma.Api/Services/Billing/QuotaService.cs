using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Tamma.Core.Billing;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 — SaaS EF-backed implementation of <see cref="IQuotaService"/>.
///
/// <para>Reads ONLY local control-plane and tenant tables (never Stripe
/// synchronously — AC6):</para>
/// <list type="bullet">
///   <item>Token usage: <c>BillingUsageRollup</c> (Story 35-3) for the current
///     period (platform tokens only; BYOK short-circuits before any DB read).</item>
///   <item>Seats: <c>TenantMemberships</c> on the control plane.</item>
///   <item>Connected repos: active <c>GitHubInstallationRepos</c> owned by the
///     tenant's installations on the control plane.</item>
///   <item>Concurrent workflows: in-flight (<c>running</c>/<c>pending</c>)
///     <c>WorkflowInstance</c> rows in the tenant's schema.</item>
/// </list>
/// </summary>
public sealed class QuotaService : IQuotaService
{
    private readonly ControlPlaneDbContext _cp;
    private readonly ITenantDbContextFactory? _tenantDbFactory;
    private readonly QuotaResolver _resolver;
    private readonly QuotaNotifier _notifier;
    private readonly TimeProvider _clock;
    private readonly ILogger<QuotaService> _logger;

    public QuotaService(
        ControlPlaneDbContext cp,
        QuotaResolver resolver,
        QuotaNotifier notifier,
        TimeProvider clock,
        ILogger<QuotaService> logger,
        ITenantDbContextFactory? tenantDbFactory = null)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(resolver);
        ArgumentNullException.ThrowIfNull(notifier);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _resolver = resolver;
        _notifier = notifier;
        _clock = clock;
        _logger = logger;
        _tenantDbFactory = tenantDbFactory;
    }

    /// <inheritdoc />
    public Task<PlanQuota> GetQuotaAsync(Guid tenantId, CancellationToken ct = default)
        => _resolver.ResolveAsync(tenantId, ct);

    /// <inheritdoc />
    public void Invalidate(Guid tenantId) => _resolver.Invalidate(tenantId);

    /// <inheritdoc />
    public async Task<QuotaDecision> CheckTokenQuotaAsync(
        Guid tenantId, string billingMode, long projectedTokens = 0, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
        {
            return QuotaDecision.Allow(QuotaDimension.PlatformTokens);
        }

        // AC3 — BYOK tenants are NEVER blocked on token volume: short-circuit
        // before any rollup, dunning, or plan DB read.
        if (IsByok(billingMode))
        {
            return QuotaDecision.Allow(QuotaDimension.PlatformTokens);
        }

        // Story 35-8 (AC8): if the tenant is in billing-suspended dunning stage,
        // hard-block platform-provided LLM calls with reason "billing_suspended".
        var isSuspended = await _cp.BillingDunningStates
            .AsNoTracking()
            .AnyAsync(d => d.TenantId == tenantId && d.Stage == DunningStages.Suspended, ct)
            .ConfigureAwait(false);
        if (isSuspended)
        {
            _logger.LogWarning(
                "Token quota hard-blocked due to billing suspension tenantId={TenantId}",
                tenantId);
            return QuotaDecision.Deny(
                QuotaDimension.PlatformTokens,
                limit: 0,
                used: 0,
                resetAt: null,
                httpStatus: StatusCodes.Status402PaymentRequired,
                reason: "billing_suspended");
        }

        var quota = await _resolver.ResolveAsync(tenantId, ct).ConfigureAwait(false);
        if (quota.PlatformTokenAllowance is not long allowance)
        {
            return QuotaDecision.Allow(QuotaDimension.PlatformTokens);
        }

        var period = await ResolveCurrentPeriodAsync(tenantId, ct).ConfigureAwait(false);
        var rollup = await _cp.BillingUsageRollups
            .AsNoTracking()
            .FirstOrDefaultAsync(
                r => r.TenantId == tenantId && r.PeriodStart == period.StartUtc, ct)
            .ConfigureAwait(false);

        var used = (rollup?.PlatformInputTokens ?? 0L) + (rollup?.PlatformOutputTokens ?? 0L);
        var projected = used + Math.Max(0L, projectedTokens);
        var resetAt = new DateTimeOffset(period.EndUtc, TimeSpan.Zero);

        if (projected >= allowance)
        {
            await _notifier.NotifyAsync(
                tenantId, QuotaDimension.PlatformTokens, QuotaNotifier.LevelExceeded,
                quota.PlanSlug, BillingModeTokens.Platform, period.StartUtc,
                used, allowance, quota.TokenOverage, ct).ConfigureAwait(false);

            if (quota.TokenOverage == OverageBehavior.HardBlock)
            {
                _logger.LogWarning(
                    "Token quota hard-blocked tenantId={TenantId} plan={Plan} used={Used} limit={Limit}",
                    tenantId, quota.PlanSlug, used, allowance);
                return QuotaDecision.Deny(
                    QuotaDimension.PlatformTokens, allowance, used, resetAt, StatusCodes.Status402PaymentRequired);
            }

            // Paid tier (AllowWithOverage): allow call; Story 35-3 meters overage.
            return QuotaDecision.Allow(QuotaDimension.PlatformTokens, allowance, used, resetAt);
        }

        var warnAt = (long)Math.Ceiling(allowance * quota.WarnThreshold);
        if (allowance > 0 && projected >= warnAt)
        {
            await _notifier.NotifyAsync(
                tenantId, QuotaDimension.PlatformTokens, QuotaNotifier.LevelWarn,
                quota.PlanSlug, BillingModeTokens.Platform, period.StartUtc,
                used, allowance, quota.TokenOverage, ct).ConfigureAwait(false);
        }

        return QuotaDecision.Allow(QuotaDimension.PlatformTokens, allowance, used, resetAt);
    }

    /// <inheritdoc />
    public async Task<QuotaDecision> CheckConcurrentWorkflowQuotaAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
        {
            return QuotaDecision.Allow(QuotaDimension.ConcurrentWorkflows);
        }

        var quota = await _resolver.ResolveAsync(tenantId, ct).ConfigureAwait(false);
        if (quota.MaxConcurrentWorkflows is not int limit)
        {
            return QuotaDecision.Allow(QuotaDimension.ConcurrentWorkflows);
        }

        var active = await CountActiveWorkflowsAsync(tenantId, ct).ConfigureAwait(false);
        var period = await ResolveCurrentPeriodAsync(tenantId, ct).ConfigureAwait(false);
        var mode = await ResolveBillingModeTokenAsync(tenantId, ct).ConfigureAwait(false);

        return await EvaluateCapAsync(
            tenantId, QuotaDimension.ConcurrentWorkflows, quota, mode, period.StartUtc, active, limit, ct)
            .ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<QuotaDecision> CheckSeatQuotaAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
        {
            return QuotaDecision.Allow(QuotaDimension.Seats);
        }

        var quota = await _resolver.ResolveAsync(tenantId, ct).ConfigureAwait(false);
        if (quota.MaxSeats is not int limit)
        {
            return QuotaDecision.Allow(QuotaDimension.Seats);
        }

        var used = await _cp.TenantMemberships
            .AsNoTracking()
            .CountAsync(m => m.TenantId == tenantId, ct)
            .ConfigureAwait(false);

        var period = await ResolveCurrentPeriodAsync(tenantId, ct).ConfigureAwait(false);
        var mode = await ResolveBillingModeTokenAsync(tenantId, ct).ConfigureAwait(false);

        return await EvaluateCapAsync(
            tenantId, QuotaDimension.Seats, quota, mode, period.StartUtc, used, limit, ct)
            .ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<QuotaDecision> CheckConnectedRepoQuotaAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
        {
            return QuotaDecision.Allow(QuotaDimension.ConnectedRepos);
        }

        var quota = await _resolver.ResolveAsync(tenantId, ct).ConfigureAwait(false);
        if (quota.MaxConnectedRepos is not int limit)
        {
            return QuotaDecision.Allow(QuotaDimension.ConnectedRepos);
        }

        var used = await CountConnectedReposAsync(tenantId, ct).ConfigureAwait(false);
        var period = await ResolveCurrentPeriodAsync(tenantId, ct).ConfigureAwait(false);
        var mode = await ResolveBillingModeTokenAsync(tenantId, ct).ConfigureAwait(false);

        return await EvaluateCapAsync(
            tenantId, QuotaDimension.ConnectedRepos, quota, mode, period.StartUtc, used, limit, ct)
            .ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<QuotaSnapshotDto> GetQuotaSnapshotAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        var quota = await _resolver.ResolveAsync(tenantId, ct).ConfigureAwait(false);
        var mode = await ResolveBillingModeTokenAsync(tenantId, ct).ConfigureAwait(false);
        var period = await ResolveCurrentPeriodAsync(tenantId, ct).ConfigureAwait(false);

        var rollup = await _cp.BillingUsageRollups
            .AsNoTracking()
            .FirstOrDefaultAsync(
                r => r.TenantId == tenantId && r.PeriodStart == period.StartUtc, ct)
            .ConfigureAwait(false);

        var tokensUsed = (rollup?.PlatformInputTokens ?? 0L) + (rollup?.PlatformOutputTokens ?? 0L);
        var seatsUsed = await _cp.TenantMemberships
            .AsNoTracking()
            .CountAsync(m => m.TenantId == tenantId, ct)
            .ConfigureAwait(false);
        var concurrentUsed = await CountActiveWorkflowsAsync(tenantId, ct).ConfigureAwait(false);
        var reposUsed = await CountConnectedReposAsync(tenantId, ct).ConfigureAwait(false);

        return new QuotaSnapshotDto(
            Plan: quota.PlanSlug,
            Mode: mode,
            TokenAllowance: quota.PlatformTokenAllowance,
            TokensUsed: tokensUsed,
            OverageBehavior: quota.TokenOverage.ToString(),
            SeatsLimit: quota.MaxSeats,
            SeatsUsed: seatsUsed,
            ConcurrentLimit: quota.MaxConcurrentWorkflows,
            ConcurrentUsed: concurrentUsed,
            ReposLimit: quota.MaxConnectedRepos,
            ReposUsed: reposUsed,
            ResetAt: period.EndUtc.ToString("O"));
    }

    private async Task<QuotaDecision> EvaluateCapAsync(
        Guid tenantId,
        QuotaDimension dimension,
        PlanQuota quota,
        string mode,
        DateTime periodStartUtc,
        long used,
        long limit,
        CancellationToken ct)
    {
        if (used >= limit)
        {
            await _notifier.NotifyAsync(
                tenantId, dimension, QuotaNotifier.LevelExceeded,
                quota.PlanSlug, mode, periodStartUtc, used, limit, OverageBehavior.HardBlock, ct)
                .ConfigureAwait(false);

            return QuotaDecision.Deny(
                dimension, limit, used, resetAt: null, StatusCodes.Status429TooManyRequests);
        }

        var warnAt = (long)Math.Ceiling(limit * quota.WarnThreshold);
        if (limit > 0 && used >= warnAt)
        {
            await _notifier.NotifyAsync(
                tenantId, dimension, QuotaNotifier.LevelWarn,
                quota.PlanSlug, mode, periodStartUtc, used, limit, OverageBehavior.HardBlock, ct)
                .ConfigureAwait(false);
        }

        return QuotaDecision.Allow(dimension, limit, used);
    }

    private async Task<BillingPeriod> ResolveCurrentPeriodAsync(Guid tenantId, CancellationToken ct)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var sub = await _cp.BillingSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId
                        && s.Status != "canceled"
                        && s.Status != "incomplete_expired")
            .OrderByDescending(s => s.UpdatedAt)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        return UsageMeteringService.ResolveCurrentPeriod(sub, now);
    }

    private async Task<string> ResolveBillingModeTokenAsync(Guid tenantId, CancellationToken ct)
    {
        var raw = await _cp.BillingCustomers
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .Select(c => c.BillingMode)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        return string.Equals(raw, nameof(BillingMode.Byok), StringComparison.OrdinalIgnoreCase) ||
               string.Equals(raw, BillingModeTokens.Byok, StringComparison.OrdinalIgnoreCase)
            ? BillingModeTokens.Byok
            : BillingModeTokens.Platform;
    }

    private async Task<int> CountActiveWorkflowsAsync(Guid tenantId, CancellationToken ct)
    {
        if (_tenantDbFactory is null)
        {
            return 0;
        }

        await using var tenantDb = await _tenantDbFactory
            .CreateAsync(tenantId, ct)
            .ConfigureAwait(false);

        return await tenantDb.WorkflowInstances
            .AsNoTracking()
            .CountAsync(
                w => w.Status == "running" || w.Status == "pending",
                ct)
            .ConfigureAwait(false);
    }

    private async Task<int> CountConnectedReposAsync(Guid tenantId, CancellationToken ct) =>
        await _cp.GitHubInstallationRepos
            .AsNoTracking()
            .CountAsync(
                r => r.IsActive && r.Installation.TenantId == tenantId,
                ct)
            .ConfigureAwait(false);

    private static bool IsByok(string? billingMode) =>
        string.Equals(billingMode, BillingModeTokens.Byok, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(billingMode, nameof(BillingMode.Byok), StringComparison.OrdinalIgnoreCase);
}
