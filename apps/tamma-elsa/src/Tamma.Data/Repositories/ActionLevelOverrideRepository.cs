using Microsoft.EntityFrameworkCore;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <inheritdoc />
/// <remarks>
/// Story 43-18 (AC1/AC2) — control-plane context DIRECTLY via
/// <see cref="IDbContextFactory{TContext}"/> (singleton-safe, identical to
/// <see cref="EfActionAssignmentRepository"/>). No tenant context, no query
/// filters.
/// </remarks>
public sealed class EfActionLevelOverrideRepository : IActionLevelOverrideRepository
{
    private readonly IDbContextFactory<ControlPlaneDbContext> _factory;

    public EfActionLevelOverrideRepository(IDbContextFactory<ControlPlaneDbContext> factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        _factory = factory;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ActionLevelOverride>> LoadAllAsync(CancellationToken ct = default)
    {
        await using var db = await _factory.CreateDbContextAsync(ct).ConfigureAwait(false);
        return await db.ActionLevelOverrides.AsNoTracking().ToListAsync(ct).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<ActionLevelOverride?> GetAsync(string actionKey, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionKey);
        await using var db = await _factory.CreateDbContextAsync(ct).ConfigureAwait(false);
        return await db.ActionLevelOverrides.AsNoTracking()
            .FirstOrDefaultAsync(r => r.ActionKey == actionKey, ct)
            .ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<(ActionLevelOverride Entity, bool WasCreated, int? PreviousLevel)> UpsertAsync(
        string actionKey,
        int level,
        string? note,
        Guid? actingUserId,
        CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionKey);

        await using var db = await _factory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var row = await db.ActionLevelOverrides
            .FirstOrDefaultAsync(r => r.ActionKey == actionKey, ct)
            .ConfigureAwait(false);

        var inserting = row is null;
        int? previousLevel = row?.Level;

        if (row is null)
        {
            row = new ActionLevelOverride
            {
                ActionKey = actionKey,
                Level = level,
                Note = string.IsNullOrEmpty(note) ? null : note,
                Version = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                CreatedBy = actingUserId,
                UpdatedBy = actingUserId,
            };
            db.ActionLevelOverrides.Add(row);
        }
        else
        {
            row.Level = level;
            if (note is not null)
            {
                row.Note = note.Length == 0 ? null : note;
            }
            row.Version += 1;
            row.UpdatedAt = DateTime.UtcNow;
            row.UpdatedBy = actingUserId;
        }

        try
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            return (row, inserting, previousLevel);
        }
        catch (DbUpdateException ex) when (inserting && IsUniqueViolation(ex))
        {
            // Concurrent writer won the insert race — retry once as update.
            db.Entry(row).State = EntityState.Detached;
            var existing = await db.ActionLevelOverrides
                .FirstOrDefaultAsync(r => r.ActionKey == actionKey, ct)
                .ConfigureAwait(false);
            if (existing is null)
            {
                throw;
            }

            var prior = existing.Level;
            existing.Level = level;
            if (note is not null)
            {
                existing.Note = note.Length == 0 ? null : note;
            }
            existing.Version += 1;
            existing.UpdatedAt = DateTime.UtcNow;
            existing.UpdatedBy = actingUserId;
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            return (existing, false, prior);
        }
    }

    /// <inheritdoc />
    public async Task<(bool Deleted, int? PreviousLevel)> DeleteAsync(
        string actionKey,
        CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionKey);

        await using var db = await _factory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var row = await db.ActionLevelOverrides
            .FirstOrDefaultAsync(r => r.ActionKey == actionKey, ct)
            .ConfigureAwait(false);
        if (row is null)
        {
            return (false, null);
        }

        var previous = row.Level;
        db.ActionLevelOverrides.Remove(row);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return (true, previous);
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";
}
