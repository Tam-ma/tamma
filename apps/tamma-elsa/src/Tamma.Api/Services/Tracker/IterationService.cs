using Tamma.Api.Dtos.Tracker;
using Tamma.Core;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-4 AC1–AC4 &amp; AC8 — iteration CRUD, three-state lifecycle
/// (<c>planned → active → closed</c>) with at-most-one-active per project,
/// three-mode carry-over on close, bulk item commitment, and SQL-computed
/// summary grouped by <see cref="WorkItemStatusCategory"/>.
/// </summary>
public sealed class IterationService(
    IProjectRepository projects,
    IIterationRepository iterations,
    IWorkItemRepository workItems,
    ITenantContext tenantContext)
{
    private void EnsureTenant()
    {
        if (tenantContext.TenantId is Guid id && id != Guid.Empty)
            return;
        throw new TammaError(
            "TRACKER.TENANT_UNRESOLVED",
            "No tenant context — every tracker table is tenant-schema resident, so this "
            + "request cannot be served. Sign in against a provisioned tenant and retry.",
            retryable: false,
            severity: TammaErrorSeverity.Medium);
    }

    public async Task<IReadOnlyList<IterationEntity>> ListByProjectAsync(Guid projectId)
    {
        EnsureTenant();
        _ = await projects.GetAsync(projectId)
            ?? throw ProjectNotFound(projectId);
        return await iterations.ListByProjectAsync(projectId);
    }

    public Task<IterationEntity?> GetAsync(Guid id)
    {
        EnsureTenant();
        return iterations.GetAsync(id);
    }

    public async Task<IterationEntity> CreateAsync(Guid projectId, CreateIterationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureTenant();

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new TammaError(
                "TRACKER.MISSING_FIELD",
                "Body field 'name' is required.",
                new Dictionary<string, object?> { ["field"] = "name" },
                retryable: false,
                severity: TammaErrorSeverity.Low);
        }

        ValidateDateRange(request.StartsOn, request.EndsOn);

        var status = string.IsNullOrWhiteSpace(request.Status)
            ? IterationRepository.StatusPlanned
            : request.Status;

        if (string.Equals(status, IterationRepository.StatusClosed, StringComparison.Ordinal))
        {
            throw new TammaError(
                "ITERATION_INVALID_TRANSITION",
                "Cannot create an iteration directly in 'closed' status; create it as 'planned' or 'active'.",
                new Dictionary<string, object?> { ["status"] = status },
                retryable: false,
                severity: TammaErrorSeverity.Low);
        }

        return await iterations.CreateAsync(new IterationEntity
        {
            ProjectId = projectId,
            Name = request.Name.Trim(),
            StartsOn = request.StartsOn,
            EndsOn = request.EndsOn,
            Status = status,
            CapacityPoints = request.CapacityPoints,
        });
    }

    public async Task<IterationTransitionResult?> PatchAsync(
        Guid id, PatchIterationRequest request, int? ifMatchVersion)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureTenant();

        if (request.StartsOn.IsSet && request.EndsOn.IsSet)
            ValidateDateRange(request.StartsOn.Value, request.EndsOn.Value);

        var patch = new IterationPatch
        {
            HasName = request.Name.IsSet,
            Name = request.Name.Value,
            HasStartsOn = request.StartsOn.IsSet,
            StartsOn = request.StartsOn.Value,
            HasEndsOn = request.EndsOn.IsSet,
            EndsOn = request.EndsOn.Value,
            HasCapacityPoints = request.CapacityPoints.IsSet,
            CapacityPoints = request.CapacityPoints.Value,
            HasStatus = request.Status.IsSet,
            Status = request.Status.Value,
            CarryOverMode = request.CarryOver,
            CarryOverTargetIterationId = request.CarryOverTargetIterationId,
        };

        return await iterations.PatchAndTransitionAsync(id, patch, ifMatchVersion);
    }

    public Task<bool> DeleteAsync(Guid id, int? ifMatchVersion)
    {
        EnsureTenant();
        return iterations.DeleteAsync(id, ifMatchVersion);
    }

    /// <summary>
    /// AC3 — bulk-commit work items into an iteration. Rejects closed iterations,
    /// missing work items, and items belonging to a different project.
    /// </summary>
    public async Task<CommitIterationItemsResponse> CommitItemsAsync(
        Guid iterationId, IReadOnlyList<Guid> workItemIds)
    {
        EnsureTenant();
        ArgumentNullException.ThrowIfNull(workItemIds);

        var iteration = await iterations.GetAsync(iterationId)
            ?? throw IterationNotFound(iterationId);

        if (string.Equals(iteration.Status, IterationRepository.StatusClosed, StringComparison.Ordinal))
        {
            throw new TammaError(
                "ITERATION_CLOSED",
                $"Cannot commit items to closed iteration '{iteration.Name}'.",
                new Dictionary<string, object?> { ["iterationId"] = iterationId },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        var distinctIds = workItemIds.Where(id => id != Guid.Empty).Distinct().ToList();
        if (distinctIds.Count == 0)
            return new CommitIterationItemsResponse(iterationId, 0, []);

        var items = await workItems.GetByIdsAsync(distinctIds);
        var byId = items.ToDictionary(w => w.Id);

        var missing = distinctIds.Where(id => !byId.ContainsKey(id)).ToList();
        if (missing.Count > 0)
        {
            throw new TammaError(
                "TRACKER.NOT_FOUND",
                $"Work item(s) not found: {string.Join(", ", missing)}.",
                new Dictionary<string, object?> { ["missingIds"] = missing },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        var wrongProject = items.Where(w => w.ProjectId != iteration.ProjectId).ToList();
        if (wrongProject.Count > 0)
        {
            throw new TammaError(
                "TRACKER.CROSS_PROJECT_ITERATION_COMMIT",
                $"Cannot commit work item(s) from another project into iteration '{iteration.Name}': "
                + string.Join(", ", wrongProject.Select(w => w.Key)),
                new Dictionary<string, object?>
                {
                    ["iterationId"] = iterationId,
                    ["iterationProjectId"] = iteration.ProjectId,
                    ["offendingIds"] = wrongProject.Select(w => w.Id).ToList(),
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        await workItems.BulkSetIterationAsync(iteration.ProjectId, distinctIds, iteration.Id);
        return new CommitIterationItemsResponse(iterationId, distinctIds.Count, distinctIds);
    }

    /// <summary>
    /// AC3 — remove a work item from an iteration (sets <c>IterationId = null</c>).
    /// Rejects items belonging to a different project.
    /// </summary>
    public async Task<bool> UncommitItemAsync(Guid iterationId, Guid workItemId)
    {
        EnsureTenant();

        var iteration = await iterations.GetAsync(iterationId)
            ?? throw IterationNotFound(iterationId);

        var item = await workItems.GetAsync(workItemId);
        if (item is null)
            return false;

        if (item.ProjectId != iteration.ProjectId)
        {
            throw new TammaError(
                "TRACKER.CROSS_PROJECT_ITERATION_COMMIT",
                $"Work item '{item.Key}' belongs to a different project than iteration '{iteration.Name}'.",
                new Dictionary<string, object?>
                {
                    ["iterationId"] = iterationId,
                    ["workItemId"] = workItemId,
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        if (item.IterationId != iterationId)
            return true;

        await workItems.BulkSetIterationAsync(iteration.ProjectId, [workItemId], null);
        return true;
    }

    /// <summary>
    /// AC8 — SQL-computed iteration summary grouped by
    /// <see cref="WorkItemStatusCategoryExtensions.Category"/> (44-0 AC3 — never
    /// a hand-written status set).
    /// </summary>
    public async Task<IterationSummaryResponse?> GetSummaryAsync(Guid iterationId)
    {
        EnsureTenant();

        var data = await iterations.GetSummaryAsync(iterationId);
        if (data is null)
            return null;

        var byCategory = Enum.GetValues<WorkItemStatusCategory>()
            .ToDictionary(c => c, _ => (Count: 0, EstimateSum: 0m));

        var totalCount = 0;
        var totalEstimate = 0m;

        foreach (var bucket in data.Buckets)
        {
            var category = WorkItemStatusExtensions.Parse(bucket.Status).Category();
            var prev = byCategory[category];
            byCategory[category] = (prev.Count + bucket.Count, prev.EstimateSum + bucket.EstimateSum);
            totalCount += bucket.Count;
            totalEstimate += bucket.EstimateSum;
        }

        var categoryList = Enum.GetValues<WorkItemStatusCategory>()
            .Select(c => new IterationSummaryCategoryResponse(
                c.ToWire(), byCategory[c].Count, byCategory[c].EstimateSum))
            .ToList();

        return new IterationSummaryResponse(
            data.Iteration.Id,
            data.Iteration.ProjectId,
            data.Iteration.Name,
            data.Iteration.Status,
            data.EstimateScale,
            data.Iteration.CapacityPoints,
            totalCount,
            totalEstimate,
            categoryList);
    }

    private static void ValidateDateRange(DateOnly? startsOn, DateOnly? endsOn)
    {
        if (startsOn is { } s && endsOn is { } e && e < s)
        {
            throw new TammaError(
                "TRACKER.INVALID_DATE_RANGE",
                $"Iteration endsOn ({e:yyyy-MM-dd}) must be on or after startsOn ({s:yyyy-MM-dd}).",
                new Dictionary<string, object?> { ["startsOn"] = s, ["endsOn"] = e },
                retryable: false,
                severity: TammaErrorSeverity.Low);
        }
    }

    private static TammaError ProjectNotFound(Guid projectId) => new(
        "TRACKER.PROJECT_NOT_FOUND",
        $"Project '{projectId}' does not exist in this tenant.",
        new Dictionary<string, object?> { ["projectId"] = projectId },
        retryable: false,
        severity: TammaErrorSeverity.Medium);

    private static TammaError IterationNotFound(Guid iterationId) => new(
        "TRACKER.ITERATION_NOT_FOUND",
        $"Iteration '{iterationId}' does not exist in this tenant.",
        new Dictionary<string, object?> { ["iterationId"] = iterationId },
        retryable: false,
        severity: TammaErrorSeverity.Medium);
}
