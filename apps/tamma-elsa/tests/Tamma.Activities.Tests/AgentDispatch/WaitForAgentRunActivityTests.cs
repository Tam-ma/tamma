using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Memory;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using Elsa.Workflows.State;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;
using Tamma.Activities.Documents;
using FlowConnection = Elsa.Workflows.Activities.Flowchart.Models.Connection;
using FlowEndpoint = Elsa.Workflows.Activities.Flowchart.Models.Endpoint;

namespace Tamma.Activities.Tests.AgentDispatch;

/// <summary>
/// Story 40-2 (AC1, AC3, AC4, AC8, AC9 + the early-completion race) — a real suspend/resume of
/// <see cref="WaitForAgentRunActivity"/> through Elsa's in-process runner (the
/// <c>DocumentDecisionRoundTripTests</c> harness), with Moq'd dispatch/collect.
/// The durable deadline and reconcile timer are resumed by bookmark id here; in production the
/// Elsa.Scheduling bookmark scheduler resumes them.
/// </summary>
[TestFixture]
public class WaitForAgentRunActivityTests
{
    private const string Tenant = "7d0b3a8e-1c55-4d8e-9a39-0b1d2c3e4f50";
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-42";
    private const string Session = "adl-42-task-0";

    private static readonly string ExpectedBookmark = LifecycleBookmarks.ForAgentRun(Tenant, Repo, Branch, Session);

    private Mock<IAgentDispatchService> _dispatch = null!;
    private Mock<IAgentResultCollectorService> _collector = null!;
    private PendingAgentRunCompletionBuffer _buffer = null!;
    private string _localWorkDir = null!;

    [SetUp]
    public void SetUp()
    {
        _dispatch = new Mock<IAgentDispatchService>();
        _dispatch.Setup(d => d.DispatchAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AgentDispatchResult(true, null, null, DateTime.UtcNow));
        _collector = new Mock<IAgentResultCollectorService>();
        _collector.Setup(c => c.CollectAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<AgentMonitorResult>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((AgentExecutionRequest r, AgentMonitorResult m, CancellationToken _) => Collected(r, m));
        _buffer = new PendingAgentRunCompletionBuffer();
        _localWorkDir = Path.Combine(Path.GetTempPath(), "tamma-wait-agent-run-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_localWorkDir);
    }

    [TearDown]
    public void TearDown()
    {
        try { Directory.Delete(_localWorkDir, recursive: true); } catch { /* best effort */ }
    }

    // ── AC1 / AC9: dispatch failures take Failed with no bookmark ────────────

    [Test]
    public async Task Gha_DispatchFails_TakesFailed_WithNoBookmark()
    {
        _dispatch.Setup(d => d.DispatchAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AgentDispatchResult(false, null, "422 workflow not found", DateTime.UtcNow));
        await using var sp = BuildProvider("github_actions");

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Failed");
        result.WorkflowState.Bookmarks.Should().BeEmpty("a failed dispatch has no run to wait for");
        Output(result, "error").Should().Be("422 workflow not found");
        Output(result, "success").Should().Be("False");
    }

    [Test]
    public async Task Gha_DispatchThrows_TakesFailed()
    {
        _dispatch.Setup(d => d.DispatchAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("boom"));
        await using var sp = BuildProvider("github_actions");

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Failed");
        result.WorkflowState.Bookmarks.Should().BeEmpty();
    }

    [Test]
    public async Task MissingFactory_FailsLoud()
    {
        await using var sp = BuildProvider("github_actions", registerFactory: false);

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Failed");
        Output(result, "error").Should().Contain("AgentExecutorFactory not registered");
    }

    [Test]
    public async Task Gha_MissingDispatchService_FailsLoud()
    {
        await using var sp = BuildProvider("github_actions", registerDispatch: false);

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Failed");
        Output(result, "error").Should().Contain("IAgentDispatchService not registered");
    }

    [Test]
    public async Task Gha_MissingCollector_FailsLoud_BeforeDispatch()
    {
        await using var sp = BuildProvider("github_actions", registerCollector: false);

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Failed");
        Output(result, "error").Should().Contain("IAgentResultCollectorService not registered");
        _dispatch.Verify(d => d.DispatchAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<CancellationToken>()), Times.Never,
            "no run may be dispatched when its result can never be collected");
    }

    // ── AC1 / AC2 / AC3: dispatch ok → suspends on the canonical name + deadline ──

    [Test]
    public async Task Gha_DispatchOk_Suspends_OnForAgentRunName_WithDeadlineAndReconcileTimers()
    {
        await using var sp = BuildProvider("github_actions");

        var (result, _) = await RunAsync(sp);

        result.WorkflowState.SubStatus.Should().Be(WorkflowSubStatus.Suspended);
        var bookmarks = result.WorkflowState.Bookmarks;
        bookmarks.Should().ContainSingle(b => b.Name == ExpectedBookmark, "the result bookmark is the Compose-built ForAgentRun name");
        CallbackOf(result, "OnTimeoutAsync").Should().NotBeNull("a durable DelayFor deadline must be armed");
        CallbackOf(result, "OnReconcileAsync").Should().NotBeNull("the post-commit reconcile timer must be armed");
        bookmarks.Should().HaveCount(3);
        _dispatch.Verify(d => d.DispatchAsync(
            It.Is<AgentExecutionRequest>(r => r.Repository == Repo && r.BranchName == Branch && r.SessionId == Session
                                              && r.TenantId == Guid.Parse(Tenant)),
            It.IsAny<CancellationToken>()), Times.Once);
        _collector.Verify(c => c.CollectAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<AgentMonitorResult>(), It.IsAny<CancellationToken>()),
            Times.Never, "nothing is collected until the run completes");
    }

    [Test]
    public async Task Gha_Dispatch_CarriesTheBookmarkAndInstance_ForTheDurableRow()
    {
        // Story 40-3 (AC1) — the API writes the agent_run_waits row from these.
        await using var sp = BuildProvider("github_actions");

        var (result, _) = await RunAsync(sp);

        _dispatch.Verify(d => d.DispatchAsync(
            It.Is<AgentExecutionRequest>(r => r.BookmarkName == ExpectedBookmark
                                              && r.WorkflowInstanceId == result.WorkflowState.Id
                                              && r.BookmarkTenantId == Tenant),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public void DeadlineMatchesTheExecutorBudget()
    {
        WaitForAgentRunActivity.EffectiveWaitTimeoutMinutes(30).Should().Be(35);
        WaitForAgentRunActivity.EffectiveWaitTimeoutMinutes(60).Should().Be(65);
        WaitForAgentRunActivity.EffectiveWaitTimeoutMinutes(1).Should().Be(AgentMonitorOptions.Default.TimeoutMinutes);
    }

    [Test]
    public async Task DifferentTenants_SuspendOnDisjointNames()
    {
        await using var sp = BuildProvider("github_actions");

        var (a, _) = await RunAsync(sp, tenant: "tenant-a");
        var (b, _) = await RunAsync(sp, tenant: "tenant-b");

        var nameA = a.WorkflowState.Bookmarks.Single(x => x.Name.StartsWith("agent-run-")).Name;
        var nameB = b.WorkflowState.Bookmarks.Single(x => x.Name.StartsWith("agent-run-")).Name;
        nameA.Should().NotBe(nameB);
    }

    // ── AC4: resume collects ──────────────────────────────────────────────

    [Test]
    public async Task Resume_WithSuccessPayload_Collects_TakesReceived_WithOutputs()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        var result = await ResumeAsync(sp, wf, suspended.WorkflowState, ResultBookmarkId(suspended), Completion(101, "success"));

        result.WorkflowState.Status.Should().Be(WorkflowStatus.Finished);
        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("True");
        Output(result, "commitSha").Should().Be("sha-101");
        _collector.Verify(c => c.CollectAsync(
            It.Is<AgentExecutionRequest>(r => r.SessionId == Session),
            It.Is<AgentMonitorResult>(m => m.WorkflowRunId == 101 && m.Conclusion == "success"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public async Task Resume_WithAgentFailure_TakesReceived_WithSuccessFalse()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        var result = await ResumeAsync(sp, wf, suspended.WorkflowState, ResultBookmarkId(suspended), Completion(102, "failure"));

        Terminal(result).Should().Be("Received", "an agent that ran and failed is Received, not Timeout");
        Output(result, "success").Should().Be("False");
    }

    [Test]
    public async Task Resume_WithUnreadablePayload_FailsClosed_WithoutCollecting()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        var result = await ResumeAsync(sp, wf, suspended.WorkflowState, ResultBookmarkId(suspended),
            new Dictionary<string, object> { [AgentRunCompletionSignal.Conclusion] = "success" });

        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("False", "an unreadable signal is never a green run");
        _collector.Verify(c => c.CollectAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<AgentMonitorResult>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Resume_CollectorThrows_FailsClosedToReceived()
    {
        _collector.Setup(c => c.CollectAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<AgentMonitorResult>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("artifact gone"));
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        var result = await ResumeAsync(sp, wf, suspended.WorkflowState, ResultBookmarkId(suspended), Completion(103, "success"));

        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("False");
        Output(result, "error").Should().Contain("artifact gone");
    }

    // ── AC3: durable deadline → Timeout ─────────────────────────────────

    [Test]
    public async Task Deadline_TakesTimeout_WithFailClosedSentinel()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        var result = await ResumeAsync(sp, wf, suspended.WorkflowState, CallbackOf(suspended, "OnTimeoutAsync")!.Id,
            new Dictionary<string, object>());

        result.WorkflowState.Status.Should().Be(WorkflowStatus.Finished);
        Terminal(result).Should().Be("Timeout");
        Output(result, "success").Should().Be("False");
        Output(result, "error").Should().Contain("timed out");
        _collector.Verify(c => c.CollectAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<AgentMonitorResult>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Early completion: the signal must not be lost ─────────────────────

    [Test]
    public async Task EarlySignal_BufferedBeforeExecute_CompletesWithoutSuspending()
    {
        _buffer.Record(ExpectedBookmark, Completion(201, "success"));
        await using var sp = BuildProvider("github_actions");

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("True");
        result.WorkflowState.Bookmarks.Should().BeEmpty();
    }

    [Test]
    public async Task EarlySignal_BufferedAfterSuspend_IsPickedUpByThePostCommitReconcile()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        // The signal arrived after the second in-activity check but before the commit:
        // the resumer found no bookmark and buffered it.
        _buffer.Record(ExpectedBookmark, Completion(202, "success"));

        var result = await ResumeAsync(sp, wf, suspended.WorkflowState, CallbackOf(suspended, "OnReconcileAsync")!.Id,
            new Dictionary<string, object>());

        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("True");
        _collector.Verify(c => c.CollectAsync(It.IsAny<AgentExecutionRequest>(),
            It.Is<AgentMonitorResult>(m => m.WorkflowRunId == 202), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public async Task Reconcile_WithNothingBuffered_StaysSuspended_AndKeepsResultAndDeadline()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);

        var afterTick = await ResumeAsync(sp, wf, suspended.WorkflowState, CallbackOf(suspended, "OnReconcileAsync")!.Id,
            new Dictionary<string, object>());

        afterTick.WorkflowState.SubStatus.Should().Be(WorkflowSubStatus.Suspended);
        afterTick.WorkflowState.Bookmarks.Should().Contain(b => b.Name == ExpectedBookmark, "the result bookmark must survive the tick");
        CallbackOf(afterTick, "OnTimeoutAsync").Should().NotBeNull("the deadline must survive the tick");
        CallbackOf(afterTick, "OnReconcileAsync").Should().BeNull("the reconcile timer is one-shot");

        var result = await ResumeAsync(sp, wf, afterTick.WorkflowState, ResultBookmarkId(afterTick), Completion(203, "success"));
        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("True");
    }

    [Test]
    public async Task ResumeInput_IsNotMutated()
    {
        await using var sp = BuildProvider("github_actions");
        var (suspended, wf) = await RunAsync(sp);
        var input = Completion(204, "success");
        var snapshot = new Dictionary<string, object>(input);

        await ResumeAsync(sp, wf, suspended.WorkflowState, ResultBookmarkId(suspended), input);

        input.Should().BeEquivalentTo(snapshot);
    }

    // ── AC8: local mode runs to completion, no external bookmark ───────────

    [Test]
    public async Task Local_RunsToCompletion_TakesReceived_WithNoBookmark()
    {
        await using var sp = BuildProvider("local");

        var (result, _) = await RunAsync(sp);

        Terminal(result).Should().Be("Received");
        Output(result, "success").Should().Be("True");
        Output(result, "commitSha").Should().Be("local-sha");
        result.WorkflowState.Bookmarks.Should().BeEmpty("local mode has no webhook to resume an external bookmark");
        _dispatch.Verify(d => d.DispatchAsync(It.IsAny<AgentExecutionRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Harness ─────────────────────────────────────────────────────────

    private static AgentExecutionResult Collected(AgentExecutionRequest r, AgentMonitorResult m)
        => m.Conclusion == "success"
            ? new AgentExecutionResult(true, 7, "https://gh.test/pr/7", $"sha-{m.WorkflowRunId}", new[] { "a.cs" }, 1, true,
                100, 60, null, "ok", r.AgentProvider, "1.0", ExecutionModeNames.GitHubActions)
            : AgentExecutionResult.Failed($"agent concluded {m.Conclusion}", r.AgentProvider, ExecutionModeNames.GitHubActions);

    private static Dictionary<string, object> Completion(long runId, string conclusion)
        => AgentRunCompletionSignal.ToInput(new AgentMonitorResult(runId, "completed", conclusion,
            $"https://gh.test/run/{runId}", 60, $"https://gh.test/run/{runId}/artifacts"));

    private static Elsa.Workflows.Models.Bookmark? CallbackOf(RunWorkflowResult result, string callback)
        => result.WorkflowState.Bookmarks.SingleOrDefault(b => b.CallbackMethodName == callback);

    private static string ResultBookmarkId(RunWorkflowResult result)
        => result.WorkflowState.Bookmarks.Single(b => b.Name == ExpectedBookmark).Id;

    private static string? Terminal(RunWorkflowResult result) => Output(result, "terminal");

    private static string? Output(RunWorkflowResult result, string key)
        => result.WorkflowState.Output.TryGetValue(key, out var v) ? v?.ToString() : null;

    private ServiceProvider BuildProvider(
        string mode, bool registerFactory = true, bool registerDispatch = true, bool registerCollector = true)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa => elsa.AddActivity<WaitForAgentRunActivity>());

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Agent:ExecutorMode"] = mode })
            .Build();
        services.AddSingleton<IConfiguration>(config);

        if (registerFactory) services.AddScoped<AgentExecutorFactory>();
        if (registerDispatch) services.AddSingleton(_dispatch.Object);
        if (registerCollector) services.AddSingleton(_collector.Object);
        services.AddSingleton(_buffer);

        var workDir = _localWorkDir;
        services.AddSingleton(new LocalExecutor(new ResultWritingRunner(), new LocalExecutorOptions
        {
            WorkingDirectory = workDir,
            CleanupAfterRun = false,
        }));
        return services.BuildServiceProvider();
    }

    private static async Task<(RunWorkflowResult Result, Workflow Workflow)> RunAsync(IServiceProvider sp, string tenant = Tenant)
    {
        using var scope = sp.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();
        var workflow = BuildWorkflow(tenant);
        var result = await runner.RunAsync(workflow, new RunWorkflowOptions(), CancellationToken.None);
        return (result, workflow);
    }

    private static async Task<RunWorkflowResult> ResumeAsync(
        IServiceProvider sp, Workflow workflow, WorkflowState state, string bookmarkId, IDictionary<string, object> input)
    {
        using var scope = sp.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();
        return await runner.RunAsync(workflow, state,
            new RunWorkflowOptions { BookmarkId = bookmarkId, Input = input }, CancellationToken.None);
    }

    private static Workflow BuildWorkflow(string tenant)
    {
        var success = new Variable<bool>("AgentSuccess", false);
        var error = new Variable<string?>("AgentError", null);
        var commitSha = new Variable<string>("AgentCommitSha", "");

        var wait = new WaitForAgentRunActivity
        {
            Id = "Wait",
            Repository = new Input<string>(Repo),
            BranchName = new Input<string>(Branch),
            IssueNumber = new Input<int>(42),
            SessionId = new Input<string>(Session),
            TenantId = new Input<string?>(_ => tenant),
            ModeOverride = new Input<string?>(_ => null),
            AgentConfigJson = new Input<string?>(_ => null),
            Success = new Output<bool>(success),
            ErrorMessage = new Output<string?>(error),
            CommitSha = new Output<string>(commitSha),
        };

        Activity Terminal(string outcome)
        {
            var seq = new Sequence
            {
                Id = $"Terminal{outcome}",
                Activities =
                {
                    new SetOutput { OutputName = new("terminal"), OutputValue = new(_ => (object)outcome) },
                    new SetOutput { OutputName = new("success"), OutputValue = new(ctx => (object)success.Get(ctx)) },
                    new SetOutput { OutputName = new("error"), OutputValue = new(ctx => (object?)error.Get(ctx) ?? "") },
                    new SetOutput { OutputName = new("commitSha"), OutputValue = new(ctx => (object?)commitSha.Get(ctx) ?? "") },
                    new Finish(),
                },
            };
            return seq;
        }

        var received = Terminal("Received");
        var timeout = Terminal("Timeout");
        var failed = Terminal("Failed");

        var flowchart = new Flowchart
        {
            Id = "AgentRunHarness",
            Start = wait,
            Variables = { success, error, commitSha },
            Activities = { wait, received, timeout, failed },
            Connections =
            {
                new FlowConnection(new FlowEndpoint(wait, "Received"), new FlowEndpoint(received)),
                new FlowConnection(new FlowEndpoint(wait, "Timeout"), new FlowEndpoint(timeout)),
                new FlowConnection(new FlowEndpoint(wait, "Failed"), new FlowEndpoint(failed)),
            },
        };
        return new Workflow(flowchart);
    }

    /// <summary>Stub process runner: plays the local CLI by writing a successful result file.</summary>
    private sealed class ResultWritingRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(ProcessRunRequest request, CancellationToken cancellationToken = default)
        {
            var args = request.Arguments.ToList();
            var resultPath = args[args.IndexOf("--output") + 1];
            File.WriteAllText(resultPath, @"{
                ""success"": true, ""task"": ""implement"", ""issue_number"": 42,
                ""branch_name"": ""tamma/issue-42"", ""tamma_session_id"": ""adl-42-task-0"",
                ""files_changed"": [""a.cs""], ""commit_sha"": ""local-sha"",
                ""tokens_used"": 1, ""duration_seconds"": 1, ""agent_provider"": ""claude-code""
            }");
            return Task.FromResult(new ProcessRunResult(0, "ok", "", false, 1));
        }
    }
}
