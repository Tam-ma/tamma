namespace Tamma.Api.Services.Tasks;

/// <summary>
/// Story 39-20 (AC5 / D8) — fail-loud DCB event constants for role-addressed
/// task assignment, reassignment, and completion. Every constant conforms to
/// <c>AGGREGATE.ACTION.STATUS</c>.
/// </summary>
public static class TaskEvents
{
    public const string Assigned = "TASK.ASSIGNED.SUCCESS";
    public const string Reassigned = "TASK.REASSIGNED.SUCCESS";
    public const string Completed = "TASK.COMPLETED.SUCCESS";

    public const string BasisInitiator = "initiator";
    public const string BasisRepoAccess = "repo-access";

    public const string SurfaceTaskView = "task-view";
    public const string SurfaceChat = "chat";

    public static readonly IReadOnlySet<string> AllowedBases =
        new HashSet<string>(StringComparer.Ordinal) { BasisInitiator, BasisRepoAccess };

    public static readonly IReadOnlySet<string> AllowedSurfaces =
        new HashSet<string>(StringComparer.Ordinal) { SurfaceTaskView, SurfaceChat };
}
