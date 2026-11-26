using System.Text.Json.Serialization;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Attributes;
using Elsa.Workflows.Models;
using Microsoft.Extensions.Logging;
using Tamma.Activities.Core;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 41-29 (AC5) — emits <c>ROUTE.*</c> DCB events (<see cref="RouteEvents"/>)
/// through the durable engine event drain (<see cref="TammaEventEmitter.Emit"/>) so
/// issue pre-routes and per-task routing decisions are reconstructable from the event
/// stream alone.
/// </summary>
[Activity(
    "Tamma.ADL",
    "Emit Route Event",
    "Emit a ROUTE.* DCB event for the single-issue-cycle router audit trail",
    Kind = ActivityKind.Task
)]
public class EmitRouteEventActivity : Activity
{
    private readonly ILogger<EmitRouteEventActivity>? _logger;

    [Input(Description = "Event type — ROUTE.ISSUE.PREROUTED / ROUTE.TASK.DISPATCHED / ROUTE.TASK.DEFERRED_TO_HUMAN / ROUTE.TASK.UNKNOWN_KIND")]
    public Input<string> EventType { get; set; } = default!;

    [Input(Description = "Issue number driving the cycle (0 when unknown)")]
    public Input<int> IssueNumber { get; set; } = new(0);

    [Input(Description = "Repository in owner/repo format")]
    public Input<string?> Repository { get; set; } = new((string?)null);

    [Input(Description = "Tenant id (empty / single-user -> platform-scope event)")]
    public Input<string?> TenantId { get; set; } = new((string?)null);

    [Input(Description = "Issue type (for ROUTE.ISSUE.PREROUTED)")]
    public Input<string?> IssueType { get; set; } = new((string?)null);

    [Input(Description = "Chosen pre-route flow (for ROUTE.ISSUE.PREROUTED)")]
    public Input<string?> ChosenFlow { get; set; } = new((string?)null);

    [Input(Description = "Plan task id (for ROUTE.TASK.*)")]
    public Input<string?> TaskId { get; set; } = new((string?)null);

    [Input(Description = "Resolved task kind wire token (for ROUTE.TASK.DISPATCHED / DEFERRED_TO_HUMAN)")]
    public Input<string?> Kind { get; set; } = new((string?)null);

    [Input(Description = "Target workflow DefinitionId (for ROUTE.TASK.DISPATCHED)")]
    public Input<string?> TargetWorkflow { get; set; } = new((string?)null);

    [Input(Description = "Missing Epic 41 target explanation (for ROUTE.TASK.DEFERRED_TO_HUMAN)")]
    public Input<string?> MissingTarget { get; set; } = new((string?)null);

    [Input(Description = "Raw offending kind value (for ROUTE.TASK.UNKNOWN_KIND)")]
    public Input<string?> RawKind { get; set; } = new((string?)null);

    [JsonConstructor]
    public EmitRouteEventActivity() { }

    public EmitRouteEventActivity(ILogger<EmitRouteEventActivity> logger)
    {
        _logger = logger;
    }

    protected override async ValueTask ExecuteAsync(ActivityExecutionContext context)
    {
        var type = EventType.GetOrDefault(context) ?? RouteEvents.TaskDispatched;
        var issueNumber = IssueNumber.GetOrDefault(context);
        var repository = Repository.GetOrDefault(context);
        var tenantId = CycleEvents.ParseTenantId(TenantId.GetOrDefault(context));

        var evt = BuildTammaEvent(
            type,
            issueNumber: issueNumber,
            repository: repository,
            tenantId: tenantId,
            issueType: IssueType.GetOrDefault(context),
            chosenFlow: ChosenFlow.GetOrDefault(context),
            taskId: TaskId.GetOrDefault(context),
            kind: Kind.GetOrDefault(context),
            targetWorkflow: TargetWorkflow.GetOrDefault(context),
            missingTarget: MissingTarget.GetOrDefault(context),
            rawKind: RawKind.GetOrDefault(context));

        TammaEventEmitter.Emit(context, this, _logger, evt);

        _logger?.LogInformation(
            "Emitted {Type} for issue #{Issue} repo {Repo} (taskId={TaskId}, kind={Kind}, target={Target}, flow={Flow})",
            type, issueNumber, repository,
            TaskId.GetOrDefault(context), Kind.GetOrDefault(context),
            TargetWorkflow.GetOrDefault(context), ChosenFlow.GetOrDefault(context));

        await context.CompleteActivityAsync();
    }

    public static TammaEvent BuildTammaEvent(
        string type,
        int issueNumber,
        string? repository,
        Guid? tenantId,
        string? issueType = null,
        string? chosenFlow = null,
        string? taskId = null,
        string? kind = null,
        string? targetWorkflow = null,
        string? missingTarget = null,
        string? rawKind = null)
    {
        var tags = new Dictionary<string, object?>();
        if (issueNumber > 0)
        {
            tags["issueId"] = !string.IsNullOrWhiteSpace(repository)
                ? $"{repository}#{issueNumber}"
                : issueNumber.ToString();
            tags["issueNumber"] = issueNumber.ToString();
        }
        if (!string.IsNullOrWhiteSpace(repository)) tags["repository"] = repository;
        if (tenantId is not null) tags["tenantId"] = tenantId.Value.ToString("D");

        if (!string.IsNullOrWhiteSpace(issueType)) tags["issueType"] = issueType;
        if (!string.IsNullOrWhiteSpace(chosenFlow)) tags["chosenFlow"] = chosenFlow;
        if (!string.IsNullOrWhiteSpace(taskId)) tags["taskId"] = taskId;
        if (!string.IsNullOrWhiteSpace(kind)) tags["kind"] = kind;
        if (!string.IsNullOrWhiteSpace(targetWorkflow)) tags["targetWorkflow"] = targetWorkflow;
        if (!string.IsNullOrWhiteSpace(missingTarget)) tags["missingTarget"] = missingTarget;
        if (!string.IsNullOrWhiteSpace(rawKind)) tags["rawKind"] = rawKind;

        var data = new Dictionary<string, object?>();
        if (!string.IsNullOrWhiteSpace(issueType)) data["issueType"] = issueType;
        if (!string.IsNullOrWhiteSpace(chosenFlow)) data["chosenFlow"] = chosenFlow;
        if (!string.IsNullOrWhiteSpace(taskId)) data["taskId"] = taskId;
        if (!string.IsNullOrWhiteSpace(kind)) data["kind"] = kind;
        if (!string.IsNullOrWhiteSpace(targetWorkflow)) data["targetWorkflow"] = targetWorkflow;
        if (!string.IsNullOrWhiteSpace(missingTarget)) data["missingTarget"] = missingTarget;
        if (!string.IsNullOrWhiteSpace(rawKind)) data["rawKind"] = rawKind;

        return new TammaEvent
        {
            EventType = type,
            Status = RouteEvents.StatusForEvent(type),
            Tags = tags,
            Data = data,
        };
    }
}
