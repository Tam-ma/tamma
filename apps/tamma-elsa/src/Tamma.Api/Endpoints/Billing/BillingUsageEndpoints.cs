using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PromptStore;
using Tamma.Data;

namespace Tamma.Api.Endpoints.Billing;

/// <summary>
/// Story 35-3 (AC8, AC12, AC13) — current-period usage endpoint:
/// <c>GET /api/v1/billing/usage</c>. Mounted in SaaS mode only; reads from the
/// local control-plane <c>billing_usage_rollup</c> table (never Stripe, which
/// lags). Resolves the caller's tenant strictly from ambient
/// <see cref="ITenantContext"/> (never a route parameter) so a tenant cannot
/// read another tenant's usage.
/// </summary>
public static class BillingUsageEndpoints
{
    public static IEndpointRouteBuilder MapBillingUsageEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/billing/usage", GetCurrentUsage)
            .RequireAuthorization("MemberAccess");
        return app;
    }

    internal static async Task<IResult> GetCurrentUsage(
        IUsageMeteringService metering,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        CancellationToken ct)
    {
        if (modeProvider.Mode != TammaMode.SaaS)
        {
            return Results.NotFound(new { error = "billing_saas_only" });
        }

        if (tenantContext.TenantId is not Guid tenantId || tenantId == Guid.Empty)
        {
            return Results.NotFound(new { error = "no_active_tenant" });
        }

        var summary = await metering.GetCurrentUsageAsync(tenantId, ct).ConfigureAwait(false);
        return Results.Ok(summary);
    }
}
