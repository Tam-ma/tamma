using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Models;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Filters;
using Elsa.Workflows.Runtime.Messages;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;
using Tamma.Activities.Core;
using Tamma.Activities.Documents;
using Tamma.Api.Dtos.Engine;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Core.AgentDispatch.Resume;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.ElsaServer.Endpoints;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// Story 40-7 — the coding cycle's crash re-entry, end to end. The REAL
/// <see cref="SingleIssueCycleWorkflow"/> runs on Elsa's runtime with stub sub-workflows for the
/// non-coding stages, the REAL <see cref="WaitForAgentRunActivity"/> suspending on its durable
/// bookmark, completions delivered through the REAL <see cref="AgentRunResumeEndpoint"/>, and the
/// REAL <see cref="TaskLoopReEntryService"/> reading the AGENT_RUN.* rows the run actually wrote
/// (engine events → the API's engine-events handler → an in-memory event store).
///
/// <para><b>What is shared across a "crash"</b> — exactly what survives one in production: the
/// event store, the accepted task-breakdown plan, and the branch (a set of files the fake
/// collector "pushes" when a task's run is collected). The Elsa host itself is disposed and a
/// fresh one built; the new cycle never sees the old instance.</para>
///
/// <para><b>Not covered here</b> (and where it is): cross-pod resume of a still-suspended instance
/// needs a shared Elsa store, which this in-process harness does not have — 40-3's
/// <c>AgentRunResumeEndpointTests</c> and <c>AgentRunResumerTests</c> cover that path. The real
/// GitHub runner contract is 40-1's <c>RunnerContractTests</c>.</para>
///
/// <para>Runs in the normal CI gate (not <c>[Explicit]</c>): it is in-process and takes seconds.</para>
/// </summary>
[TestFixture]
[NonParallelizable]
public class SingleIssueCycleCrashReEntryTests
{
    private static readonly Guid Tenant = Guid.Parse("40704070-4070-4070-4070-407040704070");
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-42";
    private const int Issue = 42;

    /// <summary>The accepted task-breakdown plan (what task-creation stored on the first run).</summary>
    private static readonly (string Id, string File)[] StoredTasks = { ("T1", "src/a.cs"), ("T2", "src/b.cs"), ("T3", "src/c.cs") };

    private World _world = null!;

    [SetUp]
    public void SetUp()
    {
        _world = new World();
        Stubs.Reset();
    }

    // ── AC1 + AC3 + AC4 (+ AC9's precondition): crash after two tasks ─────

    [Test]
    public async Task Crash_after_two_tasks_restarts_at_task_two_and_runs_only_task_two()
    {
        // Host A: run the cycle, land tasks 0 and 1 through the durable wait, crash on task 2.
        await using (var a = await HostAsync("github_actions"))
        {
            await StartCycleAsync(a);
            await DeliverAsync(a, taskIndex: 0);
            await DeliverAsync(a, taskIndex: 1);
            await WaitUntilAsync(() => _world.Dispatched.Contains(TaskSessionId.For(Issue, 2)), "task 2 dispatched on host A");
        } // ← the crash: host A and its instance are gone; task 2's run never reports back.

        _world.Dispatched.Should().Equal(Sessions(0, 1, 2));
        _world.Dispatched.Clear();

        // Host B: a FRESH cycle for the same issue. Task creation now returns a reordered list;
        // the loop must run the STORED list its indices refer to (40-4 AC9).
        Stubs.TasksJson = TasksJson(Enumerable.Reverse(StoredTasks).ToArray());
        await using var b = await HostAsync("github_actions");
        await StartCycleAsync(b);
        await DeliverAsync(b, taskIndex: 2);
        await WaitUntilAsync(() => Stubs.Invoked.Contains("merge-approval"), "the cycle got past the task loop");

        _world.Dispatched.Should().Equal(new[] { TaskSessionId.For(Issue, 2) },
            "tasks 0 and 1 landed (run recorded + files on the branch); only task 2 is re-run");

        var reentered = _world.Events(AgentRunWaitEventTypes.TaskReentered).Should().ContainSingle().Subject;
        Data(reentered).GetProperty("resumeIndex").GetInt32().Should().Be(2);
        Data(reentered).GetProperty("landedIndices").EnumerateArray().Select(x => x.GetInt32()).Should().Equal(0, 1);
        Data(reentered).GetProperty("taskId").GetString().Should().Be("T3", "index 2 of the STORED list, not the regenerated one");

        // AC4: exactly one successful run per task across the crash.
        _world.Events(AgentRunWaitEventTypes.Received)
            .Where(e => Data(e).GetProperty("success").GetBoolean())
            .Select(e => Data(e).GetProperty("taskIndex").GetInt32())
            .Should().BeEquivalentTo(new[] { 0, 1, 2 }, o => o.WithStrictOrdering());
    }

    // ── AC6: git and the events disagree → loud failure, nothing re-run ──

    [Test]
    public async Task Events_say_landed_but_the_branch_lost_the_files_fails_the_cycle_loud()
    {
        await using (var a = await HostAsync("github_actions"))
        {
            await StartCycleAsync(a);
            await DeliverAsync(a, taskIndex: 0);
            await WaitUntilAsync(() => Dispatched(TaskSessionId.For(Issue, 1)), "task 1 dispatched");
        }
        _world.BranchFiles.Clear(); // e.g. the branch was force-pushed: task 0's work is gone
        _world.Dispatched.Clear();

        await using var b = await HostAsync("github_actions");
        await StartCycleAsync(b);
        await WaitUntilAsync(() => _world.Events("CYCLE.STEP_FAILED").Any(), "the cycle failed");

        var failed = _world.Events("CYCLE.STEP_FAILED").Should().ContainSingle().Subject;
        failed.GetRawText().Should().Contain("task-reentry").And.Contain("not on the branch");
        await WaitUntilAsync(() => _world.Events(CycleEvents.Ended).Any(), "the failed cycle ended");
        _world.CycleResults.Should().Equal(new[] { "error" }, "a failed step reports an error to the engine");
        _world.Dispatched.Should().BeEmpty("nothing is skipped or re-run on a guess");
        _world.Events(AgentRunWaitEventTypes.TaskReentered).Should().BeEmpty();
    }

    // ── AC5: no completion ever arrives → durable deadline → escalate ───

    [Test]
    public async Task A_run_that_never_reports_times_out_and_the_cycle_escalates()
    {
        await using var a = await HostAsync("github_actions");
        var instanceId = await StartCycleAsync(a);
        await WaitUntilAsync(() => Dispatched(TaskSessionId.For(Issue, 0)), "task 0 dispatched");

        // The wait arms two durable timers: the 30 s reconcile read and the deadline. The deadline
        // is the one that resumes latest.
        var store = a.GetRequiredService<IBookmarkStore>();
        List<Elsa.Workflows.Runtime.Entities.StoredBookmark> timers = new();
        await WaitUntilAsync(() =>
        {
            timers = store.FindManyAsync(new BookmarkFilter { WorkflowInstanceId = instanceId }, CancellationToken.None)
                .GetAwaiter().GetResult().Where(b => ResumeAt(b) is not null).ToList();
            return timers.Count >= 2;
        }, "the wait's two durable timers");
        var deadline = timers.OrderByDescending(b => ResumeAt(b)).First();
        ResumeAt(deadline).Should().BeAfter(DateTimeOffset.UtcNow.AddMinutes(30), "the deadline is the agent budget plus a margin");
        var client = await a.GetRequiredService<IWorkflowRuntime>().CreateClientAsync(instanceId);
        await client.RunInstanceAsync(new RunWorkflowInstanceRequest { BookmarkId = deadline.Id });

        await WaitUntilAsync(() => _world.Events("CYCLE.STEP_FAILED").Any(), "the cycle escalated");
        _world.Events(AgentRunWaitEventTypes.TimedOut).Should().ContainSingle();
        _world.Events("CYCLE.STEP_FAILED").Single().GetRawText().Should().Contain("timed out");
        Stubs.Invoked.Should().NotContain("merge-approval", "a timed-out task never advances the cycle");
    }

    // ── AC7: the same crash, restarted in single-user (local) mode ───────

    [Test]
    public async Task Local_mode_restart_skips_the_landed_tasks_too()
    {
        await using (var a = await HostAsync("github_actions"))
        {
            await StartCycleAsync(a);
            await DeliverAsync(a, taskIndex: 0);
            await WaitUntilAsync(() => Dispatched(TaskSessionId.For(Issue, 1)), "task 1 dispatched");
        }

        await using var b = await HostAsync("local");
        await StartCycleAsync(b);
        await WaitUntilAsync(() => Stubs.Invoked.Contains("merge-approval"), "the cycle got past the task loop");

        _world.LocalRuns.Should().Equal(new[] { TaskSessionId.For(Issue, 1), TaskSessionId.For(Issue, 2) },
            "the local runner starts at the first unlanded task, exactly as the GitHub Actions path does");
        Data(_world.Events(AgentRunWaitEventTypes.TaskReentered).Single()).GetProperty("resumeIndex").GetInt32().Should().Be(1);
    }

    // ── Attempt scope (2026-11-07 audit): a finished attempt is never inherited ──

    [Test]
    public async Task After_a_loud_reentry_failure_the_next_attempt_starts_clean()
    {
        await using (var a = await HostAsync("github_actions"))
        {
            await StartCycleAsync(a);
            await DeliverAsync(a, taskIndex: 0);
            await WaitUntilAsync(() => Dispatched(TaskSessionId.For(Issue, 1)), "task 1 dispatched");
        }
        _world.BranchFiles.Clear();

        await using (var b = await HostAsync("github_actions"))
        {
            await StartCycleAsync(b);
            await WaitUntilAsync(() => _world.Events("CYCLE.STEP_FAILED").Any(), "attempt B failed loud");
        }
        _world.Events("CYCLE.STEP_FAILED").Should().ContainSingle();
        _world.Dispatched.Clear();

        // Attempt C, same issue, same (fresh) branch: it must not re-read attempt A's records.
        await using var c = await HostAsync("github_actions");
        await StartCycleAsync(c);
        await WaitUntilAsync(() => _world.Dispatched.Contains(TaskSessionId.For(Issue, 0)), "attempt C dispatched task 0");

        _world.Events("CYCLE.STEP_FAILED").Should().ContainSingle("attempt C did not fail on attempt A's records");
        _world.Events(AgentRunWaitEventTypes.TaskReentered).Should().BeEmpty();
    }

    [Test]
    public async Task A_finished_attempts_landed_tasks_are_not_skipped_by_a_new_attempt()
    {
        // Attempt A lands every task and finishes at the merge gate's reject terminal — a path that
        // wrote no COMPLETED / STEP_FAILED row before CYCLE.ENDED existed. Its files stay on the branch.
        await using (var a = await HostAsync("github_actions"))
        {
            await StartCycleAsync(a);
            for (var i = 0; i < StoredTasks.Length; i++) await DeliverAsync(a, taskIndex: i);
            await WaitUntilAsync(() => _world.Events(CycleEvents.Ended).Any(), "attempt A ended at the reject terminal");
        }
        _world.Events("CYCLE.STEP_FAILED").Should().BeEmpty();
        _world.Events(CycleEvents.Completed).Should().BeEmpty();
        _world.BranchFiles.Should().BeEquivalentTo(StoredTasks.Select(t => t.File));
        _world.Dispatched.Clear();

        // Attempt B, same issue and branch: it starts over rather than skipping A's tasks.
        await using var b = await HostAsync("github_actions");
        await StartCycleAsync(b);
        await WaitUntilAsync(() => _world.Dispatched.Count > 0, "attempt B dispatched a task");

        _world.Dispatched.First().Should().Be(TaskSessionId.For(Issue, 0), "a new attempt starts at task 0");
        _world.Events(AgentRunWaitEventTypes.TaskReentered).Should().BeEmpty();
    }

    [Test]
    public async Task A_rejected_merge_reports_needs_human_before_the_cycle_ends()
    {
        await using var host = await HostAsync("github_actions");
        await StartCycleAsync(host);
        for (var i = 0; i < StoredTasks.Length; i++) await DeliverAsync(host, taskIndex: i);
        await WaitUntilAsync(() => _world.Events(CycleEvents.Ended).Any(), "the cycle ended at the reject terminal");

        _world.CycleResults.Should().Equal(new[] { "needsHuman" }, "a rejected merge hands the issue to a human");
    }

    [Test]
    public async Task An_escalated_merge_gate_reports_an_error_before_the_cycle_ends()
    {
        Stubs.GateOutcome = "escalated";
        await using var host = await HostAsync("github_actions");
        await StartCycleAsync(host);
        for (var i = 0; i < StoredTasks.Length; i++) await DeliverAsync(host, taskIndex: i);
        await WaitUntilAsync(() => _world.Events(CycleEvents.Ended).Any(), "the cycle ended at the escalated terminal");

        _world.CycleResults.Should().Equal(new[] { "error" }, "an escalated merge gate is a cycle error");
    }

    [Test]
    public async Task A_completion_delivered_the_instant_the_wait_appears_is_never_lost()
    {
        // Elsa stores the bookmark row a moment before the instance state. Deliver with no
        // delay, repeatedly: every completion must still move the cycle on to task 1.
        for (var round = 0; round < 8; round++)
        {
            _world = new World();
            Stubs.Reset();
            await using var host = await HostAsync("github_actions");
            await StartCycleAsync(host);
            var session = TaskSessionId.For(Issue, 0);
            var name = LifecycleBookmarks.ForAgentRun(Tenant.ToString(), Repo, Branch, session);
            var store = host.GetRequiredService<IBookmarkStore>();
            var started = DateTime.UtcNow;
            while (!(await store.FindManyAsync(new BookmarkFilter { Name = name }, CancellationToken.None)).Any())
                if (DateTime.UtcNow - started > TimeSpan.FromSeconds(30)) Assert.Fail("the wait for task 0 never appeared");

            var result = await AgentRunResumeEndpoint.Resume(
                new AgentRunResumeEndpoint.ResumeRequest(Tenant.ToString(), Repo, Branch, session, name, null,
                    WorkflowRunId: 1000, Status: "completed", Conclusion: "success",
                    WorkflowRunUrl: "u", ArtifactsUrl: "a", DurationSeconds: 60),
                store, host.GetRequiredService<IWorkflowRuntime>(),
                host.GetRequiredService<PendingAgentRunCompletionBuffer>(),
                host.GetRequiredService<Microsoft.Extensions.Logging.ILoggerFactory>(), CancellationToken.None);

            result.GetType().Name.Should().StartWith("Ok", $"round {round}: the resume waits for the stored state, then resumes");
            await WaitUntilAsync(() => Dispatched(TaskSessionId.For(Issue, 1)), $"round {round}: task 1 dispatched after the resume");
        }
    }

    private bool Dispatched(string session)
    {
        lock (_world.Dispatched) return _world.Dispatched.Contains(session);
    }

    // ── AC9: the switch (default ON again: reads are scoped to the crashed attempt) ───

    [Test]
    public void Reentry_is_on_by_default_and_the_switch_turns_it_off()
    {
        TaskReEntryRegistration.DisabledByDefault.Should().BeFalse("reads are scoped to the crashed attempt (attempt-scope tests above)");
        TaskReEntryRegistration.IsDisabled(new ConfigurationBuilder().Build()).Should().BeFalse();
        TaskReEntryRegistration.IsDisabled(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [TaskReEntryRegistration.ConfigKey] = "false" })
            .Build()).Should().BeFalse();
        TaskReEntryRegistration.IsDisabled(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [TaskReEntryRegistration.ConfigKey] = "true" })
            .Build()).Should().BeTrue("the key stays as the operator kill-switch");
    }

    // ══ Harness ═══════════════════════════════════════════════════════════

    private static string[] Sessions(params int[] indices) => indices.Select(i => TaskSessionId.For(Issue, i)).ToArray();

    private static JsonElement Data(JsonElement e) => e.GetProperty("data");

    private static string TasksJson((string Id, string File)[] tasks) => JsonSerializer.Serialize(tasks.Select(t => new
    {
        id = t.Id, description = $"implement {t.Id}", files = new[] { t.File }, dependsOn = Array.Empty<string>(), testing = "unit",
    }));

    /// <summary>Durable state that outlives a host: events, the stored plan, the branch.</summary>
    private sealed class World
    {
        private readonly List<DomainEvent> _rows = new();
        private readonly object _gate = new();

        public HashSet<string> BranchFiles { get; } = new(StringComparer.Ordinal);
        public List<string> Dispatched { get; } = new();
        public List<string> LocalRuns { get; } = new();
        public Mock<IEventRepository> EventRepo { get; } = new();
        public Mock<IDocumentInstanceRepository> Documents { get; } = new();
        public Mock<IAgentDispatchMediationService> Git { get; } = new();

        public World()
        {
            EventRepo.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>())).ReturnsAsync((DomainEvent e) =>
            {
                lock (_gate) { e.SequenceNumber = _rows.Count + 1; _rows.Add(e); }
                return e;
            });
            EventRepo.Setup(e => e.QueryAsync(It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<int?>(), It.IsAny<int>()))
                .ReturnsAsync((Guid? t, string? type, int? issue, int limit) =>
                {
                    lock (_gate)
                        return _rows.Where(e => e.TenantId == t && e.Type == type && e.IssueNumber == issue)
                            .OrderByDescending(e => e.SequenceNumber).Take(limit).ToList();
                });

            Documents.Setup(d => d.GetLatestAcceptedAsync(Tenant, TaskBreakdownDocument.IssueIdFor(Repo, Issue), It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => new[]
                {
                    new DocumentInstance
                    {
                        Id = Guid.NewGuid(), DocumentType = "plan", IssueId = TaskBreakdownDocument.IssueIdFor(Repo, Issue),
                        Status = "accepted", BodyJson = $"{{\"tasks\":{TasksJson(StoredTasks)}}}", TenantId = Tenant,
                    },
                });

            Git.Setup(g => g.ListBranchChangedFilesAsync(It.IsAny<Guid?>(), Repo, Branch, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => { lock (_gate) return BranchFiles.ToList(); });
        }

        public void Push(string file) { lock (_gate) BranchFiles.Add(file); }

        /// <summary>Exit reasons the cycle reported to the engine callback.</summary>
        public System.Collections.Concurrent.ConcurrentQueue<string> CycleResults { get; } = new();

        /// <summary>Every saved row of a type, oldest first, as the engine wire shape.</summary>
        public List<JsonElement> Events(string type)
        {
            lock (_gate)
                return _rows.Where(r => r.Type == type).OrderBy(r => r.SequenceNumber)
                    .Select(r => JsonDocument.Parse(JsonSerializer.Serialize(new
                    {
                        eventType = r.Type,
                        tags = JsonDocument.Parse(r.Tags).RootElement,
                        data = JsonDocument.Parse(r.Data).RootElement,
                    })).RootElement.Clone())
                    .ToList();
        }
    }

    private async Task<ServiceProvider> HostAsync(string mode)
    {
        var world = _world;
        var services = new ServiceCollection();
        services.AddLogging();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tamma:ApiUrl"] = "http://tamma.test",
            ["Engine:CallbackUrl"] = "http://engine.test",
            ["Agent:ExecutorMode"] = mode,
            [TaskReEntryRegistration.ConfigKey] = "false",
        }).Build();
        services.AddSingleton<IConfiguration>(config);

        var api = new ScriptedApi(world);
        services.AddSingleton<IHttpClientFactory>(new SingleClientFactory(api));
        services.AddSingleton(_ => new Tamma.Activities.LlmCall.TammaApiClient(
            new HttpClient(api), NullLogger<Tamma.Activities.LlmCall.TammaApiClient>.Instance, config));

        // The coding step: dispatch + collect (GitHub Actions), or the local runner.
        services.AddScoped<AgentExecutorFactory>();
        services.AddSingleton<IAgentDispatchService>(new FakeDispatch(world));
        services.AddSingleton<IAgentResultCollectorService>(new FakeCollector(world));
        services.AddSingleton<PendingAgentRunCompletionBuffer>();
        var workDir = Path.Combine(Path.GetTempPath(), "tamma-40-7", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDir);
        services.AddSingleton(new LocalExecutor(new FakeLocalRunner(world), new LocalExecutorOptions
        {
            WorkingDirectory = workDir, CleanupAfterRun = false,
        }));

        // AC3: the REAL re-entry read, registered explicitly (not inherited from a default).
        services.AddSingleton<ITaskLoopReEntryService>(new TaskLoopReEntryService(
            world.EventRepo.Object, world.Documents.Object, world.Git.Object, NullLogger<TaskLoopReEntryService>.Instance));

        services.AddElsa(elsa =>
        {
            elsa.AddActivitiesFrom<WaitForAgentRunActivity>();
            elsa.AddWorkflow<SingleIssueCycleWorkflow>();
            elsa.AddWorkflow<Stubs.ContextGathering>();
            elsa.AddWorkflow<Stubs.PlanGeneration>();
            elsa.AddWorkflow<Stubs.PlanReview>();
            elsa.AddWorkflow<Stubs.TaskCreation>();
            elsa.AddWorkflow<Stubs.TaskReview>();
            elsa.AddWorkflow<Stubs.BranchCreation>();
            elsa.AddWorkflow<Stubs.PullRequest>();
            elsa.AddWorkflow<Stubs.TestCaseCreation>();
            elsa.AddWorkflow<Stubs.TddRetry>();
            elsa.AddWorkflow<Stubs.CiGate>();
            elsa.AddWorkflow<Stubs.CodeReview>();
            elsa.AddWorkflow<Stubs.MergeApproval>();
            elsa.AddWorkflow<Stubs.CreateIssues>();
            elsa.AddWorkflow<Stubs.Deployment>();
            elsa.AddWorkflow<Stubs.UpdateIssueStatus>();
            elsa.UseWorkflows(w => w.UseTammaEventPersistence());

        });

        var provider = services.BuildServiceProvider();
        provider.GetRequiredService<ITaskLoopReEntryService>().Should().BeOfType<TaskLoopReEntryService>();

        await provider.GetRequiredService<IRegistriesPopulator>().PopulateAsync(CancellationToken.None);
        foreach (var hosted in provider.GetServices<IHostedService>())
            await hosted.StartAsync(CancellationToken.None);
        return provider;
    }

    private static async Task<string> StartCycleAsync(IServiceProvider provider)
    {
        var client = await provider.GetRequiredService<IWorkflowRuntime>().CreateClientAsync();
        var response = await client.CreateAndRunInstanceAsync(new CreateAndRunWorkflowInstanceRequest
        {
            WorkflowDefinitionHandle = WorkflowDefinitionHandle.ByDefinitionId("single-issue-cycle"),
            Input = new Dictionary<string, object>
            {
                ["repository"] = Repo,
                ["issueNumber"] = Issue,
                ["tenantId"] = Tenant.ToString(),
                ["workItemJson"] = $"{{\"number\":{Issue},\"type\":\"feature\",\"title\":\"widgets\"}}",
            },
        });
        return response.WorkflowInstanceId;
    }

    /// <summary>Wait for task <paramref name="taskIndex"/>'s bookmark, then deliver its completion like the webhook path.</summary>
    private async Task DeliverAsync(IServiceProvider provider, int taskIndex)
    {
        var session = TaskSessionId.For(Issue, taskIndex);
        var name = LifecycleBookmarks.ForAgentRun(Tenant.ToString(), Repo, Branch, session);
        await WaitForBookmarkAsync(provider, b => b.Name == name, $"the wait for {session}");

        var result = await AgentRunResumeEndpoint.Resume(
            new AgentRunResumeEndpoint.ResumeRequest(Tenant.ToString(), Repo, Branch, session, name, null,
                WorkflowRunId: 1000 + taskIndex, Status: "completed", Conclusion: "success",
                WorkflowRunUrl: "u", ArtifactsUrl: "a", DurationSeconds: 60),
            provider.GetRequiredService<IBookmarkStore>(),
            provider.GetRequiredService<IWorkflowRuntime>(),
            provider.GetRequiredService<PendingAgentRunCompletionBuffer>(),
            provider.GetRequiredService<Microsoft.Extensions.Logging.ILoggerFactory>(),
            CancellationToken.None);
        result.GetType().Name.Should().StartWith("Ok", $"the wait for {session} must be resumed, not buffered");
    }

    private static async Task<Elsa.Workflows.Runtime.Entities.StoredBookmark> WaitForBookmarkAsync(
        IServiceProvider provider, Func<Elsa.Workflows.Runtime.Entities.StoredBookmark, bool> match, string what)
    {
        var store = provider.GetRequiredService<IBookmarkStore>();
        Elsa.Workflows.Runtime.Entities.StoredBookmark? found = null;
        await WaitUntilAsync(() =>
        {
            found = store.FindManyAsync(new BookmarkFilter(), CancellationToken.None).GetAwaiter().GetResult().FirstOrDefault(match);
            return found is not null;
        }, what);
        return found!;
    }

    private static DateTimeOffset? ResumeAt(Elsa.Workflows.Runtime.Entities.StoredBookmark b)
        => b.Payload?.GetType().GetProperty("ResumeAt")?.GetValue(b.Payload) switch
        {
            DateTimeOffset d => d,
            DateTime d => new DateTimeOffset(d, TimeSpan.Zero),
            _ => null,
        };

    private static async Task WaitUntilAsync(Func<bool> condition, string what, int seconds = 30)
    {
        var until = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < until)
        {
            if (condition()) return;
            await Task.Delay(50);
        }
        Assert.Fail($"Timed out after {seconds}s waiting for: {what}");
    }

    // ── fakes: the coding step ───────────────────────────────────────────

    private static int IndexOf(string sessionId)
        => TaskSessionId.TryParse(sessionId, out _, out var index) ? index : throw new InvalidOperationException(sessionId);

    private sealed class FakeDispatch(World world) : IAgentDispatchService
    {
        public Task<AgentDispatchResult> DispatchAsync(AgentExecutionRequest request, CancellationToken cancellationToken = default)
        {
            lock (world.Dispatched) world.Dispatched.Add(request.SessionId);
            return Task.FromResult(new AgentDispatchResult(true, "https://gh.test/run", null, DateTime.UtcNow));
        }
    }

    /// <summary>Collecting a run = the agent pushed its task's file to the branch.</summary>
    private sealed class FakeCollector(World world) : IAgentResultCollectorService
    {
        public Task<AgentExecutionResult> CollectAsync(AgentExecutionRequest request, AgentMonitorResult monitor, CancellationToken cancellationToken = default)
        {
            var file = StoredTasks[IndexOf(request.SessionId)].File;
            world.Push(file);
            return Task.FromResult(new AgentExecutionResult(true, 7, "https://gh.test/pr/7", $"sha-{request.SessionId}",
                new[] { file }, 1, true, 10, 60, null, "ok", request.AgentProvider, "1.0", ExecutionModeNames.GitHubActions));
        }
    }

    /// <summary>The local CLI: writes a successful result and pushes the task's file.</summary>
    private sealed class FakeLocalRunner(World world) : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(ProcessRunRequest request, CancellationToken cancellationToken = default)
        {
            var args = request.Arguments.ToList();
            using var req = JsonDocument.Parse(File.ReadAllText(args[args.IndexOf("--request") + 1]));
            var session = req.RootElement.GetProperty("tamma_session_id").GetString()!;
            lock (world.LocalRuns) world.LocalRuns.Add(session);
            var file = StoredTasks[IndexOf(session)].File;
            world.Push(file);
            File.WriteAllText(args[args.IndexOf("--output") + 1], JsonSerializer.Serialize(new
            {
                success = true, task = "implement", issue_number = Issue, branch_name = Branch, tamma_session_id = session,
                files_changed = new[] { file }, commit_sha = $"local-{session}", tokens_used = 1, duration_seconds = 1,
                agent_provider = "claude-code",
            }));
            return Task.FromResult(new ProcessRunResult(0, "ok", "", false, 1));
        }
    }

    // ── fakes: Tamma.Api over HTTP ───────────────────────────────────────

    /// <summary>
    /// Plays Tamma.Api for every engine→API call: engine events go through the REAL engine-events
    /// handler into the shared event store; the capability probe answers "nothing supported" so the
    /// cycle takes the short path to code review + the merge gate; everything else is a 200.
    /// </summary>
    private sealed class ScriptedApi(World world) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/api/engine/events", StringComparison.Ordinal) && request.Content is not null)
            {
                var body = await request.Content.ReadAsStringAsync(ct);
                var batch = JsonSerializer.Deserialize<AppendEventsRequest>(body, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
                var tc = new TenantContext();
                tc.SetTenantId(Tenant);
                await EngineEndpoints.AppendEvents(batch, world.EventRepo.Object, tc);
                return Json(HttpStatusCode.Created, new { ok = true, persisted = batch.Events.Count });
            }
            if (path.EndsWith("/api/engine/cycle-result", StringComparison.Ordinal) && request.Content is not null)
            {
                using var doc = JsonDocument.Parse(await request.Content.ReadAsStringAsync(ct));
                world.CycleResults.Enqueue(doc.RootElement.GetProperty("exitReason").GetString() ?? "");
            }
            if (path.EndsWith("/capabilities", StringComparison.Ordinal))
                return Json(HttpStatusCode.OK, new { success = true, platformKind = "test", capabilities = Array.Empty<string>() });
            return Json(HttpStatusCode.OK, new { ok = true, success = true });
        }

        private static HttpResponseMessage Json(HttpStatusCode status, object body)
            => new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    // ── stub sub-workflows for the non-coding stages ──────────────────────

    private static class Stubs
    {
        public static readonly ConcurrentBag<string> Invoked = new();
        public static string TasksJson = SingleIssueCycleCrashReEntryTests.TasksJson(StoredTasks);

        public static string GateOutcome = "reject";

        public static void Reset()
        {
            Invoked.Clear();
            GateOutcome = "reject";
            TasksJson = SingleIssueCycleCrashReEntryTests.TasksJson(StoredTasks);
        }

        public abstract class Stub : WorkflowBase
        {
            protected abstract string Id { get; }
            protected virtual Dictionary<string, Func<object>> Outputs => new() { ["success"] = () => true };

            protected override void Build(IWorkflowBuilder builder)
            {
                builder.DefinitionId = Id;
                var seq = new Sequence();
                var id = Id;
                seq.Activities.Add(new Record(id));
                foreach (var (key, value) in Outputs)
                    seq.Activities.Add(new SetOutput { OutputName = new(key), OutputValue = new(_ => value()) });
                builder.Root = seq;
            }
        }

        /// <summary>Records that a stub ran.</summary>
        private sealed class Record : CodeActivity
        {
            private readonly string _id;
            public Record(string id) => _id = id;
            protected override void Execute(ActivityExecutionContext context) => Invoked.Add(_id);
        }

        public class ContextGathering : Stub
        {
            protected override string Id => "context-gathering";
            protected override Dictionary<string, Func<object>> Outputs => new()
            { ["success"] = () => true, ["summary"] = () => "context", ["contextIds"] = () => "[\"c1\"]" };
        }

        public class PlanGeneration : Stub
        {
            protected override string Id => "plan-generation";
            protected override Dictionary<string, Func<object>> Outputs => new() { ["success"] = () => true, ["planJson"] = () => "{\"plan\":1}" };
        }

        public class PlanReview : Stub
        {
            protected override string Id => "plan-review";
            protected override Dictionary<string, Func<object>> Outputs => new()
            { ["decision"] = () => "approved", ["planJson"] = () => "{\"plan\":1}" };
        }

        public class TaskCreation : Stub
        {
            protected override string Id => "task-creation";
            protected override Dictionary<string, Func<object>> Outputs => new() { ["status"] = () => "completed", ["tasksJson"] = () => TasksJson };
        }

        public class TaskReview : Stub
        {
            protected override string Id => "task-review";
            protected override Dictionary<string, Func<object>> Outputs => new() { ["decision"] = () => "approved", ["tasksJson"] = () => TasksJson };
        }

        public class BranchCreation : Stub
        {
            protected override string Id => "branch-creation";
            protected override Dictionary<string, Func<object>> Outputs => new() { ["success"] = () => true, ["branchName"] = () => Branch };
        }

        public class PullRequest : Stub
        {
            protected override string Id => "pull-request";
            protected override Dictionary<string, Func<object>> Outputs => new()
            { ["success"] = () => true, ["prNumber"] = () => 7, ["prUrl"] = () => "https://gh.test/pr/7" };
        }

        public class TestCaseCreation : Stub { protected override string Id => "test-case-creation"; }
        public class TddRetry : Stub { protected override string Id => "tdd-with-debug-retry"; }
        public class CiGate : Stub { protected override string Id => "ci-with-debug-retry"; }
        public class CodeReview : Stub { protected override string Id => "code-review"; }
        public class CreateIssues : Stub { protected override string Id => "create-issues"; }
        public class Deployment : Stub { protected override string Id => "deployment-pipeline"; }
        public class UpdateIssueStatus : Stub { protected override string Id => "update-issue-status"; }

        public class MergeApproval : Stub
        {
            protected override string Id => "merge-approval";
            // A reject ends the cycle at its human-handoff terminal — the test only needs to see it got here.
            protected override Dictionary<string, Func<object>> Outputs => new() { ["outcome"] = () => GateOutcome };
        }
    }
}
