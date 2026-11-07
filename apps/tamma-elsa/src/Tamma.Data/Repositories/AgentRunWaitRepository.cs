using Microsoft.EntityFrameworkCore;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 40-3 — default <see cref="IAgentRunWaitRepository"/>. single-user rows on
/// <see cref="ControlPlaneDbContext"/>; SaaS rows in the tenant schema reached via
/// <see cref="ITenantDbContextFactory.CreateAsync"/> with the EXPLICIT tenant id
/// (never the ambient tenant — the webhook path has none).
/// </summary>
public sealed class AgentRunWaitRepository(
    ControlPlaneDbContext cpDb,
    ITenantDbContextFactory tenantDbFactory) : IAgentRunWaitRepository
{
    // ───────────────────────── single-user plane ─────────────────────────

    public Task<AgentRunWait> UpsertPendingByUserAsync(
        Guid userId, AgentRunWaitRegistration registration, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(registration);
        return UpsertAsync(cpDb, tenantId: null, userId: userId, registration, ct);
    }

    public async Task<IReadOnlyList<AgentRunWait>> ListPendingByUserAsync(
        Guid userId, long? installationId, string repository, string branchName, CancellationToken ct = default)
        => await Pending(cpDb.AgentRunWaits.AsNoTracking()
                .Where(w => w.UserId == userId && w.TenantId == default(Guid?)),
            installationId, repository, branchName)
            .ToListAsync(ct);

    public Task<bool> TryMarkReceivedByUserAsync(
        Guid userId, Guid waitId, long workflowRunId, CancellationToken ct = default)
        => MarkReceivedAsync(
            cpDb.AgentRunWaits.Where(w => w.Id == waitId && w.UserId == userId && w.TenantId == default(Guid?)),
            workflowRunId, ct);

    public Task<AgentRunWait?> GetByUserAsync(Guid userId, Guid waitId, CancellationToken ct = default)
        => cpDb.AgentRunWaits.AsNoTracking()
            .FirstOrDefaultAsync(w => w.Id == waitId && w.UserId == userId && w.TenantId == default(Guid?), ct);

    // ───────────────────────── SaaS plane ────────────────────────────────

    public async Task<AgentRunWait> UpsertPendingByTenantAsync(
        Guid tenantId, AgentRunWaitRegistration registration, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(registration);
        await using var db = await tenantDbFactory.CreateAsync(RequireTenant(tenantId), ct);
        return await UpsertAsync(db, tenantId: tenantId, userId: null, registration, ct);
    }

    public async Task<IReadOnlyList<AgentRunWait>> ListPendingByTenantAsync(
        Guid tenantId, long? installationId, string repository, string branchName, CancellationToken ct = default)
    {
        await using var db = await tenantDbFactory.CreateAsync(RequireTenant(tenantId), ct);
        return await Pending(db.AgentRunWaits.AsNoTracking().IgnoreQueryFilters()
                .Where(w => w.TenantId == tenantId && w.UserId == default(Guid?)),
            installationId, repository, branchName)
            .ToListAsync(ct);
    }

    public async Task<bool> TryMarkReceivedByTenantAsync(
        Guid tenantId, Guid waitId, long workflowRunId, CancellationToken ct = default)
    {
        await using var db = await tenantDbFactory.CreateAsync(RequireTenant(tenantId), ct);
        return await MarkReceivedAsync(
            db.AgentRunWaits.IgnoreQueryFilters()
                .Where(w => w.Id == waitId && w.TenantId == tenantId && w.UserId == default(Guid?)),
            workflowRunId, ct);
    }

    public async Task<AgentRunWait?> GetByTenantAsync(Guid tenantId, Guid waitId, CancellationToken ct = default)
    {
        await using var db = await tenantDbFactory.CreateAsync(RequireTenant(tenantId), ct);
        return await db.AgentRunWaits.AsNoTracking().IgnoreQueryFilters()
            .FirstOrDefaultAsync(w => w.Id == waitId && w.TenantId == tenantId && w.UserId == default(Guid?), ct);
    }

    // ───────────────────────── Story 40-3b: reconciler ──────────────────

    public async Task<IReadOnlyList<AgentRunWait>> ListStalePendingByUserAsync(
        DateTime dispatchedBefore, int limit, CancellationToken ct = default)
        => await cpDb.AgentRunWaits.AsNoTracking()
            .Where(w => w.UserId != default(Guid?) && w.TenantId == default(Guid?)
                        && w.Status == AgentRunWaitStatus.Pending && w.DispatchedAt < dispatchedBefore)
            .OrderBy(w => w.DispatchedAt).Take(limit)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<Guid>> ListTenantsWithStalePendingAsync(
        DateTime dispatchedBefore, CancellationToken ct = default)
    {
        // The ChannelOutboxRepository fan-out: snapshot the active tenants, keep those with work.
        var tenants = await cpDb.Tenants.AsNoTracking()
            .Where(t => t.DeletedAt == null).OrderBy(t => t.Id).Select(t => t.Id)
            .ToListAsync(ct);

        var withWork = new List<Guid>();
        foreach (var tid in tenants)
        {
            if (ct.IsCancellationRequested) break;
            try
            {
                await using var db = await tenantDbFactory.CreateAsync(tid, ct);
                if (await db.AgentRunWaits.IgnoreQueryFilters().AnyAsync(w =>
                        w.TenantId == tid && w.UserId == default(Guid?)
                        && w.Status == AgentRunWaitStatus.Pending && w.DispatchedAt < dispatchedBefore, ct))
                    withWork.Add(tid);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A tenant mid-deletion or a transient connection failure must not stop the sweep.
            }
        }
        return withWork;
    }

    public async Task<IReadOnlyList<AgentRunWait>> ListStalePendingByTenantAsync(
        Guid tenantId, DateTime dispatchedBefore, int limit, CancellationToken ct = default)
    {
        await using var db = await tenantDbFactory.CreateAsync(RequireTenant(tenantId), ct);
        return await db.AgentRunWaits.AsNoTracking().IgnoreQueryFilters()
            .Where(w => w.TenantId == tenantId && w.UserId == default(Guid?)
                        && w.Status == AgentRunWaitStatus.Pending && w.DispatchedAt < dispatchedBefore)
            .OrderBy(w => w.DispatchedAt).Take(limit)
            .ToListAsync(ct);
    }

    public Task<bool> TryMarkTimedOutByUserAsync(Guid userId, Guid waitId, CancellationToken ct = default)
        => MarkTimedOutAsync(
            cpDb.AgentRunWaits.Where(w => w.Id == waitId && w.UserId == userId && w.TenantId == default(Guid?)), ct);

    public async Task<bool> TryMarkTimedOutByTenantAsync(Guid tenantId, Guid waitId, CancellationToken ct = default)
    {
        await using var db = await tenantDbFactory.CreateAsync(RequireTenant(tenantId), ct);
        return await MarkTimedOutAsync(
            db.AgentRunWaits.IgnoreQueryFilters()
                .Where(w => w.Id == waitId && w.TenantId == tenantId && w.UserId == default(Guid?)), ct);
    }

    private static async Task<bool> MarkTimedOutAsync(IQueryable<AgentRunWait> row, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        return await row
            .Where(w => w.Status == AgentRunWaitStatus.Pending)
            .ExecuteUpdateAsync(s => s
                .SetProperty(w => w.Status, AgentRunWaitStatus.TimedOut)
                .SetProperty(w => w.UpdatedAt, now), ct) > 0;
    }

    // ── helpers ──

    private static Guid RequireTenant(Guid tenantId) => tenantId != Guid.Empty
        ? tenantId
        : throw new ArgumentException("A SaaS agent-run wait needs a non-empty tenant id.", nameof(tenantId));

    /// <summary>
    /// The webhook key match. Repository is compared case-insensitively: the webhook sends
    /// GitHub's canonical <c>full_name</c>, the row stores what the engine dispatched with, and
    /// GitHub names are case-insensitive (same lowercase-both-sides approach as
    /// <c>InstallationRepository.GetByRepoFullNameAsync</c>). Branch names are case-sensitive.
    /// </summary>
    private static IQueryable<AgentRunWait> Pending(
        IQueryable<AgentRunWait> principalRows, long? installationId, string repository, string branchName)
    {
        var repo = repository.ToLowerInvariant();
        return principalRows.Where(w =>
            w.Status == AgentRunWaitStatus.Pending
            && w.InstallationId == installationId
            && w.Repository.ToLower() == repo
            && w.BranchName == branchName);
    }

    /// <summary>Atomic CAS — one UPDATE with the status predicate; exactly one caller wins.</summary>
    private static async Task<bool> MarkReceivedAsync(
        IQueryable<AgentRunWait> row, long workflowRunId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var updated = await row
            .Where(w => w.Status == AgentRunWaitStatus.Pending)
            .ExecuteUpdateAsync(s => s
                .SetProperty(w => w.Status, AgentRunWaitStatus.Received)
                .SetProperty(w => w.WorkflowRunId, workflowRunId)
                .SetProperty(w => w.ReceivedAt, now)
                .SetProperty(w => w.UpdatedAt, now), ct);
        return updated > 0;
    }

    /// <summary>
    /// Read-then-write upsert on the principal unique key, resilient to a concurrent
    /// first-insert race (the <c>AgentSelectionRepository</c> shape): the loser of the
    /// unique violation re-reads the winner and re-arms it.
    /// </summary>
    private static async Task<AgentRunWait> UpsertAsync(
        DbContext db, Guid? tenantId, Guid? userId, AgentRunWaitRegistration r, CancellationToken ct)
    {
        var set = db.Set<AgentRunWait>();
        Task<AgentRunWait?> ReadExisting() => set.IgnoreQueryFilters().FirstOrDefaultAsync(w =>
            w.TenantId == tenantId && w.UserId == userId
            && w.Repository == r.Repository && w.BranchName == r.BranchName && w.SessionId == r.SessionId, ct);

        var existing = await ReadExisting();
        // The CAS (ExecuteUpdate) bypasses the change tracker, so a row this context already
        // tracks can be stale — re-arming it would then diff to "no change" and write nothing.
        if (existing is not null) await db.Entry(existing).ReloadAsync(ct);
        var created = existing is null;
        var entity = existing ?? new AgentRunWait
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            UserId = userId,
            Repository = r.Repository,
            BranchName = r.BranchName,
            SessionId = r.SessionId,
            CreatedAt = DateTime.UtcNow,
        };
        Arm(entity, r);
        if (created) set.Add(entity);

        try
        {
            await db.SaveChangesAsync(ct);
            return entity;
        }
        catch (DbUpdateException ex) when (created && IsUniqueViolation(ex))
        {
            db.Entry(entity).State = EntityState.Detached;
            var winner = await ReadExisting()
                ?? throw new InvalidOperationException(
                    "AgentRunWaitRepository upsert hit a unique violation but the winning row could not be re-read.");
            Arm(winner, r);
            await db.SaveChangesAsync(ct);
            return winner;
        }
    }

    private static void Arm(AgentRunWait w, AgentRunWaitRegistration r)
    {
        w.InstallationId = r.InstallationId;
        w.WorkflowInstanceId = r.WorkflowInstanceId;
        w.BookmarkName = r.BookmarkName;
        w.BookmarkTenantId = r.BookmarkTenantId;
        w.DispatchedAt = r.DispatchedAt;
        w.WorkflowFile = r.WorkflowFile;
        w.Status = AgentRunWaitStatus.Pending;
        w.WorkflowRunId = null;
        w.ReceivedAt = null;
        w.UpdatedAt = DateTime.UtcNow;
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation };
}
