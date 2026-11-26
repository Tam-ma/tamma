namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-5 AC1–AC4 (D1/D4/D5/D6) — DCB event types for the tracker
/// <c>WorkItem</c> aggregate (<c>WORKITEM.ACTION.STATUS</c>).
///
/// <para><b>Tag contract (AC3 / D4):</b> every item-scoped <c>WORKITEM.*</c>
/// event carries <c>tags.issueId</c> = <c>WorkItemRef.ToWire()</c> (the exact
/// join key Epic 39 documents write), <c>tags.projectId</c>,
/// <c>tags.tenantId</c>, plus <c>tags.userId</c> and <c>tags.correlationId</c>
/// where available. Project-level ordering-apply events carry
/// <c>tags.projectKey</c>, <c>tags.projectId</c>, and <c>tags.tenantId</c>.
/// <c>DomainEvent.IssueNumber</c> is always <c>null</c>.</para>
/// </summary>
public static class WorkItemEvents
{
    /// <summary>
    /// Work item created.
    /// <para>Data: <c>{ workItemId, key, kind, status, title, priority, estimate, parentId, iterationId, assigneeUserId, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Created = "WORKITEM.CREATED.SUCCESS";

    /// <summary>
    /// Work item metadata updated via PATCH.
    /// <para>Data: <c>{ workItemId, key, kind, title, priority, estimate, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Updated = "WORKITEM.UPDATED.SUCCESS";

    /// <summary>
    /// Work item status transitioned (AC4 / D5: carries <c>from</c> and <c>to</c>).
    /// <para>Data: <c>{ workItemId, key, from, to, version }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (failure rolls back the write).</para>
    /// </summary>
    public const string StatusChanged = "WORKITEM.STATUS_CHANGED.SUCCESS";

    /// <summary>
    /// Work item assignee changed (AC4 / D5: carries <c>fromAssignee</c> and <c>toAssignee</c>).
    /// <para>Data: <c>{ workItemId, key, fromAssignee, toAssignee, version }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (failure rolls back the write).</para>
    /// </summary>
    public const string Assigned = "WORKITEM.ASSIGNED.SUCCESS";

    /// <summary>
    /// Work item reparented (AC4 / D5: carries <c>fromParentId</c> and <c>toParentId</c>).
    /// <para>Data: <c>{ workItemId, key, fromParentId, toParentId, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Reparented = "WORKITEM.REPARENTED.SUCCESS";

    /// <summary>
    /// Work item moved in backlog rank order (AC4 / D5: carries <c>fromRank</c> and <c>toRank</c>).
    /// <para>Data: <c>{ workItemId, key, fromRank, toRank, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Moved = "WORKITEM.MOVED.SUCCESS";

    /// <summary>
    /// Work item committed to an iteration.
    /// <para>Data: <c>{ workItemId, key, iterationId, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Committed = "WORKITEM.COMMITTED.SUCCESS";

    /// <summary>
    /// Work item removed from an iteration.
    /// <para>Data: <c>{ workItemId, key, iterationId, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Uncommitted = "WORKITEM.UNCOMMITTED.SUCCESS";

    /// <summary>
    /// Work item hard-deleted.
    /// <para>Data: <c>{ workItemId, key, kind, status, version }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (failure rolls back the delete).</para>
    /// </summary>
    public const string Deleted = "WORKITEM.DELETED.SUCCESS";

    /// <summary>
    /// Work item linked to an external issue/reference.
    /// <para>Data: <c>{ workItemId, key, externalRef, source, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Linked = "WORKITEM.LINKED.SUCCESS";

    /// <summary>
    /// Accepted <c>BacklogOrdering</c> document applied to project ranks.
    /// <para>Data: <c>{ projectId, documentId, revision, applied, notFound, wrongProject }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (failure rolls back the rank write).</para>
    /// </summary>
    public const string OrderingApplied = "WORKITEM.ORDERING_APPLIED.SUCCESS";

    /// <summary>
    /// <c>BacklogOrdering</c> application rejected or failed.
    /// <para>Data: <c>{ projectId, documentId, errorCode, error }</c>.</para>
    /// <para>Failure policy (D6): <b>in-transaction</b> (explicit audit failure propagation).</para>
    /// </summary>
    public const string OrderingApplyFailed = "WORKITEM.ORDERING_APPLIED.FAILED";
}
