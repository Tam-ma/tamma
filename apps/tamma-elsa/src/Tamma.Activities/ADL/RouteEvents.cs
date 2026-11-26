namespace Tamma.Activities.ADL;

/// <summary>
/// Story 41-29 (AC5) — DCB event constants for the issue-level pre-route and
/// task-level flow router inside <c>SingleIssueCycleWorkflow</c>. Every constant
/// conforms to <c>AGGREGATE.ACTION.STATUS</c> (3 dot-separated segments) and is
/// emitted through the durable engine event drain via <see cref="EmitRouteEventActivity"/>.
/// </summary>
public static class RouteEvents
{
    public const string IssuePrerouted = "ROUTE.ISSUE.PREROUTED";
    public const string TaskDispatched = "ROUTE.TASK.DISPATCHED";
    public const string TaskDeferredToHuman = "ROUTE.TASK.DEFERRED_TO_HUMAN";
    public const string TaskUnknownKind = "ROUTE.TASK.UNKNOWN_KIND";

    public static string StatusForEvent(string type) => type switch
    {
        TaskUnknownKind => "error",
        _ => "success",
    };
}
