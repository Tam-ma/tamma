using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.AgentDispatch;

/// <summary>Story 40-6 — the small pieces the wait events depend on.</summary>
[TestFixture]
public class AgentRunWaitHelpersTests
{
    // ── TaskSessionId: the re-entry join key ──────────────────────────────

    [Test]
    public void SessionId_format_is_frozen()
        => TaskSessionId.For(42, 3).Should().Be("adl-42-task-3");

    [Test]
    public void SessionId_round_trips()
    {
        TaskSessionId.TryParse(TaskSessionId.For(1234, 17), out var issue, out var index).Should().BeTrue();
        issue.Should().Be(1234);
        index.Should().Be(17);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("adl-42-task-")]
    [TestCase("adl--task-1")]
    [TestCase("adl-42-task-1-extra")]
    [TestCase(" adl-42-task-1")]
    [TestCase("adl-42-task--1")]
    [TestCase("adl-x-task-1")]
    [TestCase("adl-9999999999-task-1")]
    public void SessionId_rejects_anything_else(string? raw)
        => TaskSessionId.TryParse(raw, out _, out _).Should().BeFalse();

    // ── Wake path ─────────────────────────────────────────────────────────

    [TestCase(null, "webhook")]
    [TestCase("", "webhook")]
    [TestCase("webhook", "webhook")]
    [TestCase("poll", "poll")]
    [TestCase("local", "local")]
    [TestCase(" poll ", "poll")]
    [TestCase("anything-else", "webhook")]
    public void WakePath_is_normalised(string? raw, string expected)
        => AgentRunCompletionSignal.NormalizeWakePath(raw).Should().Be(expected);

    [Test]
    public void ToInput_carries_the_wake_path_and_defaults_to_webhook()
    {
        var m = new AgentMonitorResult(1, "completed", "success", "u", 1, "a");
        AgentRunCompletionSignal.ReadWakePath(AgentRunCompletionSignal.ToInput(m)).Should().Be("webhook");
        AgentRunCompletionSignal.ReadWakePath(AgentRunCompletionSignal.ToInput(m, "poll")).Should().Be("poll");
        AgentRunCompletionSignal.ReadWakePath(null).Should().Be("webhook");
    }

    // ── The task id the workflow records per index ────────────────────────

    [TestCase("{\"id\":\"T1\",\"description\":\"x\"}", "T1")]
    [TestCase("{\"id\":\"  \"}", null)]
    [TestCase("{\"id\":7}", null)]
    [TestCase("{\"description\":\"no id\"}", null)]
    [TestCase("[]", null)]
    [TestCase("{}", null)]
    [TestCase("not json", null)]
    [TestCase("", null)]
    [TestCase(null, null)]
    public void ReadTaskId(string? json, string? expected)
        => SingleIssueCycleWorkflow.ReadTaskId(json).Should().Be(expected);
}
