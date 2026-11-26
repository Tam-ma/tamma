using System.Text.Json;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (AC2 / D6 / D8 / D11) — CRUD service for tenant repository
/// catalogue visibility and repo access grants. Emits best-effort <c>REPO.*</c>
/// DCB events and invalidates <see cref="IUserRepoScopeCache"/> on every write.
/// </summary>
public sealed class RepoAccessService(
    IRepoAccessRepository repos,
    IUserRepoScopeCache scopeCache,
    IEventRepository events,
    ILogger<RepoAccessService> logger)
{
    public Task<List<RegisteredRepo>> ListReposAsync(Guid tenantId, CancellationToken ct = default)
        => repos.ListReposByTenantAsync(tenantId, ct);

    public Task<RegisteredRepo?> GetRepoAsync(Guid tenantId, Guid repoId, CancellationToken ct = default)
        => repos.GetRepoByIdAsync(tenantId, repoId, ct);

    public Task<List<RepoAccessGrant>> ListGrantsAsync(Guid repoId, CancellationToken ct = default)
        => repos.ListGrantsByRepoAsync(repoId, ct);

    public async Task<RegisteredRepo> RegisterRepoAsync(
        Guid tenantId,
        string platformKind,
        string repoFullName,
        string? externalId,
        string visibility,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var saved = await repos.UpsertRepoAsync(tenantId, platformKind, repoFullName, externalId, visibility, ct);
        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.RepoRegistered, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["repositoryId"] = saved.Id.ToString(),
            ["platformKind"] = saved.PlatformKind,
            ["repoFullName"] = saved.RepoFullName,
            ["visibility"] = saved.Visibility,
        });
        return saved;
    }

    public async Task<RegisteredRepo?> UpdateVisibilityAsync(
        Guid tenantId,
        Guid repoId,
        string visibility,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var updated = await repos.UpdateVisibilityAsync(tenantId, repoId, visibility, ct);
        if (updated is null) return null;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.RepoVisibilityChanged, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["repositoryId"] = updated.Id.ToString(),
            ["repoFullName"] = updated.RepoFullName,
            ["visibility"] = updated.Visibility,
        });
        return updated;
    }

    public async Task<RepoAccessGrant> UpsertGrantAsync(
        Guid tenantId,
        Guid repoId,
        Guid? userId,
        Guid? teamId,
        string accessLevel,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var grant = await repos.UpsertGrantAsync(repoId, userId, teamId, accessLevel, actorUserId, ct);
        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.RepoGrantUpserted, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["grantId"] = grant.Id.ToString(),
            ["repositoryId"] = repoId.ToString(),
            ["granteeUserId"] = userId?.ToString(),
            ["granteeTeamId"] = teamId?.ToString(),
            ["accessLevel"] = grant.AccessLevel,
        });
        return grant;
    }

    public async Task<bool> RevokeGrantAsync(
        Guid tenantId,
        Guid repoId,
        Guid grantId,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var removed = await repos.RevokeGrantAsync(repoId, grantId, ct);
        if (!removed) return false;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.RepoGrantRevoked, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["grantId"] = grantId.ToString(),
            ["repositoryId"] = repoId.ToString(),
        });
        return true;
    }

    public async Task<bool> RevokeGrantByGranteeAsync(
        Guid tenantId,
        Guid repoId,
        Guid? userId,
        Guid? teamId,
        Guid actorUserId,
        CancellationToken ct = default)
    {
        var removed = await repos.RevokeGrantByGranteeAsync(repoId, userId, teamId, ct);
        if (!removed) return false;

        scopeCache.InvalidateTenant(tenantId);
        await EmitBestEffortAsync(AccessEvents.RepoGrantRevoked, tenantId, actorUserId, new Dictionary<string, object?>
        {
            ["repositoryId"] = repoId.ToString(),
            ["granteeUserId"] = userId?.ToString(),
            ["granteeTeamId"] = teamId?.ToString(),
        });
        return true;
    }

    private async Task EmitBestEffortAsync(
        string eventType,
        Guid tenantId,
        Guid actorUserId,
        Dictionary<string, object?> data)
    {
        try
        {
            await events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = eventType,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["tenantId"] = tenantId.ToString(),
                    ["userId"] = actorUserId.ToString(),
                }),
                Metadata = """{"source":"RepoAccessService"}""",
                Data = JsonSerializer.Serialize(data),
                CreatedAt = DateTime.UtcNow,
            });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Best-effort emit of {EventType} failed", eventType);
        }
    }
}
