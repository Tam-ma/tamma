using System.Net;
using System.Text;
using System.Text.Json;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Memory;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Core;
using Tamma.Core;
using Tamma.Core.AgentDispatch.Resume;
using Tamma.ElsaServer.Workflows;
using Tamma.ElsaServer.Workflows.Helpers;

namespace Tamma.Activities.Tests.AgentDispatch;

/// <summary>Story 40-4 (AC3, AC6, AC7) — the loop's re-entry node and the engine's HTTP read.</summary>
[TestFixture]
public class ComputeTaskResumeIndexActivityTests
{
    private const string Tenant = "7d0b3a8e-1c55-4d8e-9a39-0b1d2c3e4f50";
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-42";
    private const string StoredTasks = "[{\"id\":\"T1\"},{\"id\":\"T2\"},{\"id\":\"T3\"}]";

    private CapturingHandler _capture = null!;

    [SetUp]
    public void SetUp() => _capture = new CapturingHandler();

    [TearDown]
    public void TearDown() => _capture.Dispose();

    // ── The activity ──────────────────────────────────────────────────────

    [Test]
    public async Task Start_at_zero_sets_zero_and_emits_nothing()
    {
        var result = await RunAsync(new FakeService(TaskLoopResumePosition.Start(TaskResumeBasis.NoRuns, "fresh")));

        Output(result, "index").Should().Be("0");
        Output(result, "tasks").Should().BeEmpty();
        Output(result, "inconsistency").Should().BeEmpty();
        ReEntryEvents().Should().BeEmpty("a fresh start is not a re-entry");
    }

    [Test]
    public async Task Re_entry_sets_the_index_and_the_stored_list_and_emits_TaskReentered()
    {
        var position = new TaskLoopResumePosition
        {
            ResumeIndex = 2, LandedIndices = [0, 1], BasisCode = TaskResumeBasis.Resumed, Basis = "0..1 landed", TasksJson = StoredTasks,
        };

        var result = await RunAsync(new FakeService(position));

        Output(result, "index").Should().Be("2");
        Output(result, "tasks").Should().Be(StoredTasks);
        var e = ReEntryEvents().Should().ContainSingle().Subject;
        e.GetProperty("status").GetString().Should().Be("success");
        e.GetProperty("tags").GetProperty("correlationId").GetString().Should().Be("adl-42-task-2");
        e.GetProperty("tags").GetProperty("tenantId").GetString().Should().Be(Tenant);
        var data = e.GetProperty("data");
        data.GetProperty("resumeIndex").GetInt32().Should().Be(2);
        data.GetProperty("landedIndices").EnumerateArray().Select(x => x.GetInt32()).Should().Equal(0, 1);
        data.GetProperty("basisCode").GetString().Should().Be(TaskResumeBasis.Resumed);
        data.GetProperty("taskIndex").GetInt32().Should().Be(2);
        data.GetProperty("taskId").GetString().Should().Be("T3");
    }

    [Test]
    public async Task Inconsistency_is_surfaced_for_the_loud_failure_and_skips_nothing()
    {
        var result = await RunAsync(new FakeService(new TammaError(TaskLoopResumeCalculator.InconsistentStateCode, "git says no")));

        Output(result, "index").Should().Be("0");
        Output(result, "inconsistency").Should().Be("git says no");
        ReEntryEvents().Should().BeEmpty();
    }

    [Test]
    public async Task Any_other_read_failure_starts_at_zero_like_today()
    {
        var result = await RunAsync(new FakeService(new HttpRequestException("api down")));

        Output(result, "index").Should().Be("0");
        Output(result, "basis").Should().Be(TaskResumeBasis.ReadFailed);
        Output(result, "inconsistency").Should().BeEmpty("a failed read is not a disagreement");
    }

    [Test]
    public async Task A_skip_without_its_task_list_is_refused()
    {
        var result = await RunAsync(new FakeService(new TaskLoopResumePosition { ResumeIndex = 2, BasisCode = TaskResumeBasis.Resumed }));

        Output(result, "index").Should().Be("0");
        Output(result, "basis").Should().Be(TaskResumeBasis.NoTaskList);
    }

    [Test]
    public async Task The_null_seam_starts_at_zero()
    {
        var result = await RunAsync(new NullTaskLoopReEntryService());

        Output(result, "index").Should().Be("0");
        Output(result, "basis").Should().Be(TaskResumeBasis.Disabled);
    }

    [Test]
    public async Task A_missing_service_fails_loud()
    {
        var result = await RunAsync(service: null);

        result.WorkflowState.SubStatus.Should().Be(WorkflowSubStatus.Faulted);
        result.WorkflowState.Incidents.Should().ContainSingle()
            .Which.Exception!.Message.Should().Contain("No ITaskLoopReEntryService");
    }

    // ── AC6: the switch ───────────────────────────────────────────────────

    [Test]
    public void Shipped_default_is_switched_off_until_reads_are_scoped_to_one_attempt()
    {
        TaskReEntryRegistration.DisabledByDefault.Should().BeTrue(
            "re-entry reads AGENT_RUN events across every attempt at an issue (2026-11-07 audit)");
        TaskReEntryRegistration.IsDisabled(Config()).Should().BeTrue();
    }

    [TestCase("true", true)]
    [TestCase("false", false)]
    [TestCase("False", false)]
    public void The_key_selects_the_seam(string value, bool disabled)
        => TaskReEntryRegistration.IsDisabled(Config((TaskReEntryRegistration.ConfigKey, value))).Should().Be(disabled);

    [TestCase("Tamma.ElsaServer", "HttpTaskLoopReEntryService")]
    [TestCase("Tamma.Api", "Tamma.Api.Services.AgentDispatch.TaskLoopReEntryService")]
    public void Both_hosts_branch_on_the_switch(string host, string realService)
    {
        var program = File.ReadAllText(Path.Combine(SrcRoot(), host, "Program.cs"));
        var at = program.IndexOf("TaskReEntryRegistration.IsDisabled(builder.Configuration)", StringComparison.Ordinal);
        at.Should().BeGreaterThan(0, $"{host} must read Coding:TaskReEntryDisabled through TaskReEntryRegistration");
        var branch = program.Substring(at, 600);
        branch.Should().Contain("NullTaskLoopReEntryService").And.Contain(realService);
        branch.IndexOf("NullTaskLoopReEntryService", StringComparison.Ordinal)
            .Should().BeLessThan(branch.IndexOf(realService, StringComparison.Ordinal), "true ⇒ Null, else the real service");
    }

    // ── The engine's HTTP read ────────────────────────────────────────────

    [Test]
    public async Task Http_reads_the_position_and_sends_the_tenant()
    {
        var handler = new StubHandler(HttpStatusCode.OK,
            JsonSerializer.Serialize(new TaskLoopResumePosition { ResumeIndex = 1, BasisCode = "RESUMED", TasksJson = StoredTasks }));

        var p = await Http(handler).ReconstructAsync(Guid.Parse(Tenant), Repo, Branch, 42, CancellationToken.None);

        p.ResumeIndex.Should().Be(1);
        p.TasksJson.Should().Be(StoredTasks);
        handler.Last!.RequestUri!.PathAndQuery.Should().Be(
            "/api/engine/issues/42/task-resume?repository=acme%2Fwidgets&branch=tamma%2Fissue-42");
        handler.Last.Headers.GetValues("X-Tenant-Id").Should().Equal(Tenant);
    }

    [Test]
    public async Task Http_409_is_the_typed_inconsistency()
    {
        var handler = new StubHandler(HttpStatusCode.Conflict,
            JsonSerializer.Serialize(new { code = TaskLoopResumeCalculator.InconsistentStateCode, message = "files missing" }));

        var act = () => Http(handler).ReconstructAsync(null, Repo, Branch, 42, CancellationToken.None);

        var ex = (await act.Should().ThrowAsync<TammaError>()).Which;
        ex.Code.Should().Be(TaskLoopResumeCalculator.InconsistentStateCode);
        ex.Message.Should().Be("files missing");
    }

    [Test]
    public async Task Http_other_failures_are_a_retryable_read_error()
    {
        var act = () => Http(new StubHandler(HttpStatusCode.InternalServerError, "")).ReconstructAsync(null, Repo, Branch, 42, CancellationToken.None);

        var ex = (await act.Should().ThrowAsync<TammaError>()).Which;
        ex.Code.Should().Be(HttpTaskLoopReEntryService.ReadFailedCode);
        ex.Retryable.Should().BeTrue();
    }

    // ── Wiring into SingleIssueCycleWorkflow ──────────────────────────────

    [Test]
    public void The_stored_task_list_key_matches_task_creation()
        => TaskBreakdownDocument.IssueIdFor(Repo, 42).Should().Be(
            CreationBindingHelper.ScopeIssueId(CreationBindingHelper.DeriveIssueId(Repo, 42), "task-creation"));

    [Test]
    public void The_stored_task_list_reads_back_as_the_loop_list()
    {
        const string body = "{\"tasks\":[{\"id\":\"T1\",\"files\":[\"a\"]},{\"id\":\"T2\",\"files\":[]}],\"files\":[\"a\"]}";

        TaskBreakdownDocument.TryRead(body, out var json, out var tasks).Should().BeTrue();

        json.Should().Be(CreationBindingHelper.ProjectTasksArray(body), "the same array task-creation hands the cycle");
        tasks.Select(t => t.Id).Should().Equal("T1", "T2");
        tasks[0].Files.Should().Equal("a");
    }

    [TestCase("")]
    [TestCase("{}")]
    [TestCase("{\"tasks\":[]}")]
    [TestCase("not json")]
    public void An_unusable_stored_list_reads_as_none(string body)
        => TaskBreakdownDocument.TryRead(body, out _, out _).Should().BeFalse();

    [Test]
    public void CountTasks_counts_array_items()
    {
        SingleIssueCycleWorkflow.CountTasks(StoredTasks).Should().Be(3);
        SingleIssueCycleWorkflow.CountTasks("{}").Should().Be(0);
        SingleIssueCycleWorkflow.CountTasks("bad").Should().Be(0);
    }

    // ── Harness ───────────────────────────────────────────────────────────

    private List<JsonElement> ReEntryEvents() =>
        _capture.Bodies
            .SelectMany(b => JsonDocument.Parse(b).RootElement.GetProperty("events").EnumerateArray().Select(e => e.Clone()))
            .Where(e => e.GetProperty("eventType").GetString() == AgentRunWaitEventTypes.TaskReentered)
            .ToList();

    private static string? Output(RunWorkflowResult result, string key)
        => result.WorkflowState.Output.TryGetValue(key, out var v) ? v?.ToString() : null;

    private async Task<RunWorkflowResult> RunAsync(ITaskLoopReEntryService? service)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa =>
        {
            elsa.AddActivity<ComputeTaskResumeIndexActivity>();
            elsa.UseWorkflows(w => w.UseTammaEventPersistence());
        });
        var config = Config(("Tamma:ApiUrl", "http://tamma.test"));
        services.AddSingleton<IConfiguration>(config);
        var capture = _capture;
        services.AddSingleton(_ => new Tamma.Activities.LlmCall.TammaApiClient(
            new HttpClient(capture), NullLogger<Tamma.Activities.LlmCall.TammaApiClient>.Instance, config));
        if (service is not null) services.AddSingleton(service);

        await using var sp = services.BuildServiceProvider();
        using var scope = sp.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var index = new Variable<int>("Index", -1);
        var tasks = new Variable<string>("Tasks", "");
        var basis = new Variable<string>("Basis", "");
        var inconsistency = new Variable<string>("Inconsistency", "");
        var activity = new ComputeTaskResumeIndexActivity
        {
            Id = "Compute",
            Repository = new Input<string>(Repo),
            BranchName = new Input<string>(Branch),
            IssueNumber = new Input<int>(42),
            TenantId = new Input<string?>(_ => Tenant),
            ResumeIndex = new Output<int>(index),
            TasksJson = new Output<string>(tasks),
            BasisCode = new Output<string>(basis),
            InconsistencyDetail = new Output<string>(inconsistency),
        };
        var root = new Sequence
        {
            Variables = { index, tasks, basis, inconsistency },
            Activities =
            {
                activity,
                new SetOutput { OutputName = new("index"), OutputValue = new(ctx => (object)index.Get(ctx)) },
                new SetOutput { OutputName = new("tasks"), OutputValue = new(ctx => (object?)tasks.Get(ctx) ?? "") },
                new SetOutput { OutputName = new("basis"), OutputValue = new(ctx => (object?)basis.Get(ctx) ?? "") },
                new SetOutput { OutputName = new("inconsistency"), OutputValue = new(ctx => (object?)inconsistency.Get(ctx) ?? "") },
            },
        };
        return await runner.RunAsync(new Workflow(root), new RunWorkflowOptions(), CancellationToken.None);
    }

    private static IConfiguration Config(params (string Key, string Value)[] pairs)
        => new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build();

    private static HttpTaskLoopReEntryService Http(HttpMessageHandler handler)
        => new(new SingleClientFactory(new HttpClient(handler)), Config(("Tamma:ApiUrl", "http://tamma.test")),
            NullLogger<HttpTaskLoopReEntryService>.Instance);

    private static string SrcRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var nested = Path.Combine(dir.FullName, "apps", "tamma-elsa", "src");
            if (Directory.Exists(Path.Combine(nested, "Tamma.Api"))) return nested;
            var direct = Path.Combine(dir.FullName, "src");
            if (Directory.Exists(Path.Combine(direct, "Tamma.Api"))) return direct;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate apps/tamma-elsa/src");
    }

    private sealed class FakeService : ITaskLoopReEntryService
    {
        private readonly TaskLoopResumePosition? _position;
        private readonly Exception? _error;
        public FakeService(TaskLoopResumePosition position) => _position = position;
        public FakeService(Exception error) => _error = error;

        public Task<TaskLoopResumePosition> ReconstructAsync(
            Guid? tenantId, string repository, string branchName, int issueNumber, CancellationToken ct)
            => _error is not null ? Task.FromException<TaskLoopResumePosition>(_error) : Task.FromResult(_position!);
    }

    private sealed class SingleClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Last { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Last = request;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public List<string> Bodies { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Content is not null)
                Bodies.Add(await request.Content.ReadAsStringAsync(cancellationToken));
            return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"ok\":true,\"persisted\":1}") };
        }
    }
}
