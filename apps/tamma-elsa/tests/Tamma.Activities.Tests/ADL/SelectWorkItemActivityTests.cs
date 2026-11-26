using System.Net;
using System.Text;
using System.Text.Json;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Activities.Flowchart.Models;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Memory;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.Core;
using Tamma.Core.Tracking;
using FlowEndpoint = Elsa.Workflows.Activities.Flowchart.Models.Endpoint;
using FlowConnection = Elsa.Workflows.Activities.Flowchart.Models.Connection;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC1/AC2/AC4/AC10 — unit tests for <see cref="SelectWorkItemActivity"/>:
/// - Test 1: parses the real <c>{ issues, total }</c> envelope shape
/// - Test 3: transport failure and genuinely empty result emit distinct events (AC2/D2)
/// - Test 4: non-numeric platform issue number is rejected loudly, never defaulted to 0
/// - Test 11: exclude labels, bot assignee, priority-then-age sort, and source/key tags (AC4/AC10)
/// </summary>
[TestFixture]
public class SelectWorkItemActivityTests
{
    private static IConfiguration Config(string? sources = null)
    {
        var dict = new Dictionary<string, string?>
        {
            ["Anthropic:UseMock"] = "false",
            ["Engine:CallbackUrl"] = "http://engine-callback.test",
            ["Tamma:ApiUrl"] = "http://api.test",
        };
        if (sources is not null)
            dict["Intake:Sources"] = sources;
        return new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
    }

    private sealed record ProbeResult(
        string Outcome,
        string? WorkItemJson,
        int IssueNumber,
        string? Priority,
        string? WorkItemKey,
        string? WorkItemSource,
        List<TammaEvent> Events);

    private static async Task<ProbeResult> RunProbeAsync(
        HttpMessageHandler handler,
        string repo = "Tam-ma/tamma",
        string? sources = null)
    {
        var configuration = Config(sources);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa => elsa.AddActivity<SelectWorkItemActivity>());
        services.AddSingleton<IConfiguration>(configuration);
        services.AddSingleton<IHttpClientFactory>(new SingleHandlerHttpClientFactory(handler));

        var capturedEvents = new List<TammaEvent>();
        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var result = await runner.RunAsync(
            new SelectProbeWorkflow(repo, capturedEvents),
            new RunWorkflowOptions(),
            CancellationToken.None);

        result.WorkflowState.Status.Should().Be(WorkflowStatus.Finished);
        var outMap = result.WorkflowState.Output;
        return new ProbeResult(
            Outcome: outMap["outcome"]?.ToString() ?? "",
            WorkItemJson: outMap.TryGetValue("workItemJson", out var j) ? j as string : null,
            IssueNumber: outMap.TryGetValue("issueNumber", out var n) && n is int i ? i : 0,
            Priority: outMap.TryGetValue("priority", out var p) ? p as string : null,
            WorkItemKey: outMap.TryGetValue("workItemKey", out var k) ? k as string : null,
            WorkItemSource: outMap.TryGetValue("workItemSource", out var s) ? s as string : null,
            Events: capturedEvents);
    }

    private sealed class SelectProbeWorkflow(string repo, List<TammaEvent> capturedEvents) : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            var jsonVar = builder.WithVariable<string?>("WorkItemJson", null);
            var numVar = builder.WithVariable<int>("IssueNumber", 0);
            var prioVar = builder.WithVariable<string>("Priority", "");
            var keyVar = builder.WithVariable<string?>("WorkItemKey", null);
            var srcVar = builder.WithVariable<string?>("WorkItemSource", null);
            var outcomeVar = builder.WithVariable<string>("Outcome", "");

            var select = new SelectWorkItemActivity
            {
                Id = "Select",
                Repository = new Input<string>(repo),
                WorkItemJson = new Output<string?>(jsonVar),
                IssueNumber = new Output<int>(numVar),
                Priority = new Output<string>(prioVar),
                WorkItemKey = new Output<string?>(keyVar),
                WorkItemSource = new Output<string?>(srcVar),
            };

            IActivity MarkOutcome(string id, string label) => new CaptureOutcomeActivity(outcomeVar, label, capturedEvents)
            {
                Id = id,
            };

            var onSelected = MarkOutcome("OnSelected", "Selected");
            var onNothing = MarkOutcome("OnNothing", "NothingFound");
            var onTriage = MarkOutcome("OnTriage", "NeedsTriage");

            var outputs = new Sequence
            {
                Id = "Outputs",
                Activities =
                {
                    new SetOutput { Id = "OutOutcome", OutputName = new("outcome"), OutputValue = new(ctx => (object)outcomeVar.Get(ctx)) },
                    new SetOutput { Id = "OutJson", OutputName = new("workItemJson"), OutputValue = new(ctx => (object?)jsonVar.Get(ctx)) },
                    new SetOutput { Id = "OutNum", OutputName = new("issueNumber"), OutputValue = new(ctx => (object)numVar.Get(ctx)) },
                    new SetOutput { Id = "OutPrio", OutputName = new("priority"), OutputValue = new(ctx => (object)prioVar.Get(ctx)) },
                    new SetOutput { Id = "OutKey", OutputName = new("workItemKey"), OutputValue = new(ctx => (object?)keyVar.Get(ctx)) },
                    new SetOutput { Id = "OutSource", OutputName = new("workItemSource"), OutputValue = new(ctx => (object?)srcVar.Get(ctx)) },
                }
            };

            builder.Root = new Flowchart
            {
                Id = "SelectProbeFlow",
                Start = select,
                Activities = { select, onSelected, onNothing, onTriage, outputs },
                Connections =
                {
                    new FlowConnection(new FlowEndpoint(select, "Selected"), new FlowEndpoint(onSelected)),
                    new FlowConnection(new FlowEndpoint(select, "NothingFound"), new FlowEndpoint(onNothing)),
                    new FlowConnection(new FlowEndpoint(select, "NeedsTriage"), new FlowEndpoint(onTriage)),
                    new FlowConnection(new FlowEndpoint(onSelected), new FlowEndpoint(outputs)),
                    new FlowConnection(new FlowEndpoint(onNothing), new FlowEndpoint(outputs)),
                    new FlowConnection(new FlowEndpoint(onTriage), new FlowEndpoint(outputs)),
                }
            };
        }
    }

    private sealed class CaptureOutcomeActivity(
        Variable<string> outcomeVar,
        string label,
        List<TammaEvent> capturedEvents) : CodeActivity
    {
        protected override void Execute(ActivityExecutionContext context)
        {
            if (context.WorkflowExecutionContext.TransientProperties.TryGetValue("tamma:events", out var raw)
                && raw is List<TammaEvent> evts)
            {
                capturedEvents.AddRange(evts);
            }
            outcomeVar.Set(context, label);
        }
    }

    [Test]
    public async Task Parses_the_real_envelope_shape()
    {
        var handler = new StubHttpMessageHandler(req =>
        {
            if (req.RequestUri!.Query.Contains("labels="))
            {
                return JsonResponse("""
                    {
                      "issues": [
                        {
                          "number": "42",
                          "title": "Fix real intake",
                          "body": "Body text",
                          "html_url": "https://github.com/Tam-ma/tamma/issues/42",
                          "labels": [{ "name": "tamma-auto" }, { "name": "priority-high" }],
                          "createdAt": "2026-07-20T10:00:00Z"
                        }
                      ],
                      "total": 1
                    }
                    """);
            }
            return JsonResponse("""{ "issues": [], "total": 0 }""");
        });

        var probe = await RunProbeAsync(handler);

        probe.Outcome.Should().Be("Selected");
        probe.WorkItemJson.Should().NotBeNullOrWhiteSpace();
        probe.IssueNumber.Should().Be(42);
        probe.Priority.Should().Be("high");
        probe.WorkItemKey.Should().Be("Tam-ma/tamma#42");
        probe.WorkItemSource.Should().Be("platform-issue");

        var parsed = JsonSerializer.Deserialize<WorkItem>(probe.WorkItemJson!)!;
        parsed.Key.Should().Be("Tam-ma/tamma#42");
        parsed.Source.Should().Be(WorkIntakeSourceKind.PlatformIssue);
        parsed.Url.Should().Be("https://github.com/Tam-ma/tamma/issues/42");

        // AC10 / D9: ADL.WORKITEM.SELECT carries source and key tags.
        var completed = probe.Events.Single(e => e.EventType == "ADL.WORKITEM.SELECT.COMPLETED");
        completed.Status.Should().Be("success");
        completed.Tags.Should().NotBeNull();
        completed.Tags!["source"].Should().Be("platform-issue");
        completed.Tags!["key"].Should().Be("Tam-ma/tamma#42");
    }

    [Test]
    public async Task Transport_failure_and_empty_result_differ()
    {
        // 1. Genuine empty backlog -> ADL.WORKITEM.SELECT.COMPLETED (status="success")
        var emptyHandler = new StubHttpMessageHandler(_ => JsonResponse("""{ "issues": [], "total": 0 }"""));
        var emptyProbe = await RunProbeAsync(emptyHandler);
        emptyProbe.Outcome.Should().Be("NothingFound");
        emptyProbe.Events.Should().ContainSingle(e => e.EventType == "ADL.WORKITEM.SELECT.COMPLETED" && e.Status == "success");
        emptyProbe.Events.Should().NotContain(e => e.EventType == "ADL.WORKITEM.SELECT.FAILED");

        // 2. Transport failure (HttpRequestException) -> ADL.WORKITEM.SELECT.FAILED (status="error")
        var failHandler = new StubHttpMessageHandler(_ => throw new HttpRequestException("Connection refused"));
        var failProbe = await RunProbeAsync(failHandler);
        failProbe.Outcome.Should().Be("NothingFound");
        var failed = failProbe.Events.Should().ContainSingle(e => e.EventType == "ADL.WORKITEM.SELECT.FAILED").Subject;
        failed.Status.Should().Be("error");
        failed.Error.Should().Contain("Connection refused");
        failProbe.Events.Should().NotContain(e => e.EventType == "ADL.WORKITEM.SELECT.COMPLETED");
    }

    [Test]
    public async Task Non_numeric_platform_number_is_rejected_loudly()
    {
        const string badBody = """
            {
              "issues": [
                { "number": "NOT-A-NUM", "title": "Corrupt platform number", "labels": [{ "name": "tamma-auto" }] }
              ],
              "total": 1
            }
            """;

        // Direct deserialization rejects loudly with JsonException (never silently 0).
        var act = () => JsonSerializer.Deserialize<EngineIssuesResponse>(
            badBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        act.Should().Throw<JsonException>()
            .WithMessage("*NOT-A-NUM*");

        // Through SelectWorkItemActivity it surfaces as a loud failure event, never silently selecting #0.
        var handler = new StubHttpMessageHandler(_ => JsonResponse(badBody));
        var probe = await RunProbeAsync(handler);
        probe.Outcome.Should().Be("NothingFound");
        probe.WorkItemJson.Should().BeNull();
        probe.Events.Should().ContainSingle(e => e.EventType == "ADL.WORKITEM.SELECT.FAILED" && e.Status == "error");
    }

    [Test]
    public async Task Existing_filters_and_ordering_are_unchanged()
    {
        var handler = new StubHttpMessageHandler(req =>
        {
            if (req.RequestUri!.Query.Contains("labels="))
            {
                return JsonResponse("""
                    {
                      "issues": [
                        {
                          "number": 10,
                          "title": "Blocked urgent (excluded)",
                          "labels": [{ "name": "tamma-auto" }, { "name": "priority-critical" }, { "name": "blocked" }],
                          "createdAt": "2026-07-01T00:00:00Z"
                        },
                        {
                          "number": 11,
                          "title": "Assigned to human (excluded)",
                          "assignee": "alice",
                          "labels": [{ "name": "tamma-auto" }, { "name": "priority-critical" }],
                          "createdAt": "2026-07-01T00:00:00Z"
                        },
                        {
                          "number": 12,
                          "title": "Newer high priority",
                          "labels": [{ "name": "tamma-auto" }, { "name": "priority-high" }],
                          "createdAt": "2026-07-20T00:00:00Z"
                        },
                        {
                          "number": 13,
                          "title": "Older high priority (wins)",
                          "assignee": "tamma-bot",
                          "labels": [{ "name": "tamma-auto" }, { "name": "bug" }],
                          "createdAt": "2026-07-10T00:00:00Z"
                        }
                      ],
                      "total": 4
                    }
                    """);
            }
            return JsonResponse("""{ "issues": [], "total": 0 }""");
        });

        var probe = await RunProbeAsync(handler);

        probe.Outcome.Should().Be("Selected");
        probe.IssueNumber.Should().Be(13,
            "blocked (#10) and human-assigned (#11) are excluded; #13 ties #12 on high priority and wins by older CreatedAt");
        probe.Priority.Should().Be("high");
        probe.WorkItemKey.Should().Be("Tam-ma/tamma#13");
    }

    internal static HttpResponseMessage JsonResponse(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    internal sealed class StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(responder(request));
    }

    internal sealed class SingleHandlerHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
