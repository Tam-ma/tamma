namespace Tamma.Data.Entities;

/// <summary>
/// Story 39-20 (AC2 / D2) — minimal explicit tenant repository catalogue row
/// anchoring <see cref="RepoAccessGrant"/> records across all git platforms.
///
/// <para><b>Default posture (D2):</b> <see cref="Visibility"/> defaults to
/// <c>tenant</c>, giving every tenant member implicit <c>contribute</c> access
/// (grandfathering existing tenants with no lockout). Flipping a repo to
/// <c>restricted</c> activates grant-only access for non-admin members.</para>
/// </summary>
public class RegisteredRepo
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string PlatformKind { get; set; } = "github";
    public string RepoFullName { get; set; } = null!;
    public string? ExternalId { get; set; }

    /// <summary>Closed visibility posture: <c>tenant</c> | <c>restricted</c>.</summary>
    public string Visibility { get; set; } = "tenant";

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public Tenant Tenant { get; set; } = null!;
    public ICollection<RepoAccessGrant> Grants { get; set; } = new List<RepoAccessGrant>();
}
