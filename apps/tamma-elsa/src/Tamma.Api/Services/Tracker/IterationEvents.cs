namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-5 AC1–AC3 (D1) — DCB event types for the tracker <c>Iteration</c>
/// aggregate (<c>ITERATION.ACTION.STATUS</c>).
///
/// <para><b>Tag contract (AC3 / D4):</b> every <c>ITERATION.*</c> event carries
/// <c>tags.projectKey</c>, <c>tags.projectId</c>, <c>tags.iterationId</c>,
/// <c>tags.tenantId</c>, plus <c>tags.userId</c> and <c>tags.correlationId</c>
/// where available. <c>DomainEvent.IssueNumber</c> is always <c>null</c>.</para>
/// </summary>
public static class IterationEvents
{
    /// <summary>
    /// Iteration created.
    /// <para>Data: <c>{ iterationId, name, status, startsOn, endsOn, capacityPoints, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Created = "ITERATION.CREATED.SUCCESS";

    /// <summary>
    /// Iteration metadata updated (non-transition PATCH).
    /// <para>Data: <c>{ iterationId, name, status, startsOn, endsOn, capacityPoints, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Updated = "ITERATION.UPDATED.SUCCESS";

    /// <summary>
    /// Iteration transitioned <c>planned → active</c>.
    /// <para>Data: <c>{ iterationId, name, from, to, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Started = "ITERATION.STARTED.SUCCESS";

    /// <summary>
    /// Iteration transitioned <c>active → closed</c> with carry-over accounting.
    /// <para>Data: <c>{ iterationId, name, carryOverMode, movedCount, leftCount, version }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (failure rolls back close and carry-over).</para>
    /// </summary>
    public const string Closed = "ITERATION.CLOSED.SUCCESS";

    /// <summary>
    /// Iteration deleted (work items remain with <c>IterationId = null</c>).
    /// <para>Data: <c>{ iterationId, name }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Deleted = "ITERATION.DELETED.SUCCESS";

    /// <summary>
    /// Accepted <c>SprintPlan</c> document applied to an iteration.
    /// <para>Data: <c>{ iterationId, documentId, revision, sprintId, applied, notFound, wrongProject, alreadyCommittedElsewhere, carryOver }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (failure rolls back the commitment write).</para>
    /// </summary>
    public const string PlanApplied = "ITERATION.PLAN_APPLIED.SUCCESS";

    /// <summary>
    /// <c>SprintPlan</c> application rejected or failed.
    /// <para>Data: <c>{ iterationId, documentId, errorCode, error }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (explicit audit failure propagation).</para>
    /// </summary>
    public const string PlanApplyFailed = "ITERATION.PLAN_APPLIED.FAILED";
}
