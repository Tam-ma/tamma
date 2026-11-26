using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Tamma.Api.Auth;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.PromptStore;
using Tamma.Data;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 39-19 (AC1 / D2 / D9) — read-only chat history projection endpoints:
/// <list type="bullet">
///   <item><c>GET /api/chat/conversations</c> — lists the authenticated user's own
///     orchestrator chat conversations.</item>
///   <item><c>GET /api/chat/conversations/{conversationId:guid}</c> — paginated
///     message history for one conversation owned by the caller.</item>
/// </list>
///
/// <para>Caller identity ALWAYS derives from the authenticated <see cref="ClaimsPrincipal"/>
/// (never from query parameters). In SaaS mode, an empty/null ambient
/// <see cref="ITenantContext.TenantId"/> fails closed with <c>404 no_active_tenant</c>
/// BEFORE touching any repository.</para>
/// </summary>
public static class ChatEndpoints
{
    public static async Task<IResult> ListConversations(
        int? limit,
        ChatHistoryProjection projection,
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

        var userId = ResolveUserId(principal);
        if (userId == Guid.Empty)
            return Results.Unauthorized();

        var tenantId = modeProvider.Mode == TammaMode.SaaS ? tenantContext.TenantId : null;
        var items = await projection.ListConversationsAsync(tenantId, userId, limit ?? 50, ct).ConfigureAwait(false);
        return Results.Ok(new { items, count = items.Count });
    }

    public static async Task<IResult> GetConversation(
        Guid conversationId,
        long? cursor,
        int? limit,
        ChatHistoryProjection projection,
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

        if (conversationId == Guid.Empty)
            return Results.BadRequest(new { error = "conversationId is required" });

        var userId = ResolveUserId(principal);
        if (userId == Guid.Empty)
            return Results.Unauthorized();

        var tenantId = modeProvider.Mode == TammaMode.SaaS ? tenantContext.TenantId : null;
        var page = await projection.GetConversationAsync(
            tenantId, userId, conversationId, cursor, limit ?? 100, ct).ConfigureAwait(false);

        return Results.Ok(page);
    }

    internal static Guid ResolveUserId(ClaimsPrincipal principal)
    {
        var fromExt = principal.GetUserId();
        if (fromExt is Guid g && g != Guid.Empty)
            return g;

        var raw = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? principal.FindFirst("userId")?.Value;

        return Guid.TryParse(raw, out var parsed) ? parsed : Guid.Empty;
    }
}
