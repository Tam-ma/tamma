using Tamma.Api.Authorization;

namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (AC6 / D4) — pure composition rule for effective repository
/// access:
/// <c>effective = MAX(tenantRoleImplied, directGrant, teamGrants...)</c>.
///
/// <list type="bullet">
///   <item>Non-members (<paramref name="tenantRole"/> null or invalid) always
///     receive <c>null</c> (fail-closed across tenant boundaries).</item>
///   <item>Tenant <c>owner</c> / <c>admin</c> implicitly hold <c>admin</c> on
///     every repository in their tenant.</item>
///   <item>Tenant <c>member</c> implicitly holds <c>contribute</c> on
///     <c>Visibility='tenant'</c> (or uncatalogued grandfathered) repositories,
///     and <c>null</c> on <c>Visibility='restricted'</c> repositories unless
///     covered by a direct or team grant.</item>
///   <item>Team-membership roles (<c>member</c> | <c>maintainer</c>) never
///     appear in this formula — team roles govern team membership management
///     only and never bypass tenant roles or confer implicit repo power.</item>
/// </list>
/// </summary>
public static class EffectiveAccess
{
    public static string? Compute(
        string? tenantRole,
        string? repoVisibility,
        IEnumerable<string>? grantLevels)
    {
        if (!TenantRoleHierarchy.IsValid(tenantRole))
            return null;

        string? effective = tenantRole switch
        {
            TenantRoleHierarchy.Owner or TenantRoleHierarchy.Admin => RepoAccessLevels.Admin,
            TenantRoleHierarchy.Member when !string.Equals(repoVisibility, RepoVisibilities.Restricted, StringComparison.Ordinal)
                => RepoAccessLevels.Contribute,
            _ => null,
        };

        if (grantLevels is not null)
        {
            foreach (var level in grantLevels)
            {
                if (RepoAccessLevels.IsValid(level))
                    effective = RepoAccessLevels.Max(effective, level);
            }
        }

        return effective;
    }
}
