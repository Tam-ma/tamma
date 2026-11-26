using System.Security.Claims;
using System.Text.Json;
using Tamma.Api.Auth;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.PromptStore;
using Tamma.Core;
using Tamma.Data;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 39-17 (AC6 / D8) — minimal-API handlers for <c>/api/orchestrator/config</c>.
/// Reads require <c>AuthenticatedAny</c>; writes require <c>OrchestratorManage</c>
/// (<c>orchestrator:manage</c> = admin/owner in SaaS; full access for sole user
/// in single-user mode).
/// </summary>
public static class OrchestratorConfigEndpoints
{
    public static IResult GetDefaults() => Results.Ok(OrchestratorAgentDefaults.Config);

    public static async Task<IResult> GetEffective(
        IOrchestratorConfigService service,
        ClaimsPrincipal principal,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        CancellationToken ct)
    {
        try
        {
            if (modeProvider.Mode == TammaMode.SaaS && tenantContext.TenantId is Guid tenantId)
                return Results.Ok(await service.ResolveForTenantAsync(tenantId, ct));

            if (tenantContext.TenantId is null)
                return Results.Ok(new ResolvedOrchestratorConfig(
                    OrchestratorAgentDefaults.Config, "system-default", 1, DateTimeOffset.UtcNow));

            return Results.Ok(await service.ResolveForUserAsync(
                principal.GetUserId(), tenantContext.TenantId, ct));
        }
        catch (TammaError te)
        {
            return Results.BadRequest(new { error = te.Message, code = te.Code });
        }
        catch (JsonException jx)
        {
            return Results.BadRequest(new
            {
                error = "Stored orchestrator configuration JSON is malformed. DELETE /api/orchestrator/config to reset.",
                code = "ORCHESTRATOR.CONFIG.CORRUPT",
                detail = jx.Message,
            });
        }
    }

    public static async Task<IResult> Upsert(
        OrchestratorAgentConfig request,
        IOrchestratorConfigService service,
        ClaimsPrincipal principal,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        CancellationToken ct)
    {
        if (request is null)
            return Results.BadRequest(new { error = "Configuration payload is required.", code = "ORCHESTRATOR.CONFIG.INVALID" });

        var userId = principal.GetUserId();
        try
        {
            if (modeProvider.Mode == TammaMode.SaaS && tenantContext.TenantId is Guid tenantId)
            {
                var saved = await service.UpsertForTenantAsync(tenantId, userId, request, ct);
                return Results.Ok(saved);
            }

            if (userId is null || userId == Guid.Empty)
                return Results.Unauthorized();

            var userSaved = await service.UpsertForUserAsync(userId.Value, tenantContext.TenantId, request, ct);
            return Results.Ok(userSaved);
        }
        catch (TammaError te)
        {
            return Results.BadRequest(new { error = te.Message, code = te.Code });
        }
    }

    public static async Task<IResult> Delete(
        IOrchestratorConfigService service,
        ClaimsPrincipal principal,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        CancellationToken ct)
    {
        var userId = principal.GetUserId();
        bool deleted;
        if (modeProvider.Mode == TammaMode.SaaS && tenantContext.TenantId is Guid tenantId)
        {
            deleted = await service.DeleteForTenantAsync(tenantId, userId, ct);
        }
        else
        {
            if (userId is null || userId == Guid.Empty)
                return Results.Unauthorized();
            deleted = await service.DeleteForUserAsync(userId.Value, tenantContext.TenantId, ct);
        }

        return deleted
            ? Results.Ok(new { message = "Orchestrator configuration reset to defaults." })
            : Results.NotFound(new { error = "Orchestrator configuration override not found." });
    }
}
