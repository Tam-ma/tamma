using Microsoft.EntityFrameworkCore;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <inheritdoc />
public sealed class RepoAccessRepository(ControlPlaneDbContext db) : IRepoAccessRepository
{
    public async Task<RegisteredRepo> UpsertRepoAsync(
        Guid tenantId,
        string platformKind,
        string repoFullName,
        string? externalId = null,
        string visibility = "tenant",
        CancellationToken ct = default)
    {
        var normalizedPlatform = string.IsNullOrWhiteSpace(platformKind)
            ? "github"
            : platformKind.Trim().ToLowerInvariant();
        var trimmedName = repoFullName.Trim();

        var existing = await db.RegisteredRepos.FirstOrDefaultAsync(
            r => r.TenantId == tenantId
                 && r.PlatformKind == normalizedPlatform
                 && r.RepoFullName == trimmedName,
            ct);

        var now = DateTime.UtcNow;
        if (existing is not null)
        {
            existing.DeletedAt = null;
            if (!string.IsNullOrWhiteSpace(externalId))
                existing.ExternalId = externalId;
            existing.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var created = new RegisteredRepo
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PlatformKind = normalizedPlatform,
            RepoFullName = trimmedName,
            ExternalId = externalId,
            Visibility = visibility,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.RegisteredRepos.Add(created);
        await db.SaveChangesAsync(ct);
        return created;
    }

    public Task<RegisteredRepo?> GetRepoByIdAsync(
        Guid tenantId,
        Guid repositoryId,
        CancellationToken ct = default)
        => db.RegisteredRepos
            .AsNoTracking()
            .FirstOrDefaultAsync(
                r => r.TenantId == tenantId && r.Id == repositoryId && r.DeletedAt == null,
                ct);

    public Task<RegisteredRepo?> GetByFullNameAsync(
        Guid tenantId,
        string repoFullName,
        CancellationToken ct = default)
        => db.RegisteredRepos
            .AsNoTracking()
            .FirstOrDefaultAsync(
                r => r.TenantId == tenantId && r.RepoFullName == repoFullName && r.DeletedAt == null,
                ct);

    public Task<List<RegisteredRepo>> ListReposByTenantAsync(
        Guid tenantId,
        CancellationToken ct = default)
        => db.RegisteredRepos
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.DeletedAt == null)
            .OrderBy(r => r.RepoFullName)
            .ToListAsync(ct);

    public async Task<RegisteredRepo?> UpdateVisibilityAsync(
        Guid tenantId,
        Guid repositoryId,
        string visibility,
        CancellationToken ct = default)
    {
        var existing = await db.RegisteredRepos.FirstOrDefaultAsync(
            r => r.TenantId == tenantId && r.Id == repositoryId && r.DeletedAt == null,
            ct);
        if (existing is null) return null;

        existing.Visibility = visibility;
        existing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return existing;
    }

    public async Task<RepoAccessGrant> UpsertGrantAsync(
        Guid repositoryId,
        Guid? userId,
        Guid? teamId,
        string accessLevel,
        Guid? createdBy,
        CancellationToken ct = default)
    {
        var existing = await db.RepoAccessGrants.FirstOrDefaultAsync(
            g => g.RepositoryId == repositoryId && g.UserId == userId && g.TeamId == teamId,
            ct);

        var now = DateTime.UtcNow;
        if (existing is not null)
        {
            existing.AccessLevel = accessLevel;
            existing.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var grant = new RepoAccessGrant
        {
            Id = Guid.NewGuid(),
            RepositoryId = repositoryId,
            UserId = userId,
            TeamId = teamId,
            AccessLevel = accessLevel,
            CreatedBy = createdBy,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.RepoAccessGrants.Add(grant);
        await db.SaveChangesAsync(ct);
        return grant;
    }

    public async Task<bool> RevokeGrantAsync(
        Guid repositoryId,
        Guid grantId,
        CancellationToken ct = default)
    {
        var existing = await db.RepoAccessGrants.FirstOrDefaultAsync(
            g => g.RepositoryId == repositoryId && g.Id == grantId,
            ct);
        if (existing is null) return false;

        db.RepoAccessGrants.Remove(existing);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> RevokeGrantByGranteeAsync(
        Guid repositoryId,
        Guid? userId,
        Guid? teamId,
        CancellationToken ct = default)
    {
        var existing = await db.RepoAccessGrants.FirstOrDefaultAsync(
            g => g.RepositoryId == repositoryId && g.UserId == userId && g.TeamId == teamId,
            ct);
        if (existing is null) return false;

        db.RepoAccessGrants.Remove(existing);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public Task<List<RepoAccessGrant>> ListGrantsByRepoAsync(
        Guid repositoryId,
        CancellationToken ct = default)
        => db.RepoAccessGrants
            .AsNoTracking()
            .Where(g => g.RepositoryId == repositoryId)
            .OrderBy(g => g.CreatedAt)
            .ToListAsync(ct);

    public async Task<UserRepoScopeSnapshotData> GetUserRepoScopeAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken ct = default)
    {
        var repos = await db.RegisteredRepos
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.DeletedAt == null)
            .ToListAsync(ct);

        // Single union query: direct user grants + team-transitive grants via team_members.
        var directGrants = db.RepoAccessGrants
            .AsNoTracking()
            .Where(g => g.UserId == userId
                        && g.Repository.TenantId == tenantId
                        && g.Repository.DeletedAt == null)
            .Select(g => new { g.RepositoryId, g.AccessLevel });

        var teamGrants =
            from g in db.RepoAccessGrants.AsNoTracking()
            join m in db.TeamMembers.AsNoTracking() on g.TeamId equals m.TeamId
            where m.UserId == userId
                  && g.Repository.TenantId == tenantId
                  && g.Repository.DeletedAt == null
            select new { g.RepositoryId, g.AccessLevel };

        var rawGrants = await directGrants.Concat(teamGrants).ToListAsync(ct);
        var grants = rawGrants.Select(x => new RepoGrantEntry(x.RepositoryId, x.AccessLevel)).ToList();

        return new UserRepoScopeSnapshotData(repos, grants);
    }

    public async Task<IReadOnlyList<UserGrantEntry>> GetRepoAudienceAsync(
        Guid tenantId,
        Guid repositoryId,
        CancellationToken ct = default)
    {
        var direct = db.RepoAccessGrants
            .AsNoTracking()
            .Where(g => g.RepositoryId == repositoryId
                        && g.UserId != null
                        && g.Repository.TenantId == tenantId
                        && g.Repository.DeletedAt == null)
            .Select(g => new { UserId = g.UserId!.Value, g.AccessLevel });

        var viaTeam =
            from g in db.RepoAccessGrants.AsNoTracking()
            join m in db.TeamMembers.AsNoTracking() on g.TeamId equals m.TeamId
            where g.RepositoryId == repositoryId
                  && g.Repository.TenantId == tenantId
                  && g.Repository.DeletedAt == null
            select new { m.UserId, g.AccessLevel };

        var raw = await direct.Concat(viaTeam).ToListAsync(ct);
        return raw.Select(x => new UserGrantEntry(x.UserId, x.AccessLevel)).ToList();
    }
}
