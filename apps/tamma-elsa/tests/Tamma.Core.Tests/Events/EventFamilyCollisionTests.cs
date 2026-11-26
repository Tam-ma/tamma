using FluentAssertions;
using NUnit.Framework;

namespace Tamma.Core.Tests.Events;

/// <summary>
/// Story 44-5 AC10 (D1) — family-collision guard asserting that no constant
/// introduced by Epic 44 (<c>Services/Tracker/*Events.cs</c>) reuses any
/// already-taken top-level prefix, naming each incumbent file explicitly.
/// </summary>
[TestFixture]
public class EventFamilyCollisionTests
{
    private static readonly (string Prefix, string IncumbentFile)[] TakenPrefixes =
    [
        ("CYCLE.", "apps/tamma-elsa/src/Tamma.Activities/ADL/CycleEvents.cs"),
        ("SPRINT.", "docs/stories/epic-41 (Story 41-6 SprintPlan document lifecycle)"),
        ("TASK.", "apps/tamma-elsa/src/Tamma.Activities/Documents/ChannelEvents.cs (reserved for Story 39-20)"),
        ("ISSUE.", "apps/tamma-elsa/src/Tamma.Activities/ADL/MergeEvents.cs"),
        ("ISSUE_STATUS.", "apps/tamma-elsa/src/Tamma.Activities/ADL/IssueStatusEvents.cs"),
    ];

    [Test]
    public void No_taken_prefix_is_reused()
    {
        var trackerConstants = EventTypeNamingRatchetTests.ScanScopedEventConstants()
            .Where(c => c.FilePath.StartsWith(
                "apps/tamma-elsa/src/Tamma.Api/Services/Tracker/",
                StringComparison.Ordinal))
            .ToList();

        trackerConstants.Should().NotBeEmpty(
            "Epic 44 defines ProjectEvents, WorkItemEvents, and IterationEvents under Services/Tracker/");

        foreach (var (prefix, incumbent) in TakenPrefixes)
        {
            var collisions = trackerConstants
                .Where(c => c.Value.StartsWith(prefix, StringComparison.Ordinal))
                .ToList();

            collisions.Should().BeEmpty(
                $"AC10: Epic 44 must NEVER emit '{prefix}*' — that prefix is already owned by {incumbent}. "
                + $"Found: {string.Join(", ", collisions.Select(c => $"{c.FilePath}:{c.Line} {c.Value}"))}");
        }
    }
}
