using Elsa.Workflows.Helpers;
using Elsa.Workflows.Models;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Notifications;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;
using Tamma.Activities.Documents;
using Tamma.ElsaServer.Handlers;

namespace Tamma.Activities.Tests.AgentDispatch;

/// <summary>
/// Story 40-3 — a completion buffered by <c>AgentRunResumeEndpoint</c> (it beat the wait's
/// bookmark commit) is resumed once the bookmark is persisted: reconcile-after-persist.
/// </summary>
[TestFixture]
public class ReconcileBufferedAgentRunHandlerTests
{
    private static readonly string Name = LifecycleBookmarks.ForAgentRun(null, "acme/widgets", "tamma/issue-7", "adl-7-task-0");

    private PendingAgentRunCompletionBuffer _buffer = null!;
    private Mock<IBookmarkQueue> _queue = null!;
    private ReconcileBufferedAgentRunHandler _handler = null!;

    [SetUp]
    public void SetUp()
    {
        _buffer = new PendingAgentRunCompletionBuffer();
        _queue = new Mock<IBookmarkQueue>();
        _handler = new ReconcileBufferedAgentRunHandler(
            _buffer, _queue.Object, NullLogger<ReconcileBufferedAgentRunHandler>.Instance);
    }

    private static Bookmark NewBookmark(string id, string name) => new(
        id, name, "hash", null, "activity", "node", "activity-instance",
        DateTimeOffset.UtcNow, true, null, true, null);

    private static WorkflowBookmarksPersisted Persisted(params Bookmark[] added) =>
        new(Diff.From<Bookmark>(added, Array.Empty<Bookmark>(), Array.Empty<Bookmark>()));

    private static Dictionary<string, object> Completion() =>
        AgentRunCompletionSignal.ToInput(new AgentMonitorResult(991, "completed", "success", "u", 60, "a"));

    [Test]
    public async Task Buffered_completion_is_queued_when_the_wait_bookmark_is_persisted()
    {
        var original = Completion();
        _buffer.Record(Name, original);
        NewBookmarkQueueItem? queued = null;
        _queue.Setup(q => q.EnqueueAsync(It.IsAny<NewBookmarkQueueItem>(), It.IsAny<CancellationToken>()))
            .Callback<NewBookmarkQueueItem, CancellationToken>((i, _) => queued = i)
            .Returns(Task.CompletedTask);

        await _handler.HandleAsync(Persisted(NewBookmark("bm-1", Name)), CancellationToken.None);

        queued.Should().NotBeNull();
        queued!.BookmarkId.Should().Be("bm-1");
        AgentRunCompletionSignal.TryRead(queued.Options!.Input, out var read).Should().BeTrue();
        read.WorkflowRunId.Should().Be(991);
        queued.Options.Input.Should().NotBeSameAs(original, "never hand Elsa a caller's dictionary");
        _buffer.TryConsume(Name, out _).Should().BeFalse("consumed exactly once");
    }

    [Test]
    public async Task Nothing_buffered_queues_nothing()
    {
        await _handler.HandleAsync(Persisted(NewBookmark("bm-1", Name)), CancellationToken.None);

        _queue.Verify(q => q.EnqueueAsync(It.IsAny<NewBookmarkQueueItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Unrelated_bookmarks_leave_the_buffer_intact()
    {
        _buffer.Record(Name, Completion());

        await _handler.HandleAsync(Persisted(NewBookmark("bm-2", "pr-merged-none-acme_widgets-2")), CancellationToken.None);

        _queue.Verify(q => q.EnqueueAsync(It.IsAny<NewBookmarkQueueItem>(), It.IsAny<CancellationToken>()), Times.Never);
        _buffer.TryConsume(Name, out _).Should().BeTrue();
    }
}
