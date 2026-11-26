using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Models;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Activities;
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
using Tamma.Activities.Core;
using Tamma.Activities.Documents;
using Tamma.Core.Documents.Resume;
using Tamma.Core.Documents.Types;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// Story 41-29 — Task-Level Flow Router (+ issue-level pre-route) structural,
/// replay, and live Elsa runtime execution tests (AC2, AC3, AC4, AC5, AC7, AC8).
/// </summary>
[TestFixture]
[NonParallelizable]
public sealed class TaskFlowRouterTests
{
    private Flowchart _flowchart = null!;

    [SetUp]
    public void SetUp()
    {
        var builder = WorkflowTestHelper.BuildWorkflow(new SingleIssueCycleWorkflow());
        _flowchart = WorkflowTestHelper.GetFlowchart(builder);
    }

    // ── AC2: Task-level FlowSwitchByKind graph proofs ─────────────────────

    [Test]
    public void FlowSwitchByKind_routes_every_kind_and_never_reaches_deployment_pipeline_inside_loop()
    {
        var sw = _flowchart.Activities.OfType<FlowSwitch>().Single(s => s.Id == "FlowSwitchByKind");
        sw.Cases.Select(c => c.Label).Should().Equal(
            "Code", "Infra", "Chore", "Test", "Investigation", "Design", "Docs", "Unknown");

        // Code / Infra / Chore → EmitTaskDispatchedCoding → TddForTask
        foreach (var port in new[] { "Code", "Infra", "Chore" })
        {
            HasEdge("FlowSwitchByKind", port, "EmitTaskDispatchedCoding").Should().BeTrue();
        }
        HasEdge("EmitTaskDispatchedCoding", null, "TddForTask").Should().BeTrue();

        // Test → test-case-creation
        HasEdge("FlowSwitchByKind", "Test", "EmitTaskDispatchedTest").Should().BeTrue();
        HasEdge("EmitTaskDispatchedTest", null, "DispatchTestTask").Should().BeTrue();
        ReadDefinitionId("DispatchTestTask").Should().Be("test-case-creation");
        HasEdge("TestTaskOk", "True", "IncrementTask").Should().BeTrue();
        ReachableFromPort("TestTaskOk", "False").Should().Contain("EmitStepFailed");

        // Investigation → research
        HasEdge("FlowSwitchByKind", "Investigation", "EmitTaskDispatchedInvestigation").Should().BeTrue();
        HasEdge("EmitTaskDispatchedInvestigation", null, "DispatchInvestigationTask").Should().BeTrue();
        ReadDefinitionId("DispatchInvestigationTask").Should().Be("research");
        HasEdge("InvestigationTaskOk", "True", "IncrementTask").Should().BeTrue();
        ReachableFromPort("InvestigationTaskOk", "False").Should().Contain("EmitStepFailed");

        // Design → design-proposal
        HasEdge("FlowSwitchByKind", "Design", "EmitTaskDispatchedDesign").Should().BeTrue();
        HasEdge("EmitTaskDispatchedDesign", null, "DispatchDesignTask").Should().BeTrue();
        ReadDefinitionId("DispatchDesignTask").Should().Be("design-proposal");
        HasEdge("DesignTaskOk", "True", "IncrementTask").Should().BeTrue();
        ReachableFromPort("DesignTaskOk", "False").Should().Contain("EmitStepFailed");

        // Docs → human-assigned deferral (no non-existent DefinitionId, never TddForTask)
        HasEdge("FlowSwitchByKind", "Docs", "EmitTaskDeferredDocs").Should().BeTrue();
        HasEdge("EmitTaskDeferredDocs", null, "NotifyDocsDeferred").Should().BeTrue();
        HasEdge("EmitTaskDeferredDocs", null, "IncrementTask").Should().BeTrue();
        ReachableWithinLoopFromPort("FlowSwitchByKind", "Docs").Should().NotContain("TddForTask");

        // Unknown → loud escalation through shared sink (never TddForTask, never IncrementTask)
        HasEdge("FlowSwitchByKind", "Unknown", "EmitTaskUnknownKind").Should().BeTrue();
        HasEdge("EmitTaskUnknownKind", null, "UnknownTaskKindEscalate").Should().BeTrue();
        var unknownReach = ReachableFromPort("FlowSwitchByKind", "Unknown");
        unknownReach.Should().Contain("EmitStepFailed").And.Contain("ReportError").And.Contain("Finish");
        unknownReach.Should().NotContain("TddForTask").And.NotContain("IncrementTask");

        // AC2 standing guard: deployment-pipeline is NEVER reachable from inside the per-task loop.
        foreach (var port in sw.Cases.Select(c => c.Label))
        {
            ReachableWithinLoopFromPort("FlowSwitchByKind", port)
                .Should().NotContain("DeploymentPipeline",
                    $"deployment-pipeline must not be reachable inside the task loop for kind '{port}'");
        }
    }

    [Test]
    public void Every_DispatchWorkflow_target_in_SingleIssueCycleWorkflow_exists_in_ElsaServer()
    {
        // Discover every concrete WorkflowBase DefinitionId in Tamma.ElsaServer.
        var knownIds = typeof(SingleIssueCycleWorkflow).Assembly
            .GetTypes()
            .Where(t => !t.IsAbstract && typeof(WorkflowBase).IsAssignableFrom(t))
            .Select(t =>
            {
                try
                {
                    var wf = (WorkflowBase)Activator.CreateInstance(t)!;
                    return WorkflowTestHelper.BuildWorkflow(wf).Object.DefinitionId;
                }
                catch
                {
                    return null;
                }
            })
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.Ordinal);

        var dispatches = _flowchart.Activities.OfType<DispatchWorkflow>().ToList();
        dispatches.Should().NotBeEmpty();
        foreach (var dispatch in dispatches)
        {
            var defId = ReadDefinitionId(dispatch.Id!);
            defId.Should().NotBeNullOrWhiteSpace($"DispatchWorkflow '{dispatch.Id}' must declare a WorkflowDefinitionId");
            knownIds.Should().Contain(defId!,
                $"DispatchWorkflow '{dispatch.Id}' targets '{defId}' which must exist as a registered workflow");
        }
    }

    // ── AC4: Issue-level pre-route graph proofs ───────────────────────────

    [Test]
    public void IssuePreRoute_Question_never_reaches_GatherContext_GeneratePlan_or_CreateBranch()
    {
        var sw = _flowchart.Activities.OfType<FlowSwitch>().Single(s => s.Id == "IssuePreRoute");
        sw.Cases.Select(c => c.Label).Should().Equal("Question", "NeedsHuman", "Plan");

        var questionReach = ReachableFromPort("IssuePreRoute", "Question");
        questionReach.Should().Contain("AnswerQuestion")
            .And.Contain("NotifyQuestionAnswered")
            .And.Contain("ReportQuestionAnswered")
            .And.Contain("Finish");
        questionReach.Should().NotContain("GatherContext")
            .And.NotContain("GeneratePlan")
            .And.NotContain("CreateBranch");

        var needsHumanReach = ReachableFromPort("IssuePreRoute", "NeedsHuman");
        needsHumanReach.Should().Contain("NotifyNeedsHuman")
            .And.Contain("ReportPreRouteNeedsHuman")
            .And.Contain("Finish");
        needsHumanReach.Should().NotContain("GatherContext")
            .And.NotContain("GeneratePlan");

        HasEdge("IssuePreRoute", "Plan", "EmitCycleStarted").Should().BeTrue();
        HasEdge("EmitCycleStarted", null, "GatherContext").Should().BeTrue();
    }

    // ── AC5 & AC7: RouteEvents replay + ResumeBehavior preservation ───────

    [Test]
    public void RouteEvents_constants_and_replay_reconstruct_preroute_and_per_task_routes()
    {
        RouteEvents.IssuePrerouted.Should().Be("ROUTE.ISSUE.PREROUTED");
        RouteEvents.TaskDispatched.Should().Be("ROUTE.TASK.DISPATCHED");
        RouteEvents.TaskDeferredToHuman.Should().Be("ROUTE.TASK.DEFERRED_TO_HUMAN");
        RouteEvents.TaskUnknownKind.Should().Be("ROUTE.TASK.UNKNOWN_KIND");

        var tenantId = Guid.NewGuid();
        var stream = new[]
        {
            EmitRouteEventActivity.BuildTammaEvent(
                RouteEvents.IssuePrerouted, 42, "acme/web", tenantId,
                issueType: "feature", chosenFlow: "plan"),
            EmitRouteEventActivity.BuildTammaEvent(
                RouteEvents.TaskDispatched, 42, "acme/web", tenantId,
                taskId: "T1", kind: "code", targetWorkflow: "tdd-for-task"),
            EmitRouteEventActivity.BuildTammaEvent(
                RouteEvents.TaskDispatched, 42, "acme/web", tenantId,
                taskId: "T2", kind: "test", targetWorkflow: "test-case-creation"),
            EmitRouteEventActivity.BuildTammaEvent(
                RouteEvents.TaskDeferredToHuman, 42, "acme/web", tenantId,
                taskId: "T3", kind: "docs", missingTarget: "epic-41-docs-workflow (41-24/41-25/41-26)"),
            EmitRouteEventActivity.BuildTammaEvent(
                RouteEvents.TaskUnknownKind, 42, "acme/web", tenantId,
                taskId: "T4", rawKind: "teleport"),
        };

        foreach (var evt in stream)
        {
            evt.Tags["issueId"].Should().Be("acme/web#42");
            evt.Tags["repository"].Should().Be("acme/web");
            evt.Tags["tenantId"].Should().Be(tenantId.ToString("D"));
        }

        stream[0].Tags["chosenFlow"].Should().Be("plan");
        stream[1].Tags["targetWorkflow"].Should().Be("tdd-for-task");
        stream[2].Tags["targetWorkflow"].Should().Be("test-case-creation");
        stream[3].Tags["missingTarget"].Should().Be("epic-41-docs-workflow (41-24/41-25/41-26)");
        stream[4].Status.Should().Be("error");
        stream[4].Tags["rawKind"].Should().Be("teleport");

        // AC7: SingleIssueCycleWorkflow retains [ResumeBehavior(Both)] without any allowlist entry.
        var attr = typeof(SingleIssueCycleWorkflow).GetCustomAttribute<ResumeBehaviorAttribute>();
        attr.Should().NotBeNull();
        attr!.Mode.Should().Be(ResumeMode.Both);
        attr.SuspendActivities.Should().Contain(typeof(WaitForAgentRunActivity));
    }

    // ── Live Elsa runtime proofs (AC2, AC3, AC4, AC5) ────────────────────

    [Test]
    public async Task Runtime_Question_issue_answers_and_closes_without_plan_or_branch()
    {
        RouterStubs.Reset();
        await using var host = await BuildRuntimeHostAsync();

        await RunCycleAsync(host, """{"number":77,"type":"question","title":"How does auth work?","labels":["question"]}""");

        await WaitUntilAsync(() => RouterStubs.ReportedReasons.Contains("success"), "question cycle reported success");

        RouterStubs.Invoked.Should().Contain("research");
        RouterStubs.Invoked.Should().Contain("update-issue-status");
        RouterStubs.Invoked.Should().NotContain("context-gathering");
        RouterStubs.Invoked.Should().NotContain("plan-generation");
        RouterStubs.Invoked.Should().NotContain("branch-creation");
        RouterStubs.ClosedIssues.Should().Contain(77);
    }

    [Test]
    public async Task Runtime_Mixed_kind_plan_routes_test_investigation_design_and_defers_docs_without_TDD()
    {
        RouterStubs.Reset();
        RouterStubs.TasksJson = JsonSerializer.Serialize(new object[]
        {
            new { id = "T1", kind = "test", description = "Write spec", files = new[] { "tests/a.cs" }, dependsOn = Array.Empty<string>(), testing = "dotnet test" },
            new { id = "T2", kind = "investigation", description = "Investigate bottleneck", files = new[] { "docs/notes.md" }, dependsOn = Array.Empty<string>(), testing = "findings reviewed" },
            new { id = "T3", kind = "design", description = "Propose arch", files = new[] { "docs/arch.md" }, dependsOn = Array.Empty<string>(), testing = "design review" },
            new { id = "T4", kind = "docs", description = "Update README", files = new[] { "README.md" }, dependsOn = Array.Empty<string>(), testing = "doc review" },
        });

        await using var host = await BuildRuntimeHostAsync();
        await RunCycleAsync(host, """{"number":78,"type":"docs","title":"Docs and research","labels":["docs"]}""");

        await WaitUntilAsync(() => RouterStubs.Invoked.Contains("merge-approval"), "mixed-kind loop completed and reached merge-approval");

        // AC4: docs issue took the plan path!
        RouterStubs.Invoked.Should().Contain("plan-generation");
        RouterStubs.Invoked.Should().Contain("test-case-creation");
        RouterStubs.Invoked.Should().Contain("research");
        RouterStubs.Invoked.Should().Contain("design-proposal");
        // None of these four tasks should have invoked the coding agent!
        RouterStubs.CodingDispatches.Should().BeEmpty();
    }

    [Test]
    public async Task Runtime_Poisoned_unknown_kind_escalates_loud_and_never_runs_TDD()
    {
        RouterStubs.Reset();
        RouterStubs.TasksJson = JsonSerializer.Serialize(new object[]
        {
            new { id = "T-BAD", kind = "teleport", description = "Poisoned", files = new[] { "a.cs" }, dependsOn = Array.Empty<string>(), testing = "unit" },
        });

        await using var host = await BuildRuntimeHostAsync();
        await RunCycleAsync(host, """{"number":79,"type":"feature","title":"Bad kind"}""");

        await WaitUntilAsync(() => RouterStubs.ReportedReasons.Contains("error"), "poisoned kind reported loud error");

        RouterStubs.CodingDispatches.Should().BeEmpty("unknown kind must never mis-route into TDD");
        RouterStubs.Invoked.Should().NotContain("merge-approval");
    }

    // ── Graph helpers ────────────────────────────────────────────────────

    private bool HasEdge(string from, string? port, string to) =>
        _flowchart.Connections.Any(c =>
            c.Source.Activity.Id == from &&
            (port is null || c.Source.Port == port) &&
            c.Target.Activity.Id == to);

    private HashSet<string> ReachableFromPort(string sourceId, string port)
    {
        var seen = new HashSet<string>();
        var queue = new Queue<string>();
        foreach (var c in _flowchart.Connections.Where(c => c.Source.Activity.Id == sourceId && c.Source.Port == port))
            if (c.Target.Activity.Id is { } t && seen.Add(t)) queue.Enqueue(t);

        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            foreach (var c in _flowchart.Connections.Where(c => c.Source.Activity.Id == id))
                if (c.Target.Activity.Id is { } t && seen.Add(t)) queue.Enqueue(t);
        }
        return seen;
    }

    /// <summary>Reachability staying inside the per-task loop (stops at HasMoreTasks/IncrementTask).</summary>
    private HashSet<string> ReachableWithinLoopFromPort(string sourceId, string port)
    {
        var seen = new HashSet<string>();
        var queue = new Queue<string>();
        foreach (var c in _flowchart.Connections.Where(c => c.Source.Activity.Id == sourceId && c.Source.Port == port))
            if (c.Target.Activity.Id is { } t && seen.Add(t)) queue.Enqueue(t);

        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            if (id is "IncrementTask" or "HasMoreTasks") continue;
            foreach (var c in _flowchart.Connections.Where(c => c.Source.Activity.Id == id))
                if (c.Target.Activity.Id is { } t && seen.Add(t)) queue.Enqueue(t);
        }
        return seen;
    }

    private string? ReadDefinitionId(string activityId)
    {
        var dispatch = _flowchart.Activities.OfType<DispatchWorkflow>().Single(d => d.Id == activityId);
        var prop = typeof(DispatchWorkflow).GetProperty("WorkflowDefinitionId");
        var value = prop?.GetValue(dispatch);
        var expr = value?.GetType().GetProperty("Expression")?.GetValue(value) as Elsa.Expressions.Models.Expression;
        return expr?.Value?.ToString();
    }

    // ── Minimal in-process Elsa host for live routing proofs ──────────────

    private static async Task<ServiceProvider> BuildRuntimeHostAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tamma:ApiUrl"] = "http://tamma.test",
            ["Engine:CallbackUrl"] = "http://engine.test",
            ["Agent:ExecutorMode"] = "github_actions",
        }).Build();
        services.AddSingleton<IConfiguration>(config);

        var handler = new RouterCallbackHandler();
        services.AddSingleton<IHttpClientFactory>(new SingleHandlerFactory(handler));
        services.AddSingleton(_ => new Tamma.Activities.LlmCall.TammaApiClient(
            new HttpClient(handler), NullLogger<Tamma.Activities.LlmCall.TammaApiClient>.Instance, config));

        services.AddScoped<AgentExecutorFactory>();
        services.AddSingleton<IAgentDispatchService>(new RecordingDispatch());
        services.AddSingleton<IAgentResultCollectorService>(Mock.Of<IAgentResultCollectorService>());
        services.AddSingleton<PendingAgentRunCompletionBuffer>();
        services.AddSingleton<ITaskLoopReEntryService>(new NullTaskLoopReEntryService());

        services.AddElsa(elsa =>
        {
            elsa.AddActivitiesFrom<WaitForAgentRunActivity>();
            elsa.AddWorkflow<SingleIssueCycleWorkflow>();
            elsa.AddWorkflow<RouterStubs.ContextGathering>();
            elsa.AddWorkflow<RouterStubs.PlanGeneration>();
            elsa.AddWorkflow<RouterStubs.PlanReview>();
            elsa.AddWorkflow<RouterStubs.TaskCreation>();
            elsa.AddWorkflow<RouterStubs.TaskReview>();
            elsa.AddWorkflow<RouterStubs.BranchCreation>();
            elsa.AddWorkflow<RouterStubs.PullRequest>();
            elsa.AddWorkflow<RouterStubs.TestCaseCreation>();
            elsa.AddWorkflow<RouterStubs.Research>();
            elsa.AddWorkflow<RouterStubs.DesignProposal>();
            elsa.AddWorkflow<RouterStubs.TddRetry>();
            elsa.AddWorkflow<RouterStubs.CiGate>();
            elsa.AddWorkflow<RouterStubs.CodeReview>();
            elsa.AddWorkflow<RouterStubs.MergeApproval>();
            elsa.AddWorkflow<RouterStubs.CreateIssues>();
            elsa.AddWorkflow<RouterStubs.Deployment>();
            elsa.AddWorkflow<RouterStubs.UpdateIssueStatus>();
            elsa.UseWorkflows(w => w.UseTammaEventPersistence());
        });

        var sp = services.BuildServiceProvider();
        await sp.GetRequiredService<IRegistriesPopulator>().PopulateAsync(CancellationToken.None);
        foreach (var h in sp.GetServices<IHostedService>())
            await h.StartAsync(CancellationToken.None);
        return sp;
    }

    private static async Task RunCycleAsync(IServiceProvider sp, string workItemJson)
    {
        var issueNumber = 77;
        using (var d = JsonDocument.Parse(workItemJson))
            if (d.RootElement.TryGetProperty("number", out var n)) issueNumber = n.GetInt32();

        var client = await sp.GetRequiredService<IWorkflowRuntime>().CreateClientAsync();
        await client.CreateAndRunInstanceAsync(new CreateAndRunWorkflowInstanceRequest
        {
            WorkflowDefinitionHandle = WorkflowDefinitionHandle.ByDefinitionId("single-issue-cycle"),
            Input = new Dictionary<string, object>
            {
                ["repository"] = "acme/web",
                ["issueNumber"] = issueNumber,
                ["tenantId"] = Guid.NewGuid().ToString("D"),
                ["workItemJson"] = workItemJson,
            },
        });
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string what)
    {
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(50);
        }
        Assert.Fail($"Timed out waiting for: {what}");
    }

    private sealed class RecordingDispatch : IAgentDispatchService
    {
        public Task<Tamma.Activities.AgentDispatch.Models.AgentDispatchResult> DispatchAsync(
            Tamma.Activities.AgentDispatch.Models.AgentExecutionRequest request, CancellationToken ct = default)
        {
            RouterStubs.CodingDispatches.Add(request.SessionId);
            return Task.FromResult(new Tamma.Activities.AgentDispatch.Models.AgentDispatchResult(
                Success: true,
                ErrorMessage: null,
                WorkflowRunUrl: null,
                DispatchedAt: DateTime.UtcNow));
        }
    }

    private sealed class SingleHandlerFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RouterCallbackHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);

            if (path.Contains("/cycle-result", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("exitReason", out var r) && r.GetString() is { } reason)
                    RouterStubs.ReportedReasons.Add(reason);
            }

            if (path.Contains("/capabilities", StringComparison.OrdinalIgnoreCase))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"success":true,"platformKind":"test","capabilities":[]}""", System.Text.Encoding.UTF8, "application/json"),
                };
            }

            return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent("""{"ok":true,"success":true}""", System.Text.Encoding.UTF8, "application/json"),
            };
        }
    }

    private static class RouterStubs
    {
        public static ConcurrentBag<string> Invoked { get; } = new();
        public static ConcurrentBag<string> ReportedReasons { get; } = new();
        public static ConcurrentBag<string> CodingDispatches { get; } = new();
        public static ConcurrentBag<int> ClosedIssues { get; } = new();
        public static string TasksJson { get; set; } = "[]";

        public static void Reset()
        {
            Invoked.Clear();
            ReportedReasons.Clear();
            CodingDispatches.Clear();
            ClosedIssues.Clear();
            TasksJson = "[]";
        }

        private static void Stub(IWorkflowBuilder b, string id, Func<Dictionary<string, object>> outputs)
        {
            b.DefinitionId = id;
            b.Version = 1;
            var seq = new Sequence();
            seq.Activities.Add(new InlineAction(ctx =>
            {
                Invoked.Add(id);
                var exprCtx = ctx.ExpressionExecutionContext;
                if (id == "update-issue-status" && exprCtx.GetInput<bool>("closeIssue"))
                    ClosedIssues.Add(exprCtx.GetInput<int>("issueNumber"));
            }));
            foreach (var key in outputs().Keys)
            {
                var k = key;
                seq.Activities.Add(new SetOutput
                {
                    OutputName = new(k),
                    OutputValue = new(_ => outputs()[k]),
                });
            }
            b.Root = seq;
        }

        private sealed class InlineAction(Action<ActivityExecutionContext> run) : CodeActivity
        {
            protected override void Execute(ActivityExecutionContext context) => run(context);
        }

        public sealed class ContextGathering : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "context-gathering", () => new() { ["summary"] = "ok", ["contextIds"] = "c1" }); }
        public sealed class PlanGeneration : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "plan-generation", () => new() { ["planJson"] = """{"tasks":[]}""" }); }
        public sealed class PlanReview : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "plan-review", () => new() { ["decision"] = "approved" }); }
        public sealed class TaskCreation : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "task-creation", () => new() { ["tasksJson"] = TasksJson }); }
        public sealed class TaskReview : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "task-review", () => new() { ["decision"] = "approved", ["tasksJson"] = TasksJson }); }
        public sealed class BranchCreation : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "branch-creation", () => new() { ["success"] = true, ["branchName"] = "tamma/issue-78" }); }
        public sealed class PullRequest : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "pull-request", () => new() { ["prNumber"] = 99, ["prUrl"] = "https://example/pr/99" }); }
        public sealed class TestCaseCreation : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "test-case-creation", () => new() { ["success"] = true, ["status"] = "accepted" }); }
        public sealed class Research : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "research", () => new() { ["status"] = "accepted", ["report"] = "Auth uses JWT cookies." }); }
        public sealed class DesignProposal : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "design-proposal", () => new() { ["status"] = "accepted", ["approved"] = true }); }
        public sealed class TddRetry : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "tdd-with-debug-retry", () => new() { ["success"] = true }); }
        public sealed class CiGate : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "ci-with-debug-retry", () => new() { ["passed"] = true }); }
        public sealed class CodeReview : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "code-review", () => new()); }
        public sealed class MergeApproval : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "merge-approval", () => new() { ["outcome"] = "reject" }); }
        public sealed class CreateIssues : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "create-issues", () => new()); }
        public sealed class Deployment : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "deployment-pipeline", () => new() { ["deploymentStatus"] = "success" }); }
        public sealed class UpdateIssueStatus : WorkflowBase { protected override void Build(IWorkflowBuilder b) => Stub(b, "update-issue-status", () => new()); }
    }
}
