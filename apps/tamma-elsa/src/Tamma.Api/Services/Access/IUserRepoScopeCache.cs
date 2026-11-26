namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (D6) — precomputed per-(tenant, user) repository scope held in
/// <see cref="IUserRepoScopeCache"/> so repeated <c>CanSeeAsync</c> checks stay
/// O(1) in-memory without a join cascade per check.
/// </summary>
public sealed record UserRepoScope(
    Guid TenantId,
    Guid UserId,
    string? TenantRole,
    IReadOnlyDictionary<Guid, string> VisibilityByRepoId,
    IReadOnlyDictionary<string, Guid> RepoIdByFullName,
    IReadOnlyDictionary<Guid, string> MaxGrantLevelByRepoId)
{
    public bool IsTenantMember => TenantRole is not null;

    /// <summary>
    /// Computes the user's effective access level on the specified repository
    /// inside this tenant. A repository with no catalogue row falls back to
    /// tenant-visible (<c>D2</c> grandfather clause) for members of this tenant.
    /// </summary>
    public string? GetEffectiveLevel(Guid? repositoryId, string? repoFullName)
    {
        if (!IsTenantMember) return null;

        Guid? resolvedId = repositoryId;
        if (resolvedId is null && !string.IsNullOrWhiteSpace(repoFullName))
        {
            if (RepoIdByFullName.TryGetValue(repoFullName.Trim(), out var mapped))
                resolvedId = mapped;
        }

        if (resolvedId is not Guid id || !VisibilityByRepoId.TryGetValue(id, out var visibility))
        {
            // D2: uncatalogued repo inside an already-authorized tenant resolves as tenant-visible.
            return EffectiveAccess.Compute(TenantRole, RepoVisibilities.Tenant, null);
        }

        var grant = MaxGrantLevelByRepoId.TryGetValue(id, out var level) ? new[] { level } : null;
        return EffectiveAccess.Compute(TenantRole, visibility, grant);
    }
}

/// <summary>
/// Story 39-20 (D6) — singleton TTL-bounded, event-invalidated cache of
/// <see cref="UserRepoScope"/> entries.
/// </summary>
public interface IUserRepoScopeCache
{
    int Count { get; }
    UserRepoScope? TryGet(Guid tenantId, Guid userId);
    void Set(UserRepoScope scope);
    void InvalidateTenant(Guid tenantId);
    void InvalidateUser(Guid tenantId, Guid userId);
    void Flush();
}
