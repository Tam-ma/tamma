namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC2 / AC5 / Step 3) — canonical DCB event-type constants emitted
/// by the Orchestrator Agent host, session lifecycle, audited toolset, and config
/// endpoints.
///
/// <para>Every constant conforms to the 3–4 segment <c>AGGREGATE.ACTION.STATUS</c>
/// naming discipline enforced by <c>EventTypeNamingRatchetTests</c>.</para>
///
/// <para>Events owned by sibling stories are NOT duplicated here:
/// <c>APPROVAL.PROVIDED</c> / <c>ESCALATION.RESOLVED</c> (Story 39-8),
/// <c>TASK.ASSIGNED.SUCCESS</c> (Story 39-20),
/// <c>GUIDANCE.REQUESTED</c> / <c>GUIDANCE.PROVIDED</c> (Story 39-18),
/// and <c>CHAT.*</c> (Story 39-19).</para>
/// </summary>
public static class OrchestratorEvents
{
    /// <summary>Emitted by <c>AuditedToolRegistry</c> around every orchestrator tool execution (with SHA-256 args digest, never raw args).</summary>
    public const string ToolInvoked = "ORCHESTRATOR.TOOL.INVOKED";

    /// <summary>Emitted after every orchestrator decision, role assignment, escalation disposition, guidance reply, or conversation reply.</summary>
    public const string DecisionMade = "ORCHESTRATOR.DECISION.MADE";

    /// <summary>Emitted when a per-tenant orchestrator agent instance starts fresh.</summary>
    public const string SessionStarted = "ORCHESTRATOR.SESSION.STARTED";

    /// <summary>Emitted when an orchestrator agent instance re-hydrates its bootstrap context from the DCB stream after restart.</summary>
    public const string SessionRehydrated = "ORCHESTRATOR.SESSION.REHYDRATED";

    /// <summary>Emitted when an idle or explicitly stopped orchestrator agent instance is evicted from the registry.</summary>
    public const string SessionEvicted = "ORCHESTRATOR.SESSION.EVICTED";

    /// <summary>Emitted on a successful <c>PUT /api/orchestrator/config</c> mutation.</summary>
    public const string ConfigUpdated = "ORCHESTRATOR.CONFIG.UPDATED.SUCCESS";

    /// <summary>Emitted on a successful <c>DELETE /api/orchestrator/config</c> reset-to-defaults mutation.</summary>
    public const string ConfigDeleted = "ORCHESTRATOR.CONFIG.DELETED.SUCCESS";
}
