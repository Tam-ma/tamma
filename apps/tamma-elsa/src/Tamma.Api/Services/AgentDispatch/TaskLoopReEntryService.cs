using System.Text.Json;
using Tamma.Activities.AgentDispatch;
using Tamma.Core.AgentDispatch.Resume;
using Tamma.Core.Logging;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.AgentDispatch;

/// <summary>
/// Story 40-4 (AC1, AC5, AC8, AC9) — the real task-loop re-entry read. Gathers three inputs
/// and hands them to the pure <see cref="TaskLoopResumeCalculator"/>:
/// <list type="number">
///   <item><b>Runs</b> — the Story 40-6 <c>AGENT_RUN.RECEIVED</c> / <c>WAIT_SUSPENDED</c> rows for
///     this issue (the 4-7 query by tenant, type, issue), kept to this repo + branch and grouped
///     by task index.</item>
///   <item><b>The stored task list</b> — the accepted task-breakdown <c>plan</c> (39-15), the only
///     order-stable copy of the list the indices refer to. Never a freshly generated one.</item>
///   <item><b>Git</b> — the paths changed on the branch, through the tenant's own mediated driver
///     (<see cref="IAgentDispatchMediationService.ListBranchChangedFilesAsync"/>).</item>
/// </list>
/// <para>Runs only in Tamma.Api (it needs the tenant's stores and git driver); the engine reaches
/// it through <see cref="HttpTaskLoopReEntryService"/>. Mode-agnostic: the tenant comes from the
/// request scope — the SaaS tenant, or single-user's personal tenant.</para>
/// </summary>
public sealed class TaskLoopReEntryService : ITaskLoopReEntryService
{
    /// <summary>Upper bound on rows read per event type for one issue.</summary>
    internal const int EventReadLimit = 1000;

    private readonly IEventRepository _events;
    private readonly IDocumentInstanceRepository _documents;
    private readonly IAgentDispatchMediationService _git;
    private readonly ILogger<TaskLoopReEntryService> _logger;

    public TaskLoopReEntryService(
        IEventRepository events,
        IDocumentInstanceRepository documents,
        IAgentDispatchMediationService git,
        ILogger<TaskLoopReEntryService> logger)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _documents = documents ?? throw new ArgumentNullException(nameof(documents));
        _git = git ?? throw new ArgumentNullException(nameof(git));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<TaskLoopResumePosition> ReconstructAsync(
        Guid? tenantId, string repository, string branchName, int issueNumber, CancellationToken ct)
    {
        if (tenantId is not Guid tid || tid == Guid.Empty)
            return TaskLoopResumePosition.Start(TaskResumeBasis.NoRuns, "No tenant in scope; starting at task 0.");

        var runs = await ReadRunsAsync(tid, repository, branchName, issueNumber).ConfigureAwait(false);
        if (runs.Count == 0)
            return TaskLoopResumeCalculator.Compute(null, runs, null);

        string? tasksJson = null;
        IReadOnlyList<TaskListEntry>? tasks = null;
        var accepted = await _documents
            .GetLatestAcceptedAsync(tid, TaskBreakdownDocument.IssueIdFor(repository, issueNumber), ct)
            .ConfigureAwait(false);
        var plan = accepted.FirstOrDefault(d => string.Equals(d.DocumentType, TaskBreakdownDocument.DocumentType, StringComparison.Ordinal));
        if (plan is not null && TaskBreakdownDocument.TryRead(plan.BodyJson, out var json, out var list))
        {
            tasksJson = json;
            tasks = list;
        }

        var branchFiles = await _git.ListBranchChangedFilesAsync(tid, repository, branchName, ct).ConfigureAwait(false);

        var position = TaskLoopResumeCalculator.Compute(
            tasks, runs, branchFiles is null ? null : new HashSet<string>(branchFiles, StringComparer.Ordinal), tasksJson);
        _logger.LogInformation(
            "Task re-entry for {Repo}#{Issue}@{Branch}: index {Index} ({Code})",
            LogSanitizer.Clean(repository), issueNumber, LogSanitizer.Clean(branchName), position.ResumeIndex, position.BasisCode);
        return position;
    }

    /// <summary>
    /// One record per task index: the latest RECEIVED decides success/files; any row supplies
    /// the recorded task id. A suspended-only task is a run with no result (Success = null).
    /// </summary>
    internal async Task<IReadOnlyList<TaskRunRecord>> ReadRunsAsync(
        Guid tenantId, string repository, string branchName, int issueNumber)
    {
        var received = await _events.QueryAsync(tenantId, AgentRunWaitEventTypes.Received, issueNumber, EventReadLimit).ConfigureAwait(false);
        var suspended = await _events.QueryAsync(tenantId, AgentRunWaitEventTypes.WaitSuspended, issueNumber, EventReadLimit).ConfigureAwait(false);

        var rows = received.Concat(suspended)
            .Select(Parse)
            .Where(r => r is not null
                        && r.Value.IssueNumber == issueNumber
                        && string.Equals(r.Value.Repository, repository, StringComparison.Ordinal)
                        && string.Equals(r.Value.Branch, branchName, StringComparison.Ordinal))
            .Select(r => r!.Value)
            .ToList();

        return rows
            .GroupBy(r => r.TaskIndex)
            .Select(g =>
            {
                var ordered = g.OrderBy(r => r.Sequence).ToList();
                var lastReceived = ordered.LastOrDefault(r => r.Type == AgentRunWaitEventTypes.Received);
                var taskId = ordered.LastOrDefault(r => !string.IsNullOrWhiteSpace(r.TaskId)).TaskId;
                return new TaskRunRecord(
                    g.Key,
                    taskId,
                    lastReceived.Type is null ? null : lastReceived.Success,
                    lastReceived.Type is not null && lastReceived.Success ? lastReceived.Files : []);
            })
            .OrderBy(r => r.TaskIndex)
            .ToList();
    }

    private readonly record struct Row(
        string Type, long Sequence, int IssueNumber, int TaskIndex, string? TaskId,
        string? Repository, string? Branch, bool Success, IReadOnlyList<string> Files);

    private static Row? Parse(DomainEvent e)
    {
        try
        {
            using var tags = JsonDocument.Parse(string.IsNullOrWhiteSpace(e.Tags) ? "{}" : e.Tags);
            using var data = JsonDocument.Parse(string.IsNullOrWhiteSpace(e.Data) ? "{}" : e.Data);
            var correlation = Str(tags.RootElement, "correlationId");
            if (!TaskSessionId.TryParse(correlation, out var issue, out var index)) return null;

            var d = data.RootElement;
            var files = d.ValueKind == JsonValueKind.Object
                        && d.TryGetProperty("filesChanged", out var f) && f.ValueKind == JsonValueKind.Array
                ? f.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
                : new List<string>();
            var success = d.ValueKind == JsonValueKind.Object
                          && d.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.True;

            return new Row(
                e.Type, e.SequenceNumber, issue, index, Str(d, "taskId"),
                Str(tags.RootElement, "repository"), Str(tags.RootElement, "branchName"), success, files);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Str(JsonElement obj, string name)
        => obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}
