using FluentAssertions;
using NUnit.Framework;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC9 (D3) originally pinned a SHA-256 hash of <c>SingleIssueCycleWorkflow.cs</c>
/// to guarantee Story 44-7 stayed out of the contended <c>40-2 → 40-4 → 40-5 → 41-29</c>
/// merge chain. Story 41-29 is the intended final writer in that chain; this guard now
/// asserts that Story 44-7's tracker intake remains decoupled from <c>SingleIssueCycleWorkflow</c>
/// (zero references to <c>TrackerIntakeSource</c> / <c>IWorkIntakeSource</c> in the cycle).
/// </summary>
[TestFixture]
public class SingleIssueCycleUntouchedTests
{
    [Test]
    public void SingleIssueCycleWorkflow_remains_decoupled_from_tracker_intake_sources()
    {
        var path = LocateSingleIssueCycleWorkflow();
        var text = File.ReadAllText(path);

        text.Should().NotContain("TrackerIntakeSource",
            "Story 44-7 tracker intake stays outside SingleIssueCycleWorkflow");
        text.Should().NotContain("IWorkIntakeSource",
            "Story 44-7 intake abstraction stays outside SingleIssueCycleWorkflow");
        typeof(SingleIssueCycleWorkflow).Should().NotBeNull();
    }

    private static string LocateSingleIssueCycleWorkflow()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(
                dir.FullName, "apps", "tamma-elsa", "src", "Tamma.ElsaServer",
                "Workflows", "SingleIssueCycleWorkflow.cs");
            if (File.Exists(candidate))
                return candidate;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("Could not locate SingleIssueCycleWorkflow.cs.");
    }
}
