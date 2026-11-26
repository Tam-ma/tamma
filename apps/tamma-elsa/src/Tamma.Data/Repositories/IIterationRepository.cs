using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 44-4 AC1/AC2/AC4 — tri-state patch + lifecycle transition payload for
/// <see cref="IIterationRepository.PatchAndTransitionAsync"/>.
/// </summary>
public sealed record IterationPatch
{
    public bool HasName { get; init; }
    public string? Name { get; init; }
    public bool HasStartsOn { get; init; }
    public DateOnly? StartsOn { get; init; }
    public bool HasEndsOn { get; init; }
    public DateOnly? EndsOn { get; init; }
    public bool HasCapacityPoints { get; init; }
    public decimal? CapacityPoints { get; init; }
    public bool HasStatus { get; init; }
    public string? Status { get; init; }
    public string? CarryOverMode { get; init; }
    public Guid? CarryOverTargetIterationId { get; init; }
}

/// <summary>Result of patching / transitioning an iteration (including carry-over counts when closing).</summary>
public sealed record IterationTransitionResult(
    IterationEntity Iteration,
    int MovedCount,
    int LeftCount,
    string PreviousStatus = "");

/// <summary>Per-status SQL aggregation row for <see cref="IterationSummaryData"/>.</summary>
public sealed record IterationStatusBucket(
    string Status,
    int Count,
    decimal EstimateSum);

/// <summary>
/// Single-query SQL aggregation result for <c>GET /api/iterations/{id}/summary</c>
/// (Story 44-4 AC8). Category grouping is derived from <c>WorkItemStatus.Category()</c>
/// in the service layer — never a hardcoded status set literal in SQL.
/// </summary>
public sealed record IterationSummaryData(
    IterationEntity Iteration,
    string EstimateScale,
    IReadOnlyList<IterationStatusBucket> Buckets);

/// <summary>
/// Persistence seam for <c>iterations</c> (Story 44-1; populated by 44-4).
/// <b>No mode split</b> (story AC7 / epic D6): an iteration is tenant-schema content.
/// </summary>
public interface IIterationRepository
{
    Task<IterationEntity?> GetAsync(Guid id);
    Task<List<IterationEntity>> ListByProjectAsync(Guid projectId);

    /// <summary>
    /// Create an iteration. Status must be one of <c>planned|active|closed</c>.
    /// Enforces at-most-one-active per project transactionally (<c>ITERATION_ALREADY_ACTIVE</c>).
    /// </summary>
    Task<IterationEntity> CreateAsync(IterationEntity iteration);

    /// <summary>Update name/dates/status/capacity. Bumps <see cref="IterationEntity.Version"/>.</summary>
    Task<IterationEntity?> UpdateAsync(IterationEntity iteration, int? expectedVersion = null);

    /// <summary>
    /// Story 44-4 AC1/AC2/AC4 — apply metadata patches and/or lifecycle status
    /// transitions (<c>planned → active → closed</c>) inside ONE serialized
    /// transaction under the project row lock (<c>SELECT ... FOR UPDATE</c>),
    /// executing carry-over atomically when closing.
    /// </summary>
    Task<IterationTransitionResult?> PatchAndTransitionAsync(
        Guid id, IterationPatch patch, int? expectedVersion = null,
        Func<TenantDbContext, IterationTransitionResult, Task>? beforeCommit = null);

    /// <summary>
    /// Delete an iteration. Work items referencing it get
    /// <c>IterationId = NULL</c> (FK <c>SET NULL</c>) — items outlive sprints.
    /// </summary>
    Task<bool> DeleteAsync(Guid id, int? expectedVersion = null);

    /// <summary>
    /// Story 44-4 AC8 — single-query SQL summary of committed items &amp; estimates
    /// grouped by raw status wire (service maps through <c>WorkItemStatus.Category()</c>).
    /// </summary>
    Task<IterationSummaryData?> GetSummaryAsync(Guid id);
}
