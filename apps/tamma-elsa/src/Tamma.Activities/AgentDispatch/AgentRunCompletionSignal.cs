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
    /// Build a resume input from a monitor result — the shape the 40-3 resume side sends.
    /// </summary>
    public static Dictionary<string, object> ToInput(AgentMonitorResult result) => new()
    {
        [Completed] = true,
        [WorkflowRunId] = result.WorkflowRunId,
        [Status] = result.Status,
        [Conclusion] = result.Conclusion,
        [WorkflowRunUrl] = result.WorkflowRunUrl,
        [ArtifactsUrl] = result.ArtifactsUrl,
        [DurationSeconds] = result.DurationSeconds,
    };

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
