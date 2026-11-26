namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-5 AC1–AC3 (D1) — DCB event types for the tracker <c>Project</c>
/// aggregate (<c>PROJECT.ACTION.STATUS</c>).
///
/// <para><b>Tag contract (AC3 / D4):</b> every <c>PROJECT.*</c> event carries
/// <c>tags.projectKey</c>, <c>tags.projectId</c>, <c>tags.tenantId</c>, plus
/// <c>tags.userId</c> and <c>tags.correlationId</c> where available.
/// <c>DomainEvent.IssueNumber</c> is always <c>null</c>.</para>
/// </summary>
public static class ProjectEvents
{
    /// <summary>
    /// Project created.
    /// <para>Data: <c>{ projectId, key, name, estimateScale, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Created = "PROJECT.CREATED.SUCCESS";

    /// <summary>
    /// Project metadata updated (non-archive PATCH).
    /// <para>Data: <c>{ projectId, key, name, estimateScale, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Updated = "PROJECT.UPDATED.SUCCESS";

    /// <summary>
    /// Project archived.
    /// <para>Data: <c>{ projectId, key, archivedAt, version }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Archived = "PROJECT.ARCHIVED.SUCCESS";

    /// <summary>
    /// Project deleted.
    /// <para>Data: <c>{ projectId, key }</c>.</para>
    /// <para>Failure policy (D6): <b>best-effort</b> (warn and continue).</para>
    /// </summary>
    public const string Deleted = "PROJECT.DELETED.SUCCESS";
}
