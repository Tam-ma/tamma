using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Documents;

namespace Tamma.Activities.Resume;

/// <summary>
/// Story 40-4 (AC10) — the sanctioned crash re-entry nodes, as production data. The 39-10
/// build gate (<c>ResumableStandardStructuralTests</c>, clause c) requires every workflow that
/// declares <c>LatestStateReEntry</c>/<c>Both</c> to contain at least one node whose type is a
/// key here. Mirrors <see cref="LifecycleBookmarks.CanonicalSuspendActivities"/>: adding a
/// re-entry node is a deliberate edit to this one list, not something a workflow can claim
/// for itself.
/// </summary>
public static class CanonicalReEntryActivities
{
    /// <summary>Activity type → the kind of re-entry it computes.</summary>
    public static readonly IReadOnlyDictionary<Type, string> Registry = new Dictionary<Type, string>
    {
        // 39-10 — a document lifecycle's stage (produce / review / accept / complete).
        [typeof(ComputeReEntryPositionActivity)] = "document-position",
        // 40-4 — the coding task loop's first unlanded task.
        [typeof(ComputeTaskResumeIndexActivity)] = "task-index",
    };
}
