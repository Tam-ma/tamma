namespace Tamma.Data.Entities;

/// <summary>
/// Story 39-20 (AC2 / D3) — explicit repository access grant to either an
/// individual <see cref="User"/> OR a <see cref="Team"/> (enforced by
/// <c>ck_repo_access_grants_grantee_xor</c>). Access level is closed:
/// <c>read</c> | <c>contribute</c> | <c>admin</c>.
/// </summary>
public class RepoAccessGrant
{
    public Guid Id { get; set; }
    public Guid RepositoryId { get; set; }
    public Guid? UserId { get; set; }
    public Guid? TeamId { get; set; }

    /// <summary>Closed access level: <c>read</c> | <c>contribute</c> | <c>admin</c>.</summary>
    public string AccessLevel { get; set; } = "read";

    public Guid? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public RegisteredRepo Repository { get; set; } = null!;
    public User? User { get; set; }
    public Team? Team { get; set; }
}
