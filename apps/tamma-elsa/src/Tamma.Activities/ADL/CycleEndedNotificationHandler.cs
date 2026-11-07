using Elsa.Mediator.Contracts;
using Elsa.Workflows;
using Elsa.Workflows.Notifications;
using Microsoft.Extensions.Logging;
using Tamma.Activities.Core;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 40-4 (attempt boundary) — writes <see cref="CycleEvents.Ended"/> when a
/// <c>single-issue-cycle</c> instance finishes normally, by whatever path. Task-loop crash
/// re-entry reads only the cycle instances since the last end row, so "this attempt is over" must
/// be recorded on every normal end, not only where the flowchart happens to pass a
/// <c>CYCLE.COMPLETED</c> / <c>CYCLE.STEP_FAILED</c> node. (Some ends never reach a report node:
/// the merge gate's reject path stops after its notification.) Elsa's own
/// <see cref="WorkflowFinished"/> notification covers every one of them.
///
/// <para>Only <see cref="WorkflowSubStatus.Finished"/> counts. A cancelled instance (the orphan
/// sweep cancels crash-stranded cycles) and a faulted one get no end row, so the next dispatch
/// treats them as crashed and may re-enter from their records — still checked against git.</para>
///
/// <para>The workflow-pipeline drain has already run when this fires (Elsa marks the instance
/// finished after the pipeline returns), so the handler flushes its own event through the same
/// drain, with the tenant the cycle stored (the variables it is normally read from are gone). If
/// the end row is lost (no tenant, or a failed flush the drain logs), the instance merely looks
/// crashed: the next dispatch may re-enter from its records, still checked against git. Registered by <see cref="EventPersistencePipelineExtensions.UseTammaEventPersistence"/>.</para>
/// </summary>
public sealed class CycleEndedNotificationHandler(ILogger<CycleEndedNotificationHandler> logger)
    : INotificationHandler<WorkflowFinished>
{
    /// <summary>The workflow whose ends are recorded.</summary>
    public const string CycleDefinitionId = "single-issue-cycle";

    public async Task HandleAsync(WorkflowFinished notification, CancellationToken cancellationToken)
    {
        var state = notification.WorkflowState;
        if (!IsCleanEnd(notification.Workflow.Identity.DefinitionId, state.Status, state.SubStatus))
            return;

        var context = notification.WorkflowExecutionContext;
        if (!TryReadCycle(context.Properties, out var issue, out var repository, out var tenantId))
            return; // the cycle never reached a CYCLE.* emit: nothing ran that re-entry could read

        // The tenant comes from what the cycle stored, never from the (now out-of-scope) workflow
        // variables: the end row must land in the same tenant scope the re-entry read queries.
        var tenant = CycleEvents.ParseTenantId(tenantId);
        if (tenant is null)
            logger.LogWarning(
                "CYCLE.ENDED for {Repo}#{Issue} (instance {Instance}) has no tenant; it is stored unscoped and a "
                + "tenant-scoped re-entry read will not see it, so the next dispatch treats this instance as crashed",
                repository, issue, context.Id);

        var evt = EmitCycleEventActivity.BuildTammaEvent(
            CycleEvents.Ended, issue, repository, tenant, stepId: null, errorDetail: null);
        evt.Timestamp = DateTime.UtcNow;
        evt.ActivityName = nameof(CycleEndedNotificationHandler);
        evt.WorkflowInstanceId = context.Id;

        var props = context.TransientProperties;
        if (!props.TryGetValue(EventDrain.EventsKey, out var existing) || existing is not List<TammaEvent> list)
        {
            list = new List<TammaEvent>();
            props[EventDrain.EventsKey] = list;
        }
        list.Add(evt);

        await EventPersistenceMiddleware.DrainAsync(context, tenant).ConfigureAwait(false);
    }

    private const string IssueKey = "tamma:cycle:issueNumber";
    private const string RepositoryKey = "tamma:cycle:repository";
    private const string TenantKey = "tamma:cycle:tenantId";

    /// <summary>
    /// Called by <see cref="EmitCycleEventActivity"/> (CYCLE.STARTED is the cycle's first emit):
    /// keep the cycle's identity in the instance's persisted properties. Its workflow variables are
    /// out of scope once the instance has finished, which is when <see cref="HandleAsync"/> runs.
    /// </summary>
    public static void RememberCycle(IDictionary<string, object> properties, int issueNumber, string? repository, string? tenantId)
    {
        if (issueNumber <= 0) return;
        properties[IssueKey] = issueNumber.ToString(System.Globalization.CultureInfo.InvariantCulture);
        properties[RepositoryKey] = repository ?? "";
        properties[TenantKey] = tenantId ?? "";
    }

    /// <summary>Read what <see cref="RememberCycle"/> stored (values may come back from the store as JSON).</summary>
    public static bool TryReadCycle(IDictionary<string, object> properties, out int issueNumber, out string? repository, out string? tenantId)
    {
        issueNumber = 0;
        repository = Read(properties, RepositoryKey);
        tenantId = Read(properties, TenantKey);
        return int.TryParse(Read(properties, IssueKey), System.Globalization.NumberStyles.Integer,
                   System.Globalization.CultureInfo.InvariantCulture, out issueNumber)
               && issueNumber > 0;
    }

    private static string? Read(IDictionary<string, object> properties, string key)
        => properties.TryGetValue(key, out var v) ? v switch
        {
            System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.String } je => je.GetString(),
            null => null,
            _ => v.ToString(),
        } : null;

    /// <summary>A <c>single-issue-cycle</c> instance that finished normally (not cancelled, not faulted).</summary>
    public static bool IsCleanEnd(string? definitionId, WorkflowStatus status, WorkflowSubStatus subStatus)
        => string.Equals(definitionId, CycleDefinitionId, StringComparison.Ordinal)
           && status == WorkflowStatus.Finished
           && subStatus == WorkflowSubStatus.Finished;
}
