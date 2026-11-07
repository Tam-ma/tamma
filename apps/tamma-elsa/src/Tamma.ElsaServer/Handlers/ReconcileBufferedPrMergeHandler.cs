using Elsa.Mediator.Contracts;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Notifications;
using Tamma.Activities.ADL;

namespace Tamma.ElsaServer.Handlers;

/// <summary>
/// Closes the last reconcile-on-register gap for <see cref="WaitForPRMergedActivity"/>.
/// <para>
/// The activity checks <see cref="PendingPrMergeBuffer"/> before and after creating its
/// <c>pr-merged-*</c> bookmark, but that bookmark only reaches the store when the
/// workflow COMMITS — after the activity has returned. A merged-PR webhook landing in
/// that window finds no stored bookmark, is buffered by <c>PrMergedResumeEndpoint</c>,
/// and nothing read the buffer again: the merged cycle sat on the 12 h SLA (the
/// nightly Gitea engine-E2E "deploy approval never suspends" flake — Tamma merges the
/// PR itself, so the webhook arrives within ~1 s of the wait registering).
/// </para>
/// <para>
/// Elsa publishes <see cref="WorkflowBookmarksPersisted"/> right after the bookmarks are
/// saved, so a buffered notification consumed here always has a stored bookmark to
/// resume. The resume goes through Elsa's own bookmark queue (the mechanism it uses to
/// resume a parent after a child completes), which runs after the commit releases the
/// instance and burns the bookmark — so it cannot double-advance with the endpoint:
/// the buffer entry is consumed at most once.
/// </para>
/// </summary>
public sealed class ReconcileBufferedPrMergeHandler(
    PendingPrMergeBuffer pendingMerges,
    IBookmarkQueue bookmarkQueue,
    ILogger<ReconcileBufferedPrMergeHandler> logger) : INotificationHandler<WorkflowBookmarksPersisted>
{
    private const string BookmarkPrefix = "pr-merged-";

    public async Task HandleAsync(WorkflowBookmarksPersisted notification, CancellationToken cancellationToken)
    {
        foreach (var bookmark in notification.Diff.Added)
        {
            var name = bookmark.Name;
            if (string.IsNullOrEmpty(name) || !name.StartsWith(BookmarkPrefix, StringComparison.Ordinal))
                continue;

            if (!pendingMerges.TryConsume(name, out var mergeSha))
                continue;

            var input = new Dictionary<string, object>();
            if (!string.IsNullOrWhiteSpace(mergeSha))
                input["mergeSha"] = mergeSha;

            await bookmarkQueue.EnqueueAsync(new NewBookmarkQueueItem
            {
                BookmarkId = bookmark.Id,
                Options = new() { Input = input },
            }, cancellationToken);

            logger.LogInformation(
                "Buffered merge notification for {Bookmark} reconciled after the wait's bookmark was persisted " +
                "(bookmark {BookmarkId}, sha: {MergeSha}) — resume queued",
                name, bookmark.Id, mergeSha ?? "unknown");
        }
    }
}
