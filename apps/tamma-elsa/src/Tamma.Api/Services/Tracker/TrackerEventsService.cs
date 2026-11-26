using System.Collections.Frozen;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Tamma.Api.Auth;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-5 AC2–AC6 (D2–D6) — dedicated DCB event emitter invoked inside the
/// tracker services (never inline in endpoints), following the shipped
/// <c>AcceptanceRulesEventsService</c> precedent.
/// </summary>
public interface ITrackerEventsService
{
    // ── Project events ──
    Task EmitProjectCreatedAsync(ProjectEntity project, Guid? userId = null);
    Task EmitProjectUpdatedAsync(ProjectEntity project, Guid? userId = null);
    Task EmitProjectArchivedAsync(ProjectEntity project, Guid? userId = null);
    Task EmitProjectDeletedAsync(ProjectEntity project, Guid? userId = null);

    // ── WorkItem events ──
    Task EmitWorkItemCreatedAsync(WorkItemEntity item, string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemUpdatedAsync(WorkItemEntity item, string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemStatusChangedAsync(
        WorkItemEntity item, string fromStatus, string toStatus,
        TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemAssignedAsync(
        WorkItemEntity item, Guid? fromAssignee, Guid? toAssignee,
        TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemReparentedAsync(
        WorkItemEntity item, Guid? fromParentId, Guid? toParentId,
        string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemMovedAsync(
        WorkItemEntity item, string fromRank, string toRank,
        string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemCommittedAsync(
        WorkItemEntity item, Guid iterationId, string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemUncommittedAsync(
        WorkItemEntity item, Guid iterationId, string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemDeletedAsync(
        WorkItemEntity item, TenantDbContext? transactionDb = null,
        string? projectKey = null, Guid? userId = null);
    Task EmitWorkItemLinkedAsync(
        WorkItemEntity item, string? externalRefJson, string source = "manual",
        string? projectKey = null, Guid? userId = null);
    Task EmitOrderingAppliedAsync(
        ProjectEntity project, Guid documentId, int revision,
        int applied, int notFound, int wrongProject,
        TenantDbContext? transactionDb = null, Guid? userId = null);
    Task EmitOrderingApplyFailedAsync(
        ProjectEntity project, Guid documentId, string errorCode, string error,
        Guid? userId = null);

    // ── Iteration events ──
    Task EmitIterationCreatedAsync(IterationEntity iteration, string projectKey, Guid? userId = null);
    Task EmitIterationUpdatedAsync(IterationEntity iteration, string projectKey, Guid? userId = null);
    Task EmitIterationStartedAsync(IterationEntity iteration, string projectKey, string fromStatus, Guid? userId = null);
    Task EmitIterationClosedAsync(
        IterationEntity iteration, string projectKey, string carryOverMode,
        int movedCount, int leftCount, TenantDbContext? transactionDb = null, Guid? userId = null);
    Task EmitIterationDeletedAsync(IterationEntity iteration, string projectKey, Guid? userId = null);
    Task EmitPlanAppliedAsync(
        IterationEntity iteration, string projectKey, Guid documentId, int revision, string sprintId,
        int applied, int notFound, int wrongProject, int alreadyCommittedElsewhere, int carryOver,
        TenantDbContext? transactionDb = null, Guid? userId = null);
    Task EmitPlanApplyFailedAsync(
        IterationEntity iteration, string projectKey, Guid documentId, string errorCode, string error,
        Guid? userId = null);
}

/// <summary>
/// Story 44-5 AC2–AC6 (D2–D6) — concrete DCB emitter with explicit, test-pinned
/// transactional vs best-effort failure policy split.
/// </summary>
public sealed class TrackerEventsService(
    IEventRepository events,
    ITenantContext tenantContext,
    IHttpContextAccessor? httpContextAccessor = null,
    ILogger<TrackerEventsService>? logger = null) : ITrackerEventsService
{
    /// <summary>
    /// D6 — events whose failure MUST roll back the write transaction
    /// (authorization-relevant, ordering-relevant, destructive, or close
    /// accounting transitions).
    /// </summary>
    public static readonly FrozenSet<string> Transactional = FrozenSet.ToFrozenSet(
    [
        WorkItemEvents.StatusChanged,
        WorkItemEvents.Assigned,
        WorkItemEvents.Deleted,
        WorkItemEvents.OrderingApplied,
        WorkItemEvents.OrderingApplyFailed,
        IterationEvents.Closed,
        IterationEvents.PlanApplied,
        IterationEvents.PlanApplyFailed,
    ], StringComparer.Ordinal);

    /// <summary>
    /// D6 — events whose failure logs a warning and lets the originating
    /// mutation succeed. Partitioned disjointly with <see cref="Transactional"/>
    /// across every constant in <see cref="ProjectEvents"/>,
    /// <see cref="WorkItemEvents"/>, and <see cref="IterationEvents"/>.
    /// </summary>
    public static readonly FrozenSet<string> BestEffort = FrozenSet.ToFrozenSet(
    [
        ProjectEvents.Created,
        ProjectEvents.Updated,
        ProjectEvents.Archived,
        ProjectEvents.Deleted,
        WorkItemEvents.Created,
        WorkItemEvents.Updated,
        WorkItemEvents.Reparented,
        WorkItemEvents.Moved,
        WorkItemEvents.Committed,
        WorkItemEvents.Uncommitted,
        WorkItemEvents.Linked,
        IterationEvents.Created,
        IterationEvents.Updated,
        IterationEvents.Started,
        IterationEvents.Deleted,
    ], StringComparer.Ordinal);

    // ═══════════════════════════ Project events ═════════════════════════════

    public Task EmitProjectCreatedAsync(ProjectEntity project, Guid? userId = null) =>
        EmitProjectEventAsync(ProjectEvents.Created, project, new Dictionary<string, object?>
        {
            ["projectId"] = project.Id,
            ["key"] = project.Key,
            ["name"] = project.Name,
            ["estimateScale"] = project.EstimateScale,
            ["version"] = project.Version,
        }, userId);

    public Task EmitProjectUpdatedAsync(ProjectEntity project, Guid? userId = null) =>
        EmitProjectEventAsync(ProjectEvents.Updated, project, new Dictionary<string, object?>
        {
            ["projectId"] = project.Id,
            ["key"] = project.Key,
            ["name"] = project.Name,
            ["estimateScale"] = project.EstimateScale,
            ["version"] = project.Version,
        }, userId);

    public Task EmitProjectArchivedAsync(ProjectEntity project, Guid? userId = null) =>
        EmitProjectEventAsync(ProjectEvents.Archived, project, new Dictionary<string, object?>
        {
            ["projectId"] = project.Id,
            ["key"] = project.Key,
            ["archivedAt"] = project.ArchivedAt,
            ["version"] = project.Version,
        }, userId);

    public Task EmitProjectDeletedAsync(ProjectEntity project, Guid? userId = null) =>
        EmitProjectEventAsync(ProjectEvents.Deleted, project, new Dictionary<string, object?>
        {
            ["projectId"] = project.Id,
            ["key"] = project.Key,
        }, userId);

    // ═══════════════════════════ WorkItem events ════════════════════════════

    public Task EmitWorkItemCreatedAsync(WorkItemEntity item, string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Created, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["kind"] = item.Kind,
            ["status"] = item.Status,
            ["title"] = item.Title,
            ["priority"] = item.Priority,
            ["estimate"] = item.Estimate,
            ["parentId"] = item.ParentId,
            ["iterationId"] = item.IterationId,
            ["assigneeUserId"] = item.AssigneeUserId,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId);

    public Task EmitWorkItemUpdatedAsync(WorkItemEntity item, string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Updated, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["kind"] = item.Kind,
            ["title"] = item.Title,
            ["priority"] = item.Priority,
            ["estimate"] = item.Estimate,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId);

    public Task EmitWorkItemStatusChangedAsync(
        WorkItemEntity item, string fromStatus, string toStatus,
        TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.StatusChanged, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["from"] = fromStatus,
            ["to"] = toStatus,
            ["version"] = item.Version,
        }, transactionDb, projectKey, userId);

    public Task EmitWorkItemAssignedAsync(
        WorkItemEntity item, Guid? fromAssignee, Guid? toAssignee,
        TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Assigned, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["fromAssignee"] = fromAssignee,
            ["toAssignee"] = toAssignee,
            ["version"] = item.Version,
        }, transactionDb, projectKey, userId);

    public Task EmitWorkItemReparentedAsync(
        WorkItemEntity item, Guid? fromParentId, Guid? toParentId,
        string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Reparented, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["fromParentId"] = fromParentId,
            ["toParentId"] = toParentId,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId);

    public Task EmitWorkItemMovedAsync(
        WorkItemEntity item, string fromRank, string toRank,
        string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Moved, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["fromRank"] = fromRank,
            ["toRank"] = toRank,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId);

    public Task EmitWorkItemCommittedAsync(
        WorkItemEntity item, Guid iterationId, string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Committed, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["iterationId"] = iterationId,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId, iterationId: iterationId);

    public Task EmitWorkItemUncommittedAsync(
        WorkItemEntity item, Guid iterationId, string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Uncommitted, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["iterationId"] = iterationId,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId, iterationId: iterationId);

    public Task EmitWorkItemDeletedAsync(
        WorkItemEntity item, TenantDbContext? transactionDb = null,
        string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Deleted, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["kind"] = item.Kind,
            ["status"] = item.Status,
            ["version"] = item.Version,
        }, transactionDb, projectKey, userId);

    public Task EmitWorkItemLinkedAsync(
        WorkItemEntity item, string? externalRefJson, string source = "manual",
        string? projectKey = null, Guid? userId = null) =>
        EmitWorkItemEventAsync(WorkItemEvents.Linked, item, new Dictionary<string, object?>
        {
            ["workItemId"] = item.Id,
            ["key"] = item.Key,
            ["externalRef"] = TrackerService.ParseExternalRef(externalRefJson),
            ["source"] = source,
            ["version"] = item.Version,
        }, transactionDb: null, projectKey, userId);

    public Task EmitOrderingAppliedAsync(
        ProjectEntity project, Guid documentId, int revision,
        int applied, int notFound, int wrongProject,
        TenantDbContext? transactionDb = null, Guid? userId = null) =>
        EmitProjectEventAsync(WorkItemEvents.OrderingApplied, project, new Dictionary<string, object?>
        {
            ["projectId"] = project.Id,
            ["documentId"] = documentId,
            ["revision"] = revision,
            ["applied"] = applied,
            ["notFound"] = notFound,
            ["wrongProject"] = wrongProject,
        }, userId, transactionDb);

    public Task EmitOrderingApplyFailedAsync(
        ProjectEntity project, Guid documentId, string errorCode, string error,
        Guid? userId = null) =>
        EmitProjectEventAsync(WorkItemEvents.OrderingApplyFailed, project, new Dictionary<string, object?>
        {
            ["projectId"] = project.Id,
            ["documentId"] = documentId,
            ["errorCode"] = errorCode,
            ["error"] = error,
        }, userId);

    // ═══════════════════════════ Iteration events ═══════════════════════════

    public Task EmitIterationCreatedAsync(IterationEntity iteration, string projectKey, Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.Created, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["name"] = iteration.Name,
            ["status"] = iteration.Status,
            ["startsOn"] = iteration.StartsOn,
            ["endsOn"] = iteration.EndsOn,
            ["capacityPoints"] = iteration.CapacityPoints,
            ["version"] = iteration.Version,
        }, transactionDb: null, userId);

    public Task EmitIterationUpdatedAsync(IterationEntity iteration, string projectKey, Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.Updated, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["name"] = iteration.Name,
            ["status"] = iteration.Status,
            ["startsOn"] = iteration.StartsOn,
            ["endsOn"] = iteration.EndsOn,
            ["capacityPoints"] = iteration.CapacityPoints,
            ["version"] = iteration.Version,
        }, transactionDb: null, userId);

    public Task EmitIterationStartedAsync(
        IterationEntity iteration, string projectKey, string fromStatus, Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.Started, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["name"] = iteration.Name,
            ["from"] = fromStatus,
            ["to"] = iteration.Status,
            ["version"] = iteration.Version,
        }, transactionDb: null, userId);

    public Task EmitIterationClosedAsync(
        IterationEntity iteration, string projectKey, string carryOverMode,
        int movedCount, int leftCount, TenantDbContext? transactionDb = null, Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.Closed, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["name"] = iteration.Name,
            ["carryOverMode"] = carryOverMode,
            ["movedCount"] = movedCount,
            ["leftCount"] = leftCount,
            ["version"] = iteration.Version,
        }, transactionDb, userId);

    public Task EmitIterationDeletedAsync(IterationEntity iteration, string projectKey, Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.Deleted, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["name"] = iteration.Name,
        }, transactionDb: null, userId);

    public Task EmitPlanAppliedAsync(
        IterationEntity iteration, string projectKey, Guid documentId, int revision, string sprintId,
        int applied, int notFound, int wrongProject, int alreadyCommittedElsewhere, int carryOver,
        TenantDbContext? transactionDb = null, Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.PlanApplied, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["documentId"] = documentId,
            ["revision"] = revision,
            ["sprintId"] = sprintId,
            ["applied"] = applied,
            ["notFound"] = notFound,
            ["wrongProject"] = wrongProject,
            ["alreadyCommittedElsewhere"] = alreadyCommittedElsewhere,
            ["carryOver"] = carryOver,
        }, transactionDb, userId);

    public Task EmitPlanApplyFailedAsync(
        IterationEntity iteration, string projectKey, Guid documentId, string errorCode, string error,
        Guid? userId = null) =>
        EmitIterationEventAsync(IterationEvents.PlanApplyFailed, iteration, projectKey, new Dictionary<string, object?>
        {
            ["iterationId"] = iteration.Id,
            ["documentId"] = documentId,
            ["errorCode"] = errorCode,
            ["error"] = error,
        }, transactionDb: null, userId);

    // ═══════════════════════════ Core append ════════════════════════════════

    private Task EmitProjectEventAsync(
        string type, ProjectEntity project, IReadOnlyDictionary<string, object?> data,
        Guid? userId, TenantDbContext? transactionDb = null)
    {
        var tags = BuildBaseTags(project.Id, project.Key, userId);
        return AppendAsync(type, tags, data, transactionDb);
    }

    private Task EmitIterationEventAsync(
        string type, IterationEntity iteration, string projectKey,
        IReadOnlyDictionary<string, object?> data, TenantDbContext? transactionDb, Guid? userId)
    {
        var tags = BuildBaseTags(iteration.ProjectId, projectKey, userId);
        tags["iterationId"] = iteration.Id.ToString();
        return AppendAsync(type, tags, data, transactionDb);
    }

    private Task EmitWorkItemEventAsync(
        string type, WorkItemEntity item, IReadOnlyDictionary<string, object?> data,
        TenantDbContext? transactionDb, string? projectKey, Guid? userId, Guid? iterationId = null)
    {
        var hasRef = WorkItemRef.TryParse(item.Key, out var parsed);
        var canonicalWire = hasRef ? parsed.ToWire() : item.Key;
        var resolvedProjectKey = !string.IsNullOrWhiteSpace(projectKey)
            ? projectKey
            : (hasRef ? parsed.ProjectKey : null);

        var tags = BuildBaseTags(item.ProjectId, resolvedProjectKey, userId);
        tags["issueId"] = canonicalWire;
        if (iterationId is Guid iterId)
            tags["iterationId"] = iterId.ToString();
        return AppendAsync(type, tags, data, transactionDb);
    }

    private Dictionary<string, string?> BuildBaseTags(Guid projectId, string? projectKey, Guid? explicitUserId)
    {
        var tags = new Dictionary<string, string?>
        {
            ["projectId"] = projectId.ToString(),
        };
        if (!string.IsNullOrWhiteSpace(projectKey))
            tags["projectKey"] = projectKey;
        if (tenantContext.TenantId is Guid tid && tid != Guid.Empty)
            tags["tenantId"] = tid.ToString();

        var resolvedUserId = explicitUserId ?? httpContextAccessor?.HttpContext?.User?.GetUserId();
        if (resolvedUserId is Guid uid && uid != Guid.Empty)
            tags["userId"] = uid.ToString();

        var correlationId = ResolveCorrelationId();
        if (!string.IsNullOrWhiteSpace(correlationId))
            tags["correlationId"] = correlationId;

        return tags;
    }

    private string? ResolveCorrelationId()
    {
        var http = httpContextAccessor?.HttpContext;
        if (http is not null)
        {
            var header = http.Request.Headers["X-Correlation-Id"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(header))
                return header;
            if (!string.IsNullOrWhiteSpace(http.TraceIdentifier))
                return http.TraceIdentifier;
        }
        return Activity.Current?.TraceId.ToString();
    }

    private async Task AppendAsync(
        string type,
        Dictionary<string, string?> tags,
        IReadOnlyDictionary<string, object?> data,
        TenantDbContext? transactionDb)
    {
        var transactional = Transactional.Contains(type);

        var metadata = new Dictionary<string, object?>
        {
            ["workflowVersion"] = "1.0.0",
            ["eventSource"] = "tracker",
        };

        var evt = new DomainEvent
        {
            Type = type,
            TenantId = tenantContext.TenantId,
            // AC3 / D4: native keys (TAM-142) never fit integer IssueNumber.
            // Always left NULL; Tags.issueId is the join key.
            IssueNumber = null,
            Tags = JsonSerializer.Serialize(tags),
            Metadata = JsonSerializer.Serialize(metadata),
            Data = JsonSerializer.Serialize(data),
        };

        if (transactional)
        {
            if (transactionDb is not null)
                await events.AppendInTransactionAsync(transactionDb, evt);
            else
                await events.AppendAsync(evt);
            return;
        }

        try
        {
            await events.AppendAsync(evt);
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex,
                "Best-effort tracker event emission failed for {EventType} (tags={Tags}); originating mutation succeeded.",
                type, evt.Tags);
        }
    }
}

/// <summary>
/// No-op fallback used only when a unit test constructs a tracker service
/// directly without wiring <see cref="ITrackerEventsService"/>. Production DI
/// always binds <see cref="TrackerEventsService"/>.
/// </summary>
public sealed class NullTrackerEventsService : ITrackerEventsService
{
    public static readonly NullTrackerEventsService Instance = new();

    public Task EmitProjectCreatedAsync(ProjectEntity project, Guid? userId = null) => Task.CompletedTask;
    public Task EmitProjectUpdatedAsync(ProjectEntity project, Guid? userId = null) => Task.CompletedTask;
    public Task EmitProjectArchivedAsync(ProjectEntity project, Guid? userId = null) => Task.CompletedTask;
    public Task EmitProjectDeletedAsync(ProjectEntity project, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemCreatedAsync(WorkItemEntity item, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemUpdatedAsync(WorkItemEntity item, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemStatusChangedAsync(WorkItemEntity item, string fromStatus, string toStatus, TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemAssignedAsync(WorkItemEntity item, Guid? fromAssignee, Guid? toAssignee, TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemReparentedAsync(WorkItemEntity item, Guid? fromParentId, Guid? toParentId, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemMovedAsync(WorkItemEntity item, string fromRank, string toRank, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemCommittedAsync(WorkItemEntity item, Guid iterationId, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemUncommittedAsync(WorkItemEntity item, Guid iterationId, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemDeletedAsync(WorkItemEntity item, TenantDbContext? transactionDb = null, string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitWorkItemLinkedAsync(WorkItemEntity item, string? externalRefJson, string source = "manual", string? projectKey = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitOrderingAppliedAsync(ProjectEntity project, Guid documentId, int revision, int applied, int notFound, int wrongProject, TenantDbContext? transactionDb = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitOrderingApplyFailedAsync(ProjectEntity project, Guid documentId, string errorCode, string error, Guid? userId = null) => Task.CompletedTask;
    public Task EmitIterationCreatedAsync(IterationEntity iteration, string projectKey, Guid? userId = null) => Task.CompletedTask;
    public Task EmitIterationUpdatedAsync(IterationEntity iteration, string projectKey, Guid? userId = null) => Task.CompletedTask;
    public Task EmitIterationStartedAsync(IterationEntity iteration, string projectKey, string fromStatus, Guid? userId = null) => Task.CompletedTask;
    public Task EmitIterationClosedAsync(IterationEntity iteration, string projectKey, string carryOverMode, int movedCount, int leftCount, TenantDbContext? transactionDb = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitIterationDeletedAsync(IterationEntity iteration, string projectKey, Guid? userId = null) => Task.CompletedTask;
    public Task EmitPlanAppliedAsync(IterationEntity iteration, string projectKey, Guid documentId, int revision, string sprintId, int applied, int notFound, int wrongProject, int alreadyCommittedElsewhere, int carryOver, TenantDbContext? transactionDb = null, Guid? userId = null) => Task.CompletedTask;
    public Task EmitPlanApplyFailedAsync(IterationEntity iteration, string projectKey, Guid documentId, string errorCode, string error, Guid? userId = null) => Task.CompletedTask;
}
