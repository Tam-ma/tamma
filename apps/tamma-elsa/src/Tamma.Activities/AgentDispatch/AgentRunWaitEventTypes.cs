namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// Story 40-6 — the durable agent-run WAIT lifecycle: suspended, received, timed out,
/// resume unresolved, task re-entered. One list; every emitter references it.
///
/// <para><b>The strings are frozen.</b> Rows with these types are already in
/// <c>domain_events</c>, which is append-only, and 40-4's re-entry reads them back. Changing
/// a value is a stream migration (old rows keep the old type), not a rename.
/// <c>AgentRunWaitEventTypesTests</c> pins each byte.</para>
///
/// <para><b>Not to be confused with</b> 32-5's <c>AGENT.RUN.*</c> managed-run record
/// (<c>Tamma.Api.Services.Agents.AgentRunEventTypes</c>, one character away on the wire), the
/// <c>AGENT_DISPATCH.*</c> mediation audit, <c>AGENT.EXECUTION.*</c> (activity start/end) or
/// <c>AGENT.TASK.*</c> (32-6 trail). This family records only the wait; nothing here repeats
/// one of those transitions.</para>
///
/// <para>Two-segment names (no <c>.STATUS</c>), like <c>DOCUMENT.REENTERED</c>: the outcome
/// lives in the event's <c>Status</c> field — see <see cref="StatusFor"/>.</para>
/// </summary>
public static class AgentRunWaitEventTypes
{
    /// <summary>The run was dispatched and the workflow suspended on its bookmark.</summary>
    public const string WaitSuspended = "AGENT_RUN.WAIT_SUSPENDED";

    /// <summary>The run's completion reached the waiting activity. <c>data.wakePath</c> says how.</summary>
    public const string Received = "AGENT_RUN.RECEIVED";

    /// <summary>The durable deadline fired before any completion arrived.</summary>
    public const string TimedOut = "AGENT_RUN.TIMED_OUT";

    /// <summary>A completion could not be matched to its wait (drift, engine refusal).</summary>
    public const string ResumeUnresolved = "AGENT_RUN.RESUME_UNRESOLVED";

    /// <summary>A restarted cycle skipped tasks that had already landed (Story 40-4).</summary>
    public const string TaskReentered = "AGENT_RUN.TASK_REENTERED";

    /// <summary>Every value, for the drift tests.</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        WaitSuspended, Received, TimedOut, ResumeUnresolved, TaskReentered,
    };

    /// <summary>Values of <c>data.wakePath</c> on <see cref="Received"/>.</summary>
    public static class WakePaths
    {
        /// <summary>The <c>workflow_run.completed</c> webhook (40-3).</summary>
        public const string Webhook = "webhook";
        /// <summary>The stale-wait reconciler re-polled the run (40-3b).</summary>
        public const string Poll = "poll";
        /// <summary>Single-user in-process run; no webhook involved.</summary>
        public const string Local = "local";
    }

    /// <summary>
    /// <c>Status</c> for each type. A wait that timed out or could not be resumed is an error
    /// row, never a quiet success; a suspend is a <c>started</c> row.
    /// </summary>
    public static string StatusFor(string type) => type switch
    {
        WaitSuspended => "started",
        TimedOut => "error",
        ResumeUnresolved => "error",
        _ => "success",
    };
}
