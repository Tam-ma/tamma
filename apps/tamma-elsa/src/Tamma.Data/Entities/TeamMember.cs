namespace Tamma.Data.Entities;

/// <summary>
/// Story 39-20 (AC1 / D4) — membership of a <see cref="User"/> inside a
/// <see cref="Team"/> with a team-scoped role (<c>member</c> | <c>maintainer</c>).
/// A team <c>maintainer</c> may manage that team's membership list alongside
/// tenant admin/owner, but the team role itself confers zero repository power —
/// repo power flows exclusively through <see cref="RepoAccessGrant"/> rows.
/// </summary>
public class TeamMember
{
    public Guid Id { get; set; }
    public Guid TeamId { get; set; }
    public Guid UserId { get; set; }
    public string Role { get; set; } = "member";
    public DateTime CreatedAt { get; set; }

    public Team Team { get; set; } = null!;
    public User User { get; set; } = null!;
}
