namespace Tamma.Data.Entities;

/// <summary>
/// Story 40-3 — the durable correlation record for one in-flight GitHub Actions
/// coding run that a <c>WaitForAgentRunActivity</c> is suspended on.
///
/// <para>The <c>workflow_run.completed</c> webhook knows the installation, repo,
/// head branch and run id, but not the Tamma session id / bookmark name the
/// suspended wait needs. This row bridges that gap. It is written on the API side
/// when the mediated dispatch succeeds, read by the webhook resume path, and is
/// NOT a queue: delivery rides Elsa's persisted bookmark store.</para>
///
/// <para><b>Dual-resident, mode-keyed (the <see cref="AgentRoleSelection"/>
/// precedent).</b> SaaS ⇒ <see cref="TenantId"/> set, <see cref="UserId"/> NULL,
/// row in the tenant's <c>t_&lt;hex&gt;</c> schema. single-user ⇒
/// <see cref="UserId"/> set, <see cref="TenantId"/> NULL, row on the control
/// plane. Exactly one is non-null (<c>ck_agent_run_waits_principal_xor</c>).</para>
/// </summary>
public class AgentRunWait
{
    public Guid Id { get; set; }

    /// <summary>SaaS principal — set iff <see cref="UserId"/> is NULL.</summary>
    public Guid? TenantId { get; set; }

    /// <summary>single-user principal — set iff <see cref="TenantId"/> is NULL.</summary>
    public Guid? UserId { get; set; }

    /// <summary><c>owner/name</c>, as dispatched.</summary>
    public string Repository { get; set; } = null!;

    /// <summary>The dispatched ref (the agent's working branch).</summary>
    public string BranchName { get; set; } = null!;

    /// <summary>The Tamma session id (the dispatch correlation id).</summary>
    public string SessionId { get; set; } = null!;

    /// <summary>
    /// GitHub App installation id owning the repo at dispatch time; the webhook
    /// match folds it (review-finding-5 cross-tenant guard). NULL when the repo
    /// has no App installation row.
    /// </summary>
    public long? InstallationId { get; set; }

    /// <summary>The suspended Elsa workflow instance.</summary>
    public string WorkflowInstanceId { get; set; } = null!;

    /// <summary>The <c>LifecycleBookmarks.ForAgentRun</c> name the wait suspended on.</summary>
    public string BookmarkName { get; set; } = null!;

    /// <summary>
    /// The tenant segment the engine folded into <see cref="BookmarkName"/>.
    /// SaaS: equals <see cref="TenantId"/>. single-user: the personal tenant id
    /// the engine ran under, or NULL (the <c>none</c> segment). The resume side
    /// recomputes the name from this + repo/branch/session and refuses on drift.
    /// </summary>
    public Guid? BookmarkTenantId { get; set; }

    /// <summary>One of <see cref="AgentRunWaitStatus"/>.</summary>
    public string Status { get; set; } = AgentRunWaitStatus.Pending;

    /// <summary>The run id that resumed the wait (set on <c>received</c>).</summary>
    public long? WorkflowRunId { get; set; }

    public DateTime DispatchedAt { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Story 40-3 — the closed <see cref="AgentRunWait.Status"/> set.</summary>
public static class AgentRunWaitStatus
{
    public const string Pending = "pending";
    public const string Received = "received";
    public const string TimedOut = "timed_out";
}
