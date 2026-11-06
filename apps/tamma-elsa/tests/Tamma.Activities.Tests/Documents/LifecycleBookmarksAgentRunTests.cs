using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Documents;

namespace Tamma.Activities.Tests.Documents;

/// <summary>
/// Story 40-2 (AC2, AC6) — the agent-run bookmark name and its canonical-registry entry.
/// </summary>
[TestFixture]
public class LifecycleBookmarksAgentRunTests
{
    [Test]
    public void ForAgentRun_SameInputs_ByteIdentical()
    {
        var a = LifecycleBookmarks.ForAgentRun("t-1", "acme/widgets", "tamma/issue-42", "adl-42-task-0");
        var b = LifecycleBookmarks.ForAgentRun("t-1", "acme/widgets", "tamma/issue-42", "adl-42-task-0");
        a.Should().Be(b);
    }

    [Test]
    public void ForAgentRun_IsComposeBuilt_WithTheAgentRunGate()
    {
        LifecycleBookmarks.ForAgentRun("T-1", "Acme/Widgets", "tamma/issue-42", "adl-42-task-0")
            .Should().Be(LifecycleBookmarks.Compose("agent-run", "T-1", "Acme/Widgets", "tamma/issue-42", "adl-42-task-0"))
            .And.Be("agent-run-t_1-acme_widgets-tamma_issue_42-adl_42_task_0");
    }

    [Test]
    public void ForAgentRun_DifferentTenants_DisjointNames()
    {
        LifecycleBookmarks.ForAgentRun("tenant-a", "acme/w", "b", "s")
            .Should().NotBe(LifecycleBookmarks.ForAgentRun("tenant-b", "acme/w", "b", "s"));
    }

    [Test]
    public void ForAgentRun_NullTenant_UsesNoneSegment()
    {
        LifecycleBookmarks.ForAgentRun(null, "acme/w", "b", "s").Should().Be("agent-run-none-acme_w-b-s");
        LifecycleBookmarks.ForAgentRun("", "acme/w", "b", "s").Should().Be("agent-run-none-acme_w-b-s");
    }

    [Test]
    public void ForAgentRun_HostileCharacters_AreNormalized()
    {
        var name = LifecycleBookmarks.ForAgentRun("x y", "a/b;drop", "feat/*", "s\n1");
        name.Should().MatchRegex("^[a-z0-9._-]+$");
    }

    [Test]
    public void CanonicalSuspendActivities_RegistersWaitForAgentRun_UnderAgentRun()
    {
        LifecycleBookmarks.CanonicalSuspendActivities.Should()
            .ContainKey(typeof(WaitForAgentRunActivity))
            .WhoseValue.Should().Be("agent-run");
    }

    [Test]
    public void CanonicalSuspendActivities_HasExactlyThreeEntries()
    {
        // A conscious count: a fourth suspend point must be a visible edit here.
        LifecycleBookmarks.CanonicalSuspendActivities.Keys.Should().BeEquivalentTo(new[]
        {
            typeof(WaitForDocumentDecisionActivity),
            typeof(WaitForDocumentInputActivity),
            typeof(WaitForAgentRunActivity),
        });
    }

    [Test]
    public void ExecuteAgentActivity_IsNotACanonicalSuspendPoint()
    {
        LifecycleBookmarks.CanonicalSuspendActivities.Should().NotContainKey(typeof(ExecuteAgentActivity));
    }
}
