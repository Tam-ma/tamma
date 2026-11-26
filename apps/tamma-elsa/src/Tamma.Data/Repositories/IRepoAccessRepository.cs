using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 39-20 (AC2 / AC3 / D6) — control-plane persistence for the minimal
/// repository catalogue and direct/team access grants, plus the precomputed
/// scope and inverse-audience queries.
/// </summary>
public interface IRepoAccessRepository
{
    Task<RegisteredRepo> UpsertRepoAsync(
        Guid tenantId,
        string platformKind,
        string repoFullName,
        string? externalId = null,
        string visibility = "tenant",
        CancellationToken ct = default);

    Task<RegisteredRepo?> GetRepoByIdAsync(Guid tenantId, Guid repositoryId, CancellationToken ct = default);
    Task<RegisteredRepo?> GetByFullNameAsync(Guid tenantId, string repoFullName, CancellationToken ct = default);
    Task<List<RegisteredRepo>> ListReposByTenantAsync(Guid tenantId, CancellationToken ct = default);
    Task<RegisteredRepo?> UpdateVisibilityAsync(Guid tenantId, Guid repositoryId, string visibility, CancellationToken ct = default);

    Task<RepoAccessGrant> UpsertGrantAsync(
        Guid repositoryId,
        Guid? userId,
        Guid? teamId,
        string accessLevel,
        Guid? createdBy,
        CancellationToken ct = default);

    Task<bool> RevokeGrantAsync(Guid repositoryId, Guid grantId, CancellationToken ct = default);
    Task<bool> RevokeGrantByGranteeAsync(Guid repositoryId, Guid? userId, Guid? teamId, CancellationToken ct = default);
    Task<List<RepoAccessGrant>> ListGrantsByRepoAsync(Guid repositoryId, CancellationToken ct = default);

    /// <summary>
    /// Single-query precompute for <c>UserRepoScopeCache</c> (D6): returns every
    /// non-deleted repo in <paramref name="tenantId"/> plus all direct AND
    /// team-transitive grant rows covering <paramref name="userId"/>.
    /// </summary>
    Task<UserRepoScopeSnapshotData> GetUserRepoScopeAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken ct = default);

    /// <summary>
    /// Inverse query for <c>EligibleAudienceAsync</c> (D6): returns every grant
    /// row (direct user or expanded via <c>team_members</c>) for
    /// <paramref name="repositoryId"/> in <paramref name="tenantId"/>.
    /// </summary>
    Task<IReadOnlyList<UserGrantEntry>> GetRepoAudienceAsync(
        Guid tenantId,
        Guid repositoryId,
        CancellationToken ct = default);
}

/// <summary>Raw DB projection for one user's tenant repo scope.</summary>
public sealed record UserRepoScopeSnapshotData(
    IReadOnlyList<RegisteredRepo> TenantRepos,
    IReadOnlyList<RepoGrantEntry> UserGrants);

/// <summary>One effective grant entry (direct or via team) for a user on a repo.</summary>
public sealed record RepoGrantEntry(Guid RepositoryId, string AccessLevel);

/// <summary>One user grant entry (direct or via team) for a repo's audience.</summary>
public sealed record UserGrantEntry(Guid UserId, string AccessLevel);
