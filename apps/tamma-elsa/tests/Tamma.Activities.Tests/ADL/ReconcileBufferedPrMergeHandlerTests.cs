using Elsa.Workflows.Helpers;
using Elsa.Workflows.Models;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Notifications;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.ElsaServer.Handlers;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// A merged-PR webhook buffered between WaitForPRMerged's last buffer check and the
/// workflow's commit must be reconciled once the wait's bookmark is persisted —
/// otherwise the merged cycle sits on the 12 h SLA.
/// </summary>
[TestFixture]
public class ReconcileBufferedPrMergeHandlerTests
{
    private const string BookmarkName = "pr-merged-none-owner_repo-2";

    private PendingPrMergeBuffer _buffer = null!;
    private Mock<IBookmarkQueue> _queue = null!;
    private ReconcileBufferedPrMergeHandler _handler = null!;

    [SetUp]
    public void SetUp()
    {
        _buffer = new PendingPrMergeBuffer();
        _queue = new Mock<IBookmarkQueue>();
        _handler = new ReconcileBufferedPrMergeHandler(
            _buffer, _queue.Object, NullLogger<ReconcileBufferedPrMergeHandler>.Instance);
    }

    private static Bookmark NewBookmark(string id, string name) => new(
        id, name, "hash", null, "activity", "node", "activity-instance",
        DateTimeOffset.UtcNow, true, null, true, null);

    private static WorkflowBookmarksPersisted Persisted(params Bookmark[] added) =>
        new(Diff.From<Bookmark>(added, Array.Empty<Bookmark>(), Array.Empty<Bookmark>()));

    [Test]
    public async Task BufferedMerge_IsQueuedForResume_WhenTheWaitBookmarkIsPersisted()
    {
        _buffer.Record(BookmarkName, "abc123");

        await _handler.HandleAsync(Persisted(NewBookmark("bm-1", BookmarkName)), CancellationToken.None);

        _queue.Verify(q => q.EnqueueAsync(
            It.Is<NewBookmarkQueueItem>(i =>
                i.BookmarkId == "bm-1"
                && (string)i.Options!.Input!["mergeSha"] == "abc123"),
            It.IsAny<CancellationToken>()), Times.Once);
        _buffer.TryConsume(BookmarkName, out _).Should().BeFalse("the buffered entry is consumed exactly once");
    }

    [Test]
    public async Task NothingBuffered_QueuesNothing()
    {
        await _handler.HandleAsync(Persisted(NewBookmark("bm-1", BookmarkName)), CancellationToken.None);

        _queue.Verify(q => q.EnqueueAsync(It.IsAny<NewBookmarkQueueItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task UnrelatedBookmarks_AreIgnored_AndLeaveTheBufferIntact()
    {
        _buffer.Record(BookmarkName, "abc123");

        await _handler.HandleAsync(
            Persisted(NewBookmark("bm-2", "adl-merge-approval-none-owner_repo-1-2")), CancellationToken.None);

        _queue.Verify(q => q.EnqueueAsync(It.IsAny<NewBookmarkQueueItem>(), It.IsAny<CancellationToken>()), Times.Never);
        _buffer.TryConsume(BookmarkName, out _).Should().BeTrue("a different bookmark must not consume the entry");
    }
}
