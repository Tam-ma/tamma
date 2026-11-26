using System.Text.Json;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (AC1 / D6 / D8 / D11) — CRUD service for tenant-scoped teams and
/// team membership. Emits best-effort <c>TEAM.*</c> DCB events and invalidates
/// <see cref="IUserRepoScopeCache"/> for the tenant on every write.
/// </summary>
public sealed class TeamService(
    ITeamRepository teams,
    IUserRepoScopeCache scopeCache,
    IEventRepository events,
    ILogger<TeamService> logger)
{
    public Task<List<Team>> ListAsync(Guid tenantId, CancellationToken ct = default)
        => teams.ListByTenantAsync(tenantId, ct);

    public Task<Team?> GetAsync(Guid tenantId, Guid teamId, CancellationToken ct = default)
        => teams.GetByIdAsync(tenantId, teamId, ct);

    public Task<Team?> GetByNameAsync(Guid tenantId, string name, CancellationToken ct = default)
        => teams.GetByNameAsync(tenantId, name, ct);

    public Task<string?> GetMemberRoleAsync(Guid teamId, Guid userId, CancellationToken ct = default)
        => teams.GetMemberRoleAsync(teamId, userId, ct);

    public Task<List<TeamMember>> ListMembersAsync(Guid teamId, CancellationToken ct = default)
        => teams.ListMembersAsync(teamId, ct);

    public async Task<Team> CreateAsync(
        Guid tenantId,
        string name,
        string? description,
        string defaultMemberRole,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var created = await teams.CreateAsync(new Team
        {
            TenantId = tenantId,
            Name = name,
            Description = description,
            DefaultMemberRole = defaultMemberRole,
        }, ct);

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.TeamCreated, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["teamId"] = created.Id.ToString(),
            ["name"] = created.Name,
            ["defaultMemberRole"] = created.DefaultMemberRole,
        });
        return created;
    }

    public async Task<Team?> UpdateAsync(
        Guid tenantId,
        Guid teamId,
        string name,
        string? description,
        string defaultMemberRole,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var updated = await teams.UpdateAsync(tenantId, teamId, name, description, defaultMemberRole, ct);
        if (updated is null) return null;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.TeamUpdated, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["teamId"] = updated.Id.ToString(),
            ["name"] = updated.Name,
            ["defaultMemberRole"] = updated.DefaultMemberRole,
        });
        return updated;
    }

    public async Task<bool> DeleteAsync(
        Guid tenantId,
        Guid teamId,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var deleted = await teams.DeleteAsync(tenantId, teamId, ct);
        if (!deleted) return false;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.TeamDeleted, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["teamId"] = teamId.ToString(),
        });
        return true;
    }

    public async Task<TeamMember> AddMemberAsync(
        Guid tenantId,
        Guid teamId,
        Guid memberUserId,
        string role,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var member = await teams.AddMemberAsync(teamId, memberUserId, role, ct);
        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.TeamMemberAdded, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["teamId"] = teamId.ToString(),
            ["memberUserId"] = memberUserId.ToString(),
            ["role"] = member.Role,
        });
        return member;
    }

    public async Task<TeamMember?> UpdateMemberRoleAsync(
        Guid tenantId,
        Guid teamId,
        Guid memberUserId,
        string role,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var updated = await teams.UpdateMemberRoleAsync(teamId, memberUserId, role, ct);
        if (updated is null) return null;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.TeamMemberRoleChanged, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["teamId"] = teamId.ToString(),
            ["memberUserId"] = memberUserId.ToString(),
            ["role"] = updated.Role,
        });
        return updated;
    }

    public async Task<bool> RemoveMemberAsync(
        Guid tenantId,
        Guid teamId,
        Guid memberUserId,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var removed = await teams.RemoveMemberAsync(teamId, memberUserId, ct);
        if (!removed) return false;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.TeamMemberRemoved, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["teamId"] = teamId.ToString(),
            ["memberUserId"] = memberUserId.ToString(),
        });
        return true;
    }

    private async Task EmitBestEffortAsync(
        string eventType,
        Guid tenantId,
        Guid actorUserId,
        Dictionary<string, object?> data)
    {
        try
        {
            await events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = eventType,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["tenantId"] = tenantId.ToString(),
                    ["userId"] = actorUserId.ToString(),
                }),
                Metadata = """{"source":"TeamService"}""",
                Data = JsonSerializer.Serialize(data),
                CreatedAt = DateTime.UtcNow,
            });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Best-effort emit of {EventType} failed", eventType);
        }
    }
}
