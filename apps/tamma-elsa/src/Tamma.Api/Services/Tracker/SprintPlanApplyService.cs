using Tamma.Api.Dtos.Tracker;
using Tamma.Core;
using Tamma.Data;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-4 AC9 / AC10 (D7–D10) — applies an accepted <c>SprintPlan</c>
/// document's <c>Committed</c> entries to an iteration in one idempotent
/// transaction.
///
/// <para><b>Carry-over entries are NEVER committed (AC9 / A4):</b>
/// <c>SprintPlan.CarryOver</c> lists unfinished work from a prior sprint with
/// reasons; only <c>SprintPlan.Committed</c> acquires <c>IterationId</c>.</para>
///
/// <para><b>41-6 AC3 correction in code (D9 / AC10):</b> committing an item to
/// an iteration writes <c>IterationId</c> only. It does NOT create a decision-inbox
/// entry and emits NO domain events here (Story 44-5 owns tracker emission).</para>
/// </summary>
public sealed class SprintPlanApplyService(
    IIterationRepository iterations,
    IWorkItemRepository workItems,
    ISprintPlanReader sprintPlanReader,
    ITenantContext tenantContext)
{
    public async Task<ApplySprintPlanResponse> ApplyAsync(
        Guid iterationId, Guid documentId, CancellationToken ct = default)
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

        var iteration = await iterations.GetAsync(iterationId);
        if (iteration is null)
        {
            throw new TammaError(
                "TRACKER.ITERATION_NOT_FOUND",
                $"Iteration '{iterationId}' does not exist in this tenant.",
                new Dictionary<string, object?> { ["iterationId"] = iterationId },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        if (string.Equals(iteration.Status, IterationRepository.StatusClosed, StringComparison.Ordinal))
        {
            throw new TammaError(
                "ITERATION_CLOSED",
                $"Cannot apply a sprint plan to closed iteration '{iteration.Name}'.",
                new Dictionary<string, object?> { ["iterationId"] = iterationId },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        // AC9 / D7: enforces DocumentType == "sprint-plan" and Status == "accepted" (409).
        var doc = await sprintPlanReader.ReadAcceptedAsync(tid, documentId, ct);
        var plan = doc.Plan;

        var outcomes = new List<ApplyOutcome>(plan.Committed.Count);
        var idsToCommit = new List<Guid>();
        var seenIds = new HashSet<Guid>();

        var appliedCount = 0;
        var notFoundCount = 0;
        var wrongProjectCount = 0;
        var alreadyCommittedElsewhereCount = 0;

        // AC9 / A4: apply Plan.Committed ONLY — NEVER Plan.CarryOver.
        foreach (var entry in plan.Committed)
        {
            var issueId = entry.IssueId ?? string.Empty;
            var item = await workItems.GetByKeyAsync(issueId);

            if (item is null)
            {
                notFoundCount++;
                outcomes.Add(new ApplyOutcome(
                    issueId, ApplyOutcomeCodes.NotFound, null, null));
                continue;
            }

            if (item.ProjectId != iteration.ProjectId)
            {
                wrongProjectCount++;
                outcomes.Add(new ApplyOutcome(
                    issueId, ApplyOutcomeCodes.WrongProject, item.Id, item.Key));
                continue;
            }

            if (item.IterationId is Guid existingIterationId && existingIterationId != iteration.Id)
            {
                // D8: moved into this iteration, but reported DISTINCTLY so the
                // scrum master sees cards pulled out of another iteration.
                alreadyCommittedElsewhereCount++;
                if (seenIds.Add(item.Id))
                    idsToCommit.Add(item.Id);
                outcomes.Add(new ApplyOutcome(
                    issueId,
                    ApplyOutcomeCodes.AlreadyCommittedElsewhere,
                    item.Id,
                    item.Key,
                    PreviousIterationId: existingIterationId));
                continue;
            }

            appliedCount++;
            // Idempotence by outcome (D7/D10): skip rows already attached to THIS iteration.
            if (item.IterationId != iteration.Id && seenIds.Add(item.Id))
                idsToCommit.Add(item.Id);
            outcomes.Add(new ApplyOutcome(
                issueId, ApplyOutcomeCodes.Applied, item.Id, item.Key));
        }

        if (idsToCommit.Count > 0)
            await workItems.BulkSetIterationAsync(iteration.ProjectId, idsToCommit, iteration.Id);

        return new ApplySprintPlanResponse(
            doc.DocumentId,
            doc.Revision,
            iteration.Id,
            plan.SprintId,
            appliedCount,
            notFoundCount,
            wrongProjectCount,
            alreadyCommittedElsewhereCount,
            plan.CarryOver.Count,
            outcomes);
    }
}
