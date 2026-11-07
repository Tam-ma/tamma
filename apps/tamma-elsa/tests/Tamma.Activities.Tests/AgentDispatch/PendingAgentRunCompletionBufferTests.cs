using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;

namespace Tamma.Activities.Tests.AgentDispatch;

/// <summary>
/// A buffered completion may only satisfy the dispatch it belongs to. Session ids (and so
/// bookmark names) are fixed per issue + task, so a re-dispatch of the same task within the
/// buffer's hour would otherwise consume the previous run's result.
/// </summary>
[TestFixture]
public class PendingAgentRunCompletionBufferTests
{
    private const string Name = "agent-run-test";

    private static Dictionary<string, object> Completion(long runId, DateTime? runCreatedAt = null)
        => AgentRunCompletionSignal.ToInput(
            new AgentMonitorResult(runId, "completed", "success", "u", 60, "a"), runCreatedAt: runCreatedAt);

    [Test]
    public void Unarmed_name_behaves_as_before()
    {
        var buffer = new PendingAgentRunCompletionBuffer();
        buffer.Record(Name, Completion(1));

        buffer.TryConsume(Name, out var input).Should().BeTrue();
        AgentRunCompletionSignal.TryRead(input, out var r).Should().BeTrue();
        r.WorkflowRunId.Should().Be(1);
    }

    [Test]
    public void Arming_drops_a_completion_recorded_before_the_dispatch_began()
    {
        var buffer = new PendingAgentRunCompletionBuffer();
        buffer.Record(Name, Completion(1));

        buffer.Arm(Name, DateTimeOffset.UtcNow.AddSeconds(1));

        buffer.TryConsume(Name, out _).Should().BeFalse("it was recorded before this dispatch started");
    }

    [Test]
    public void A_completion_recorded_after_the_dispatch_began_is_consumed()
    {
        var buffer = new PendingAgentRunCompletionBuffer();
        buffer.Arm(Name, DateTimeOffset.UtcNow.AddSeconds(-1));
        buffer.Record(Name, Completion(2, runCreatedAt: DateTime.UtcNow));

        buffer.TryConsume(Name, out var input).Should().BeTrue();
        AgentRunCompletionSignal.TryRead(input, out var r).Should().BeTrue();
        r.WorkflowRunId.Should().Be(2);
    }

    [Test]
    public void A_run_created_before_the_armed_dispatch_is_rejected_even_if_recorded_after_it()
    {
        var buffer = new PendingAgentRunCompletionBuffer();
        var dispatchedAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        buffer.Arm(Name, dispatchedAt);
        buffer.Record(Name, Completion(1, runCreatedAt: dispatchedAt.UtcDateTime.AddMinutes(-5)));

        buffer.TryConsume(Name, out _).Should().BeFalse();
        buffer.TryConsume(Name, out _).Should().BeFalse("a rejected entry is removed, never retried");
    }

    [Test]
    public void The_armed_floor_also_applies_to_the_bookmark_persisted_reconcile_path()
    {
        // ReconcileBufferedAgentRunHandler calls TryConsume with only the name.
        var buffer = new PendingAgentRunCompletionBuffer();
        var dispatchedAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        buffer.Arm(Name, dispatchedAt);
        buffer.Record(Name, Completion(1, runCreatedAt: dispatchedAt.UtcDateTime.AddMinutes(-5)));
        buffer.Record("agent-run-other", Completion(3, runCreatedAt: dispatchedAt.UtcDateTime.AddMinutes(-5)));

        buffer.TryConsume(Name, out _).Should().BeFalse();
        buffer.TryConsume("agent-run-other", out _).Should().BeTrue("the floor is per bookmark name");
    }
}
