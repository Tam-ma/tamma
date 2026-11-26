using System.Security.Claims;
using Tamma.Api.Auth;
using Tamma.Api.Authorization;
using Tamma.Api.Dtos.Access;
using Tamma.Api.Services.Access;
using Tamma.Data.Entities;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 39-20 (AC1 / D9) — tenant-scoped team CRUD and membership endpoints
/// mounted under <c>/api/v1/orgs/{tenantId:guid}/teams</c> with
/// <see cref="RequireTenantMembershipFilter"/>.
///
/// <para>Write authorization uses <see cref="Permissions.HasPermission(string?, string?)"/>
/// against the filter-derived path-tenant role (<c>teams:manage</c> = admin/owner).
/// Team membership mutations additionally admit a <c>maintainer</c> of THAT team (D4).</para>
/// </summary>
public static class TeamEndpoints
{
    public static async Task<IResult> ListTeams(
        Guid tenantId,
        TeamService service,
        CancellationToken ct)
    {
        var list = await service.ListAsync(tenantId, ct);
        return Results.Ok(list.Select(Map).ToList());
    }

    public static async Task<IResult> GetTeam(
        Guid tenantId,
        Guid teamId,
        TeamService service,
        CancellationToken ct)
    {
        var team = await service.GetAsync(tenantId, teamId, ct);
        return team is null
            ? Results.NotFound(new { error = $"Team '{teamId}' not found in organization." })
            : Results.Ok(Map(team));
    }

    public static async Task<IResult> CreateTeam(
        Guid tenantId,
        CreateTeamRequest request,
        TeamService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasTeamsManage(http))
            return Forbidden("Admin or owner role is required to manage teams.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var name = request?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 120)
            return Results.BadRequest(new { error = "Team name is required (1–120 characters)." });

        var defaultRole = string.IsNullOrWhiteSpace(request?.DefaultMemberRole)
            ? TeamMemberRoles.Member
            : request!.DefaultMemberRole!.Trim();
        if (!TeamMemberRoles.IsValid(defaultRole))
            return Results.BadRequest(new { error = $"Invalid defaultMemberRole '{defaultRole}'. Expected 'member' or 'maintainer'." });

        var existing = await service.GetByNameAsync(tenantId, name, ct);
        if (existing is not null)
            return Results.Conflict(new { error = $"A team named '{name}' already exists in this organization." });

        var created = await service.CreateAsync(tenantId, name, request?.Description?.Trim(), defaultRole, actorId, ct);
        return Results.Created($"/api/v1/orgs/{tenantId}/teams/{created.Id}", Map(created));
    }

    public static async Task<IResult> UpdateTeam(
        Guid tenantId,
        Guid teamId,
        UpdateTeamRequest request,
        TeamService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasTeamsManage(http))
            return Forbidden("Admin or owner role is required to update teams.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var name = request?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 120)
            return Results.BadRequest(new { error = "Team name is required (1–120 characters)." });

        var defaultRole = string.IsNullOrWhiteSpace(request?.DefaultMemberRole)
            ? TeamMemberRoles.Member
            : request!.DefaultMemberRole!.Trim();
        if (!TeamMemberRoles.IsValid(defaultRole))
            return Results.BadRequest(new { error = $"Invalid defaultMemberRole '{defaultRole}'. Expected 'member' or 'maintainer'." });

        var updated = await service.UpdateAsync(tenantId, teamId, name, request?.Description?.Trim(), defaultRole, actorId, ct);
        return updated is null
            ? Results.NotFound(new { error = $"Team '{teamId}' not found in organization." })
            : Results.Ok(Map(updated));
    }

    public static async Task<IResult> DeleteTeam(
        Guid tenantId,
        Guid teamId,
        TeamService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (!HasTeamsManage(http))
            return Forbidden("Admin or owner role is required to delete teams.");

        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var deleted = await service.DeleteAsync(tenantId, teamId, actorId, ct);
        return deleted
            ? Results.NoContent()
            : Results.NotFound(new { error = $"Team '{teamId}' not found in organization." });
    }

    public static async Task<IResult> ListMembers(
        Guid tenantId,
        Guid teamId,
        TeamService service,
        CancellationToken ct)
    {
        var team = await service.GetAsync(tenantId, teamId, ct);
        if (team is null)
            return Results.NotFound(new { error = $"Team '{teamId}' not found in organization." });

        var members = await service.ListMembersAsync(teamId, ct);
        return Results.Ok(members.Select(MapMember).ToList());
    }

    public static async Task<IResult> AddMember(
        Guid tenantId,
        Guid teamId,
        AddTeamMemberRequest request,
        TeamService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var team = await service.GetAsync(tenantId, teamId, ct);
        if (team is null)
            return Results.NotFound(new { error = $"Team '{teamId}' not found in organization." });

        if (!await CanManageTeamMembersAsync(http, service, teamId, actorId, ct))
            return Forbidden("Team maintainer or tenant admin/owner role is required to manage team members.");

        if (request is null || request.UserId == Guid.Empty)
            return Results.BadRequest(new { error = "userId is required." });

        var role = string.IsNullOrWhiteSpace(request.Role) ? team.DefaultMemberRole : request.Role.Trim();
        if (!TeamMemberRoles.IsValid(role))
            return Results.BadRequest(new { error = $"Invalid team member role '{role}'. Expected 'member' or 'maintainer'." });

        var added = await service.AddMemberAsync(tenantId, teamId, request.UserId, role, actorId, ct);
        return Results.Ok(MapMember(added));
    }

    public static async Task<IResult> UpdateMemberRole(
        Guid tenantId,
        Guid teamId,
        Guid userId,
        UpdateTeamMemberRoleRequest request,
        TeamService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var team = await service.GetAsync(tenantId, teamId, ct);
        if (team is null)
            return Results.NotFound(new { error = $"Team '{teamId}' not found in organization." });

        if (!await CanManageTeamMembersAsync(http, service, teamId, actorId, ct))
            return Forbidden("Team maintainer or tenant admin/owner role is required to update member roles.");

        var role = request?.Role?.Trim();
        if (!TeamMemberRoles.IsValid(role))
            return Results.BadRequest(new { error = $"Invalid team member role '{role}'. Expected 'member' or 'maintainer'." });

        var updated = await service.UpdateMemberRoleAsync(tenantId, teamId, userId, role!, actorId, ct);
        return updated is null
            ? Results.NotFound(new { error = $"User '{userId}' is not a member of team '{teamId}'." })
            : Results.Ok(MapMember(updated));
    }

    public static async Task<IResult> RemoveMember(
        Guid tenantId,
        Guid teamId,
        Guid userId,
        TeamService service,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (principal.GetUserId() is not Guid actorId)
            return Results.Unauthorized();

        var team = await service.GetAsync(tenantId, teamId, ct);
        if (team is null)
            return Results.NotFound(new { error = $"Team '{teamId}' not found in organization." });

        if (!await CanManageTeamMembersAsync(http, service, teamId, actorId, ct))
            return Forbidden("Team maintainer or tenant admin/owner role is required to remove members.");

        var removed = await service.RemoveMemberAsync(tenantId, teamId, userId, actorId, ct);
        return removed
            ? Results.NoContent()
            : Results.NotFound(new { error = $"User '{userId}' is not a member of team '{teamId}'." });
    }

    private static bool HasTeamsManage(HttpContext http)
    {
        var role = http.Items.TryGetValue(RequireTenantMembershipFilter.TenantRoleItemKey, out var raw)
            ? raw as string
            : null;
        return Permissions.HasPermission(role, "teams:manage");
    }

    private static async Task<bool> CanManageTeamMembersAsync(
        HttpContext http,
        TeamService service,
        Guid teamId,
        Guid actorId,
        CancellationToken ct)
    {
        if (HasTeamsManage(http)) return true;
        var memberRole = await service.GetMemberRoleAsync(teamId, actorId, ct);
        return string.Equals(memberRole, TeamMemberRoles.Maintainer, StringComparison.Ordinal);
    }

    private static IResult Forbidden(string error)
        => Results.Json(new { error }, statusCode: StatusCodes.Status403Forbidden);

    private static TeamResponse Map(Team t) => new(
        t.Id,
        t.TenantId,
        t.Name,
        t.Description,
        t.DefaultMemberRole,
        t.Members.Count,
        t.Members.Select(MapMember).ToList(),
        t.CreatedAt,
        t.UpdatedAt);

    private static TeamMemberResponse MapMember(TeamMember m) => new(
        m.Id, m.TeamId, m.UserId, m.Role, m.CreatedAt);
}
