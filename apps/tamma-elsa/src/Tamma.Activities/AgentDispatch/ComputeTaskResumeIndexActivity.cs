using System.Text.Json;
using System.Text.Json.Serialization;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Attributes;
using Elsa.Workflows.Models;
using Microsoft.Extensions.Logging;
using Tamma.Activities.Core;
using Tamma.Activities.Documents;
using Tamma.Core;
using Tamma.Core.AgentDispatch.Resume;

namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// Story 40-4 (AC3, AC7) — the task-loop re-entry node. Sits between the loop's init and its
/// "more tasks?" check in <c>SingleIssueCycleWorkflow</c>, asks
/// <see cref="ITaskLoopReEntryService"/> which task a restarted cycle should begin at, and
/// hands back the index (and, on a real re-entry, the stored task list that index refers to).
///
/// <para><b>The type name is load-bearing</b>: 40-5's build gate, 40-6's emission and 40-7's
/// integration proof name it, and <c>CanonicalReEntryActivities</c> registers it.</para>
///
/// <list type="bullet">
///   <item>Re-entry (index &gt; 0) emits <see cref="AgentRunWaitEventTypes.TaskReentered"/>;
///     a start at 0 emits nothing.</item>
///   <item>Git/events disagreement sets <see cref="InconsistencyDetail"/>; the workflow routes
///     it to its loud failure. Nothing is skipped or re-run on a guess.</item>
///   <item>Any other read failure starts at task 0 — exactly today's behaviour — and logs a
///     warning with <see cref="TaskResumeBasis.ReadFailed"/>.</item>
///   <item>No service registered is a loud configuration error, not a silent 0.</item>
/// </list>
/// </summary>
[Activity(
    "Tamma.AgentDispatch",
    "Compute Task Resume Index",
    "Find the first task that has not landed (git + agent-run events) so a restarted cycle skips finished tasks",
    Kind = ActivityKind.Task)]
public class ComputeTaskResumeIndexActivity : Activity
{
    public const string ServiceUnregisteredCode = "CODE.REENTRY.SERVICE_UNREGISTERED";

    private readonly ILogger<ComputeTaskResumeIndexActivity>? _logger;

    [Input(Description = "Repository in owner/repo format")]
    public Input<string> Repository { get; set; } = default!;

    [Input(Description = "The cycle's working branch")]
    public Input<string> BranchName { get; set; } = default!;

    [Input(Description = "Issue number")]
    public Input<int> IssueNumber { get; set; } = default!;

    [Input(Description = "Tenant id (empty in single-user mode)")]
    public Input<string?> TenantId { get; set; } = new((string?)null);

    [Output(Description = "The task index to start the loop at")]
    public Output<int> ResumeIndex { get; set; } = default!;

    [Output(Description = "The stored task list the index refers to (only on re-entry; else empty)")]
    public Output<string> TasksJson { get; set; } = default!;

    [Output(Description = "Why this index (a TaskResumeBasis code)")]
    public Output<string> BasisCode { get; set; } = default!;

    [Output(Description = "Non-empty when git and the event trail disagree (route to the loud failure)")]
    public Output<string> InconsistencyDetail { get; set; } = default!;

    [JsonConstructor]
    public ComputeTaskResumeIndexActivity() { }

    public ComputeTaskResumeIndexActivity(ILogger<ComputeTaskResumeIndexActivity> logger) => _logger = logger;

    protected override async ValueTask ExecuteAsync(ActivityExecutionContext context)
    {
        var logger = _logger ?? context.GetService<ILogger<ComputeTaskResumeIndexActivity>>();
        var service = context.GetService<ITaskLoopReEntryService>()
            ?? throw new TammaError(
                ServiceUnregisteredCode,
                "No ITaskLoopReEntryService is registered in the engine; the cycle cannot decide where its task loop " +
                "starts. Register HttpTaskLoopReEntryService or NullTaskLoopReEntryService (Coding:TaskReEntryDisabled).",
                retryable: false,
                severity: TammaErrorSeverity.High);

        var repository = Repository.Get(context) ?? "";
        var branch = BranchName.Get(context) ?? "";
        var issueNumber = IssueNumber.Get(context);
        var tenantId = DocumentEvents.ParseTenantId(TenantId.GetOrDefault(context));

        TaskLoopResumePosition position;
        var inconsistency = "";
        try
        {
            position = await service.ReconstructAsync(tenantId, repository, branch, issueNumber, context.CancellationToken)
                .ConfigureAwait(false);
        }
        catch (TammaError ex) when (ex.Code == TaskLoopResumeCalculator.InconsistentStateCode)
        {
            logger?.LogError("Task re-entry for issue {Issue} on {Branch} refused: {Message}", issueNumber, branch, ex.Message);
            position = TaskLoopResumePosition.Start(TaskLoopResumeCalculator.InconsistentStateCode, ex.Message);
            inconsistency = ex.Message;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !context.CancellationToken.IsCancellationRequested)
        {
            logger?.LogWarning(ex, "Task re-entry read failed for issue {Issue}; starting at task 0", issueNumber);
            position = TaskLoopResumePosition.Start(TaskResumeBasis.ReadFailed,
                $"The re-entry read failed ({ex.GetType().Name}); starting at task 0.");
        }

        // A position may only skip tasks when it brings the list those indices refer to.
        if (position.IsReEntry && string.IsNullOrWhiteSpace(position.TasksJson))
        {
            logger?.LogWarning("Task re-entry returned index {Index} without a task list; starting at task 0", position.ResumeIndex);
            position = TaskLoopResumePosition.Start(TaskResumeBasis.NoTaskList,
                "The re-entry read returned a position without its task list; starting at task 0.");
        }

        ResumeIndex.Set(context, position.ResumeIndex);
        TasksJson.Set(context, position.IsReEntry ? position.TasksJson! : "");
        BasisCode.Set(context, position.BasisCode);
        InconsistencyDetail.Set(context, inconsistency);

        if (position.IsReEntry)
        {
            TammaEventEmitter.Emit(context, this, logger,
                BuildReenteredEvent(position, repository, branch, issueNumber, tenantId));
            logger?.LogInformation("Re-entering issue {Issue}'s task loop at task {Index}: {Basis}",
                issueNumber, position.ResumeIndex, position.Basis);
        }

        await context.CompleteActivityAsync();
    }

    /// <summary>The <see cref="AgentRunWaitEventTypes.TaskReentered"/> row. Pure; public for tests.</summary>
    public static TammaEvent BuildReenteredEvent(
        TaskLoopResumePosition position, string repository, string branchName, int issueNumber, Guid? tenantId)
        => WaitForAgentRunActivity.BuildWaitEvent(
            AgentRunWaitEventTypes.TaskReentered,
            TaskSessionId.For(issueNumber, position.ResumeIndex),
            issueNumber, repository, branchName, tenantId,
            position.ResumeIndex,
            TaskIdAt(position.TasksJson, position.ResumeIndex),
            new Dictionary<string, object?>
            {
                ["resumeIndex"] = position.ResumeIndex,
                ["landedIndices"] = position.LandedIndices.ToArray(),
                ["basisCode"] = position.BasisCode,
                ["basis"] = position.Basis,
            });

    private static string? TaskIdAt(string? tasksJson, int index)
    {
        if (string.IsNullOrWhiteSpace(tasksJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(tasksJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Array || index >= doc.RootElement.GetArrayLength()) return null;
            var t = doc.RootElement[index];
            return t.ValueKind == JsonValueKind.Object && t.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
                ? id.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
