using System.Text.Json;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;

namespace Tamma.Activities.Tests.AgentDispatch;

/// <summary>
/// Story 40-2 (AC5) — the agent-run completion payload read-back must survive a serializing
/// runtime (the #15/#437 lesson): boxed / string / JsonElement, truthy and falsy, and a
/// missing or unparseable payload fails closed.
/// </summary>
[TestFixture]
public class WaitForAgentRunReadBackTests
{
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private static Dictionary<string, object> Payload(object completed, object runId) => new()
    {
        [AgentRunCompletionSignal.Completed] = completed,
        [AgentRunCompletionSignal.WorkflowRunId] = runId,
        [AgentRunCompletionSignal.Conclusion] = "success",
        [AgentRunCompletionSignal.ArtifactsUrl] = "https://api.github.test/artifacts",
    };

    private static IEnumerable<object> Truthy() => new object[] { true, "true", "True", Json("true") };
    private static IEnumerable<object> Falsy() => new object[] { false, "false", "False", Json("false"), "yes", 1 };

    [TestCaseSource(nameof(Truthy))]
    public void Completed_Truthy_Reads(object completed)
    {
        AgentRunCompletionSignal.TryRead(Payload(completed, 77L), out var r).Should().BeTrue();
        r.WorkflowRunId.Should().Be(77);
        r.Conclusion.Should().Be("success");
    }

    [TestCaseSource(nameof(Falsy))]
    public void Completed_Falsy_FailsClosed(object completed)
    {
        AgentRunCompletionSignal.TryRead(Payload(completed, 77L), out _).Should().BeFalse();
    }

    [Test]
    public void RunId_ToleratesBoxedStringAndJsonElement()
    {
        foreach (var runId in new object[] { 77L, 77, "77", Json("77"), Json("\"77\"") })
        {
            AgentRunCompletionSignal.TryRead(Payload(true, runId), out var r).Should().BeTrue($"run id {runId} ({runId.GetType().Name})");
            r.WorkflowRunId.Should().Be(77);
        }
    }

    [Test]
    public void StringFields_ToleratesJsonElement()
    {
        var input = new Dictionary<string, object>
        {
            [AgentRunCompletionSignal.Completed] = Json("true"),
            [AgentRunCompletionSignal.WorkflowRunId] = Json("5"),
            [AgentRunCompletionSignal.Conclusion] = Json("\"failure\""),
            [AgentRunCompletionSignal.WorkflowRunUrl] = Json("\"https://gh.test/run/5\""),
            [AgentRunCompletionSignal.DurationSeconds] = Json("120"),
        };
        AgentRunCompletionSignal.TryRead(input, out var r).Should().BeTrue();
        r.Conclusion.Should().Be("failure");
        r.WorkflowRunUrl.Should().Be("https://gh.test/run/5");
        r.DurationSeconds.Should().Be(120);
        r.Status.Should().Be("completed");
    }

    [Test]
    public void MissingOrUnparseable_FailsClosed()
    {
        AgentRunCompletionSignal.TryRead(null, out _).Should().BeFalse();
        AgentRunCompletionSignal.TryRead(new Dictionary<string, object>(), out _).Should().BeFalse();
        AgentRunCompletionSignal.TryRead(Payload(true, "not-a-number"), out _).Should().BeFalse();
        AgentRunCompletionSignal.TryRead(Payload(true, 0L), out _).Should().BeFalse();
        AgentRunCompletionSignal.TryRead(Payload(true, -3L), out _).Should().BeFalse();
        AgentRunCompletionSignal.TryRead(new Dictionary<string, object> { [AgentRunCompletionSignal.WorkflowRunId] = 5L }, out _)
            .Should().BeFalse("a payload that does not assert completion is not a completion");
    }

    [Test]
    public void ToInput_RoundTrips()
    {
        var m = new AgentMonitorResult(9, "completed", "success", "https://u", 30, "https://a");
        AgentRunCompletionSignal.TryRead(AgentRunCompletionSignal.ToInput(m), out var r).Should().BeTrue();
        r.Should().Be(m);
    }
}
