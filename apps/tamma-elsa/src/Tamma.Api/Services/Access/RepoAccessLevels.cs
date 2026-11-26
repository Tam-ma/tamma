namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (AC2 / D3) — closed repository access-level vocabulary:
/// <c>read &lt; contribute &lt; admin</c>. Mirrors <c>TenantRoleHierarchy</c>
/// without coupling to <c>Tamma.Core/Documents</c>.
/// </summary>
public static class RepoAccessLevels
{
    public const string Read = "read";
    public const string Contribute = "contribute";
    public const string Admin = "admin";

    public static readonly IReadOnlySet<string> Allowed =
        new HashSet<string>(StringComparer.Ordinal) { Read, Contribute, Admin };

    public static bool IsValid(string? level)
        => level is not null && Allowed.Contains(level);

    /// <summary>Ordinal rank: admin=3, contribute=2, read=1, none/unknown=0.</summary>
    public static int Rank(string? level) => level switch
    {
        Admin => 3,
        Contribute => 2,
        Read => 1,
        _ => 0,
    };

    public static bool IsAtLeast(string? level, string minimum)
        => IsValid(minimum) && Rank(level) >= Rank(minimum);

    public static string? Max(string? a, string? b)
    {
        var ra = Rank(a);
        var rb = Rank(b);
        if (ra == 0 && rb == 0) return null;
        return ra >= rb ? a : b;
    }
}

/// <summary>Story 39-20 (AC1 / D4) — closed team-membership role vocabulary.</summary>
public static class TeamMemberRoles
{
    public const string Member = "member";
    public const string Maintainer = "maintainer";

    public static readonly IReadOnlySet<string> Allowed =
        new HashSet<string>(StringComparer.Ordinal) { Member, Maintainer };

    public static bool IsValid(string? role)
        => role is not null && Allowed.Contains(role);
}

/// <summary>Story 39-20 (AC2 / D2) — closed repository visibility posture vocabulary.</summary>
public static class RepoVisibilities
{
    public const string Tenant = "tenant";
    public const string Restricted = "restricted";

    public static readonly IReadOnlySet<string> Allowed =
        new HashSet<string>(StringComparer.Ordinal) { Tenant, Restricted };

    public static bool IsValid(string? visibility)
        => visibility is not null && Allowed.Contains(visibility);
}
