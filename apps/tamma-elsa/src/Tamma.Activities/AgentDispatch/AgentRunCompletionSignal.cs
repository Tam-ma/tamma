using System.Globalization;
using Tamma.Activities.AgentDispatch.Models;

namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// Story 40-2 (AC4, AC5) — the resume-input contract for <see cref="WaitForAgentRunActivity"/>.
/// The 40-3 signal (webhook / resume endpoint / reconciler) resumes the
/// <c>LifecycleBookmarks.ForAgentRun</c> bookmark with these keys; the activity reads them
/// back here into the <see cref="AgentMonitorResult"/> the collector needs.
///
/// <para><b>Serialization-tolerant (the #15/#437 lesson).</b> In-process the values arrive as
/// boxed CLR types; a serializing runtime delivers strings or <see cref="System.Text.Json.JsonElement"/>s.
/// Every read goes through <see cref="ResumeInput.AsBool"/> or a <c>ToString()</c>-then-parse,
/// never a bare <c>is true</c> / <c>is long</c>.</para>
///
/// <para><b>Fail-closed.</b> A payload that does not assert <see cref="Completed"/> or has no
/// positive run id is unreadable: <see cref="TryRead"/> returns <c>false</c> and the activity
/// produces a failed result. An unreadable signal is never a green run.</para>
/// </summary>
public static class AgentRunCompletionSignal
{
    /// <summary>Required. Truthy = the run reached a terminal state.</summary>
    public const string Completed = "Completed";

    /// <summary>Required. The GitHub <c>workflow_run</c> id (positive).</summary>
    public const string WorkflowRunId = "WorkflowRunId";

    /// <summary><c>workflow_run.status</c> (default <c>completed</c>).</summary>
    public const string Status = "Status";

    /// <summary><c>workflow_run.conclusion</c> (<c>success</c>, <c>failure</c>, …).</summary>
    public const string Conclusion = "Conclusion";

    /// <summary><c>workflow_run.html_url</c>.</summary>
    public const string WorkflowRunUrl = "WorkflowRunUrl";

    /// <summary><c>workflow_run.artifacts_url</c>.</summary>
    public const string ArtifactsUrl = "ArtifactsUrl";

    /// <summary>Optional run duration in seconds.</summary>
    public const string DurationSeconds = "DurationSeconds";

    /// <summary>
    /// Optional (Story 40-6). How the completion was observed — one of
    /// <see cref="AgentRunWaitEventTypes.WakePaths"/>. Absent ⇒ <c>webhook</c>, the only
    /// resume path that exists today.
    /// </summary>
    public const string WakePath = "WakePath";

    /// <summary>
    /// Optional. The GitHub run's <c>created_at</c> (ISO 8601, UTC). Lets a buffered completion
    /// be matched to the dispatch it belongs to (<see cref="PendingAgentRunCompletionBuffer"/>).
    /// </summary>
    public const string RunCreatedAt = "RunCreatedAt";

    /// <summary>
    /// Build a resume input from a monitor result — the shape the 40-3 resume side sends.
    /// </summary>
    public static Dictionary<string, object> ToInput(
        AgentMonitorResult result, string wakePath = AgentRunWaitEventTypes.WakePaths.Webhook,
        DateTime? runCreatedAt = null)
    {
        var input = new Dictionary<string, object>
        {
            [WakePath] = wakePath,
            [Completed] = true,
            [WorkflowRunId] = result.WorkflowRunId,
            [Status] = result.Status,
            [Conclusion] = result.Conclusion,
            [WorkflowRunUrl] = result.WorkflowRunUrl,
            [ArtifactsUrl] = result.ArtifactsUrl,
            [DurationSeconds] = result.DurationSeconds,
        };
        if (runCreatedAt is { } created)
            input[RunCreatedAt] = DateTime.SpecifyKind(created.ToUniversalTime(), DateTimeKind.Utc)
                .ToString("O", CultureInfo.InvariantCulture);
        return input;
    }

    /// <summary>
    /// The run's <c>created_at</c> (UTC), when the payload carries it. False when absent or
    /// unparseable.
    /// </summary>
    public static bool TryReadRunCreatedAt(IDictionary<string, object>? input, out DateTime runCreatedAt)
    {
        runCreatedAt = default;
        var raw = input is null ? null : Text(input, RunCreatedAt);
        if (raw is null) return false;
        if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
            return false;
        runCreatedAt = parsed;
        return true;
    }

    /// <summary>
    /// Read a resume input into an <see cref="AgentMonitorResult"/>. Returns <c>false</c>
    /// (fail-closed) when the payload is missing, does not assert completion, or has no
    /// positive run id.
    /// </summary>
    public static bool TryRead(IDictionary<string, object>? input, out AgentMonitorResult result)
    {
        result = default!;
        if (input is null) return false;

        if (!ResumeInput.AsBool(Get(input, Completed))) return false;

        if (!long.TryParse(Text(input, WorkflowRunId), NumberStyles.Integer, CultureInfo.InvariantCulture, out var runId)
            || runId <= 0)
            return false;

        int.TryParse(Text(input, DurationSeconds), NumberStyles.Integer, CultureInfo.InvariantCulture, out var duration);

        result = new AgentMonitorResult(
            WorkflowRunId: runId,
            Status: Text(input, Status) ?? "completed",
            Conclusion: Text(input, Conclusion) ?? string.Empty,
            WorkflowRunUrl: Text(input, WorkflowRunUrl) ?? string.Empty,
            DurationSeconds: Math.Max(0, duration),
            ArtifactsUrl: Text(input, ArtifactsUrl) ?? string.Empty);
        return true;
    }

    /// <summary>
    /// The wake path a resume input carries. Unknown or missing values read as
    /// <c>webhook</c> so a caller cannot write an arbitrary string into the audit row.
    /// </summary>
    public static string ReadWakePath(IDictionary<string, object>? input)
        => NormalizeWakePath(input is null ? null : Text(input, WakePath));

    /// <summary>Map a raw wake-path value onto a known one (default <c>webhook</c>).</summary>
    public static string NormalizeWakePath(string? raw)
        => raw?.Trim() switch
        {
            AgentRunWaitEventTypes.WakePaths.Poll => AgentRunWaitEventTypes.WakePaths.Poll,
            AgentRunWaitEventTypes.WakePaths.Local => AgentRunWaitEventTypes.WakePaths.Local,
            _ => AgentRunWaitEventTypes.WakePaths.Webhook,
        };

    private static object? Get(IDictionary<string, object> input, string key)
        => input.TryGetValue(key, out var v) ? v : null;

    /// <summary>
    /// String form of a resumed value. <see cref="System.Text.Json.JsonElement.ToString"/>
    /// yields the raw text for strings and numbers, so this covers the boxed, string and
    /// JsonElement paths. Blank ⇒ null.
    /// </summary>
    private static string? Text(IDictionary<string, object> input, string key)
    {
        var s = Get(input, key)?.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
