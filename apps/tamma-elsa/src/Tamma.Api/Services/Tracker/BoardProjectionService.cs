using Tamma.Api.Dtos.Tracker;
using Tamma.Core;
using Tamma.Core.Documents.Types;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-4 AC5–AC7 (D4–D6) — read-only board projection over
/// <see cref="IWorkItemRepository.BoardQueryAsync"/>. Always executes ONE SQL
/// window-function statement regardless of column count, fills the complete
/// closed-vocabulary column skeleton from <c>Enum.GetValues</c> (never a
/// hardcoded list or literal count), and caps unbounded <c>assignee</c> boards
/// at <see cref="DefaultAssigneeColumnCap"/> + <c>unassigned</c> + <c>other</c>.
/// </summary>
public sealed class BoardProjectionService(
    IWorkItemRepository workItems,
    ITenantContext tenantContext)
{
    public const int DefaultPerColumnLimit = 50;
    public const int DefaultAssigneeColumnCap = 20;
    public const string UnassignedKey = "unassigned";
    public const string OtherKey = "other";
    public const string UnprioritizedKey = "unprioritized";
    public const string BacklogIterationKey = "backlog";

    private static readonly IReadOnlyDictionary<string, int> EmptyStatusCounts =
        new Dictionary<string, int>();

    public async Task<BoardResponse> GetBoardAsync(
        Guid projectId,
        string? groupByWire,
        Guid? iterationId,
        Guid? assigneeId,
        IReadOnlyCollection<string>? kinds,
        int? perColumnLimit,
        string? columnKey = null,
        string? cursor = null)
    {
        if (tenantContext.TenantId is not Guid tid || tid == Guid.Empty)
        {
            throw new TammaError(
                "TRACKER.TENANT_UNRESOLVED",
                "No tenant context — every tracker table is tenant-schema resident, so this "
                + "request cannot be served. Sign in against a provisioned tenant and retry.",
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        // AC6 / D5: closed vocabulary; unknown groupBy fails loud naming accepted values.
        var groupBy = string.IsNullOrWhiteSpace(groupByWire)
            ? BoardGroupBy.Status
            : BoardGroupByExtensions.Parse(groupByWire);

        foreach (var k in kinds ?? [])
            _ = WorkItemKindExtensions.Parse(k);

        var (afterRank, afterId) = TrackerService.DecodeCursor(cursor);
        var limit = perColumnLimit is > 0 and <= 200 ? perColumnLimit.Value : DefaultPerColumnLimit;

        // ONE single SQL window-function query regardless of column count (AC5 / D4).
        var rows = await workItems.BoardQueryAsync(new BoardQuery
        {
            ProjectId = projectId,
            GroupBy = groupBy,
            IterationId = iterationId,
            AssigneeUserId = assigneeId,
            Kinds = kinds,
            PerColumnLimit = limit,
            ColumnKey = columnKey,
            AfterRank = afterRank,
            AfterId = afterId,
        });

        var grouped = rows
            .GroupBy(r => r.GroupKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        return groupBy switch
        {
            BoardGroupBy.Status => BuildStatusBoard(projectId, limit, grouped, columnKey),
            BoardGroupBy.Kind => BuildKindBoard(projectId, limit, grouped, columnKey),
            BoardGroupBy.Priority => BuildPriorityBoard(projectId, limit, grouped, columnKey),
            BoardGroupBy.Assignee => BuildAssigneeBoard(projectId, limit, grouped),
            BoardGroupBy.Iteration => BuildIterationBoard(projectId, limit, grouped),
            _ => throw new ArgumentOutOfRangeException(nameof(groupBy), groupBy, null),
        };
    }

    private static BoardResponse BuildStatusBoard(
        Guid projectId, int limit, Dictionary<string, List<BoardItemRow>> grouped, string? columnKey)
    {
        // AC7 / D6 / A1: derive skeleton directly from Enum.GetValues<WorkItemStatus>() —
        // never a hardcoded list and never a hardcoded count.
        var statuses = Enum.GetValues<WorkItemStatus>();
        var columns = new List<BoardColumnResponse>(statuses.Length);

        foreach (var status in statuses)
        {
            var wire = status.ToWire();
            if (columnKey is not null && !string.Equals(wire, columnKey, StringComparison.Ordinal))
                continue;
            grouped.TryGetValue(wire, out var bucket);
            columns.Add(BuildColumn(wire, LabelFromWire(wire), bucket, limit));
        }

        return new BoardResponse(
            projectId, BoardGroupBy.Status.ToWire(), limit, ColumnCap: null, FoldedColumnCount: 0, columns);
    }

    private static BoardResponse BuildKindBoard(
        Guid projectId, int limit, Dictionary<string, List<BoardItemRow>> grouped, string? columnKey)
    {
        var kinds = Enum.GetValues<WorkItemKind>();
        var columns = new List<BoardColumnResponse>(kinds.Length);

        foreach (var kind in kinds)
        {
            var wire = kind.ToWire();
            if (columnKey is not null && !string.Equals(wire, columnKey, StringComparison.Ordinal))
                continue;
            grouped.TryGetValue(wire, out var bucket);
            columns.Add(BuildColumn(wire, LabelFromWire(wire), bucket, limit));
        }

        return new BoardResponse(
            projectId, BoardGroupBy.Kind.ToWire(), limit, ColumnCap: null, FoldedColumnCount: 0, columns);
    }

    private static BoardResponse BuildPriorityBoard(
        Guid projectId, int limit, Dictionary<string, List<BoardItemRow>> grouped, string? columnKey)
    {
        var keys = Enum.GetValues<TriagePriority>()
            .Select(p => p.ToWire())
            .Append(UnprioritizedKey)
            .ToList();
        var columns = new List<BoardColumnResponse>(keys.Count);

        foreach (var wire in keys)
        {
            if (columnKey is not null && !string.Equals(wire, columnKey, StringComparison.Ordinal))
                continue;
            grouped.TryGetValue(wire, out var bucket);
            columns.Add(BuildColumn(wire, LabelFromWire(wire), bucket, limit));
        }

        return new BoardResponse(
            projectId, BoardGroupBy.Priority.ToWire(), limit, ColumnCap: null, FoldedColumnCount: 0, columns);
    }

    private static BoardResponse BuildAssigneeBoard(
        Guid projectId, int limit, Dictionary<string, List<BoardItemRow>> grouped)
    {
        // D6: cap unbounded assignee columns at DefaultAssigneeColumnCap (20) by item
        // count, keep `unassigned` as a distinguished column, and fold the remainder into `other`.
        grouped.TryGetValue(UnassignedKey, out var unassignedBucket);

        var assigned = grouped
            .Where(kv => !string.Equals(kv.Key, UnassignedKey, StringComparison.Ordinal))
            .OrderByDescending(kv => kv.Value[0].GroupTotal)
            .ThenBy(kv => kv.Key, StringComparer.Ordinal)
            .ToList();

        var top = assigned.Take(DefaultAssigneeColumnCap).ToList();
        var overflow = assigned.Skip(DefaultAssigneeColumnCap).ToList();

        var columns = new List<BoardColumnResponse>(top.Count + 2);
        foreach (var (key, bucket) in top)
            columns.Add(BuildColumn(key, key, bucket, limit));

        columns.Add(BuildColumn(UnassignedKey, "Unassigned", unassignedBucket, limit));

        if (overflow.Count > 0)
        {
            var foldedTotal = overflow.Sum(kv => kv.Value[0].GroupTotal);
            var foldedItems = overflow
                .SelectMany(kv => kv.Value)
                .OrderBy(r => r.Item.Rank, StringComparer.Ordinal)
                .ThenBy(r => r.Item.Id)
                .Take(limit)
                .ToList();
            var hasMore = foldedTotal > foldedItems.Count;
            var nextCursor = hasMore && foldedItems.Count > 0
                ? TrackerService.EncodeCursor(foldedItems[^1].Item.Rank, foldedItems[^1].Item.Id)
                : null;
            columns.Add(new BoardColumnResponse(
                OtherKey,
                "Other",
                foldedItems.Select(MapItem).ToList(),
                foldedTotal,
                hasMore,
                nextCursor));
        }

        return new BoardResponse(
            projectId,
            BoardGroupBy.Assignee.ToWire(),
            limit,
            ColumnCap: DefaultAssigneeColumnCap,
            FoldedColumnCount: overflow.Count,
            columns);
    }

    private static BoardResponse BuildIterationBoard(
        Guid projectId, int limit, Dictionary<string, List<BoardItemRow>> grouped)
    {
        var columns = new List<BoardColumnResponse>(grouped.Count);
        foreach (var (key, bucket) in grouped.OrderBy(kv => kv.Key == BacklogIterationKey ? 0 : 1)
            .ThenBy(kv => kv.Key, StringComparer.Ordinal))
        {
            var label = key == BacklogIterationKey ? "Backlog" : key;
            columns.Add(BuildColumn(key, label, bucket, limit));
        }

        return new BoardResponse(
            projectId, BoardGroupBy.Iteration.ToWire(), limit, ColumnCap: null, FoldedColumnCount: 0, columns);
    }

    private static BoardColumnResponse BuildColumn(
        string key, string label, List<BoardItemRow>? rawBucket, int limit)
    {
        if (rawBucket is null || rawBucket.Count == 0)
            return new BoardColumnResponse(key, label, [], 0, HasMore: false, NextCursor: null);

        var totalCount = rawBucket[0].GroupTotal;
        var hasMore = rawBucket.Count > limit;
        var page = hasMore ? rawBucket.Take(limit).ToList() : rawBucket;
        var nextCursor = hasMore && page.Count > 0
            ? TrackerService.EncodeCursor(page[^1].Item.Rank, page[^1].Item.Id)
            : null;

        return new BoardColumnResponse(
            key,
            label,
            page.Select(MapItem).ToList(),
            totalCount,
            hasMore,
            nextCursor);
    }

    private static WorkItemResponse MapItem(BoardItemRow r)
    {
        var w = r.Item;
        return new WorkItemResponse(
            w.Id, w.ProjectId, w.Key, w.PreviousKeys, w.Number, w.Kind, w.Status,
            WorkItemStatusExtensions.Parse(w.Status).Category().ToWire(),
            w.Priority, w.IssueType, w.Title, w.Description, w.ParentId, w.IterationId,
            w.Rank, w.SiblingRank, w.AssigneeUserId, w.CreatedByUserId, w.Estimate,
            TrackerService.ParseExternalRef(w.ExternalRefJson),
            w.CreatedAt, w.UpdatedAt, w.ClosedAt, w.Version,
            r.ChildCount, r.ChildCountByStatus ?? EmptyStatusCounts);
    }

    private static string LabelFromWire(string wire) =>
        string.Join(' ', wire.Split('_', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => char.ToUpperInvariant(part[0]) + part[1..]));
}
