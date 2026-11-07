using Elsa.Mediator.Contracts;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Notifications;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Documents;

namespace Tamma.ElsaServer.Handlers;

/// <summary>
/// Story 40-3 — the reconcile-after-persist step for <see cref="WaitForAgentRunActivity"/>
/// (the <see cref="ReconcileBufferedPrMergeHandler"/> pattern).
/// <para>
/// A completion that reaches <c>AgentRunResumeEndpoint</c> before the wait's bookmark is
/// committed is buffered in <see cref="PendingAgentRunCompletionBuffer"/>. Elsa publishes
/// <see cref="WorkflowBookmarksPersisted"/> right after the bookmarks are saved, so a buffered
/// completion consumed here always has a stored bookmark to resume. The resume goes through
/// Elsa's bookmark queue, which burns the bookmark — the buffer entry is consumed at most
/// once, so this cannot double-advance with the endpoint or the activity's own reconcile timer.
/// </para>
/// </summary>
public sealed class ReconcileBufferedAgentRunHandler(
    PendingAgentRunCompletionBuffer pending,
    IBookmarkQueue bookmarkQueue,
    ILogger<ReconcileBufferedAgentRunHandler> logger) : INotificationHandler<WorkflowBookmarksPersisted>
{
    private const string BookmarkPrefix = LifecycleBookmarks.AgentRunGate + "-";

    public async Task HandleAsync(WorkflowBookmarksPersisted notification, CancellationToken cancellationToken)
    {
        foreach (var bookmark in notification.Diff.Added)
        {
            var name = bookmark.Name;
            if (string.IsNullOrEmpty(name) || !name.StartsWith(BookmarkPrefix, StringComparison.Ordinal))
                continue;

            if (!pending.TryConsume(name, out var input))
                continue;

            await bookmarkQueue.EnqueueAsync(new NewBookmarkQueueItem
            {
                BookmarkId = bookmark.Id,
                // A fresh copy — never hand Elsa a dictionary another path may still hold.
                Options = new() { Input = new Dictionary<string, object>(input) },
            }, cancellationToken);

            logger.LogInformation(
                "Buffered agent-run completion for {Bookmark} reconciled after the bookmark was persisted " +
                "(bookmark {BookmarkId}) — resume queued", name, bookmark.Id);
        }
    }
}
