using FluentAssertions;
using Microsoft.Extensions.Configuration;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Core.Tracking;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC7 (Tests 7 &amp; 8) — <see cref="TrackerIntakeSource"/> honours
/// the tracker's own model: <c>AutomationMode</c> gate (default <c>off</c> yields
/// nothing), <c>ready</c> status filter, <c>Rank</c>-then-priority ordering,
/// <c>Source = tracker</c>, <c>Key = WorkItemRef.ToWire()</c>, and <c>Number = 0</c>.
/// </summary>
[TestFixture]
public class TrackerIntakeSourceTests
{
    private static IConfiguration Config() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tamma:ApiUrl"] = "http://api.test",
        })
        .Build();

    [Test]
    public async Task Selects_ready_items_by_rank_then_priority()
    {
        var projectId = Guid.NewGuid();
        var handler = new SelectWorkItemActivityTests.StubHttpMessageHandler(req =>
        {
            if (req.RequestUri!.AbsolutePath == "/api/projects")
            {
                return SelectWorkItemActivityTests.JsonResponse($$"""
                    [
                      { "id": "{{projectId:D}}", "key": "TAM", "automationMode": "auto" }
                    ]
                    """);
            }

            req.RequestUri!.AbsolutePath.Should().Be("/api/work-items");
            req.RequestUri!.Query.Should().Contain("status=ready");

            return SelectWorkItemActivityTests.JsonResponse($$"""
                {
                  "items": [
                    {
                      "id": "{{Guid.NewGuid():D}}",
                      "projectId": "{{projectId:D}}",
                      "key": "TAM-3",
                      "kind": "task",
                      "issueType": "feature",
                      "priority": "urgent",
                      "title": "Lower rank despite urgent",
                      "rank": "V",
                      "createdAt": "2026-07-10T00:00:00Z"
                    },
                    {
                      "id": "{{Guid.NewGuid():D}}",
                      "projectId": "{{projectId:D}}",
                      "key": "TAM-1",
                      "kind": "task",
                      "issueType": "bug",
                      "priority": "low",
                      "title": "Same top rank, lower priority",
                      "rank": "A",
                      "createdAt": "2026-07-01T00:00:00Z"
                    },
                    {
                      "id": "{{Guid.NewGuid():D}}",
                      "projectId": "{{projectId:D}}",
                      "key": "TAM-2",
                      "kind": "story",
                      "issueType": null,
                      "priority": "high",
                      "title": "Same top rank, higher priority (wins)",
                      "rank": "A",
                      "createdAt": "2026-07-05T00:00:00Z"
                    }
                  ],
                  "nextCursor": null,
                  "visibilityMode": "tenant"
                }
                """);
        });

        var source = new TrackerIntakeSource(
            new SelectWorkItemActivityTests.SingleHandlerHttpClientFactory(handler), Config());

        var result = await source.FetchAsync(new WorkIntakeQuery("Tam-ma/tamma", ["tamma-auto"], [], "tamma-bot"));

        result.Failed.Should().BeFalse();
        result.Candidates.Select(c => c.Key).Should().Equal(["TAM-2", "TAM-1", "TAM-3"],
            "AC7 / D6: ordered by Rank (ordinal) first ('A' before 'V'), then priority ('high' before 'low')");
        result.Candidates.Should().OnlyContain(c => c.Source == WorkIntakeSourceKind.Tracker);
        result.Candidates.Should().OnlyContain(c => c.Number == 0, "AC9/D3: native tracker items carry IssueNumber = 0");
    }

    [Test]
    public async Task Automation_off_yields_nothing()
    {
        var workItemsCalled = false;
        var handler = new SelectWorkItemActivityTests.StubHttpMessageHandler(req =>
        {
            if (req.RequestUri!.AbsolutePath == "/api/projects")
            {
                return SelectWorkItemActivityTests.JsonResponse($$"""
                    [
                      { "id": "{{Guid.NewGuid():D}}", "key": "OFF", "automationMode": "off" }
                    ]
                    """);
            }
            workItemsCalled = true;
            return SelectWorkItemActivityTests.JsonResponse("""{ "items": [] }""");
        });

        var source = new TrackerIntakeSource(
            new SelectWorkItemActivityTests.SingleHandlerHttpClientFactory(handler), Config());

        var result = await source.FetchAsync(new WorkIntakeQuery("Tam-ma/tamma", ["tamma-auto"], [], "tamma-bot"));

        result.Failed.Should().BeFalse();
        result.Candidates.Should().BeEmpty("AC7 / D6: projects with default automationMode='off' yield nothing");
        workItemsCalled.Should().BeFalse("no /api/work-items call should be made for opted-out projects");
    }
}
