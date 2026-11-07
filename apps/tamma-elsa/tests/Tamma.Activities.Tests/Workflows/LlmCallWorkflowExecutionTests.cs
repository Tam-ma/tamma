using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Management;
using Elsa.Workflows.Management.Entities;
using Elsa.Workflows.Management.Filters;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Activities.Context;
using Tamma.Activities.LlmCall;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.Security;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// Runs the REAL <see cref="LlmCallWorkflow"/> (<c>llm-call</c>) — the one path every
/// model call in the engine takes — through a real <see cref="IWorkflowRunner"/>. Only
/// the HTTP layer is faked: <c>POST /api/v1/llm/call</c> answers from a per-provider
/// script, everything else 404s (so prompt/convention/agent resolution take their
/// documented fallbacks).
///
/// <para>Before this fixture no test executed the workflow (0 of its 160 branches were
/// covered); its tests were all structural. These pin the retry / provider-failover /
/// fail-closed behaviour the workflow's own docs promise.</para>
/// </summary>
[TestFixture]
public class LlmCallWorkflowExecutionTests
{
    private const int MaxRetries = 3; // LlmCallWorkflow's MaxRetries variable default

    [Test]
    public async Task FirstProviderSucceeds_ReturnsItsResponse_AndCallsNothingElse()
    {
        var api = new FakeLlmApi().Script("anthropic", Ok("hello"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"]);

        output["success"].Should().Be(true);
        output["llmResponse"].Should().Be("hello");
        output["providerUsed"].Should().Be("anthropic");
        output["tokensUsed"].Should().Be(15);
        api.CallsTo("anthropic").Should().Be(1);
        api.CallsTo("openai").Should().Be(0);
    }

    [TestCase(429)]
    [TestCase(502)]
    [TestCase(503)]
    [TestCase(504)]
    public async Task TransientFailure_IsRetriedOnTheSameProvider(int status)
    {
        var api = new FakeLlmApi().Script("anthropic", Fail(status), Ok("second time lucky"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"]);

        output["success"].Should().Be(true);
        output["llmResponse"].Should().Be("second time lucky");
        api.CallsTo("anthropic").Should().Be(2);
        api.CallsTo("openai").Should().Be(0);
    }

    [Test]
    public async Task TransportFailure_IsTreatedAsTransient_AndRetried()
    {
        // A raw 5xx from the API itself nulls the response; the shim maps that to
        // httpStatusCode 0, which RetryCheck treats as transient.
        var api = new FakeLlmApi().Script("anthropic", Raw(HttpStatusCode.InternalServerError), Ok("recovered"));

        var output = await RunAsync(api, chain: ["anthropic"]);

        output["success"].Should().Be(true);
        api.CallsTo("anthropic").Should().Be(2);
    }

    [Test]
    public async Task PersistentTransientFailure_StopsAtMaxRetries_ThenFailsOver()
    {
        var api = new FakeLlmApi()
            .Script("anthropic", Enumerable.Repeat(Fail(503), 10).ToArray())
            .Script("openai", Ok("from openai"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"]);

        output["success"].Should().Be(true);
        output["providerUsed"].Should().Be("openai");
        output["llmResponse"].Should().Be("from openai");
        api.CallsTo("anthropic").Should().Be(MaxRetries, "retries are bounded per provider");
    }

    [TestCase(400)]
    [TestCase(401)]
    [TestCase(422)]
    public async Task NonTransientFailure_IsNotRetried_AndFailsOverImmediately(int status)
    {
        var api = new FakeLlmApi()
            .Script("anthropic", Fail(status), Ok("must not be reached"))
            .Script("openai", Ok("from openai"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"]);

        output["providerUsed"].Should().Be("openai");
        api.CallsTo("anthropic").Should().Be(1, "retrying a bad request burns budget for nothing");
    }

    [Test]
    public async Task EveryProviderFails_ReportsFailure_WithDiagnosticsForEachAttempt()
    {
        var api = new FakeLlmApi()
            .Script("anthropic", Fail(400))
            .Script("openai", Enumerable.Repeat(Fail(503), 10).ToArray());

        var output = await RunAsync(api, chain: ["anthropic", "openai"]);

        output["success"].Should().Be(false);
        output["llmResponse"].Should().Be("", "a failed call must never look like an empty answer with success");
        output["providerUsed"].Should().Be("");

        var workflowOutput = JsonSerializer.Deserialize<LlmCallWorkflowOutput>((string)output["workflowOutput"])!;
        workflowOutput.Success.Should().BeFalse();
        workflowOutput.ErrorMessage.Should().Be("All providers in the chain failed");
        workflowOutput.Diagnostics.Should().HaveCount(1 + MaxRetries);
        workflowOutput.Diagnostics.Should().OnlyContain(d => !d.Succeeded);
        api.CallsTo("openai").Should().Be(MaxRetries);
    }

    [Test]
    public async Task SuccessAfterFailover_KeepsTheFailedAttemptsInTheDiagnostics()
    {
        var api = new FakeLlmApi()
            .Script("anthropic", Fail(400))
            .Script("openai", Ok("ok"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"]);

        var workflowOutput = JsonSerializer.Deserialize<LlmCallWorkflowOutput>((string)output["workflowOutput"])!;
        workflowOutput.SuccessfulProvider.Should().Be("openai");
        workflowOutput.Diagnostics.Select(d => (d.ProviderName, d.Succeeded))
            .Should().Equal(("anthropic", false), ("openai", true));
    }

    [Test]
    public async Task ProvidersOutsideTheAllowlist_AreNeverCalled()
    {
        var api = new FakeLlmApi()
            .Script("evil-proxy", Ok("exfiltrated"))
            .Script("openai", Ok("from openai"));

        var output = await RunAsync(api, chain: ["evil-proxy", "openai"]);

        output["providerUsed"].Should().Be("openai");
        api.CallsTo("evil-proxy").Should().Be(0);
    }

    [Test]
    public async Task SpentPerCallBudget_SkipsTheRemainingProviders()
    {
        // The first provider burns tokens and fails; that spend exceeds the caller's
        // per-call cap, so the next provider must be skipped, not called.
        var api = new FakeLlmApi()
            .Script("anthropic", Fail(400, promptTokens: 1_000_000))
            .Script("openai", Ok("must not be reached"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"], budgetCapUsd: 0.01m);

        output["success"].Should().Be(false);
        api.CallsTo("openai").Should().Be(0);
        var workflowOutput = JsonSerializer.Deserialize<LlmCallWorkflowOutput>((string)output["workflowOutput"])!;
        workflowOutput.Diagnostics.Should().Contain(d => d.ProviderName == "openai" && d.BudgetExhausted);
    }

    [Test]
    public async Task NoBudgetCap_MeansUnlimited()
    {
        var api = new FakeLlmApi()
            .Script("anthropic", Fail(400, promptTokens: 1_000_000))
            .Script("openai", Ok("ok"));

        var output = await RunAsync(api, chain: ["anthropic", "openai"], budgetCapUsd: 0m);

        output["success"].Should().Be(true);
        output["providerUsed"].Should().Be("openai");
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    private static object Ok(string text) => new
    {
        success = true,
        text,
        httpStatusCode = 200,
        usage = new { promptTokens = 10, completionTokens = 5, totalTokens = 15 },
        modelUsed = "test-model",
    };

    private static object Fail(int status, int promptTokens = 0) => new
    {
        success = false,
        httpStatusCode = status,
        usage = new { promptTokens, completionTokens = 0, totalTokens = promptTokens },
        failureCode = "UPSTREAM",
        failureReason = $"upstream said {status}",
    };

    private static object Raw(HttpStatusCode status) => status;

    private static async Task<IDictionary<string, object>> RunAsync(FakeLlmApi api, string[] chain, decimal budgetCapUsd = 0m)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tamma:ApiUrl"] = "http://tamma.test",
        }).Build();

        var store = new Mock<IWorkflowInstanceStore>();
        store.Setup(s => s.CountAsync(It.IsAny<WorkflowInstanceFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0L);
        store.Setup(s => s.FindManyAsync(It.IsAny<WorkflowInstanceFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<WorkflowInstance>());

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton(store.Object);
        services.AddSingleton(new ProviderAllowlist());
        services.AddSingleton<IHttpClientFactory>(new FakeHttpClientFactory(api));
        services.AddSingleton(sp => new TammaApiClient(
            new HttpClient(api), sp.GetRequiredService<ILogger<TammaApiClient>>(), config));
        services.AddElsa(elsa => elsa
            .AddActivitiesFrom<CallLlmInlineActivity>()
            .AddWorkflow<LlmCallWorkflow>());

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var inputJson = JsonSerializer.Serialize(new LlmCallWorkflowInput
        {
            Role = "developer",
            UserPrompt = "say hi",
            ProviderChain = chain.ToList(),
            CorrelationId = "test-correlation",
            BudgetCapUsd = budgetCapUsd,
        });

        var run = await runner.RunAsync(
            new LlmCallWorkflow(),
            new RunWorkflowOptions { Input = new Dictionary<string, object> { ["InputJson"] = inputJson } },
            CancellationToken.None);

        run.WorkflowState.Status.Should().Be(WorkflowStatus.Finished,
            $"llm-call must always finish (incidents: {string.Join("; ", run.WorkflowState.Incidents.Select(i => i.Exception?.Message))})");
        run.WorkflowState.SubStatus.Should().Be(WorkflowSubStatus.Finished);
        return run.WorkflowState.Output;
    }

    /// <summary>
    /// Fake Tamma API. <c>POST /api/v1/llm/call</c> answers from a per-provider queue
    /// (the last scripted answer repeats); any other route returns 404.
    /// </summary>
    private sealed class FakeLlmApi : HttpMessageHandler
    {
        private readonly ConcurrentDictionary<string, Queue<object>> _scripts = new();
        private readonly ConcurrentDictionary<string, int> _calls = new();

        public FakeLlmApi Script(string provider, params object[] answers)
        {
            _scripts[provider] = new Queue<object>(answers);
            return this;
        }

        public int CallsTo(string provider) => _calls.GetValueOrDefault(provider);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.Method != HttpMethod.Post || request.RequestUri?.AbsolutePath != "/api/v1/llm/call")
                return new HttpResponseMessage(HttpStatusCode.NotFound);

            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!;
            var provider = body["provider"]?.GetValue<string>() ?? "";
            _calls.AddOrUpdate(provider, 1, (_, n) => n + 1);

            if (!_scripts.TryGetValue(provider, out var queue) || queue.Count == 0)
                return Json(Fail(400));

            var answer = queue.Count > 1 ? queue.Dequeue() : queue.Peek();
            return answer is HttpStatusCode raw ? new HttpResponseMessage(raw) : Json(answer);
        }

        private static HttpResponseMessage Json(object payload) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
    }

    private sealed class FakeHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false)
        {
            BaseAddress = new Uri("http://tamma.test"),
        };
    }
}
