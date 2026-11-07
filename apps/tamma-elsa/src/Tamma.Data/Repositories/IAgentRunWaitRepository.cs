using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 40-3 — the fields of one pending agent-run wait, as written on the API side
/// when the mediated dispatch succeeds. The principal is passed separately (per plane).
/// </summary>
public sealed record AgentRunWaitRegistration(
    string Repository,
    string BranchName,
    string SessionId,
    long? InstallationId,
    string WorkflowInstanceId,
    string BookmarkName,
    Guid? BookmarkTenantId,
    DateTime DispatchedAt,
    // The dispatched workflow file (the webhook matches workflow_run.path against it).
    string? WorkflowFile = null);

/// <summary>
/// Story 40-3 — durable store for <see cref="AgentRunWait"/> rows. Two parallel
/// planes (the <see cref="IAgentSelectionRepository"/> discipline): the user plane
/// lives on <c>ControlPlaneDbContext</c> (single-user), the tenant plane in the
/// tenant schema (SaaS). Every predicate pins the opposite principal key to NULL;
/// no method joins both planes.
///
/// <para>The tenant plane takes its tenant id EXPLICITLY and routes the connection
/// with it — it never reads <c>ITenantContext</c>, because the webhook path that
/// reads these rows is tenant-free (no ambient tenant is bound).</para>
/// </summary>
public interface IAgentRunWaitRepository
{
    // ── single-user plane (control plane) ──

    /// <summary>
    /// Insert or reset the pending row for <c>(user, repository, branch, session)</c>.
    /// A re-dispatch under the same session (the bounded debug retry) re-arms the
    /// existing row: new instance/bookmark/dispatch time, status back to pending.
    /// </summary>
    Task<AgentRunWait> UpsertPendingByUserAsync(
        Guid userId, AgentRunWaitRegistration registration, CancellationToken ct = default);

    /// <summary>Pending rows for this user matching the webhook key.</summary>
    Task<IReadOnlyList<AgentRunWait>> ListPendingByUserAsync(
        Guid userId, long? installationId, string repository, string branchName, CancellationToken ct = default);

    /// <summary>CAS <c>pending → received</c>. False when the row is not (or no longer) pending.</summary>
    Task<bool> TryMarkReceivedByUserAsync(
        Guid userId, Guid waitId, long workflowRunId, CancellationToken ct = default);

    Task<AgentRunWait?> GetByUserAsync(Guid userId, Guid waitId, CancellationToken ct = default);

    // ── SaaS plane (tenant schema) ──

    /// <inheritdoc cref="UpsertPendingByUserAsync"/>
    Task<AgentRunWait> UpsertPendingByTenantAsync(
        Guid tenantId, AgentRunWaitRegistration registration, CancellationToken ct = default);

    /// <summary>Pending rows for this tenant matching the webhook key.</summary>
    Task<IReadOnlyList<AgentRunWait>> ListPendingByTenantAsync(
        Guid tenantId, long? installationId, string repository, string branchName, CancellationToken ct = default);

    /// <inheritdoc cref="TryMarkReceivedByUserAsync"/>
    Task<bool> TryMarkReceivedByTenantAsync(
        Guid tenantId, Guid waitId, long workflowRunId, CancellationToken ct = default);

    Task<AgentRunWait?> GetByTenantAsync(Guid tenantId, Guid waitId, CancellationToken ct = default);

    // ── Story 40-3b — the reconciler's reads/writes ──

    /// <summary>Single-user plane: pending rows dispatched before <paramref name="dispatchedBefore"/>, oldest first.</summary>
    Task<IReadOnlyList<AgentRunWait>> ListStalePendingByUserAsync(
        DateTime dispatchedBefore, int limit, CancellationToken ct = default);

    /// <summary>
    /// Active tenants holding at least one pending row dispatched before
    /// <paramref name="dispatchedBefore"/>. One unreachable tenant schema is skipped, never fatal.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListTenantsWithStalePendingAsync(
        DateTime dispatchedBefore, CancellationToken ct = default);

    /// <summary>SaaS plane: this tenant's pending rows dispatched before <paramref name="dispatchedBefore"/>, oldest first.</summary>
    Task<IReadOnlyList<AgentRunWait>> ListStalePendingByTenantAsync(
        Guid tenantId, DateTime dispatchedBefore, int limit, CancellationToken ct = default);

    /// <summary>CAS <c>pending → timed_out</c>. False when the row is not (or no longer) pending.</summary>
    Task<bool> TryMarkTimedOutByUserAsync(Guid userId, Guid waitId, CancellationToken ct = default);

    /// <inheritdoc cref="TryMarkTimedOutByUserAsync"/>
    Task<bool> TryMarkTimedOutByTenantAsync(Guid tenantId, Guid waitId, CancellationToken ct = default);
}
