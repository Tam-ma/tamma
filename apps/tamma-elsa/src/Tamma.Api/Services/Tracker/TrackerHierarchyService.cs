using Tamma.Api.Dtos.Tracker;
using Tamma.Core;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-3 (D1–D5) — hierarchy enforcement, neighbour-addressed backlog
/// moves, kind-change validation, and recursive-CTE subtree reads.
///
/// <para>All structural invariants come from Core's <see cref="TrackerHierarchy"/>
/// (<c>CanParent</c> and <c>MaxDepth</c>) and <see cref="Rank"/> — never
/// duplicated as literals or a reinstated parenting matrix.</para>
/// </summary>
public sealed class TrackerHierarchyService(
    IWorkItemRepository workItems,
    ITenantContext tenantContext,
    ITrackerEventsService? events = null)
{
    private readonly ITrackerEventsService _events = events ?? NullTrackerEventsService.Instance;

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

    /// <summary>
    /// AC1/AC2 — reparent a work item (null detaches to top-level) inside ONE
    /// serialized Postgres transaction against persisted state.
    /// </summary>
    public async Task<WorkItemEntity?> ReparentAsync(Guid id, Guid? parentId, int? ifMatchVersion)
    {
        EnsureTenant();
        var before = _events is NullTrackerEventsService ? null : await workItems.GetAsync(id);
        var updated = await workItems.ReparentTransactionalAsync(id, parentId, ifMatchVersion);
        if (updated is not null && _events is not NullTrackerEventsService)
            await _events.EmitWorkItemReparentedAsync(updated, before?.ParentId, updated.ParentId);
        return updated;
    }

    /// <summary>
    /// AC3 / D3 — neighbour-addressed move in the project backlog writing
    /// exactly ONE row (<c>Rank</c> only) via <see cref="IWorkItemRepository.SetRanksAsync"/>.
    /// </summary>
    public async Task<WorkItemEntity?> MoveAsync(
        Guid id, Guid? afterId, Guid? beforeId, int? ifMatchVersion)
    {
        EnsureTenant();

        if (afterId == id || beforeId == id)
        {
            throw new TammaError(
                "TRACKER.INVALID_MOVE_NEIGHBOR",
                "A work item cannot be moved relative to itself (afterId/beforeId must differ from id).",
                new Dictionary<string, object?> { ["workItemId"] = id },
                retryable: false,
                severity: TammaErrorSeverity.Low);
        }
        if (afterId is Guid aSame && beforeId is Guid bSame && aSame == bSame)
        {
            throw new TammaError(
                "TRACKER.INVALID_MOVE_NEIGHBOR",
                "afterId and beforeId cannot reference the same work item.",
                new Dictionary<string, object?> { ["neighborId"] = aSame },
                retryable: false,
                severity: TammaErrorSeverity.Low);
        }

        var target = await workItems.GetAsync(id);
        if (target is null)
            return null;

        WorkItemEntity? after = null;
        if (afterId is Guid aid)
        {
            after = await workItems.GetAsync(aid)
                ?? throw InvalidNeighbor("afterId", aid, "does not exist in this tenant");
            if (after.ProjectId != target.ProjectId)
                throw InvalidNeighbor("afterId", aid, "belongs to a different project");
        }

        WorkItemEntity? before = null;
        if (beforeId is Guid bid)
        {
            before = await workItems.GetAsync(bid)
                ?? throw InvalidNeighbor("beforeId", bid, "does not exist in this tenant");
            if (before.ProjectId != target.ProjectId)
                throw InvalidNeighbor("beforeId", bid, "belongs to a different project");
        }

        string newRank;
        if (after is null && before is null)
        {
            var maxRank = await workItems.GetMaxRankAsync(target.ProjectId, excludeWorkItemId: id);
            newRank = Rank.Append(maxRank);
        }
        else if (after is null)
        {
            newRank = Rank.Prepend(before!.Rank);
        }
        else if (before is null)
        {
            newRank = Rank.Append(after.Rank);
        }
        else
        {
            if (string.CompareOrdinal(after.Rank, before.Rank) >= 0)
            {
                throw new TammaError(
                    "TRACKER.INVALID_MOVE_NEIGHBOR",
                    $"Cannot place item between '{after.Key}' (rank '{after.Rank}') and "
                    + $"'{before.Key}' (rank '{before.Rank}'): afterId must sort strictly before beforeId.",
                    new Dictionary<string, object?>
                    {
                        ["afterId"] = after.Id,
                        ["afterRank"] = after.Rank,
                        ["beforeId"] = before.Id,
                        ["beforeRank"] = before.Rank,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Low);
            }
            newRank = Rank.Between(after.Rank, before.Rank);
        }

        var fromRank = target.Rank;
        var updated = await workItems.SetRanksAsync(id, newRank, siblingRank: null, expectedVersion: ifMatchVersion);
        if (updated is not null && _events is not NullTrackerEventsService)
            await _events.EmitWorkItemMovedAsync(updated, fromRank, updated.Rank);
        return updated;
    }

    /// <summary>
    /// AC5/AC6 — return the item and its descendants to <see cref="TrackerHierarchy.MaxDepth"/>
    /// in ONE recursive CTE query with SQL-aggregated direct-child roll-ups.
    /// </summary>
    public Task<List<WorkItemSubtreeNode>> GetSubtreeAsync(Guid id)
    {
        EnsureTenant();
        return workItems.GetSubtreeAsync(id, TrackerHierarchy.MaxDepth);
    }

    /// <summary>
    /// AC4 / D4 — validate changing <paramref name="existing"/>'s kind to
    /// <paramref name="newKind"/> against BOTH its current parent and ALL its
    /// direct children, collecting every violating edge rather than stopping at
    /// the first.
    /// </summary>
    public Task ValidateKindChangeAsync(WorkItemEntity existing, WorkItemKind newKind)
    {
        EnsureTenant();
        return ValidateKindChangeAsync(workItems, existing, newKind);
    }

    /// <summary>
    /// Shared static core so <see cref="TrackerService.PatchWorkItemAsync"/>
    /// enforces the exact same rule without altering its existing constructor.
    /// </summary>
    internal static async Task ValidateKindChangeAsync(
        IWorkItemRepository repo, WorkItemEntity existing, WorkItemKind newKind)
    {
        var newKindWire = newKind.ToWire();
        var violations = new List<HierarchyViolation>();

        // 1. Validate against current parent (if any).
        if (existing.ParentId is Guid parentId)
        {
            var parent = await repo.GetAsync(parentId);
            if (parent is not null)
            {
                var parentKind = WorkItemKindExtensions.Parse(parent.Kind);
                if (!TrackerHierarchy.CanParent(parentKind, newKind))
                {
                    violations.Add(new HierarchyViolation(
                        Direction: "parent",
                        RelatedItemId: parent.Id,
                        RelatedItemKey: parent.Key,
                        ParentKind: parent.Kind,
                        ChildKind: newKindWire,
                        Rule: "KIND_NOT_PERMITTED",
                        Message: $"Current parent '{parent.Key}' ({parent.Kind}) may not parent '{existing.Key}' as '{newKindWire}'."));
                }
            }
        }

        // 2. Validate against ALL direct children.
        var children = await repo.ListAsync(new WorkItemQuery
        {
            ParentId = existing.Id,
            Limit = 500,
        });
        foreach (var child in children)
        {
            var childKind = WorkItemKindExtensions.Parse(child.Kind);
            if (!TrackerHierarchy.CanParent(newKind, childKind))
            {
                violations.Add(new HierarchyViolation(
                    Direction: "child",
                    RelatedItemId: child.Id,
                    RelatedItemKey: child.Key,
                    ParentKind: newKindWire,
                    ChildKind: child.Kind,
                    Rule: "KIND_NOT_PERMITTED",
                    Message: $"'{existing.Key}' as '{newKindWire}' may not parent child '{child.Key}' ({child.Kind})."));
            }
        }

        if (violations.Count > 0)
        {
            throw new TammaError(
                "KIND_NOT_PERMITTED",
                $"Cannot change '{existing.Key}' to kind '{newKindWire}': "
                + $"{violations.Count} hierarchy relationship(s) violate TrackerHierarchy.CanParent "
                + "(KIND_NOT_PERMITTED).",
                new Dictionary<string, object?>
                {
                    ["workItemId"] = existing.Id,
                    ["targetKind"] = newKindWire,
                    ["violations"] = violations,
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }
    }

    private static TammaError InvalidNeighbor(string field, Guid id, string reason) => new(
        "TRACKER.INVALID_MOVE_NEIGHBOR",
        $"Move neighbour {field} '{id}' {reason}.",
        new Dictionary<string, object?> { ["field"] = field, ["neighborId"] = id },
        retryable: false,
        severity: TammaErrorSeverity.Low);
}
