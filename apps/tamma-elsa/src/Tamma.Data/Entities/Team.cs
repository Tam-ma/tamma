namespace Tamma.Data.Entities;

/// <summary>
/// Story 39-20 (AC1 / D1) — tenant-scoped team grouping users for role-based
/// repository access grants. Control-plane resident alongside
/// <see cref="TenantMembership"/> because members reference CP <see cref="User"/>
/// rows. Single-user mode requires zero teams.
/// </summary>
public class Team
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Name { get; set; } = null!;
    public string? Description { get; set; }

    /// <summary>Default role for newly added members (<c>member</c> | <c>maintainer</c>).</summary>
    public string DefaultMemberRole { get; set; } = "member";

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Tenant Tenant { get; set; } = null!;
    public ICollection<TeamMember> Members { get; set; } = new List<TeamMember>();
    public ICollection<RepoAccessGrant> RepoGrants { get; set; } = new List<RepoAccessGrant>();
}
