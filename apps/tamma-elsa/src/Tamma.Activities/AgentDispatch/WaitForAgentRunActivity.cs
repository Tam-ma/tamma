using System.Globalization;
using System.Text.Json.Serialization;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities.Flowchart.Attributes;
using Elsa.Workflows.Attributes;
using Elsa.Workflows.Models;
using Microsoft.Extensions.Logging;
using Tamma.Activities.AgentDispatch.Models;
using Tamma.Activities.Core;
using Tamma.Activities.Documents;

namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// Story 40-2 — runs a coding agent and WAITS DURABLY for it. Replaces the ~35-minute inline
/// <c>await</c> inside <see cref="ExecuteAgentActivity"/> (dispatch → monitor → collect) with
/// dispatch → suspend on a persisted bookmark → collect on resume.
///
/// <para><b>GitHub Actions mode (the suspend path).</b> <c>ExecuteAsync</c> dispatches the run
/// through <see cref="IAgentDispatchService"/>. A failed dispatch takes <c>Failed</c> with no
/// bookmark (there is no run to wait for). A successful dispatch creates:</para>
/// <list type="number">
///   <item>the result bookmark, named by <see cref="LifecycleBookmarks.ForAgentRun"/>
///     (tenant-folded, recomputable from durable inputs by the 40-3 resume side) →
///     <see cref="OnResumeAsync"/> collects via <see cref="IAgentResultCollectorService"/>
///     and takes <c>Received</c> (agent success AND agent-reported failure both route here);</item>
///   <item>a durable <c>DelayFor</c> deadline (<see cref="EffectiveWaitTimeoutMinutes"/>) →
///     fail-closed sentinel result and the <c>Timeout</c> edge;</item>
///   <item>a short durable reconcile timer (<see cref="ReconcileDelaySeconds"/>) that re-reads
///     <see cref="PendingAgentRunCompletionBuffer"/> once the suspended state is committed.</item>
/// </list>
/// <para>The workflow instance is Suspended for the wait — no thread, no in-memory task. Whichever
/// bookmark resumes first and completes the activity burns the rest.</para>
///
/// <para><b>Early completion cannot be lost (in-process).</b> A signal that arrives before the
/// bookmark is committed finds nothing to resume; the resume side records it in
/// <see cref="PendingAgentRunCompletionBuffer"/>. The activity consumes the buffer before creating
/// its bookmarks, right after, and from the reconcile timer that fires only after the commit — the
/// window between the second check and the commit is covered by that third read (and by the
/// engine's <c>ReconcileBufferedAgentRunHandler</c> on bookmark persist). Cross-process durability
/// is 40-3's <c>agent_run_waits</c> row, written API-side from the bookmark name + instance id this
/// activity sends on the dispatch; <c>Timeout</c> is the last resort.</para>
///
/// <para><b>Local mode (D5).</b> There is no webhook for a local run, so the activity runs the
/// executor to completion inside <c>ExecuteAsync</c> under the same hard deadline and takes
/// <c>Received</c> (or <c>Timeout</c>) without creating an external bookmark. Same outputs and
/// edges in both modes, so the workflow definition stays mode-agnostic.</para>
///
/// <para>Outputs and the <c>LastAgentExecutionResult</c> variable match
/// <see cref="ExecuteAgentActivity"/> exactly.</para>
/// </summary>
[Activity(
    "Tamma.AgentDispatch",
    "Wait For Agent Run",
    "Dispatch an AI agent run, then suspend on a durable bookmark until it completes or times out",
    Kind = ActivityKind.Task)]
[FlowNode(OutcomeReceived, OutcomeTimeout, OutcomeFailed)]
public class WaitForAgentRunActivity : Activity, ITammaActivity
{
    public const string OutcomeReceived = "Received";
    public const string OutcomeTimeout = "Timeout";
    public const string OutcomeFailed = "Failed";

    /// <summary>
    /// Delay before the post-commit reconcile read of <see cref="PendingAgentRunCompletionBuffer"/>.
    /// Long enough that the suspended state is committed; short against any real agent run.
    /// </summary>
    public const int ReconcileDelaySeconds = 30;

    /// <summary>Minutes added to the agent's own timeout for discovery + collection.</summary>
    public const int TimeoutSafetyMinutes = 5;

    private const string DispatchedAtProperty = "Tamma:AgentRunDispatchedAt";

    private readonly ILogger<WaitForAgentRunActivity>? _logger;
    private readonly AgentExecutorFactory? _factory;

    public string? EventType => "AGENT.EXECUTION";

    public Dictionary<string, object?> BuildStartData(ActivityExecutionContext context) => new()
    {
        ["repository"] = Repository.Get(context),
        ["branchName"] = BranchName.Get(context),
        ["issueNumber"] = IssueNumber.Get(context),
        ["sessionId"] = SessionId.Get(context),
        ["task"] = Task.Get(context),
        ["agentProvider"] = AgentProvider.Get(context),
        ["timeoutMinutes"] = TimeoutMinutes.Get(context),
        ["mode"] = context.GetVariable<string>("AgentExecutionMode") ?? "auto",
    };

    public Dictionary<string, object?> BuildEndData(ActivityExecutionContext context)
    {
        var data = new Dictionary<string, object?>
        {
            ["repository"] = Repository.Get(context),
            ["branchName"] = BranchName.Get(context),
            ["sessionId"] = SessionId.Get(context),
        };
        if (context.GetVariable<object?>("LastAgentExecutionResult") is AgentExecutionResult r)
        {
            data["success"] = r.Success;
            data["prNumber"] = r.PrNumber;
            data["filesChanged"] = r.FilesChanged.Length;
            data["commitsCount"] = r.CommitsCount;
            data["tokensUsed"] = r.TokensUsed;
            data["durationSeconds"] = r.DurationSeconds;
            data["agentProvider"] = r.AgentProvider;
            data["checksPassed"] = r.ChecksPassed;
            data["mode"] = r.ExecutionMode;
        }
        return data;
    }

    // ─── Inputs (ExecuteAgentActivity's, plus TenantId) ──────────────────
    [Input(Description = "Repository in owner/repo format")]
    public Input<string> Repository { get; set; } = default!;

    [Input(Description = "Branch for the agent to work on")]
    public Input<string> BranchName { get; set; } = default!;

    [Input(Description = "Issue number")]
    public Input<int> IssueNumber { get; set; } = default!;

    [Input(Description = "Issue title")]
    public Input<string> IssueTitle { get; set; } = new(string.Empty);

    [Input(Description = "Task type: implement, fix, debug, review, test")]
    public Input<string> Task { get; set; } = new("implement");

    [Input(Description = "Serialized development plan")]
    public Input<string> PlanJson { get; set; } = new("{}");

    [Input(Description = "Tamma session ID")]
    public Input<string> SessionId { get; set; } = default!;

    [Input(Description = "Agent provider")]
    public Input<string> AgentProvider { get; set; } = new("claude-code");

    [Input(Description = "Agent config JSON")]
    public Input<string?> AgentConfigJson { get; set; } = default!;

    [Input(Description = "Agent timeout in minutes (the wait deadline adds a safety margin)")]
    public Input<int> TimeoutMinutes { get; set; } = new(30);

    [Input(Description = "Override the execution mode (local, github_actions)")]
    public Input<string?> ModeOverride { get; set; } = default!;

    [Input(Description = "Owning tenant id (folded into the bookmark name; empty in single-user mode)")]
    public Input<string?> TenantId { get; set; } = default!;

    // ─── Outputs (ExecuteAgentActivity's, plus BookmarkName) ─────────────
    [Output(Description = "Whether the agent completed successfully")]
    public Output<bool> Success { get; set; } = default!;

    [Output(Description = "Execution mode used (local / github_actions)")]
    public Output<string> ExecutionMode { get; set; } = default!;

    [Output(Description = "PR number if created")]
    public Output<int?> PrNumber { get; set; } = default!;

    [Output(Description = "PR HTML URL")]
    public Output<string?> PrUrl { get; set; } = default!;

    [Output(Description = "HEAD commit SHA")]
    public Output<string> CommitSha { get; set; } = default!;

    [Output(Description = "JSON-serialized array of changed file paths")]
    public Output<string> FilesChangedJson { get; set; } = default!;

    [Output(Description = "Number of commits made by the agent")]
    public Output<int> CommitsCount { get; set; } = default!;

    [Output(Description = "Whether CI checks passed")]
    public Output<bool?> ChecksPassed { get; set; } = default!;

    [Output(Description = "Total tokens consumed")]
    public Output<int> TokensUsed { get; set; } = default!;

    [Output(Description = "Execution duration in seconds")]
    public Output<int> DurationSeconds { get; set; } = default!;

    [Output(Description = "Error details if the agent failed")]
    public Output<string?> ErrorMessage { get; set; } = default!;

    [Output(Description = "Agent log summary")]
    public Output<string?> AgentLogSummary { get; set; } = default!;

    [Output(Description = "The agent-run bookmark name (LifecycleBookmarks.ForAgentRun)")]
    public Output<string?> BookmarkName { get; set; } = default!;

    [JsonConstructor]
    public WaitForAgentRunActivity() { }

    public WaitForAgentRunActivity(
        ILogger<WaitForAgentRunActivity> logger,
        AgentExecutorFactory factory)
    {
        _logger = logger;
        _factory = factory;
    }

    /// <summary>
    /// The durable wait deadline: the agent's timeout plus <see cref="TimeoutSafetyMinutes"/>,
    /// never below <see cref="AgentMonitorOptions.Default"/>'s budget — the same value
    /// <see cref="GitHubActionsExecutor"/> gives its monitor, so wall-clock behaviour is unchanged.
    /// </summary>
    public static int EffectiveWaitTimeoutMinutes(int agentTimeoutMinutes)
        => Math.Max(AgentMonitorOptions.Default.TimeoutMinutes, agentTimeoutMinutes + TimeoutSafetyMinutes);

    /// <summary>The bookmark name this activity suspends on for the given inputs.</summary>
    public string ComputeBookmarkName(ActivityExecutionContext context)
        => LifecycleBookmarks.ForAgentRun(
            TenantId.GetOrDefault(context), Repository.Get(context), BranchName.Get(context), SessionId.Get(context));

    protected override async ValueTask ExecuteAsync(ActivityExecutionContext context)
    {
        var startedAt = DateTime.UtcNow;
        TammaEventEmitter.EmitStart(context, this, this, _logger);

        var request = BuildRequest(context);
        var bookmarkName = ComputeBookmarkName(context);
        BookmarkName.Set(context, bookmarkName);
        var waitMinutes = EffectiveWaitTimeoutMinutes(request.TimeoutMinutes);

        // Store-rehydrated activities come from the [JsonConstructor] with null ctor members
        // (engine E2E run 38) — fall back to the container, and fail LOUD when it is not there.
        var factory = _factory ?? context.GetService<AgentExecutorFactory>();
        if (factory is null)
        {
            await FailAsync(context, request, startedAt, "unknown",
                "AgentExecutorFactory not registered — WaitForAgentRunActivity requires DI.");
            return;
        }

        string mode;
        try
        {
            mode = factory.ResolveMode(ModeOverride.GetOrDefault(context));
        }
        catch (Exception ex)
        {
            await FailAsync(context, request, startedAt, "unknown", $"Could not resolve agent execution mode: {ex.Message}");
            return;
        }
        context.SetVariable("AgentExecutionMode", mode);

        if (mode == ExecutionModeNames.Local)
        {
            await RunLocalAsync(context, factory, request, startedAt, waitMinutes);
            return;
        }

        if (mode != ExecutionModeNames.GitHubActions)
        {
            await FailAsync(context, request, startedAt, mode, $"Unknown agent execution mode: {mode}");
            return;
        }

        // ── GitHub Actions: dispatch, then suspend ────────────────────────
        var dispatch = context.GetService<IAgentDispatchService>();
        var collector = context.GetService<IAgentResultCollectorService>();
        if (dispatch is null || collector is null)
        {
            var missing = dispatch is null ? nameof(IAgentDispatchService) : nameof(IAgentResultCollectorService);
            await FailAsync(context, request, startedAt, mode,
                $"{missing} not registered — WaitForAgentRunActivity requires DI.");
            return;
        }

        AgentDispatchResult dispatchResult;
        try
        {
            // Story 40-3 — the API persists the durable agent_run_waits row from these.
            var suspending = request with
            {
                BookmarkName = bookmarkName,
                WorkflowInstanceId = context.WorkflowExecutionContext.Id,
                BookmarkTenantId = TenantId.GetOrDefault(context),
            };
            dispatchResult = await dispatch.DispatchAsync(suspending, context.CancellationToken);
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Agent dispatch threw for {Repository}/{Branch}", request.Repository, request.BranchName);
            await FailAsync(context, request, startedAt, mode, $"Dispatch error: {ex.Message}");
            return;
        }

        if (!dispatchResult.Success)
        {
            await FailAsync(context, request, startedAt, mode, dispatchResult.ErrorMessage ?? "Dispatch failed");
            return;
        }

        context.SetProperty(DispatchedAtProperty, startedAt.ToString("O", CultureInfo.InvariantCulture));

        var buffer = context.GetService<PendingAgentRunCompletionBuffer>();

        // Reconcile 1 — a signal that raced ahead of this activity.
        if (buffer is not null && buffer.TryConsume(bookmarkName, out var early))
        {
            _logger?.LogInformation("Agent-run completion for {Bookmark} arrived before the wait registered — completing", bookmarkName);
            await CompleteFromSignalAsync(context, early);
            return;
        }

        context.CreateBookmark(new CreateBookmarkArgs
        {
            BookmarkName = bookmarkName,
            Callback = OnResumeAsync,
            AutoBurn = true,
            IncludeActivityInstanceId = false,
        });
        context.DelayFor(TimeSpan.FromMinutes(waitMinutes), OnTimeoutAsync);
        if (buffer is not null)
            context.DelayFor(TimeSpan.FromSeconds(ReconcileDelaySeconds), OnReconcileAsync);

        // Reconcile 2 — a signal that arrived while the bookmarks were being created.
        if (buffer is not null && buffer.TryConsume(bookmarkName, out var late))
        {
            _logger?.LogInformation("Agent-run completion for {Bookmark} arrived while the wait was registering — completing", bookmarkName);
            await CompleteFromSignalAsync(context, late);
            return;
        }

        _logger?.LogInformation(
            "Agent run dispatched for {Repository}/{Branch} (session={SessionId}); suspended on {Bookmark}, deadline +{Minutes}min",
            request.Repository, request.BranchName, request.SessionId, bookmarkName, waitMinutes);
    }

    /// <summary>Result-bookmark resume: the 40-3 signal delivered the run-completion payload.</summary>
    private async ValueTask OnResumeAsync(ActivityExecutionContext context)
        => await CompleteFromSignalAsync(context, context.WorkflowInput);

    /// <summary>
    /// Reconcile 3 — fires after the suspended state is committed. A buffered signal completes
    /// the wait; otherwise the wait stays suspended on its result and deadline bookmarks.
    /// </summary>
    private async ValueTask OnReconcileAsync(ActivityExecutionContext context)
    {
        var buffer = context.GetService<PendingAgentRunCompletionBuffer>();
        var bookmarkName = ComputeBookmarkName(context);
        if (buffer is not null && buffer.TryConsume(bookmarkName, out var input))
        {
            _logger?.LogInformation("Agent-run completion for {Bookmark} found on the post-commit reconcile — completing", bookmarkName);
            await CompleteFromSignalAsync(context, input);
            return;
        }
        _logger?.LogDebug("No buffered completion for {Bookmark}; still waiting", bookmarkName);
    }

    /// <summary>Durable deadline: no completion arrived. Fail closed and take <c>Timeout</c>.</summary>
    private async ValueTask OnTimeoutAsync(ActivityExecutionContext context)
    {
        var request = BuildRequest(context);
        var minutes = EffectiveWaitTimeoutMinutes(request.TimeoutMinutes);
        _logger?.LogWarning(
            "Agent run for {Repository}/{Branch} (session={SessionId}) timed out after {Minutes}min — taking Timeout",
            request.Repository, request.BranchName, request.SessionId, minutes);

        var sentinel = AgentExecutionResult.Failed(
            $"Agent run timed out after {minutes} minutes with no completion signal",
            request.AgentProvider, ExecutionModeNames.GitHubActions);
        SetResult(context, sentinel);
        TammaEventEmitter.EmitFailure(context, this, this, _logger, Elapsed(context), sentinel.ErrorMessage!);
        await context.CompleteActivityWithOutcomesAsync(OutcomeTimeout);
    }

    /// <summary>
    /// Read the completion payload (fail-closed), collect, set outputs, take <c>Received</c>.
    /// Reads only — the input dictionary is never mutated.
    /// </summary>
    private async ValueTask CompleteFromSignalAsync(ActivityExecutionContext context, IDictionary<string, object>? input)
    {
        var request = BuildRequest(context);
        AgentExecutionResult result;

        if (!AgentRunCompletionSignal.TryRead(input, out var monitorResult))
        {
            _logger?.LogWarning("Unreadable agent-run completion payload for session {SessionId} — failing closed", request.SessionId);
            result = AgentExecutionResult.Failed(
                "Agent-run completion signal was missing or unreadable",
                request.AgentProvider, ExecutionModeNames.GitHubActions);
        }
        else
        {
            var collector = context.GetService<IAgentResultCollectorService>();
            if (collector is null)
            {
                result = AgentExecutionResult.Failed(
                    "IAgentResultCollectorService not registered — WaitForAgentRunActivity requires DI.",
                    request.AgentProvider, ExecutionModeNames.GitHubActions);
            }
            else
            {
                try
                {
                    result = await collector.CollectAsync(request, monitorResult, context.CancellationToken);
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Collect failed for {Repository}/{Branch}", request.Repository, request.BranchName);
                    result = AgentExecutionResult.Failed(
                        $"Collect failed: {ex.Message}", request.AgentProvider, ExecutionModeNames.GitHubActions);
                }
            }
        }

        SetResult(context, result);
        EmitEnd(context, result, Elapsed(context));
        await context.CompleteActivityWithOutcomesAsync(OutcomeReceived);
    }

    private async ValueTask RunLocalAsync(
        ActivityExecutionContext context, AgentExecutorFactory factory, AgentExecutionRequest request,
        DateTime startedAt, int waitMinutes)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.CancellationToken);
        deadline.CancelAfter(TimeSpan.FromMinutes(waitMinutes));

        AgentExecutionResult result;
        try
        {
            var executor = factory.Create(ExecutionModeNames.Local);
            result = await executor.ExecuteAsync(request, deadline.Token);
        }
        catch (OperationCanceledException) when (!context.CancellationToken.IsCancellationRequested)
        {
            var sentinel = AgentExecutionResult.Failed(
                $"Agent run timed out after {waitMinutes} minutes", request.AgentProvider, ExecutionModeNames.Local);
            SetResult(context, sentinel);
            TammaEventEmitter.EmitFailure(context, this, this, _logger, DateTime.UtcNow - startedAt, sentinel.ErrorMessage!);
            await context.CompleteActivityWithOutcomesAsync(OutcomeTimeout);
            return;
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Local agent execution failed for {Repository}/{Branch}", request.Repository, request.BranchName);
            result = AgentExecutionResult.Failed($"Execute error: {ex.Message}", request.AgentProvider, ExecutionModeNames.Local);
        }

        SetResult(context, result);
        EmitEnd(context, result, DateTime.UtcNow - startedAt);
        await context.CompleteActivityWithOutcomesAsync(OutcomeReceived);
    }

    private async ValueTask FailAsync(
        ActivityExecutionContext context, AgentExecutionRequest request, DateTime startedAt, string mode, string message)
    {
        _logger?.LogError("WaitForAgentRunActivity failed for {Repository}/{Branch}: {Error}",
            request.Repository, request.BranchName, message);
        SetResult(context, AgentExecutionResult.Failed(message, request.AgentProvider, mode));
        TammaEventEmitter.EmitFailure(context, this, this, _logger, DateTime.UtcNow - startedAt, message);
        await context.CompleteActivityWithOutcomesAsync(OutcomeFailed);
    }

    private void EmitEnd(ActivityExecutionContext context, AgentExecutionResult result, TimeSpan elapsed)
    {
        if (result.Success)
            TammaEventEmitter.EmitSuccess(context, this, this, _logger, elapsed);
        else
            TammaEventEmitter.EmitFailure(context, this, this, _logger, elapsed, result.ErrorMessage ?? "unknown");
    }

    private static TimeSpan Elapsed(ActivityExecutionContext context)
    {
        var raw = context.GetProperty<object?>(DispatchedAtProperty)?.ToString();
        return DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at)
            ? DateTime.UtcNow - at
            : TimeSpan.Zero;
    }

    private AgentExecutionRequest BuildRequest(ActivityExecutionContext context)
    {
        var tenantRaw = TenantId.GetOrDefault(context);
        return new AgentExecutionRequest(
            Repository: Repository.Get(context),
            BranchName: BranchName.Get(context),
            IssueNumber: IssueNumber.Get(context),
            IssueTitle: IssueTitle.Get(context) ?? string.Empty,
            Task: Task.Get(context),
            PlanJson: PlanJson.Get(context),
            SessionId: SessionId.Get(context),
            AgentProvider: AgentProvider.Get(context),
            AgentConfigJson: AgentConfigJson.GetOrDefault(context),
            WorkflowFileName: "tamma-agent.yml",
            TimeoutMinutes: TimeoutMinutes.Get(context),
            TenantId: Guid.TryParse(tenantRaw, out var tid) && tid != Guid.Empty ? tid : null);
    }

    private void SetResult(ActivityExecutionContext context, AgentExecutionResult r)
    {
        Success.Set(context, r.Success);
        ExecutionMode.Set(context, r.ExecutionMode);
        PrNumber.Set(context, r.PrNumber);
        PrUrl.Set(context, r.PrUrl);
        CommitSha.Set(context, r.CommitSha);
        FilesChangedJson.Set(context, System.Text.Json.JsonSerializer.Serialize(r.FilesChanged));
        CommitsCount.Set(context, r.CommitsCount);
        ChecksPassed.Set(context, r.ChecksPassed);
        TokensUsed.Set(context, r.TokensUsed);
        DurationSeconds.Set(context, r.DurationSeconds);
        ErrorMessage.Set(context, r.ErrorMessage);
        AgentLogSummary.Set(context, r.AgentLogSummary);
        context.SetVariable("LastAgentExecutionResult", r);
    }
}
