using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Core;
using Tamma.Core.Tracking;
using Tamma.ElsaServer.Workflows.Helpers;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC3/AC5 (Tests 5, 6, 10) — fail-loud keyed registry + platform
/// key byte-identity pin (no lineage migration).
/// </summary>
[TestFixture]
public class WorkIntakeSourceRegistryTests
{
    [Test]
    public void Unknown_source_throws_naming_the_set()
    {
        var registry = new WorkIntakeSourceRegistry(
        [
            new StubSource(WorkIntakeSourceKind.PlatformIssue),
            new StubSource(WorkIntakeSourceKind.Tracker),
        ]);

        var act = () => registry.ResolveConfigured(["jira-magic"]);
        act.Should().Throw<TammaError>()
            .Which.Message.Should()
            .Contain("platform-issue")
            .And.Contain("tracker");
    }

    [Test]
    public void Duplicate_key_throws_at_startup()
    {
        var act = () => new WorkIntakeSourceRegistry(
        [
            new StubSource(WorkIntakeSourceKind.Tracker),
            new StubSource(WorkIntakeSourceKind.Tracker),
        ]);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*Duplicate*tracker*");
    }

    [Test]
    public void Key_is_byte_identical_to_today()
    {
        // D5 / Test 10: PlatformIssueIntakeSource's WorkItem.Key must be byte-identical
        // to CreationBindingHelper.DeriveIssueId and PlanBindingHelper.DeriveIssueId
        // so zero existing DocumentInstance.IssueId lineage moves.
        const string repo = "Tam-ma/tamma";
        const int number = 42;

        var key = PlatformIssueIntakeSource.FormatPlatformKey(repo, number);
        key.Should().Be(CreationBindingHelper.DeriveIssueId(repo, number));
        key.Should().Be(PlanBindingHelper.DeriveIssueId(repo, number));
        key.Should().Be("Tam-ma/tamma#42");
    }

    private sealed class StubSource(WorkIntakeSourceKind kind) : IWorkIntakeSource
    {
        public WorkIntakeSourceKind Kind { get; } = kind;
        public Task<WorkIntakeResult> FetchAsync(WorkIntakeQuery query, CancellationToken ct = default) =>
            Task.FromResult(new WorkIntakeResult([]));
    }
}
