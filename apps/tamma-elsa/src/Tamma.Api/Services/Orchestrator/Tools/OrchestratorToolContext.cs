namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC1 / AC4 / D5) — server-constructed principal &amp; correlation
/// context bound to every orchestrator tool instance at construction time.
/// The LLM can NEVER override <see cref="TenantId"/> or <see cref="ActingUserId"/>
/// through tool arguments.
/// </summary>
/// <param name="TenantId">Tenant boundary for SaaS (or personal tenant in single-user mode). Required for all tenant-scoped reads.</param>
/// <param name="UserId">Sole user id in single-user mode (used by <c>get_acceptance_rules</c> when <paramref name="TenantId"/> is null).</param>
/// <param name="ActingUserId">When serving user X in 39-19 chat, carries X's user id so tools attenuate reads and writes to X's 39-20 scope. Null when acting as the tenant orchestrator principal.</param>
/// <param name="DecisionSessionId">Active acceptance decision session id, if any (stamped onto <c>ORCHESTRATOR.TOOL.INVOKED</c> tags).</param>
/// <param name="CorrelationId">Correlation id linking tool invocations to the parent request/turn.</param>
/// <param name="IssueId">Optional active issue id for audit tagging.</param>
/// <param name="AllowWriteVerbs">Whether write-capable <c>workflow_control</c> verbs (<c>dispatch</c>, <c>resume</c>, <c>cancel</c>) are permitted for this context.</param>
public sealed record OrchestratorToolContext(
    Guid? TenantId,
    Guid? UserId,
    Guid? ActingUserId,
    Guid? DecisionSessionId,
    string CorrelationId,
    string? IssueId = null,
    bool AllowWriteVerbs = false);
