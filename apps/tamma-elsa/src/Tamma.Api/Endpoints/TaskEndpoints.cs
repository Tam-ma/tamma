using System.Security.Claims;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Tasks;
using Tamma.Data;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 39-19 (AC3 / AC4 / D7 / D9) — read-only Task View inbox endpoints:
/// <list type="bullet">
///   <item><c>GET /api/tasks</c> — lists tasks visible to the authenticated user
///     (enforced server-side via Story 39-20's <c>ITaskAudienceResolver</c>).</item>
///   <item><c>GET /api/tasks/{sessionId:guid}</c> — detail for one task visible
///     to the authenticated user (404 when absent or outside the user's scope).</item>
/// </list>
///
/// <para>Task actions NEVER live here: acting on a task posts directly to Story 39-8's
/// idempotent <c>POST /api/documents/decisions/{sessionId}/resume</c> (D8).</para>
/// </summary>
public static class TaskEndpoints
{
    public static async Task<IResult> ListTasks(
        bool? includeCompleted,
        TaskInboxProjection projection,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        if (modeProvider.Mode == TammaMode.SaaS &&
            (tenantContext.TenantId is not Guid saasTenantId || saasTenantId == Guid.Empty))
        {
            return Results.NotFound(new { error = "no_active_tenant" });
        }

        var userId = ChatEndpoints.ResolveUserId(principal);
        if (userId == Guid.Empty)
            return Results.Unauthorized();

        var tenantId = modeProvider.Mode == TammaMode.SaaS ? tenantContext.TenantId : null;
        var items = await projection.ListForUserAsync(
            tenantId, userId, includeCompleted ?? false, ct).ConfigureAwait(false);

        return Results.Ok(new { items, count = items.Count });
    }

    public static async Task<IResult> GetTask(
        Guid sessionId,
        TaskInboxProjection projection,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        if (modeProvider.Mode == TammaMode.SaaS &&
            (tenantContext.TenantId is not Guid saasTenantId || saasTenantId == Guid.Empty))
        {
            return Results.NotFound(new { error = "no_active_tenant" });
        }

        if (sessionId == Guid.Empty)
            return Results.BadRequest(new { error = "sessionId is required" });

        var userId = ChatEndpoints.ResolveUserId(principal);
        if (userId == Guid.Empty)
            return Results.Unauthorized();

        var tenantId = modeProvider.Mode == TammaMode.SaaS ? tenantContext.TenantId : null;
        var item = await projection.GetForUserAsync(tenantId, userId, sessionId, ct).ConfigureAwait(false);
        return item is null
            ? Results.NotFound(new { error = "task_not_found" })
            : Results.Ok(item);
    }
}
