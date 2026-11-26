using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 39-20 (AC1) — control-plane persistence for tenant-scoped teams and
/// their members.
/// </summary>
public interface ITeamRepository
{
    Task<Team> CreateAsync(Team team, CancellationToken ct = default);
    Task<Team?> GetByIdAsync(Guid tenantId, Guid teamId, CancellationToken ct = default);
    Task<Team?> GetByNameAsync(Guid tenantId, string name, CancellationToken ct = default);
    Task<List<Team>> ListByTenantAsync(Guid tenantId, CancellationToken ct = default);
    Task<Team?> UpdateAsync(Guid tenantId, Guid teamId, string name, string? description, string defaultMemberRole, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid tenantId, Guid teamId, CancellationToken ct = default);

    Task<TeamMember> AddMemberAsync(Guid teamId, Guid userId, string role, CancellationToken ct = default);
    Task<TeamMember?> UpdateMemberRoleAsync(Guid teamId, Guid userId, string role, CancellationToken ct = default);
    Task<bool> RemoveMemberAsync(Guid teamId, Guid userId, CancellationToken ct = default);
    Task<string?> GetMemberRoleAsync(Guid teamId, Guid userId, CancellationToken ct = default);
    Task<List<TeamMember>> ListMembersAsync(Guid teamId, CancellationToken ct = default);
    Task<List<Guid>> ListTeamIdsForUserAsync(Guid tenantId, Guid userId, CancellationToken ct = default);
}
