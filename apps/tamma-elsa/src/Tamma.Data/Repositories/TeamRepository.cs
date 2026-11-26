using Microsoft.EntityFrameworkCore;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <inheritdoc />
public sealed class TeamRepository(ControlPlaneDbContext db) : ITeamRepository
{
    public async Task<Team> CreateAsync(Team team, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(team);
        var now = DateTime.UtcNow;
        if (team.Id == Guid.Empty) team.Id = Guid.NewGuid();
        team.CreatedAt = now;
        team.UpdatedAt = now;

        db.Teams.Add(team);
        await db.SaveChangesAsync(ct);
        return team;
    }

    public Task<Team?> GetByIdAsync(Guid tenantId, Guid teamId, CancellationToken ct = default)
        => db.Teams
            .AsNoTracking()
            .Include(t => t.Members)
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == teamId, ct);

    public Task<Team?> GetByNameAsync(Guid tenantId, string name, CancellationToken ct = default)
        => db.Teams
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Name == name, ct);

    public Task<List<Team>> ListByTenantAsync(Guid tenantId, CancellationToken ct = default)
        => db.Teams
            .AsNoTracking()
            .Include(t => t.Members)
            .Where(t => t.TenantId == tenantId)
            .OrderBy(t => t.Name)
            .ToListAsync(ct);

    public async Task<Team?> UpdateAsync(
        Guid tenantId,
        Guid teamId,
        string name,
        string? description,
        string defaultMemberRole,
        CancellationToken ct = default)
    {
        var existing = await db.Teams
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == teamId, ct);
        if (existing is null) return null;

        existing.Name = name;
        existing.Description = description;
        existing.DefaultMemberRole = defaultMemberRole;
        existing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return existing;
    }

    public async Task<bool> DeleteAsync(Guid tenantId, Guid teamId, CancellationToken ct = default)
    {
        var existing = await db.Teams
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == teamId, ct);
        if (existing is null) return false;

        db.Teams.Remove(existing);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<TeamMember> AddMemberAsync(
        Guid teamId,
        Guid userId,
        string role,
        CancellationToken ct = default)
    {
        var existing = await db.TeamMembers
            .FirstOrDefaultAsync(m => m.TeamId == teamId && m.UserId == userId, ct);
        if (existing is not null)
        {
            existing.Role = role;
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var member = new TeamMember
        {
            Id = Guid.NewGuid(),
            TeamId = teamId,
            UserId = userId,
            Role = role,
            CreatedAt = DateTime.UtcNow,
        };
        db.TeamMembers.Add(member);
        await db.SaveChangesAsync(ct);
        return member;
    }

    public async Task<TeamMember?> UpdateMemberRoleAsync(
        Guid teamId,
        Guid userId,
        string role,
        CancellationToken ct = default)
    {
        var existing = await db.TeamMembers
            .FirstOrDefaultAsync(m => m.TeamId == teamId && m.UserId == userId, ct);
        if (existing is null) return null;

        existing.Role = role;
        await db.SaveChangesAsync(ct);
        return existing;
    }

    public async Task<bool> RemoveMemberAsync(
        Guid teamId,
        Guid userId,
        CancellationToken ct = default)
    {
        var existing = await db.TeamMembers
            .FirstOrDefaultAsync(m => m.TeamId == teamId && m.UserId == userId, ct);
        if (existing is null) return false;

        db.TeamMembers.Remove(existing);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public Task<string?> GetMemberRoleAsync(Guid teamId, Guid userId, CancellationToken ct = default)
        => db.TeamMembers
            .AsNoTracking()
            .Where(m => m.TeamId == teamId && m.UserId == userId)
            .Select(m => m.Role)
            .FirstOrDefaultAsync(ct);

    public Task<List<TeamMember>> ListMembersAsync(Guid teamId, CancellationToken ct = default)
        => db.TeamMembers
            .AsNoTracking()
            .Where(m => m.TeamId == teamId)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync(ct);

    public Task<List<Guid>> ListTeamIdsForUserAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken ct = default)
        => db.TeamMembers
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.Team.TenantId == tenantId)
            .Select(m => m.TeamId)
            .ToListAsync(ct);
}
