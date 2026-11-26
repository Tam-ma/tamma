using Tamma.Api.Infrastructure;
using Tamma.Api.Services.Pricing;
using Tamma.Core.Actions;

namespace Tamma.Api.Endpoints.Admin;

/// <summary>
/// Story 34-10 (AC10, AC12) — platform-owner admin trigger to re-run the
/// idempotent pricing backfill (<c>POST /api/admin/pricing/backfill</c>).
/// Born <c>.Governs</c>-bound to the machinery catalog member
/// <c>effect:pricing.backfill.run</c>.
/// </summary>
public static class AdminPricingBackfillEndpoint
{
    public static IEndpointRouteBuilder MapAdminPricingBackfillEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/admin/pricing/backfill", Run)
            .RequireAuthorization("PlatformOwnerAccess")
            .Governs(new ActionKey(ActionNamespace.Effect, ExternalEffect.PricingBackfillRun.ToWire()));

        return app;
    }

    internal static async Task<IResult> Run(
        IPricingBackfillService backfill,
        CancellationToken ct)
    {
        try
        {
            var report = await backfill.RunAsync(BackfillTrigger.Admin, ct).ConfigureAwait(false);
            return Results.Ok(report);
        }
        catch (PricingBackfillInProgressException)
        {
            return Results.Conflict(new { error = "backfill_in_progress" });
        }
    }
}
