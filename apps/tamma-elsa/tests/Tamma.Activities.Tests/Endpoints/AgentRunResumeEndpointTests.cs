using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Entities;
using Elsa.Workflows.Runtime.Filters;
using Elsa.Workflows.Runtime.Messages;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Documents;
using Tamma.ElsaServer.Endpoints;

namespace Tamma.Activities.Tests.Endpoints;

/// <summary>
/// Story 40-3 (AC3, AC7, AC8) — the engine-side agent-run resume seam. Before this story
/// nothing resumed the <c>agent-run</c> bookmark: every GitHub Actions run took the
/// <c>Timeout</c> edge. The endpoint recomputes the name from the request (never trusts a
/// raw name), resumes exactly once, buffers a bookmark miss, and refuses drift/ambiguity.
/// </summary>
[TestFixture]
public class AgentRunResumeEndpointTests
{
    private const string Tenant = "6a5ee5c1-8f5a-4d3a-9b6e-000000000001";
    private const string OtherTenant = "6a5ee5c1-8f5a-4d3a-9b6e-000000000002";
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-7";
    private const string Session = "adl-7-task-0";

    private Mock<IBookmarkStore> _bookmarks = null!;
    private Mock<IWorkflowRuntime> _runtime = null!;
    private Mock<IWorkflowClient> _client = null!;
    private bool _stateCommitted;
    private bool _bookmarkListShared;
    private PendingAgentRunCompletionBuffer _buffer = null!;
    private RunWorkflowInstanceRequest? _ran;

    private static string Name(string? tenant = Tenant) =>
        LifecycleBookmarks.ForAgentRun(tenant, Repo, Branch, Session);

    [SetUp]
    public void SetUp()
    {
        _bookmarks = new Mock<IBookmarkStore>();
        _runtime = new Mock<IWorkflowRuntime>();
        _client = new Mock<IWorkflowClient>();
        _buffer = new PendingAgentRunCompletionBuffer();
        _ran = null;
        _stateCommitted = true;
        _bookmarkListShared = false;
        _client.Setup(c => c.ExportStateAsync(It.IsAny<CancellationToken>())).ReturnsAsync(() => StoredState());
        ResumeGuard.MaxWait = TimeSpan.Zero; // unit tests: one read, no waiting
        _runtime.Setup(r => r.CreateClientAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(_client.Object);
        _client.Setup(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()))
            .Callback<RunWorkflowInstanceRequest, CancellationToken>((r, _) => _ran = r)
            .ReturnsAsync(new RunWorkflowInstanceResponse());
        _bookmarks.Setup(b => b.FindManyAsync(It.IsAny<BookmarkFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Enumerable.Empty<StoredBookmark>());
        _bookmarks.Setup(b => b.DeleteAsync(It.IsAny<BookmarkFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1L);
    }

    private readonly List<string> _storedBookmarkIds = new();

    [TearDown]
    public void RestoreGuard() => ResumeGuard.MaxWait = TimeSpan.FromSeconds(2);

    /// <summary>The state as stored: it holds the bookmarks only once it is committed.</summary>
    private Elsa.Workflows.State.WorkflowState StoredState()
    {
        var state = new Elsa.Workflows.State.WorkflowState();
        foreach (var id in _storedBookmarkIds)
        {
            if (_stateCommitted || _bookmarkListShared)
                state.Bookmarks.Add(new Elsa.Workflows.Models.Bookmark(id, "n", "h", null, "a", "node", "ai-" + id, DateTimeOffset.UtcNow));
            if (_stateCommitted)
                state.ActivityExecutionContexts.Add(new Elsa.Workflows.State.ActivityExecutionContextState { Id = "ai-" + id });
        }
        return state;
    }

    private void StoreHas(string name, params StoredBookmark[] matches)
    {
        _storedBookmarkIds.AddRange(matches.Select(m => m.Id));
        StoreHasRows(name, matches);
    }

    private void StoreHasRows(string name, params StoredBookmark[] matches) => _bookmarks
        .Setup(b => b.FindManyAsync(It.Is<BookmarkFilter>(f => f.Name == name), It.IsAny<CancellationToken>()))
        .ReturnsAsync(matches.AsEnumerable());

    private static StoredBookmark Bookmark(string id, string name, string instanceId) => new()
    {
        Id = id, Name = name, WorkflowInstanceId = instanceId, CreatedAt = DateTimeOffset.UtcNow,
    };

    private static AgentRunResumeEndpoint.ResumeRequest Request(
        string? tenant = Tenant, string? bookmarkName = null, string? instanceId = null, long runId = 991) => new(
        TenantId: tenant, Repository: Repo, BranchName: Branch, SessionId: Session,
        BookmarkName: bookmarkName, WorkflowInstanceId: instanceId,
        WorkflowRunId: runId, Status: "completed", Conclusion: "success",
        WorkflowRunUrl: "https://github.com/acme/widgets/actions/runs/991",
        ArtifactsUrl: "https://api.github.com/repos/acme/widgets/actions/runs/991/artifacts",
        DurationSeconds: 120);

    private Task<IResult> Call(AgentRunResumeEndpoint.ResumeRequest request) =>
        AgentRunResumeEndpoint.Resume(request, _bookmarks.Object, _runtime.Object, _buffer,
            NullLoggerFactory.Instance, CancellationToken.None);

    private static int? StatusOf(IResult r) => (r as IStatusCodeHttpResult)?.StatusCode;

    [Test]
    public async Task Resume_runs_the_instance_with_a_readable_completion_payload()
    {
        StoreHas(Name(), Bookmark("bm-1", Name(), "wf-1"));

        var result = await Call(Request(bookmarkName: Name(), instanceId: "wf-1"));

        StatusOf(result).Should().Be(200);
        _ran.Should().NotBeNull();
        _ran!.BookmarkId.Should().Be("bm-1");
        AgentRunCompletionSignal.TryRead(_ran.Input, out var read).Should().BeTrue(
            "the resume input must satisfy the 40-2 fail-closed reader");
        read.WorkflowRunId.Should().Be(991);
        read.Conclusion.Should().Be("success");
        read.ArtifactsUrl.Should().EndWith("/artifacts");
        _bookmarks.Verify(b => b.DeleteAsync(It.Is<BookmarkFilter>(f => f.BookmarkId == "bm-1"), It.IsAny<CancellationToken>()),
            Times.Once, "the bookmark is claimed atomically before the instance runs");
    }

    [Test]
    public async Task A_resume_before_the_instance_state_is_stored_is_buffered_not_lost()
    {
        StoreHas(Name(), Bookmark("bm-1", Name(), "wf-1"));
        _stateCommitted = false; // the bookmark row is stored; the instance state is not yet

        var result = await Call(Request(bookmarkName: Name(), instanceId: "wf-1"));

        StatusOf(result).Should().Be(202);
        _ran.Should().BeNull("resuming now would load the old state and resume nothing");
        _bookmarks.Verify(b => b.DeleteAsync(It.IsAny<BookmarkFilter>(), It.IsAny<CancellationToken>()), Times.Never,
            "the row stays so the wait is still reachable");
        _buffer.TryConsume(Name(), out _).Should().BeTrue("the completion waits for the post-commit reconcile read");
    }

    [Test]
    public async Task A_stored_state_that_shows_the_bookmark_but_not_its_activity_is_not_resumed()
    {
        // The in-memory store shares the bookmark list with the running workflow: the old stored
        // state shows the new bookmark while its activities are still the old ones.
        StoreHas(Name(), Bookmark("bm-1", Name(), "wf-1"));
        _stateCommitted = false;
        _bookmarkListShared = true;

        var result = await Call(Request(bookmarkName: Name(), instanceId: "wf-1"));

        StatusOf(result).Should().Be(202);
        _ran.Should().BeNull();
        _bookmarks.Verify(b => b.DeleteAsync(It.IsAny<BookmarkFilter>(), It.IsAny<CancellationToken>()), Times.Never);
        _buffer.TryConsume(Name(), out _).Should().BeTrue();
    }

    [Test]
    public async Task Single_user_null_tenant_folds_to_the_none_segment()
    {
        var name = Name(tenant: null);
        name.Should().Contain("-none-");
        StoreHas(name, Bookmark("bm-su", name, "wf-su"));

        var result = await Call(Request(tenant: null, bookmarkName: name));

        StatusOf(result).Should().Be(200);
        _ran!.BookmarkId.Should().Be("bm-su");
    }

    [Test]
    public async Task Bookmark_miss_buffers_the_completion_for_reconcile_after_persist()
    {
        var result = await Call(Request());

        StatusOf(result).Should().Be(202);
        _buffer.TryConsume(Name(), out var buffered).Should().BeTrue(
            "a completion that beats the bookmark commit must not be lost (40-2 buffer contract)");
        AgentRunCompletionSignal.TryRead(buffered, out var read).Should().BeTrue();
        read.WorkflowRunId.Should().Be(991);
        _client.Verify(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task A_buffered_completion_carries_the_run_created_at()
    {
        var created = new DateTime(2026, 11, 1, 10, 1, 0, DateTimeKind.Utc);

        await Call(Request() with { RunCreatedAt = created });

        _buffer.TryConsume(Name(), out var buffered).Should().BeTrue();
        AgentRunCompletionSignal.TryReadRunCreatedAt(buffered, out var read).Should().BeTrue();
        read.Should().Be(created);
    }

    [Test]
    public async Task Stored_name_that_drifts_from_the_recomputed_name_is_refused()
    {
        // Principal fold: a caller stating tenant A cannot resume by naming tenant B's bookmark.
        var otherName = Name(OtherTenant);
        StoreHas(otherName, Bookmark("bm-b", otherName, "wf-b"));

        var result = await Call(Request(tenant: Tenant, bookmarkName: otherName));

        StatusOf(result).Should().Be(409);
        _client.Verify(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _bookmarks.Verify(b => b.DeleteAsync(It.IsAny<BookmarkFilter>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Other_tenants_wait_is_never_reached()
    {
        var otherName = Name(OtherTenant);
        StoreHas(otherName, Bookmark("bm-b", otherName, "wf-b"));

        var result = await Call(Request(tenant: Tenant));

        StatusOf(result).Should().Be(202, "tenant A's lookup finds nothing — it buffers under A's own name");
        _client.Verify(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _buffer.TryConsume(otherName, out _).Should().BeFalse();
    }

    [Test]
    public async Task Ambiguous_match_is_refused_with_409()
    {
        StoreHas(Name(), Bookmark("bm-1", Name(), "wf-1"), Bookmark("bm-2", Name(), "wf-2"));

        var result = await Call(Request());

        StatusOf(result).Should().Be(409);
        _client.Verify(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Instance_mismatch_is_refused_with_409()
    {
        StoreHas(Name(), Bookmark("bm-1", Name(), "wf-other"));

        var result = await Call(Request(instanceId: "wf-1"));

        StatusOf(result).Should().Be(409);
        _client.Verify(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Lost_claim_is_a_benign_no_op_404()
    {
        StoreHas(Name(), Bookmark("bm-1", Name(), "wf-1"));
        _bookmarks.Setup(b => b.DeleteAsync(It.IsAny<BookmarkFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0L);

        var result = await Call(Request());

        StatusOf(result).Should().Be(404, "a concurrent resume (redelivery) already burned the bookmark");
        _client.Verify(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Failed_run_restores_the_claimed_bookmark()
    {
        var bm = Bookmark("bm-1", Name(), "wf-1");
        StoreHas(Name(), bm);
        _client.Setup(c => c.RunInstanceAsync(It.IsAny<RunWorkflowInstanceRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("boom"));

        var act = () => Call(Request());

        await act.Should().ThrowAsync<InvalidOperationException>();
        _bookmarks.Verify(b => b.SaveAsync(bm, It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestCase(null, Branch, Session, 991L)]
    [TestCase(Repo, "", Session, 991L)]
    [TestCase(Repo, Branch, " ", 991L)]
    [TestCase(Repo, Branch, Session, 0L)]
    public async Task Malformed_request_is_400(string? repo, string branch, string session, long runId)
    {
        var request = Request(runId: runId) with { Repository = repo, BranchName = branch, SessionId = session };

        var result = await Call(request);

        StatusOf(result).Should().Be(400);
    }
}
