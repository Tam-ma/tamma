using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Api.Services.PromptStore;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-3 (AC2, AC7, AC8) — <see cref="AgentRunResumer"/>: the webhook resolves the
/// durable row by <c>(installation, repo, head_branch)</c> under the principal it derives
/// from the INSTALLATION (never an ambient tenant), forwards the resume to the engine with
/// the stored name as a drift guard, and marks the row received exactly once.
/// </summary>
[TestFixture]
public class AgentRunResumerTests
{
    private const long Installation = 4242;
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-7";
    private const string Session = "adl-7-task-0";

    private Mock<IAgentRunWaitRepository> _waits = null!;
    private Mock<IInstallationRepository> _installations = null!;
    private Mock<ISoleUserProvider> _soleUser = null!;
    private Mock<IEventRepository> _events = null!;
    private StubEngine _engine = null!;
    private Guid _tenantId;
    private Guid _userId;

    [SetUp]
    public void SetUp()
    {
        _waits = new Mock<IAgentRunWaitRepository>();
        _installations = new Mock<IInstallationRepository>();
        _soleUser = new Mock<ISoleUserProvider>();
        _events = new Mock<IEventRepository>();
        _engine = new StubEngine(HttpStatusCode.OK);
        _tenantId = Guid.NewGuid();
        _userId = Guid.NewGuid();
        _installations.Setup(i => i.GetByInstallationIdAsync(Installation))
            .ReturnsAsync(new GitHubInstallation { InstallationId = Installation, TenantId = _tenantId, AccountLogin = "acme", AccountType = "Organization" });
        _soleUser.Setup(s => s.GetSoleUserIdAsync(It.IsAny<CancellationToken>())).ReturnsAsync(_userId);
        _waits.Setup(w => w.TryMarkReceivedByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        _waits.Setup(w => w.TryMarkReceivedByUserAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
    }

    [TearDown]
    public void TearDown() => _engine.Dispose();

    private AgentRunResumer Sut(TammaMode mode) => new(
        _waits.Object, _installations.Object, new StubMode(mode), _soleUser.Object,
        new StubHttpClientFactory(_engine), _events.Object, NullLogger<AgentRunResumer>.Instance);

    private AgentRunWait Row(Guid? tenantId, Guid? userId, Guid? bookmarkTenant, DateTime? dispatchedAt = null, string session = Session) => new()
    {
        Id = Guid.NewGuid(),
        TenantId = tenantId,
        UserId = userId,
        Repository = Repo,
        BranchName = Branch,
        SessionId = session,
        InstallationId = Installation,
        WorkflowInstanceId = "wf-1",
        BookmarkName = LifecycleBookmarks.ForAgentRun(bookmarkTenant?.ToString(), Repo, Branch, session),
        BookmarkTenantId = bookmarkTenant,
        Status = AgentRunWaitStatus.Pending,
        DispatchedAt = dispatchedAt ?? new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc),
    };

    private static AgentRunCompletion Completion(long? installation = Installation, string? branch = Branch) => new(
        InstallationId: installation, Repository: Repo, HeadBranch: branch, WorkflowRunId: 991,
        Status: "completed", Conclusion: "success",
        WorkflowRunUrl: "https://github.com/acme/widgets/actions/runs/991",
        ArtifactsUrl: "https://api.github.com/repos/acme/widgets/actions/runs/991/artifacts",
        CreatedAt: new DateTime(2026, 11, 1, 10, 1, 0, DateTimeKind.Utc),
        UpdatedAt: new DateTime(2026, 11, 1, 10, 6, 0, DateTimeKind.Utc));

    private void TenantRows(params AgentRunWait[] rows) => _waits
        .Setup(w => w.ListPendingByTenantAsync(_tenantId, Installation, Repo, Branch, It.IsAny<CancellationToken>()))
        .ReturnsAsync(rows);

    [Test]
    public async Task SaaS_resolves_the_tenant_from_the_installation_and_resumes()
    {
        var row = Row(_tenantId, null, _tenantId);
        TenantRows(row);

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.Resumed);
        _engine.Calls.Should().ContainSingle();
        var body = _engine.Bodies.Single();
        body.GetProperty("tenantId").GetString().Should().Be(_tenantId.ToString());
        body.GetProperty("sessionId").GetString().Should().Be(Session);
        body.GetProperty("bookmarkName").GetString().Should().Be(row.BookmarkName);
        body.GetProperty("workflowInstanceId").GetString().Should().Be("wf-1");
        body.GetProperty("workflowRunId").GetInt64().Should().Be(991);
        body.GetProperty("conclusion").GetString().Should().Be("success");
        body.GetProperty("durationSeconds").GetInt32().Should().Be(300);
        _engine.Calls.Single().Should().Be("/elsa/api/agent-runs/resume");
        _waits.Verify(w => w.TryMarkReceivedByTenantAsync(_tenantId, row.Id, 991, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public async Task Single_user_resolves_the_sole_user_with_a_null_tenant()
    {
        var row = Row(null, _userId, bookmarkTenant: null);
        _waits.Setup(w => w.ListPendingByUserAsync(_userId, Installation, Repo, Branch, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { row });

        var outcome = await Sut(TammaMode.SingleUser).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.Resumed);
        _engine.Bodies.Single().GetProperty("tenantId").ValueKind.Should().Be(JsonValueKind.Null,
            "the single-user wait folded the 'none' segment");
        _waits.Verify(w => w.TryMarkReceivedByUserAsync(_userId, row.Id, 991, It.IsAny<CancellationToken>()), Times.Once);
        _waits.Verify(w => w.ListPendingByTenantAsync(It.IsAny<Guid>(), It.IsAny<long?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never, "single-user mode never touches the tenant plane");
    }

    [Test]
    public async Task Principal_A_payload_never_reaches_principal_B_row()
    {
        // Installation 4242 belongs to tenant A; tenant B holds a pending row on the same repo+branch.
        var tenantB = Guid.NewGuid();
        _waits.Setup(w => w.ListPendingByTenantAsync(tenantB, It.IsAny<long?>(), Repo, Branch, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { Row(tenantB, null, tenantB) });
        TenantRows();

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
        _engine.Calls.Should().BeEmpty();
        _waits.Verify(w => w.ListPendingByTenantAsync(tenantB, It.IsAny<long?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _waits.Verify(w => w.TryMarkReceivedByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task SaaS_without_an_installation_id_does_not_resume()
    {
        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion(installation: null));

        outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
        _engine.Calls.Should().BeEmpty();
    }

    [Test]
    public async Task Unknown_installation_does_not_resume()
    {
        _installations.Setup(i => i.GetByInstallationIdAsync(Installation)).ReturnsAsync((GitHubInstallation?)null);

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
        _engine.Calls.Should().BeEmpty();
    }

    [Test]
    public async Task No_pending_row_is_no_match_and_redelivery_is_idempotent()
    {
        TenantRows(); // already received ⇒ not pending

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
        _engine.Calls.Should().BeEmpty();
    }

    [Test]
    public async Task Two_rows_resume_the_latest_dispatched_before_the_run_was_created()
    {
        var older = Row(_tenantId, null, _tenantId, new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc), "s-old");
        var latest = Row(_tenantId, null, _tenantId, new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc), "s-new");
        var after = Row(_tenantId, null, _tenantId, new DateTime(2026, 11, 1, 10, 30, 0, DateTimeKind.Utc), "s-after");
        TenantRows(older, after, latest);

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.Resumed);
        _engine.Bodies.Single().GetProperty("sessionId").GetString().Should().Be("s-new");
    }

    [Test]
    public async Task Genuinely_ambiguous_match_logs_and_skips()
    {
        var at = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        TenantRows(Row(_tenantId, null, _tenantId, at, "s-1"), Row(_tenantId, null, _tenantId, at, "s-2"));

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.Ambiguous);
        _engine.Calls.Should().BeEmpty("never a wrong resume");
    }

    [Test]
    public async Task Stored_name_drift_is_refused_before_any_engine_call()
    {
        var row = Row(_tenantId, null, _tenantId);
        row.BookmarkName = LifecycleBookmarks.ForAgentRun(Guid.NewGuid().ToString(), Repo, Branch, Session);
        TenantRows(row);

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.Refused);
        _engine.Calls.Should().BeEmpty();
        _waits.Verify(w => w.TryMarkReceivedByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestCase(HttpStatusCode.Accepted, AgentRunResumeOutcome.Buffered, true)]
    [TestCase(HttpStatusCode.NotFound, AgentRunResumeOutcome.AlreadyResumed, true)]
    [TestCase(HttpStatusCode.Conflict, AgentRunResumeOutcome.Refused, false)]
    [TestCase(HttpStatusCode.ServiceUnavailable, AgentRunResumeOutcome.EngineError, false)]
    public async Task Engine_status_maps_to_outcome_and_row_state(HttpStatusCode status, AgentRunResumeOutcome expected, bool marked)
    {
        _engine.Status = status;
        var row = Row(_tenantId, null, _tenantId);
        TenantRows(row);

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(expected);
        _waits.Verify(w => w.TryMarkReceivedByTenantAsync(_tenantId, row.Id, 991, It.IsAny<CancellationToken>()),
            marked ? Times.Once() : Times.Never());
    }

    [Test]
    public async Task Lost_received_CAS_is_already_resumed()
    {
        TenantRows(Row(_tenantId, null, _tenantId));
        _waits.Setup(w => w.TryMarkReceivedByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion());

        outcome.Should().Be(AgentRunResumeOutcome.AlreadyResumed);
    }

    [Test]
    public async Task Missing_head_branch_is_no_match()
    {
        var outcome = await Sut(TammaMode.SaaS).ResumeFromWorkflowRunAsync(Completion(branch: null));

        outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
    }

    // ── doubles ──

    internal sealed class StubMode(TammaMode mode) : ITammaModeProvider { public TammaMode Mode { get; } = mode; }

    internal sealed class StubEngine(HttpStatusCode status) : HttpMessageHandler
    {
        public HttpStatusCode Status { get; set; } = status;
        public List<string> Calls { get; } = new();
        public List<JsonElement> Bodies { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls.Add(request.RequestUri!.AbsolutePath);
            var json = await request.Content!.ReadAsStringAsync(ct);
            Bodies.Add(JsonDocument.Parse(json).RootElement.Clone());
            return new HttpResponseMessage(Status) { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
        }
    }

    internal sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false)
        {
            BaseAddress = new Uri("http://engine.test"),
        };
    }
}
