using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Activities.ADL;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC8 (D7/D8, Test 9) — opt-in, idempotent native tracker status
/// write-back over HTTP. Replaying a transition to the status already held is
/// a true no-op (zero POSTs, zero duplicate events).
/// </summary>
[TestFixture]
public class UpdateWorkItemStatusActivityTests
{
    private static IConfiguration Config() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tamma:ApiUrl"] = "http://api.test",
        })
        .Build();

    [Test]
    public async Task Replay_is_a_no_op()
    {
        var itemId = Guid.NewGuid();
        var projectId = Guid.NewGuid();
        var currentStatus = "ready";
        var version = 1;
        var postCalls = 0;
        string? capturedActor = null;

        var handler = new SelectWorkItemActivityTests.StubHttpMessageHandler(req =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath == "/api/work-items/by-key/TAM-42")
            {
                return SelectWorkItemActivityTests.JsonResponse($$"""
                    { "id": "{{itemId:D}}", "projectId": "{{projectId:D}}", "status": "{{currentStatus}}", "version": {{version}} }
                    """);
            }
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath == $"/api/projects/{projectId:D}")
            {
                return SelectWorkItemActivityTests.JsonResponse($$"""
                    { "id": "{{projectId:D}}", "key": "TAM", "automationMode": "auto" }
                    """);
            }
            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath == $"/api/work-items/{itemId:D}/status")
            {
                postCalls++;
                var body = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                var doc = JsonDocument.Parse(body).RootElement;
                currentStatus = doc.GetProperty("status").GetString()!;
                capturedActor = doc.GetProperty("actor").GetString();
                version++;
                return SelectWorkItemActivityTests.JsonResponse($$"""
                    { "id": "{{itemId:D}}", "status": "{{currentStatus}}", "version": {{version}} }
                    """);
            }
            return SelectWorkItemActivityTests.JsonResponse("{}", HttpStatusCode.NotFound);
        });

        var factory = new SelectWorkItemActivityTests.SingleHandlerHttpClientFactory(handler);

        // First call: ready -> in_progress (applies transition with actor="loop").
        var first = await UpdateWorkItemStatusActivity.ExecuteCoreAsync(
            "TAM-42", "in_progress", null, "loop", Config(), factory, NullLogger.Instance);
        first.Success.Should().BeTrue();
        first.Applied.Should().BeTrue();
        first.NoOp.Should().BeFalse();
        postCalls.Should().Be(1);
        capturedActor.Should().Be("loop");

        // Second call (re-entry replay): already in_progress -> 0 POSTs, NoOp = true.
        var second = await UpdateWorkItemStatusActivity.ExecuteCoreAsync(
            "TAM-42", "in_progress", null, "loop", Config(), factory, NullLogger.Instance);
        second.Success.Should().BeTrue();
        second.Applied.Should().BeFalse();
        second.NoOp.Should().BeTrue("AC8 / D7: replay to status already held must be an idempotent no-op");
        postCalls.Should().Be(1, "replay must issue ZERO additional POSTs");
    }

    [Test]
    public async Task Automation_off_or_assist_skips_write_back()
    {
        foreach (var mode in new[] { "off", "assist" })
        {
            var itemId = Guid.NewGuid();
            var projectId = Guid.NewGuid();
            var postCalls = 0;

            var handler = new SelectWorkItemActivityTests.StubHttpMessageHandler(req =>
            {
                if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/by-key/"))
                {
                    return SelectWorkItemActivityTests.JsonResponse($$"""
                        { "id": "{{itemId:D}}", "projectId": "{{projectId:D}}", "status": "ready", "version": 1 }
                        """);
                }
                if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/projects/"))
                {
                    return SelectWorkItemActivityTests.JsonResponse($$"""
                        { "id": "{{projectId:D}}", "key": "TAM", "automationMode": "{{mode}}" }
                        """);
                }
                postCalls++;
                return SelectWorkItemActivityTests.JsonResponse("{}");
            });

            var result = await UpdateWorkItemStatusActivity.ExecuteCoreAsync(
                "TAM-1", "in_progress", null, "loop", Config(),
                new SelectWorkItemActivityTests.SingleHandlerHttpClientFactory(handler), NullLogger.Instance);

            result.Success.Should().BeTrue();
            result.Applied.Should().BeFalse();
            result.NoOp.Should().BeTrue($"AC8 / D7: automationMode='{mode}' keeps status write-back off");
            postCalls.Should().Be(0);
        }
    }
}
