using Microsoft.EntityFrameworkCore;
using Tamma.Api.Authorization;
using Tamma.Api.Services.Billing;
using Tamma.Core.Billing;
using Tamma.Data;

namespace Tamma.Api.Endpoints.Billing;

/// <summary>
/// Story 35-6 (AC4, AC11, AC12) — quota observability and engine token-quota
/// endpoints:
/// <list type="bullet">
///   <item><c>GET /api/v1/admin/quota/{tenantId:guid}</c> — SaaS-only,
///     <c>PlatformOwnerAccess</c>, full resolved limits + usage snapshot.</item>
///   <item><c>GET /api/v1/orgs/{tenantId:guid}/quota</c> — SaaS-only,
///     <c>MemberAccess</c> + <see cref="RequireTenantMembershipFilter"/>,
///     same read-only snapshot scoped strictly to the caller's tenant.</item>
///   <item><c>GET /api/v1/billing/quota/{tenantId:guid}/token</c> — engine-callable
///     token-quota gate consumed by <c>TammaApiClient.GetTokenQuotaAsync</c>.</item>
/// </list>
/// </summary>
public static class QuotaEndpoints
{
    public static IEndpointRouteBuilder MapQuotaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/admin/quota/{tenantId:guid}", GetAdminQuota)
            .RequireAuthorization("PlatformOwnerAccess");

        app.MapGet("/api/v1/orgs/{tenantId:guid}/quota", GetOrgQuota)
            .RequireAuthorization("MemberAccess")
            .AddEndpointFilter<RequireTenantMembershipFilter>();

        return app;
    }

    public static IEndpointRouteBuilder MapEngineTokenQuotaEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/billing/quota/{tenantId:guid}/token", GetEngineTokenQuota)
            .RequireAuthorization();

        return app;
    }

    internal static async Task<IResult> GetAdminQuota(
        Guid tenantId,
        IQuotaService quota,
        ControlPlaneDbContext cp,
        CancellationToken ct)
    {
        var exists = await cp.Tenants
            .AsNoTracking()
            .AnyAsync(t => t.Id == tenantId, ct)
            .ConfigureAwait(false);
        if (!exists)
        {
            return Results.NotFound(new { error = "tenant_not_found" });
        }

        var snapshot = await quota.GetQuotaSnapshotAsync(tenantId, ct).ConfigureAwait(false);
        return Results.Ok(snapshot);
    }

    internal static async Task<IResult> GetOrgQuota(
        Guid tenantId,
        IQuotaService quota,
        CancellationToken ct)
    {
        var snapshot = await quota.GetQuotaSnapshotAsync(tenantId, ct).ConfigureAwait(false);
        return Results.Ok(snapshot);
    }

    internal static async Task<IResult> GetEngineTokenQuota(
        Guid tenantId,
        IQuotaService quota,
        ControlPlaneDbContext cp,
        CancellationToken ct)
    {
        var rawMode = await cp.BillingCustomers
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .Select(c => c.BillingMode)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        var billingMode = string.Equals(rawMode, nameof(BillingMode.Byok), StringComparison.OrdinalIgnoreCase)
            ? BillingModeTokens.Byok
            : BillingModeTokens.Platform;

        var decision = await quota
            .CheckTokenQuotaAsync(tenantId, billingMode, projectedTokens: 0, ct)
            .ConfigureAwait(false);

        return Results.Ok(new
        {
            allowed = decision.Allowed,
            which_quota = decision.WhichQuota.ToWire(),
            limit = decision.Limit,
            used = decision.Used,
            reset_at = decision.ResetAt?.UtcDateTime.ToString("O"),
            http_status = decision.HttpStatus,
        });
    }
}
