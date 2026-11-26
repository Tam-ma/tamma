using Tamma.Api.Dtos.Tracker;
using Tamma.Core;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-3 AC7–AC9 (D7–D11) — applies an accepted <c>BacklogOrdering</c>
/// document to a project's backlog ranks in one idempotent transaction.
///
/// <para><b>Not a document-lifecycle step (D11):</b> reads the document via
/// <see cref="IBacklogOrderingReader"/>, never mutates it, and emits no
/// <c>DOCUMENT.*</c> event.</para>
/// </summary>
public sealed class OrderingApplyService(
    IProjectRepository projects,
    IWorkItemRepository workItems,
    IBacklogOrderingReader orderingReader,
    ITenantContext tenantContext,
    ITrackerEventsService? events = null)
{
    private readonly ITrackerEventsService _events = events ?? NullTrackerEventsService.Instance;

    public const string OutcomeApplied = ApplyOutcomeCodes.Applied;
    public const string OutcomeNotFound = ApplyOutcomeCodes.NotFound;
    public const string OutcomeWrongProject = ApplyOutcomeCodes.WrongProject;

    public async Task<ApplyOrderingResponse> ApplyAsync(
        Guid projectId, Guid documentId, CancellationToken ct = default)
    {
        var tenantId = tenantContext.TenantId;
        if (tenantId is not Guid tid || tid == Guid.Empty)
        {
            throw new TammaError(
                "TRACKER.TENANT_UNRESOLVED",
                "No tenant context — every tracker table is tenant-schema resident, so this "
                + "request cannot be served. Sign in against a provisioned tenant and retry.",
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        var project = await projects.GetAsync(projectId);
        if (project is null)
        {
            throw new TammaError(
                "TRACKER.PROJECT_NOT_FOUND",
                $"Project '{projectId}' does not exist in this tenant.",
                new Dictionary<string, object?> { ["projectId"] = projectId },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        // AC7 / D6: enforces DocumentType == "backlog-ordering" and Status == "accepted" (409).
        BacklogOrderingView view;
        try
        {
            view = await orderingReader.ReadAcceptedAsync(tid, documentId, ct);
        }
        catch (TammaError te)
        {
            if (_events is not NullTrackerEventsService)
                await _events.EmitOrderingApplyFailedAsync(project, documentId, te.Code, te.Message);
            throw;
        }

        // AC7 / D6b#3: ALWAYS order by BacklogItem.Rank (1-based int), NEVER array position.
        var sortedEntries = view.Entries
            .OrderBy(e => e.Rank ?? int.MaxValue)
            .ToList();

        // Load every item in this project in its current (Rank, Id) order so
        // unreferenced items can be appended after the applied set preserving
        // their relative order (AC8 / D9).
        var projectItems = await workItems.ListAllForProjectAsync(projectId);

        // Build deterministic current-key + previous-key lookups for this project
        // (current key always wins over previous key — 44-0 AC8).
        var byCurrentKey = new Dictionary<string, WorkItemEntity>(StringComparer.Ordinal);
        var byPreviousKey = new Dictionary<string, WorkItemEntity>(StringComparer.Ordinal);
        foreach (var item in projectItems)
        {
            byCurrentKey[item.Key] = item;
            foreach (var prevKey in item.PreviousKeys)
                byPreviousKey.TryAdd(prevKey, item);
        }

        var appliedItems = new List<WorkItemEntity>();
        var appliedIds = new HashSet<Guid>();
        var pendingOutcomes = new List<(string ItemId, int? DocumentRank, string Outcome, WorkItemEntity? Resolved)>();

        foreach (var entry in sortedEntries)
        {
            var itemId = entry.ItemId ?? string.Empty;
            if (!byCurrentKey.TryGetValue(itemId, out var resolved)
                && !byPreviousKey.TryGetValue(itemId, out resolved))
            {
                // Not in this project — check if it belongs to another project in the tenant.
                var anywhere = await workItems.GetByKeyAsync(itemId);
                var outcome = anywhere is not null && anywhere.ProjectId != projectId
                    ? OutcomeWrongProject
                    : OutcomeNotFound;
                pendingOutcomes.Add((itemId, entry.Rank, outcome, anywhere));
                continue;
            }

            if (appliedIds.Add(resolved.Id))
                appliedItems.Add(resolved);
            pendingOutcomes.Add((itemId, entry.Rank, OutcomeApplied, resolved));
        }

        // Compute deterministic target ranks (D9 & D10):
        // 1) Applied items get monotone increasing ranks from Rank.First() forward.
        // 2) Unreferenced items in the project are appended after the applied set
        //    in their existing (Rank, Id) relative order.
        var targetRanks = new Dictionary<Guid, string>(projectItems.Count);
        string? prevRank = null;
        foreach (var item in appliedItems)
        {
            prevRank = prevRank is null ? Rank.First() : Rank.Append(prevRank);
            targetRanks[item.Id] = prevRank;
        }
        foreach (var item in projectItems)
        {
            if (appliedIds.Contains(item.Id))
                continue;
            prevRank = prevRank is null ? Rank.First() : Rank.Append(prevRank);
            targetRanks[item.Id] = prevRank;
        }

        // AC8 / D10: idempotence by outcome — only persist rows whose Rank
        // actually changes, so a second run on the same document is a true no-op.
        var delta = new List<(Guid Id, string Rank)>();
        foreach (var item in projectItems)
        {
            var desired = targetRanks[item.Id];
            if (!string.Equals(item.Rank, desired, StringComparison.Ordinal))
                delta.Add((item.Id, desired));
        }

        var appliedCount = 0;
        var notFoundCount = 0;
        var wrongProjectCount = 0;
        var outcomes = new List<ApplyOutcome>(pendingOutcomes.Count);

        foreach (var (itemId, docRank, outcome, resolved) in pendingOutcomes)
        {
            switch (outcome)
            {
                case OutcomeApplied:
                    appliedCount++;
                    outcomes.Add(new ApplyOutcome(
                        itemId, outcome, resolved!.Id, resolved.Key, DocumentRank: docRank, NewRank: targetRanks[resolved.Id]));
                    break;
                case OutcomeWrongProject:
                    wrongProjectCount++;
                    outcomes.Add(new ApplyOutcome(
                        itemId, outcome, resolved?.Id, resolved?.Key, DocumentRank: docRank));
                    break;
                default:
                    notFoundCount++;
                    outcomes.Add(new ApplyOutcome(
                        itemId, outcome, null, null, DocumentRank: docRank));
                    break;
            }
        }

        // Story 44-5 AC6 / D6: WORKITEM.ORDERING_APPLIED.SUCCESS emits INSIDE the
        // bulk-rank write transaction so an audit failure rolls back the rank updates.
        Func<TenantDbContext, Task>? beforeCommit = _events is NullTrackerEventsService
            ? null
            : db => _events.EmitOrderingAppliedAsync(
                project, view.DocumentId, view.Revision,
                appliedCount, notFoundCount, wrongProjectCount,
                transactionDb: db);

        if (delta.Count > 0 || beforeCommit is not null)
            await workItems.BulkSetRanksAsync(projectId, delta, beforeCommit);

        return new ApplyOrderingResponse(
            view.DocumentId,
            view.Revision,
            appliedCount,
            notFoundCount,
            wrongProjectCount,
            outcomes);
    }
}
