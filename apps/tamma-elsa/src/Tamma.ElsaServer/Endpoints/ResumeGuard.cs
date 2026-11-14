using Elsa.Workflows.Runtime;
using Elsa.Workflows.State;

namespace Tamma.ElsaServer.Endpoints;

/// <summary>
/// Guards a bookmark resume against the gap in Elsa's commit: it stores the bookmark row a
/// moment before it stores the instance state. A resume in that gap loads the old state,
/// resumes nothing, and then saves the old state back over the new one — the wait is lost for
/// good. Every resume endpoint waits here until the stored state can continue the bookmark.
/// </summary>
public static class ResumeGuard
{
    /// <summary>How long to wait for the instance state. The gap is milliseconds wide.</summary>
    public static TimeSpan MaxWait { get; set; } = TimeSpan.FromSeconds(2);

    private static readonly TimeSpan Poll = TimeSpan.FromMilliseconds(10);

    /// <summary>
    /// True when the state holds the bookmark AND the activity it belongs to — what Elsa needs
    /// to continue it. The bookmark alone is not enough: stores that share objects (the
    /// in-memory one) can show a new bookmark on a state whose activities are still the old ones.
    /// </summary>
    public static bool IsResumable(WorkflowState? state, string bookmarkId)
    {
        var stored = state?.Bookmarks.FirstOrDefault(b => b.Id == bookmarkId);
        return stored is not null
            && state!.ActivityExecutionContexts.Any(c => c.Id == stored.ActivityInstanceId);
    }

    /// <summary>
    /// Waits up to <see cref="MaxWait"/> for the stored state of <paramref name="client"/>'s
    /// instance to be resumable from <paramref name="bookmarkId"/>.
    /// </summary>
    public static async Task<bool> WaitUntilResumableAsync(
        IWorkflowClient client, string bookmarkId, CancellationToken ct)
    {
        var until = DateTime.UtcNow + MaxWait;
        while (true)
        {
            WorkflowState? state = null;
            try { state = await client.ExportStateAsync(ct).ConfigureAwait(false); }
            catch (Exception ex) when (ex is not OperationCanceledException) { /* instance not stored yet */ }
            if (IsResumable(state, bookmarkId)) return true;
            if (DateTime.UtcNow >= until) return false;
            await Task.Delay(Poll, ct).ConfigureAwait(false);
        }
    }

    /// <summary>The retryable refusal for endpoints with no buffer: nothing was consumed.</summary>
    public static IResult NotReady(string bookmark) => Results.Conflict(new
    {
        error = "instance_state_not_ready",
        bookmark,
        detail = "The wait is registered but its workflow state is not stored yet. Retry.",
    });
}
