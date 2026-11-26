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
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.LlmCall;
using Tamma.Activities.Policy;
using Tamma.ElsaServer.Endpoints;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// Story 43-19 — full-runtime execution proof of staged deploy gates (QA → UAT → Production).
/// Runs the REAL <see cref="DeploymentPipelineWorkflow"/> on Elsa's runtime with:
/// <list type="bullet">
///   <item>real <see cref="CheckActionGateActivity"/> calling a fake <see cref="TammaApiClient"/>
///     governance-evaluate endpoint driven by a per-test dial / policy table;</item>
///   <item>real stage-scoped <see cref="WaitForDeploymentApprovalActivity"/> suspending on
///     <c>adl-deploy-{qa|uat|prod}-approval-…</c> bookmarks;</item>
///   <item>real <see cref="DeploymentApprovalResumeEndpoint.Resume"/> driving each bookmark; and</item>
///   <item>a stub <c>llm-call</c> workflow recording which stages were actually dispatched.</item>
/// </list>
///
/// <para>Proves AC1 (QA 75 / UAT 80 dial gating), AC2 (two-stage suspend/resume where approving QA
/// does NOT release UAT), and denied hard-stop behavior end to end.</para>
/// </summary>
[TestFixture]
[NonParallelizable]
[Category(ElsaRuntimeHarness.Category)]
public class DeploymentPipelineStagedGateExecutionTests
{
    private const string Tenant = "43194319-4319-4319-4319-431943194319";
    private const string Repo = "acme/staged-app";
    private const string MergeSha = "deadbeef1234";
    private const int Issue = 4319;

    // Shared per-test recording state read by the stub llm-call workflow.
    private static readonly ConcurrentQueue<string> DispatchedStages = new();

    [SetUp]
    public void SetUp()
    {
        while (DispatchedStages.TryDequeue(out _)) { }
    }

    // ====================================================================
    // AC2: Two-stage suspend/resume — approving QA MUST NOT release UAT
    // ====================================================================

    [Test]
    public async Task BelowQaAndUatDial_SuspendsAtEachStageSeparately_ApprovingQaDoesNotReleaseUat()
    {
        // Dial 70 (< 75 QA, < 80 UAT, < 90 Prod): all three gates require human approval.
        var evaluatedKeys = new ConcurrentQueue<string>();
        await using var provider = await BuildHostAsync(actionKey =>
        {
            evaluatedKeys.Enqueue(actionKey);
            return new GovernanceEvaluateResponse(
                Outcome: GovernanceEvaluateResponse.OutcomeRequiresHuman,
                Action: actionKey,
                Enforced: true,
                Reason: $"dial 70 below {actionKey}");
        });

        var instanceId = await StartPipelineAsync(provider);

        // 1. Suspends on QA bookmark — NOT UAT, NOT Prod.
        var qaBookmark = WaitForDeploymentApprovalActivity.BookmarkName(Tenant, Repo, Issue, MergeSha, "qa");
        await WaitForBookmarkAsync(provider, qaBookmark);

        // Wrong-stage resumes MUST 404 and leave QA suspended.
        (await ResumeAsync(provider, "uat", "approve")).Should().Be(StatusCodes.Status404NotFound);
        (await ResumeAsync(provider, "production", "approve")).Should().Be(StatusCodes.Status404NotFound);
        DispatchedStages.Should().BeEmpty("QA has not been approved yet");

        // 2. Approve QA → QA deploys → pipeline suspends on UAT (proving QA approval did NOT release UAT).
        (await ResumeAsync(provider, "qa", "approve")).Should().Be(StatusCodes.Status200OK);

        var uatBookmark = WaitForDeploymentApprovalActivity.BookmarkName(Tenant, Repo, Issue, MergeSha, "uat");
        await WaitForBookmarkAsync(provider, uatBookmark);

        DispatchedStages.ToArray().Should().Equal(new[] { "qa" },
            "approving QA must deploy QA and stop at UAT's own gate — never releasing UAT");

        // QA bookmark is burned (404), and Prod is not waiting yet (404).
        (await ResumeAsync(provider, "qa", "approve")).Should().Be(StatusCodes.Status404NotFound);
        (await ResumeAsync(provider, "production", "approve")).Should().Be(StatusCodes.Status404NotFound);

        // 3. Approve UAT → UAT deploys → pipeline suspends on Prod.
        (await ResumeAsync(provider, "uat", "approve")).Should().Be(StatusCodes.Status200OK);

        var prodBookmark = WaitForDeploymentApprovalActivity.BookmarkName(Tenant, Repo, Issue, MergeSha, "production");
        await WaitForBookmarkAsync(provider, prodBookmark);

        DispatchedStages.ToArray().Should().Equal(new[] { "qa", "uat" },
            "approving UAT must deploy UAT and stop at Production's gate");

        // 4. Approve Prod (omitting stage to also pin backward-compatible default) → completes.
        (await ResumeAsync(provider, stage: null, "approve")).Should().Be(StatusCodes.Status200OK);

        var finalState = await ElsaRuntimeHarness.WaitForFinishedAsync(provider, instanceId);
        finalState.Output["deploymentStatus"].Should().Be("success");
        finalState.Output["completedStages"].Should().Be("[\"qa\",\"uat\",\"production\"]");
        DispatchedStages.ToArray().Should().Equal(new[] { "qa", "uat", "production" });
        evaluatedKeys.ToArray().Should().Equal(
            new[] { "effect:deploy.qa", "effect:deploy.uat", "effect:deploy.prod" });
    }

    // ====================================================================
    // AC1: Dial 78 → QA (75) auto-runs; UAT (80) waits — and rejecting UAT stops cleanly
    // ====================================================================

    [Test]
    public async Task DialAt78_QaAutoRuns_UatSuspends_RejectingUatFailsPipelineWithoutDeployingUat()
    {
        var evaluatedKeys = new ConcurrentQueue<string>();
        await using var provider = await BuildHostAsync(actionKey =>
        {
            evaluatedKeys.Enqueue(actionKey);
            // Simulate dial = 78 against catalog levels: deploy.qa = 75 (automates), deploy.uat = 80 (waits).
            var outcome = actionKey == "effect:deploy.qa"
                ? GovernanceEvaluateResponse.OutcomeAutomated
                : GovernanceEvaluateResponse.OutcomeRequiresHuman;
            return new GovernanceEvaluateResponse(
                Outcome: outcome,
                Action: actionKey,
                Enforced: true,
                Reason: "dial=78");
        });

        var instanceId = await StartPipelineAsync(provider);

        // QA must auto-deploy without creating a QA bookmark, then suspend at UAT.
        var uatBookmark = WaitForDeploymentApprovalActivity.BookmarkName(Tenant, Repo, Issue, MergeSha, "uat");
        await WaitForBookmarkAsync(provider, uatBookmark);

        DispatchedStages.ToArray().Should().Equal(new[] { "qa" },
            "dial 78 >= deploy.qa (75) must automate QA without a human wait");

        // Reject UAT → pipeline fails at uat, never deploys UAT or Prod.
        (await ResumeAsync(provider, "uat", "reject")).Should().Be(StatusCodes.Status200OK);

        var finalState = await ElsaRuntimeHarness.WaitForFinishedAsync(provider, instanceId);
        finalState.Output["deploymentStatus"].Should().Be("failed:uat");
        finalState.Output["completedStages"].Should().Be("[\"qa\"]");
        DispatchedStages.ToArray().Should().Equal(new[] { "qa" },
            "a rejected UAT gate must never deploy UAT or Production");
        evaluatedKeys.ToArray().Should().Equal(new[] { "effect:deploy.qa", "effect:deploy.uat" });
    }

    // ====================================================================
    // Denial hard-stop on QA: zero bookmarks, zero deploys, failed:qa
    // ====================================================================

    [Test]
    public async Task QaGateDenied_HardStopsImmediately_NeverSuspendsOrDeploys()
    {
        await using var provider = await BuildHostAsync(actionKey =>
            new GovernanceEvaluateResponse(
                Outcome: GovernanceEvaluateResponse.OutcomeDenied,
                Action: actionKey,
                Enforced: true,
                Reason: "deploy.qa disabled by admin"));

        var instanceId = await StartPipelineAsync(provider);
        var finalState = await ElsaRuntimeHarness.WaitForFinishedAsync(provider, instanceId);

        finalState.Output["deploymentStatus"].Should().Be("failed:qa");
        finalState.Output["completedStages"].Should().Be("[]");
        DispatchedStages.Should().BeEmpty("a denied QA gate must never deploy anything");

        var bookmarks = await provider.GetRequiredService<IBookmarkStore>()
            .FindManyAsync(new BookmarkFilter(), CancellationToken.None);
        bookmarks.Should().BeEmpty("a denied gate must hard-stop, not park at an approvable wait");
    }

    // ====================================================================
    // Harness helpers
    // ====================================================================

    private static async Task<ServiceProvider> BuildHostAsync(Func<string, GovernanceEvaluateResponse> evaluate)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa =>
        {
            elsa.UseWorkflowRuntime();
            elsa.AddWorkflow<DeploymentPipelineWorkflow>();
            elsa.AddWorkflow<StubLlmDeployWorkflow>();
            elsa.AddActivity<CheckActionGateActivity>();
            elsa.AddActivity<WaitForDeploymentApprovalActivity>();
            elsa.AddActivity<EmitDeploymentEventActivity>();
            elsa.AddActivity<CreateReleaseActivity>();
        });

        services.AddSingleton(_ =>
        {
            var http = new HttpClient(new FakeApiHandler(evaluate))
            {
                BaseAddress = new Uri("http://tamma-api.test"),
            };
            return new TammaApiClient(http, NullLogger<TammaApiClient>.Instance);
        });

        var provider = services.BuildServiceProvider();
        await ElsaRuntimeHarness.StartAsync(provider);
        return provider;
    }

    private static async Task<string> StartPipelineAsync(IServiceProvider provider)
    {
        var runtime = provider.GetRequiredService<IWorkflowRuntime>();
        var client = await runtime.CreateClientAsync();
        await client.CreateAndRunInstanceAsync(new CreateAndRunWorkflowInstanceRequest
        {
            WorkflowDefinitionHandle = WorkflowDefinitionHandle.ByDefinitionId("deployment-pipeline"),
            Input = new Dictionary<string, object>
            {
                ["repository"] = Repo,
                ["mergeSha"] = MergeSha,
                ["issueNumber"] = Issue,
                ["branchName"] = "main",
                ["mode"] = "business",
                ["tenantId"] = Tenant,
                ["requireProdApproval"] = false,
            },
        });
        return client.WorkflowInstanceId;
    }

    private static Task WaitForBookmarkAsync(IServiceProvider provider, string bookmarkName)
    {
        var store = provider.GetRequiredService<IBookmarkStore>();
        return ElsaRuntimeHarness.UntilAsync(async () =>
        {
            var found = await store.FindManyAsync(new BookmarkFilter { Name = bookmarkName }, CancellationToken.None);
            return found.Any();
        }, $"bookmark '{bookmarkName}'");
    }

    private static async Task<int> ResumeAsync(IServiceProvider provider, string? stage, string decision)
    {
        var req = new DeploymentApprovalResumeEndpoint.ResumeRequest(
            IssueNumber: Issue,
            Decision: decision,
            Feedback: $"test {decision} {stage ?? "default"}",
            Approver: "test-operator@acme.test",
            TenantId: Tenant,
            Repository: Repo,
            MergeSha: MergeSha,
            Stage: stage);

        var result = await DeploymentApprovalResumeEndpoint.Resume(
            req,
            provider.GetRequiredService<IBookmarkStore>(),
            provider.GetRequiredService<IWorkflowRuntime>(),
            NullLoggerFactory.Instance,
            CancellationToken.None);

        return (result as IStatusCodeHttpResult)?.StatusCode ?? 0;
    }

    /// <summary>Stub <c>llm-call</c> workflow that records the stage dispatched and reports success.</summary>
    private sealed class StubLlmDeployWorkflow : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            builder.DefinitionId = "llm-call";
            builder.Version = 1;
            builder.Root = new Sequence
            {
                Activities =
                {
                    new SetOutput
                    {
                        OutputName = new("llmResponse"),
                        OutputValue = new(ctx =>
                        {
                            var vars = ctx.GetInput<IDictionary<string, object>>("variables");
                            var stage = vars != null && vars.TryGetValue("stage", out var s)
                                ? s?.ToString() ?? ""
                                : "";
                            DispatchedStages.Enqueue(stage);
                            return (object)"{\"status\":\"success\"}";
                        }),
                    },
                },
            };
        }
    }

    /// <summary>Fake Tamma.Api handler answering governance evaluate + release create + events.</summary>
    private sealed class FakeApiHandler(Func<string, GovernanceEvaluateResponse> evaluate) : HttpMessageHandler
    {
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri?.AbsolutePath ?? "";

            if (path.EndsWith("/api/v1/governance/evaluate", StringComparison.OrdinalIgnoreCase))
            {
                var body = request.Content is not null ? await request.Content.ReadAsStringAsync(ct) : "{}";
                var req = JsonSerializer.Deserialize<GovernanceEvaluateRequest>(body, Json);
                var actionKey = req?.Action ?? "";
                var decision = evaluate(actionKey);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(decision, Json), Encoding.UTF8, "application/json"),
                };
            }

            if (path.Contains("/releases", StringComparison.OrdinalIgnoreCase))
            {
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent(
                        "{\"tagName\":\"deploy-deadbee\",\"htmlUrl\":\"https://github.com/acme/staged-app/releases/tag/deploy-deadbee\"}",
                        Encoding.UTF8, "application/json"),
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json"),
            };
        }
    }
}
