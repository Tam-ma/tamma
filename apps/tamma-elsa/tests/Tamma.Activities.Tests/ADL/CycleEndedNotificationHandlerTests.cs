using System.Text.Json;
using Elsa.Workflows;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.ADL;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 40-4 — the rules behind CYCLE.ENDED (the re-entry attempt boundary). The end-to-end
/// proof that a finished cycle writes it is in <c>SingleIssueCycleCrashReEntryTests</c>.
/// </summary>
[TestFixture]
public class CycleEndedNotificationHandlerTests
{
    [Test]
    public void Only_a_normally_finished_cycle_is_an_end()
    {
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Finished, WorkflowSubStatus.Finished)
            .Should().BeTrue();
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Finished, WorkflowSubStatus.Cancelled)
            .Should().BeFalse("the orphan sweep cancels crash-stranded cycles; those are crashes");
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Finished, WorkflowSubStatus.Faulted)
            .Should().BeFalse();
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Running, WorkflowSubStatus.Suspended)
            .Should().BeFalse();
        CycleEndedNotificationHandler.IsCleanEnd("merge-approval", WorkflowStatus.Finished, WorkflowSubStatus.Finished)
            .Should().BeFalse("only the coding cycle has a task loop to re-enter");
    }

    [Test]
    public void The_cycle_identity_round_trips_through_the_instance_properties()
    {
        var props = new Dictionary<string, object>();
        CycleEndedNotificationHandler.RememberCycle(props, 42, "acme/widgets", "t-1");

        // As stored and reloaded by the workflow store: values come back as JSON strings.
        var reloaded = JsonSerializer.Deserialize<Dictionary<string, object>>(JsonSerializer.Serialize(props))!;

        foreach (var bag in new[] { props, reloaded })
        {
            CycleEndedNotificationHandler.TryReadCycle(bag, out var issue, out var repo, out var tenant).Should().BeTrue();
            issue.Should().Be(42);
            repo.Should().Be("acme/widgets");
            tenant.Should().Be("t-1");
        }
    }

    [Test]
    public void No_identity_means_no_end_row()
    {
        var props = new Dictionary<string, object>();
        CycleEndedNotificationHandler.RememberCycle(props, 0, "acme/widgets", null);
        CycleEndedNotificationHandler.TryReadCycle(props, out _, out _, out _).Should().BeFalse();
    }
}
