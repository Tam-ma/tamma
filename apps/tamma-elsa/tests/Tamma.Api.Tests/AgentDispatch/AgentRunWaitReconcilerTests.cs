using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Documents;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Api.Services.PromptStore;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-3b — the agent-run wait reconciler: what it does with each stale wait, and that it
/// sweeps per principal under that principal's lock without one failure stopping the rest.
/// </summary>
[TestFixture]
public class AgentRunWaitReconcilerTests
{
    private static readonly DateTime Now = new(2026, 11, 7, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-403b-403b-403b-aaaaaaaaaaaa");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-403b-403b-403b-bbbbbbbbbbbb");
    private static readonly Guid SoleUser = Guid.Parse("cccccccc-403b-403b-403b-cccccccccccc");
    private const string Repo = "acme/widgets";
    private static readonly AgentRunWaitReconcilerOptions Options = new();

    private Mock<IAgentRunWaitRepository> _waits = null!;
    private Mock<IAgentDispatchMediationService> _mediation = null!;
    private Mock<IAgentRunResumer> _resumer = null!;
    private Mock<IEventRepository> _events = null!;
    private FakeLock _lock = null!;
    private TammaMode _mode;
    private List<AgentRunCompletion> _resumed = null!;

    [SetUp]
    public void SetUp()
    {
        _waits = new Mock<IAgentRunWaitRepository>();
        _waits.Setup(w => w.TryMarkTimedOutByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _waits.Setup(w => w.TryMarkTimedOutByUserAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _mediation = new Mock<IAgentDispatchMediationService>();
        _mediation.Setup(m => m.DiscoverRunAsync(It.IsAny<Guid?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AgentRunStatusResult { Success = true, Found = false });
        _resumed = new List<AgentRunCompletion>();
        _resumer = new Mock<IAgentRunResumer>();
        _resumer.Setup(r => r.ResumeFromWorkflowRunAsync(It.IsAny<AgentRunCompletion>(), It.IsAny<CancellationToken>()))
            .Callback((AgentRunCompletion c, CancellationToken _) => _resumed.Add(c))
            .ReturnsAsync(AgentRunResumeOutcome.Resumed);
        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>())).ReturnsAsync((DomainEvent e) => e);
        _lock = new FakeLock();
        _mode = TammaMode.SaaS;
    }

    // ── The decision ──────────────────────────────────────────────────────

    [Test]
    public void A_finished_run_is_resumed()
        => AgentRunWaitReconciler.Decide(Wait(TenantA, minutesAgo: 15), Completed(77), Now, Options)
            .Should().Be(AgentRunWaitSweepAction.Resume);

    [Test]
    public void A_finished_run_is_resumed_even_past_the_limit() // late beats lost
        => AgentRunWaitReconciler.Decide(Wait(TenantA, minutesAgo: 600), Completed(77), Now, Options)
            .Should().Be(AgentRunWaitSweepAction.Resume);

    [TestCase("in_progress")]
    [TestCase("queued")]
    public void A_running_run_waits(string status)
        => AgentRunWaitReconciler.Decide(Wait(TenantA, minutesAgo: 15),
                new AgentRunStatusResult { Success = true, Found = true, RunId = 77, Status = status }, Now, Options)
            .Should().Be(AgentRunWaitSweepAction.Wait);

    [Test]
    public void No_run_found_yet_waits()
        => AgentRunWaitReconciler.Decide(Wait(TenantA, minutesAgo: 15), new AgentRunStatusResult { Success = true, Found = false }, Now, Options)
            .Should().Be(AgentRunWaitSweepAction.Wait);

    [Test]
    public void A_failed_lookup_is_not_a_completion()
        => AgentRunWaitReconciler.Decide(Wait(TenantA, minutesAgo: 15),
                new AgentRunStatusResult { Success = false, Found = true, RunId = 77, Status = "completed" }, Now, Options)
            .Should().Be(AgentRunWaitSweepAction.Wait);

    [TestCase(59, AgentRunWaitSweepAction.Wait)]
    [TestCase(60, AgentRunWaitSweepAction.TimeOut)]
    [TestCase(120, AgentRunWaitSweepAction.TimeOut)]
    public void No_completion_by_the_limit_times_out(int minutesAgo, AgentRunWaitSweepAction expected)
        => AgentRunWaitReconciler.Decide(Wait(TenantA, minutesAgo), null, Now, Options).Should().Be(expected);

    [Test]
    public void The_limit_outlives_the_engine_deadline()
        => Options.TimeOutAfterMinutes.Should().BeGreaterThan(
            WaitForAgentRunActivity.EffectiveWaitTimeoutMinutes(30),
            "a row is only marked timed_out after the engine wait itself has taken its Timeout edge");

    // ── The sweep ─────────────────────────────────────────────────────────

    [Test]
    public async Task SaaS_resumes_finished_runs_through_the_webhook_resumer_with_wake_path_poll()
    {
        var wait = Wait(TenantA, minutesAgo: 15);
        Tenants((TenantA, new[] { wait }));
        _mediation.Setup(m => m.DiscoverRunAsync(TenantA, Repo, wait.BranchName, wait.DispatchedAt.AddMinutes(-2), wait.SessionId, AgentDispatchMediationService.DefaultWorkflowFile, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Completed(77));

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.Resumed.Should().ContainSingle().Which.Should().Be((wait.Id, AgentRunResumeOutcome.Resumed));
        var c = _resumed.Single();
        c.WakePath.Should().Be(AgentRunWaitEventTypes.WakePaths.Poll);
        c.WorkflowRunId.Should().Be(77);
        c.InstallationId.Should().Be(wait.InstallationId);
        c.HeadBranch.Should().Be(wait.BranchName);
        c.Conclusion.Should().Be("success");
        _lock.Acquired.Should().Equal($"tenant:{TenantA:D}");
    }

    [Test]
    public async Task The_wait_workflow_file_is_used_for_discovery_and_the_run_identity_is_forwarded()
    {
        var wait = Wait(TenantA, minutesAgo: 15);
        wait.WorkflowFile = "custom-agent.yml";
        Tenants((TenantA, new[] { wait }));
        _mediation.Setup(m => m.DiscoverRunAsync(TenantA, Repo, wait.BranchName, It.IsAny<DateTime>(), wait.SessionId, "custom-agent.yml", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Completed(77) with { WorkflowPath = ".github/workflows/custom-agent.yml", Event = "workflow_dispatch" });

        await Sut().SweepOnceAsync(CancellationToken.None);

        var c = _resumed.Single();
        c.WorkflowPath.Should().Be(".github/workflows/custom-agent.yml");
        c.Event.Should().Be("workflow_dispatch");
    }

    [Test]
    public async Task A_CI_run_created_after_the_dispatch_on_the_agent_branch_is_not_taken_as_the_agent_result()
    {
        // Real resumer: discovery hands back the repo's CI run (triggered by the agent's push,
        // so created AFTER the dispatch, on the same branch). It must not resume the wait.
        var wait = Wait(TenantA, minutesAgo: 15);
        Tenants((TenantA, new[] { wait }));
        _mediation.Setup(m => m.DiscoverRunAsync(TenantA, Repo, wait.BranchName, It.IsAny<DateTime>(), wait.SessionId, It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Completed(90) with
            {
                WorkflowPath = ".github/workflows/ci.yml",
                Event = "push",
                CreatedAt = wait.DispatchedAt.AddMinutes(3),
            });
        _waits.Setup(w => w.ListPendingByTenantAsync(TenantA, wait.InstallationId, Repo, wait.BranchName, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { wait });
        using var engine = new AgentRunResumerTests.StubEngine(System.Net.HttpStatusCode.OK);

        var result = await Sut(RealResumer(engine)).SweepOnceAsync(CancellationToken.None);

        result.Resumed.Should().ContainSingle().Which.Outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
        engine.Calls.Should().BeEmpty();
        _waits.Verify(w => w.TryMarkReceivedByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task A_discovered_run_without_workflow_identity_is_not_resumed()
    {
        var wait = Wait(TenantA, minutesAgo: 15);
        Tenants((TenantA, new[] { wait }));
        _mediation.Setup(m => m.DiscoverRunAsync(TenantA, Repo, wait.BranchName, It.IsAny<DateTime>(), wait.SessionId, It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Completed(91) with { CreatedAt = wait.DispatchedAt.AddMinutes(1) }); // no path / event
        _waits.Setup(w => w.ListPendingByTenantAsync(TenantA, wait.InstallationId, Repo, wait.BranchName, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { wait });
        using var engine = new AgentRunResumerTests.StubEngine(System.Net.HttpStatusCode.OK);

        var result = await Sut(RealResumer(engine)).SweepOnceAsync(CancellationToken.None);

        result.Resumed.Should().ContainSingle().Which.Outcome.Should().Be(AgentRunResumeOutcome.NoMatch);
        engine.Calls.Should().BeEmpty();
    }

    [Test]
    public async Task The_agent_run_found_by_discovery_resumes_through_the_real_resumer()
    {
        var wait = Wait(TenantA, minutesAgo: 15);
        Tenants((TenantA, new[] { wait }));
        _mediation.Setup(m => m.DiscoverRunAsync(TenantA, Repo, wait.BranchName, It.IsAny<DateTime>(), wait.SessionId, It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Completed(92) with
            {
                WorkflowPath = ".github/workflows/tamma-agent.yml",
                Event = "workflow_dispatch",
                CreatedAt = wait.DispatchedAt.AddSeconds(5),
            });
        _waits.Setup(w => w.ListPendingByTenantAsync(TenantA, wait.InstallationId, Repo, wait.BranchName, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { wait });
        _waits.Setup(w => w.TryMarkReceivedByTenantAsync(TenantA, wait.Id, 92, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        using var engine = new AgentRunResumerTests.StubEngine(System.Net.HttpStatusCode.OK);

        var result = await Sut(RealResumer(engine)).SweepOnceAsync(CancellationToken.None);

        result.Resumed.Should().ContainSingle().Which.Outcome.Should().Be(AgentRunResumeOutcome.Resumed);
        engine.Calls.Should().ContainSingle();
    }

    [Test]
    public async Task SaaS_marks_long_dead_waits_timed_out_and_records_it()
    {
        var wait = Wait(TenantA, minutesAgo: 90);
        Tenants((TenantA, new[] { wait }));

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.TimedOut.Should().Equal(wait.Id);
        _waits.Verify(w => w.TryMarkTimedOutByTenantAsync(TenantA, wait.Id, It.IsAny<CancellationToken>()), Times.Once);
        _events.Verify(e => e.AppendAsync(It.Is<DomainEvent>(d =>
            d.Type == AgentRunWaitEventTypes.ResumeUnresolved && d.TenantId == TenantA && d.IssueNumber == 42
            && d.Data.Contains("no_completion_before_deadline") && d.Tags.Contains(wait.SessionId))), Times.Once);
        _resumer.VerifyNoOtherCalls();
    }

    [Test]
    public async Task A_row_another_sweeper_already_closed_records_nothing()
    {
        var wait = Wait(TenantA, minutesAgo: 90);
        Tenants((TenantA, new[] { wait }));
        _waits.Setup(w => w.TryMarkTimedOutByTenantAsync(TenantA, wait.Id, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.TimedOut.Should().BeEmpty();
        _events.Verify(e => e.AppendAsync(It.IsAny<DomainEvent>()), Times.Never);
    }

    [Test]
    public async Task Running_waits_are_left_for_the_next_sweep()
    {
        Tenants((TenantA, new[] { Wait(TenantA, minutesAgo: 15) }));

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.StillWaiting.Should().Be(1);
        _resumer.VerifyNoOtherCalls();
        _waits.Verify(w => w.TryMarkTimedOutByTenantAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task A_principal_another_pod_holds_is_skipped_and_others_still_sweep()
    {
        var a = Wait(TenantA, minutesAgo: 90);
        var b = Wait(TenantB, minutesAgo: 90);
        Tenants((TenantA, new[] { a }), (TenantB, new[] { b }));
        _lock.HeldElsewhere.Add($"tenant:{TenantA:D}");

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.SkippedLocked.Should().Be(1);
        result.TimedOut.Should().Equal(b.Id);
        _waits.Verify(w => w.ListStalePendingByTenantAsync(TenantA, It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never,
            "rows are only read under the principal's lock");
    }

    [Test]
    public async Task One_failing_wait_does_not_stop_the_rest()
    {
        var bad = Wait(TenantA, minutesAgo: 90);
        var good = Wait(TenantB, minutesAgo: 90);
        Tenants((TenantA, new[] { bad }), (TenantB, new[] { good }));
        _mediation.Setup(m => m.DiscoverRunAsync(TenantA, It.IsAny<string>(), It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("platform down"));

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.TimedOut.Should().Equal(good.Id);
        _lock.Released.Should().BeEquivalentTo(_lock.Acquired, "every lock taken is released");
    }

    [Test]
    public async Task Single_user_sweeps_the_user_plane()
    {
        _mode = TammaMode.SingleUser;
        var wait = Wait(null, minutesAgo: 90, user: SoleUser);
        _waits.Setup(w => w.ListStalePendingByUserAsync(Now.AddMinutes(-Options.StaleAfterMinutes), Options.BatchPerPrincipal, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { wait });

        var result = await Sut().SweepOnceAsync(CancellationToken.None);

        result.TimedOut.Should().Equal(wait.Id);
        _waits.Verify(w => w.TryMarkTimedOutByUserAsync(SoleUser, wait.Id, It.IsAny<CancellationToken>()), Times.Once);
        _waits.Verify(w => w.ListTenantsWithStalePendingAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()), Times.Never);
        _lock.Acquired.Should().Equal($"user:{SoleUser:D}");
    }

    [Test]
    public async Task Only_waits_older_than_the_stale_threshold_are_read()
    {
        Tenants();
        await Sut().SweepOnceAsync(CancellationToken.None);
        _waits.Verify(w => w.ListTenantsWithStalePendingAsync(Now.AddMinutes(-10), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── harness ───────────────────────────────────────────────────────────

    private AgentRunResumer RealResumer(AgentRunResumerTests.StubEngine engine)
    {
        var installations = new Mock<IInstallationRepository>();
        installations.Setup(i => i.GetByInstallationIdAsync(4242)).ReturnsAsync(new GitHubInstallation
        {
            InstallationId = 4242, TenantId = TenantA, AccountLogin = "acme", AccountType = "Organization",
        });
        return new AgentRunResumer(_waits.Object, installations.Object, new StubMode(_mode), null,
            new AgentRunResumerTests.StubHttpClientFactory(engine), _events.Object, NullLogger<AgentRunResumer>.Instance);
    }

    private AgentRunWaitReconciler Sut(IAgentRunResumer? resumer = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(_waits.Object);
        services.AddSingleton(_mediation.Object);
        services.AddSingleton(resumer ?? _resumer.Object);
        services.AddSingleton(_events.Object);
        services.AddSingleton<ITammaModeProvider>(new StubMode(_mode));
        return new AgentRunWaitReconciler(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            _lock, Options, NullLogger<AgentRunWaitReconciler>.Instance, () => Now);
    }

    private void Tenants(params (Guid Tenant, AgentRunWait[] Rows)[] tenants)
    {
        _waits.Setup(w => w.ListTenantsWithStalePendingAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(tenants.Select(t => t.Tenant).ToList());
        foreach (var (tenant, rows) in tenants)
            _waits.Setup(w => w.ListStalePendingByTenantAsync(tenant, It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(rows);
    }

    private static AgentRunWait Wait(Guid? tenant, int minutesAgo, Guid? user = null)
    {
        var session = TaskSessionId.For(42, 1);
        return new AgentRunWait
        {
            Id = Guid.NewGuid(),
            TenantId = tenant,
            UserId = user,
            Repository = Repo,
            BranchName = "tamma/issue-42",
            SessionId = session,
            InstallationId = 4242,
            WorkflowInstanceId = "wf-1",
            BookmarkName = LifecycleBookmarks.ForAgentRun(tenant?.ToString(), Repo, "tamma/issue-42", session),
            BookmarkTenantId = tenant,
            Status = AgentRunWaitStatus.Pending,
            DispatchedAt = Now.AddMinutes(-minutesAgo),
        };
    }

    private static AgentRunStatusResult Completed(long runId) => new()
    {
        Success = true, Found = true, RunId = runId, Status = "completed", Conclusion = "success",
        WorkflowRunUrl = "https://gh.test/run", ArtifactsUrl = "https://gh.test/run/artifacts",
        CreatedAt = Now.AddMinutes(-14), UpdatedAt = Now.AddMinutes(-5),
    };

    private sealed class StubMode(TammaMode mode) : ITammaModeProvider
    {
        public TammaMode Mode => mode;
    }

    private sealed class FakeLock : IAgentRunSweepLock
    {
        public HashSet<string> HeldElsewhere { get; } = new();
        public List<string> Acquired { get; } = new();
        public List<string> Released { get; } = new();

        public Task<IAsyncDisposable?> TryAcquireAsync(string principalKey, CancellationToken ct)
        {
            if (HeldElsewhere.Contains(principalKey)) return Task.FromResult<IAsyncDisposable?>(null);
            Acquired.Add(principalKey);
            return Task.FromResult<IAsyncDisposable?>(new Release(() => Released.Add(principalKey)));
        }

        private sealed class Release(Action onRelease) : IAsyncDisposable
        {
            public ValueTask DisposeAsync() { onRelease(); return ValueTask.CompletedTask; }
        }
    }
}
