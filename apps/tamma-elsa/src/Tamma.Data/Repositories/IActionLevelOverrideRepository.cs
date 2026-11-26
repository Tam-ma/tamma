using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 43-18 (AC1/AC2) — persistence seam for <c>action_level_overrides</c>.
/// Platform-global, control-plane resident (reads/writes go through
/// <c>IDbContextFactory&lt;ControlPlaneDbContext&gt;</c> directly, singleton-safe,
/// mirroring <see cref="IActionAssignmentRepository"/>).
/// </summary>
public interface IActionLevelOverrideRepository
{
    /// <summary>All platform-level overrides currently stored (bounded by
    /// catalog size; tiny by construction).</summary>
    Task<IReadOnlyList<ActionLevelOverride>> LoadAllAsync(CancellationToken ct = default);

    /// <summary>Look up one override by its <c>ActionKey</c> wire, or null.</summary>
    Task<ActionLevelOverride?> GetAsync(string actionKey, CancellationToken ct = default);

    /// <summary>
    /// Insert or update the override for <paramref name="actionKey"/>. Returns
    /// the persisted row, whether it was newly created, and the previously
    /// stored <c>Level</c> (null on insert) so audit emission records the exact
    /// transition without a separate racy read.
    /// </summary>
    Task<(ActionLevelOverride Entity, bool WasCreated, int? PreviousLevel)> UpsertAsync(
        string actionKey,
        int level,
        string? note,
        Guid? actingUserId,
        CancellationToken ct = default);

    /// <summary>
    /// Delete the override for <paramref name="actionKey"/> so resolution falls
    /// back to the catalog-shipped <c>DefaultMinAutonomy</c>. Returns
    /// <c>(false, null)</c> when no override row existed, or
    /// <c>(true, previousLevel)</c> when removed.
    /// </summary>
    Task<(bool Deleted, int? PreviousLevel)> DeleteAsync(
        string actionKey,
        CancellationToken ct = default);
}
