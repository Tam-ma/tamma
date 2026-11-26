using Tamma.Api.Auth;
using Tamma.Api.Authorization;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (AC3 / D5 / D6 / AC7) — the single production implementation of
/// <see cref="ITaskAudienceResolver"/> and <see cref="IRepoAccessEvaluator"/>.
///
/// <para>No mode branch exists here: single-user mode is the trivial case of the
/// same predicate (sole user is owner of their personal tenant, zero teams, all
/// repos tenant-visible).</para>
/// </summary>
public sealed class TaskAudienceResolver(
    IRepoAccessRepository repoAccess,
    ITenantMembershipRepository memberships,
    IUserRepoScopeCache scopeCache) : ITaskAudienceResolver, IRepoAccessEvaluator
{
    public const string BasisInitiator = "initiator";
    public const string BasisRepoAccess = "repo-access";

    public async Task<bool> CanSeeAsync(Guid userId, TaskRef task)
    {
        ArgumentNullException.ThrowIfNull(task);
        if (task.TenantId == Guid.Empty || userId == Guid.Empty)
            return false;

        var scope = await GetOrLoadScopeAsync(task.TenantId, userId);

        // Cross-tenant fail-closed: a user who is not a member of task.TenantId
        // sees nothing even if a forged/stale TaskRef carries their id.
        if (!scope.IsTenantMember)
            return false;

        // Visibility predicate (a): user initiated the workflow.
        if (task.InitiatorUserId is Guid initiator && initiator == userId)
            return true;

        // Visibility predicate (b): user has any access level on the task's repo
        // (or the task is tenant-wide / uncatalogued repo grandfathered per D2).
        var level = scope.GetEffectiveLevel(task.RepositoryId, task.RepoKey);
        return level is not null;
    }

    public async Task<IReadOnlyList<AudienceMember>> EligibleAudienceAsync(TaskRef task, string roleWire)
    {
        ArgumentNullException.ThrowIfNull(task);
        if (task.TenantId == Guid.Empty || !TenantRoleHierarchy.IsValid(roleWire))
            return Array.Empty<AudienceMember>();

        var tenantMembers = await memberships.ListAllByTenantAsync(task.TenantId);
        if (tenantMembers.Count == 0)
            return Array.Empty<AudienceMember>();

        // Resolve target repository (by id, else full name). Null = tenant-wide / grandfathered (D2).
        RegisteredRepo? repo = null;
        if (task.RepositoryId is Guid repoId && repoId != Guid.Empty)
        {
            repo = await repoAccess.GetRepoByIdAsync(task.TenantId, repoId);
        }
        else if (!string.IsNullOrWhiteSpace(task.RepoKey))
        {
            repo = await repoAccess.GetByFullNameAsync(task.TenantId, task.RepoKey.Trim());
        }

        // Inverse query for repo-specific grants (direct + team-transitive) when repo is catalogued.
        Dictionary<Guid, string>? maxGrantByUser = null;
        if (repo is not null)
        {
            var grants = await repoAccess.GetRepoAudienceAsync(task.TenantId, repo.Id);
            maxGrantByUser = new Dictionary<Guid, string>();
            foreach (var g in grants)
            {
                maxGrantByUser[g.UserId] = maxGrantByUser.TryGetValue(g.UserId, out var existing)
                    ? RepoAccessLevels.Max(existing, g.AccessLevel) ?? g.AccessLevel
                    : g.AccessLevel;
            }
        }

        var candidates = new List<AudienceMember>();
        foreach (var member in tenantMembers)
        {
            // Addressed role check: member's tenant role must satisfy the addressed role hierarchy.
            if (!TenantRoleHierarchy.IsAtLeast(member.Role, roleWire))
                continue;

            // Optional permission requirement declared by the task type (e.g. "workflows:manage").
            if (!string.IsNullOrWhiteSpace(task.RequiredPermission)
                && !Permissions.HasPermission(member.Role, task.RequiredPermission))
            {
                continue;
            }

            string[]? grantList = maxGrantByUser is not null
                && maxGrantByUser.TryGetValue(member.UserId, out var grantLevel)
                ? [grantLevel]
                : null;

            var effectiveLevel = EffectiveAccess.Compute(
                member.Role,
                repo?.Visibility ?? RepoVisibilities.Tenant,
                grantList);

            var isInitiator = task.InitiatorUserId is Guid init && init == member.UserId;
            if (!isInitiator && effectiveLevel is null)
                continue;

            var basis = isInitiator ? BasisInitiator : BasisRepoAccess;
            var resolvedLevel = effectiveLevel ?? RepoAccessLevels.Contribute;
            candidates.Add(new AudienceMember(member.UserId, member.Role, basis, resolvedLevel));
        }

        // D5 deterministic ordering: initiator first, then effective level rank desc,
        // tenant role rank desc, UserId asc.
        candidates.Sort((a, b) =>
        {
            var initCmp = (b.Basis == BasisInitiator ? 1 : 0).CompareTo(a.Basis == BasisInitiator ? 1 : 0);
            if (initCmp != 0) return initCmp;

            var levelCmp = RepoAccessLevels.Rank(b.EffectiveLevel).CompareTo(RepoAccessLevels.Rank(a.EffectiveLevel));
            if (levelCmp != 0) return levelCmp;

            var roleCmp = TenantRoleHierarchy.Level(b.RoleWire).CompareTo(TenantRoleHierarchy.Level(a.RoleWire));
            if (roleCmp != 0) return roleCmp;

            return a.UserId.CompareTo(b.UserId);
        });

        return candidates;
    }

    public async Task<string?> GetEffectiveAccessLevelAsync(
        Guid userId,
        Guid tenantId,
        Guid? repositoryId,
        string? repoFullName,
        CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty || userId == Guid.Empty)
            return null;

        var scope = await GetOrLoadScopeAsync(tenantId, userId, ct);
        return scope.GetEffectiveLevel(repositoryId, repoFullName);
    }

    private async Task<UserRepoScope> GetOrLoadScopeAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken ct = default)
    {
        var cached = scopeCache.TryGet(tenantId, userId);
        if (cached is not null)
            return cached;

        var tenantRole = await memberships.GetRoleAsync(tenantId, userId);
        if (tenantRole is null)
        {
            var empty = new UserRepoScope(
                tenantId,
                userId,
                TenantRole: null,
                new Dictionary<Guid, string>(),
                new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase),
                new Dictionary<Guid, string>());
            scopeCache.Set(empty);
            return empty;
        }

        var snapshot = await repoAccess.GetUserRepoScopeAsync(tenantId, userId, ct);

        var visById = new Dictionary<Guid, string>(snapshot.TenantRepos.Count);
        var idByName = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in snapshot.TenantRepos)
        {
            visById[r.Id] = r.Visibility;
            idByName[r.RepoFullName] = r.Id;
        }

        var maxByRepo = new Dictionary<Guid, string>();
        foreach (var g in snapshot.UserGrants)
        {
            maxByRepo[g.RepositoryId] = maxByRepo.TryGetValue(g.RepositoryId, out var current)
                ? RepoAccessLevels.Max(current, g.AccessLevel) ?? g.AccessLevel
                : g.AccessLevel;
        }

        var built = new UserRepoScope(tenantId, userId, tenantRole, visById, idByName, maxByRepo);
        scopeCache.Set(built);
        return built;
    }
}
