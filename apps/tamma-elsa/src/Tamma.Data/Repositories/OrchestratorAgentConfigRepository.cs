using Microsoft.EntityFrameworkCore;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 39-17 (AC6 / D8) — tenant-resident repository for
/// <c>orchestrator_agent_configs</c>. Routes every query through
/// <see cref="ITenantDbContextFactory"/>. Accepts an explicit <c>dbTenantId</c>
/// when invoked from background orchestrator instances where no HTTP ambient
/// <see cref="ITenantContext"/> exists.
/// </summary>
public sealed class OrchestratorAgentConfigRepository(
    ITenantDbContextFactory tenantDbFactory,
    ITenantContext tenantContext) : IOrchestratorAgentConfigRepository
{
    private Guid ResolveDbTenantId(Guid? explicitTenantId) =>
        explicitTenantId is { } tid && tid != Guid.Empty
            ? tid
            : tenantContext.TenantId
                ?? throw new InvalidOperationException(
                    "OrchestratorAgentConfigRepository requires a tenant id (either explicit or ambient ITenantContext).");

    public async Task<OrchestratorAgentConfigRow?> GetByUserAsync(
        Guid userId, Guid? dbTenantId = null, CancellationToken ct = default)
    {
        if (userId == Guid.Empty) return null;
        var tid = ResolveDbTenantId(dbTenantId);
        await using var db = await tenantDbFactory.CreateAsync(tid, ct);
        return await db.OrchestratorAgentConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TenantId == default(Guid?), ct);
    }

    public async Task<OrchestratorAgentConfigRow?> GetByTenantAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant id required.", nameof(tenantId));
        var tid = ResolveDbTenantId(tenantId);
        await using var db = await tenantDbFactory.CreateAsync(tid, ct);
        return await db.OrchestratorAgentConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.UserId == default(Guid?), ct);
    }

    public async Task<(OrchestratorAgentConfigRow Entity, bool WasCreated)> UpsertAsync(
        OrchestratorAgentConfigRow entity,
        Guid? actingUserId = null,
        Guid? dbTenantId = null,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entity);
        var hasUser = entity.UserId is { } u && u != Guid.Empty;
        var hasTenant = entity.TenantId is { } t && t != Guid.Empty;
        if (hasUser == hasTenant)
            throw new ArgumentException(
                "Exactly one of UserId or TenantId must be set on OrchestratorAgentConfigRow.");

        var tid = ResolveDbTenantId(dbTenantId ?? entity.TenantId);
        await using var db = await tenantDbFactory.CreateAsync(tid, ct);

        var existing = await db.OrchestratorAgentConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                r => r.UserId == entity.UserId && r.TenantId == entity.TenantId,
                ct);

        var now = DateTime.UtcNow;
        if (existing is not null)
        {
            existing.ConfigJson = entity.ConfigJson;
            existing.Version += 1;
            existing.UpdatedBy = actingUserId ?? entity.UserId;
            existing.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return (existing, false);
        }

        if (entity.Id == Guid.Empty)
            entity.Id = Guid.NewGuid();
        entity.Version = 1;
        entity.CreatedBy = actingUserId ?? entity.UserId;
        entity.UpdatedBy = actingUserId ?? entity.UserId;
        entity.CreatedAt = now;
        entity.UpdatedAt = now;
        db.OrchestratorAgentConfigs.Add(entity);
        await db.SaveChangesAsync(ct);
        return (entity, true);
    }

    public async Task<bool> DeleteByUserAsync(
        Guid userId, Guid? dbTenantId = null, CancellationToken ct = default)
    {
        if (userId == Guid.Empty) return false;
        var tid = ResolveDbTenantId(dbTenantId);
        await using var db = await tenantDbFactory.CreateAsync(tid, ct);
        var row = await db.OrchestratorAgentConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TenantId == default(Guid?), ct);
        if (row is null) return false;
        db.OrchestratorAgentConfigs.Remove(row);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> DeleteByTenantAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant id required.", nameof(tenantId));
        var tid = ResolveDbTenantId(tenantId);
        await using var db = await tenantDbFactory.CreateAsync(tid, ct);
        var row = await db.OrchestratorAgentConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.UserId == default(Guid?), ct);
        if (row is null) return false;
        db.OrchestratorAgentConfigs.Remove(row);
        await db.SaveChangesAsync(ct);
        return true;
    }
}
