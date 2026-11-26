using System.Security.Claims;
using Tamma.Api.Auth;
using Tamma.Api.Authorization;
using Tamma.Api.Dtos.Access;
using Tamma.Api.Services.Access;
using Tamma.Data.Entities;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 39-20 (AC2 / D9) — tenant-scoped repository catalogue visibility and
/// grant management endpoints mounted under <c>/api/v1/orgs/{tenantId:guid}/repos</c>
/// with <see cref="RequireTenantMembershipFilter"/>.
///
/// <para>Write gates use <see cref="Permissions.HasPermission(string?, string?)"/>
/// against <c>repos:manage</c> (admin/owner) on the filter-derived path-tenant role.</para>
/// </summary>
public static class RepoAccessEndpoints
{
    public static async Task<IResult> ListRepos(
        Guid tenantId,
        RepoAccessService service,
        IRepoAccessEvaluator evaluator,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        if (principal.GetUserId() is not Guid userId)
            return Results.Unauthorized();

        var repos = await service.ListReposAsync(tenantId, ct);
        var result = new List<RegisteredRepoResponse>(repos.Count);
        foreach (var r in repos)
        {
            var level = await evaluator.GetEffectiveAccessLevelAsync(userId, tenantId, r.Id, r.RepoFullName, ct);
            result.Add(MapRepo(r, level));
        }
        return Results.Ok(result);
    }

    public static async Task<IResult> RegisterRepo(
        Guid tenantId,
        RegisterRepoRequest request,
        RepoAccessService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasReposManage(http))
            return Forbidden("Admin or owner role is required to register repositories.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var fullName = request?.RepoFullName?.Trim();
        if (string.IsNullOrWhiteSpace(fullName) || fullName.Length > 255)
            return Results.BadRequest(new { error = "repoFullName is required (1–255 characters)." });

        var platform = string.IsNullOrWhiteSpace(request?.PlatformKind) ? "github" : request!.PlatformKind!.Trim();
        var visibility = string.IsNullOrWhiteSpace(request?.Visibility) ? RepoVisibilities.Tenant : request!.Visibility!.Trim();
        if (!RepoVisibilities.IsValid(visibility))
            return Results.BadRequest(new { error = $"Invalid visibility '{visibility}'. Expected 'tenant' or 'restricted'." });

        var saved = await service.RegisterRepoAsync(tenantId, platform, fullName, request?.ExternalId?.Trim(), visibility, actorId, ct);
        return Results.Ok(MapRepo(saved, RepoAccessLevels.Admin));
    }

    public static async Task<IResult> UpdateVisibility(
        Guid tenantId,
        Guid repoId,
        UpdateRepoVisibilityRequest request,
        RepoAccessService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasReposManage(http))
            return Forbidden("Admin or owner role is required to change repository visibility.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var visibility = request?.Visibility?.Trim();
        if (!RepoVisibilities.IsValid(visibility))
            return Results.BadRequest(new { error = $"Invalid visibility '{visibility}'. Expected 'tenant' or 'restricted'." });

        var updated = await service.UpdateVisibilityAsync(tenantId, repoId, visibility!, actorId, ct);
        return updated is null
            ? Results.NotFound(new { error = $"Repository '{repoId}' not found in organization." })
            : Results.Ok(MapRepo(updated, RepoAccessLevels.Admin));
    }

    public static async Task<IResult> ListGrants(
        Guid tenantId,
        Guid repoId,
        RepoAccessService service,
        CancellationToken ct)
    {
        var repo = await service.GetRepoAsync(tenantId, repoId, ct);
        if (repo is null)
            return Results.NotFound(new { error = $"Repository '{repoId}' not found in organization." });

        var grants = await service.ListGrantsAsync(repoId, ct);
        return Results.Ok(grants.Select(MapGrant).ToList());
    }

    public static async Task<IResult> UpsertGrant(
        Guid tenantId,
        Guid repoId,
        UpsertRepoGrantRequest request,
        RepoAccessService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasReposManage(http))
            return Forbidden("Admin or owner role is required to manage repository grants.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var repo = await service.GetRepoAsync(tenantId, repoId, ct);
        if (repo is null)
            return Results.NotFound(new { error = $"Repository '{repoId}' not found in organization." });

        if (request is null || (request.UserId is null) == (request.TeamId is null))
            return Results.BadRequest(new { error = "Exactly one of 'userId' or 'teamId' must be provided." });

        var level = request.AccessLevel?.Trim();
        if (!RepoAccessLevels.IsValid(level))
            return Results.BadRequest(new { error = $"Invalid accessLevel '{level}'. Expected 'read', 'contribute', or 'admin'." });

        var saved = await service.UpsertGrantAsync(tenantId, repoId, request.UserId, request.TeamId, level!, actorId, ct);
        return Results.Ok(MapGrant(saved));
    }

    public static async Task<IResult> RevokeGrantById(
        Guid tenantId,
        Guid repoId,
        Guid grantId,
        RepoAccessService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasReposManage(http))
            return Forbidden("Admin or owner role is required to revoke repository grants.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var repo = await service.GetRepoAsync(tenantId, repoId, ct);
        if (repo is null)
            return Results.NotFound(new { error = $"Repository '{repoId}' not found in organization." });

        var removed = await service.RevokeGrantAsync(tenantId, repoId, grantId, actorId, ct);
        return removed
            ? Results.NoContent()
            : Results.NotFound(new { error = $"Grant '{grantId}' not found on repository '{repoId}'." });
    }

    public static async Task<IResult> RevokeGrantByGrantee(
        Guid tenantId,
        Guid repoId,
        Guid? userId,
        Guid? teamId,
        RepoAccessService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasReposManage(http))
            return Forbidden("Admin or owner role is required to revoke repository grants.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var repo = await service.GetRepoAsync(tenantId, repoId, ct);
        if (repo is null)
            return Results.NotFound(new { error = $"Repository '{repoId}' not found in organization." });

        if ((userId is null) == (teamId is null))
            return Results.BadRequest(new { error = "Exactly one of 'userId' or 'teamId' query parameters must be provided." });

        var removed = await service.RevokeGrantByGranteeAsync(tenantId, repoId, userId, teamId, actorId, ct);
        return removed
            ? Results.NoContent()
            : Results.NotFound(new { error = "Matching grant not found on repository." });
    }

    private static bool HasReposManage(HttpContext http)
    {
        var role = http.Items.TryGetValue(RequireTenantMembershipFilter.TenantRoleItemKey, out var raw)
            ? raw as string
            : null;
        return Permissions.HasPermission(role, "repos:manage");
    }

    private static IResult Forbidden(string error)
        => Results.Json(new { error }, statusCode: StatusCodes.Status403Forbidden);

    private static RegisteredRepoResponse MapRepo(RegisteredRepo r, string? effectiveLevel) => new(
        r.Id,
        r.TenantId,
        r.PlatformKind,
        r.RepoFullName,
        r.ExternalId,
        r.Visibility,
        effectiveLevel,
        r.CreatedAt,
        r.UpdatedAt);

    private static RepoAccessGrantResponse MapGrant(RepoAccessGrant g) => new(
        g.Id,
        g.RepositoryId,
        g.UserId,
        g.TeamId,
        g.AccessLevel,
        g.CreatedBy,
        g.CreatedAt,
        g.UpdatedAt);
}
