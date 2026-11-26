using System.Net;
using System.Net.Http;
using System.Text;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Management;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Management.Entities;
using Elsa.Workflows.Management.Filters;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.LlmCall;
using FlowConnection = Elsa.Workflows.Activities.Flowchart.Models.Connection;
using FlowEndpoint = Elsa.Workflows.Activities.Flowchart.Models.Endpoint;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 35-6 (AC4) — verifies the engine-side token-quota check inside
/// <see cref="CheckLimitsActivity"/>: allowed proceeds to <c>Continue</c>;
/// quota exhaustion routes to <c>Stop</c>; quota endpoint 500 or transport
/// failure fails CLOSED to <c>Stop</c>.
/// </summary>
[TestFixture]
public class CheckLimitsQuotaTests
{
    private const string TenantId = "22222222-2222-2222-2222-222222222222";

    [Test]
    public async Task Continues_When_Budget_And_TokenQuota_Are_Both_Allowed()
    {
        var output = await RunWithApiResponsesAsync(
            budgetJson: """{"spent":1.25,"limit":50.0,"remaining":48.75,"percentUsed":2.5}""",
            quotaResponse: () => JsonResponse(
                """{"allowed":true,"which_quota":"platform_tokens","limit":100000,"used":25000,"reset_at":"2026-07-01T00:00:00Z","http_status":0}"""));

        output["outcome"].Should().Be("continue");
        output["stopReason"].Should().Be("");
    }

    [Test]
    public async Task Stops_When_TokenQuota_Is_Exhausted()
    {
        var output = await RunWithApiResponsesAsync(
            budgetJson: """{"spent":1.25,"limit":50.0,"remaining":48.75,"percentUsed":2.5}""",
            quotaResponse: () => JsonResponse(
                """{"allowed":false,"which_quota":"platform_tokens","limit":100000,"used":100000,"reset_at":"2026-07-01T00:00:00Z","http_status":402}"""));

        output["outcome"].Should().Be("stop");
        output["stopReason"].ToString().Should().Contain("Plan token quota exhausted");
        output["stopReason"].ToString().Should().Contain("100000/100000");
    }

    [Test]
    public async Task Stops_FailClosed_When_QuotaEndpoint_Returns_ServerError()
    {
        var output = await RunWithApiResponsesAsync(
            budgetJson: """{"spent":1.25,"limit":0.0,"remaining":0.0,"percentUsed":0.0}""",
            quotaResponse: () => new HttpResponseMessage(HttpStatusCode.InternalServerError));

        output["outcome"].Should().Be("stop", "quota check failures must fail closed even without a USD ceiling");
        output["stopReason"].ToString().Should().Contain("failing closed");
    }

    [Test]
    public async Task Stops_FailClosed_When_QuotaEndpoint_Throws_HttpRequestException()
    {
        var output = await RunWithApiResponsesAsync(
            budgetJson: """{"spent":0.0,"limit":0.0,"remaining":0.0,"percentUsed":0.0}""",
            quotaResponse: () => throw new HttpRequestException("simulated network outage"));

        output["outcome"].Should().Be("stop");
        output["stopReason"].ToString().Should().Contain("failing closed");
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };

    private static async Task<IDictionary<string, object>> RunWithApiResponsesAsync(
        string budgetJson,
        Func<HttpResponseMessage> quotaResponse)
    {
        var store = new Mock<IWorkflowInstanceStore>();
        store.Setup(s => s.CountAsync(It.IsAny<WorkflowInstanceFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0L);
        store.Setup(s => s.FindManyAsync(It.IsAny<WorkflowInstanceFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<WorkflowInstance>());

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tamma:ApiUrl"] = "http://tamma-api.test",
                [AdlSpendCeiling.BudgetOwnerKey] = TenantId,
            })
            .Build();

        var handler = new StubHandler(req =>
        {
            var path = req.RequestUri?.AbsolutePath ?? "";
            if (path.Contains("/api/providers/diagnostics/budget/", StringComparison.Ordinal))
                return JsonResponse(budgetJson);
            if (path.Contains("/api/v1/billing/quota/", StringComparison.Ordinal))
                return quotaResponse();
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        });

        var apiClient = new TammaApiClient(
            new HttpClient(handler),
            Mock.Of<ILogger<TammaApiClient>>(),
            configuration);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa => elsa.AddActivity<CheckLimitsActivity>());
        services.AddSingleton<IConfiguration>(configuration);
        services.AddSingleton(store.Object);
        services.AddSingleton<IAdlStopSwitch>(new ConfigAdlStopSwitch(configuration));
        services.AddSingleton(apiClient);

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var result = await runner.RunAsync(new QuotaProbeWorkflow(), new RunWorkflowOptions(), CancellationToken.None);
        result.WorkflowState.Status.Should().Be(WorkflowStatus.Finished);
        return result.WorkflowState.Output;
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(responder(request));
    }

    private sealed class QuotaProbeWorkflow : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            var stopReason = builder.WithVariable<string?>("StopReason", null);
            var gate = new CheckLimitsActivity
            {
                Id = "CheckLimits",
                MaxConcurrent = new Input<int>(2),
                EmergencyStop = new Input<bool>(false),
                StopReason = new Output<string?>(stopReason),
            };
            var recordReason = new SetOutput
            {
                Id = "RecordReason",
                OutputName = new("stopReason"),
                OutputValue = new(ctx => (object?)(stopReason.Get(ctx) ?? "")),
            };
            var onContinue = new SetOutput
            {
                Id = "OnContinue",
                OutputName = new("outcome"),
                OutputValue = new(_ => (object)"continue"),
            };
            var onStop = new SetOutput
            {
                Id = "OnStop",
                OutputName = new("outcome"),
                OutputValue = new(_ => (object)"stop"),
            };

            builder.Root = new Flowchart
            {
                Start = gate,
                Activities = { gate, recordReason, onContinue, onStop },
                Connections =
                {
                    new FlowConnection(new FlowEndpoint(gate, "Continue"), new FlowEndpoint(onContinue)),
                    new FlowConnection(new FlowEndpoint(gate, "Stop"), new FlowEndpoint(onStop)),
                    new FlowConnection(new FlowEndpoint(onContinue), new FlowEndpoint(recordReason)),
                    new FlowConnection(new FlowEndpoint(onStop), new FlowEndpoint(recordReason)),
                },
            };
        }
    }
}
