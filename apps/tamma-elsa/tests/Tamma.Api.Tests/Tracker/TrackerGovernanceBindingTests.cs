using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Tests.Actions;
using Tamma.Core.Actions;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-3 AC10 &amp; AC11 (D12 / Amendment A3) — verifies that the three new
/// mutating tracker routes (<c>parent</c>, <c>move</c>, <c>apply-ordering</c>)
/// are never added to <see cref="KnownUngovernedEndpoints.All"/>, that the
/// shrink-only ratchet (<see cref="KnownUngovernedEndpoints.PinnedCount"/> /
/// <see cref="KnownUngovernedEndpoints.PinHistory"/>) stayed unmodified, and
/// that all three catalog descriptors carry verbatim <c>:guid</c> SiteKeys at
/// zone level 20. (Live booted-host <c>IActionGateMetadata</c> binding is
/// asserted in <see cref="TrackerRbacTests.New_44_3_routes_carry_IActionGateMetadata"/>
/// and <see cref="GovernedEndpointCoverageSweepTests"/> /
/// <see cref="GovernedEndpointBindingSweepTests"/>.)
/// </summary>
[TestFixture]
public class TrackerGovernanceBindingTests
{
    internal static readonly (string Method, string Pattern, ExternalEffect ExpectedEffect, string ExpectedHandler, ActionRisk ExpectedRisk, int ExpectedMinAutonomy)[]
        NewStory443And444Routes =
        [
            ("POST", "/api/work-items/{id:guid}/parent", ExternalEffect.TrackerWorkItemReparent, "TrackerEndpoints.SetParent", ActionRisk.Mutating, 20),
            ("POST", "/api/work-items/{id:guid}/move", ExternalEffect.TrackerWorkItemMove, "TrackerEndpoints.MoveWorkItem", ActionRisk.Mutating, 20),
            ("POST", "/api/projects/{projectId:guid}/apply-ordering", ExternalEffect.TrackerBacklogApplyOrdering, "TrackerEndpoints.ApplyOrdering", ActionRisk.Mutating, 20),
            ("POST", "/api/projects/{projectId:guid}/iterations", ExternalEffect.TrackerIterationCreate, "TrackerEndpoints.CreateIteration", ActionRisk.Mutating, 20),
            ("PATCH", "/api/iterations/{id:guid}", ExternalEffect.TrackerIterationUpdate, "TrackerEndpoints.PatchIteration", ActionRisk.Mutating, 20),
            ("DELETE", "/api/iterations/{id:guid}", ExternalEffect.TrackerIterationDelete, "TrackerEndpoints.DeleteIteration", ActionRisk.Destructive, 95),
            ("POST", "/api/iterations/{id:guid}/items", ExternalEffect.TrackerIterationCommit, "TrackerEndpoints.CommitIterationItems", ActionRisk.Mutating, 20),
            ("DELETE", "/api/iterations/{id:guid}/items/{workItemId:guid}", ExternalEffect.TrackerIterationUncommit, "TrackerEndpoints.UncommitIterationItem", ActionRisk.Mutating, 20),
            ("POST", "/api/iterations/{id:guid}/apply-plan", ExternalEffect.TrackerIterationApplyPlan, "TrackerEndpoints.ApplySprintPlan", ActionRisk.Mutating, 20),
        ];

    [Test]
    public void New_44_3_and_44_4_routes_are_not_in_KnownUngovernedEndpoints_and_ratchet_is_unmodified()
    {
        foreach (var (method, pattern, _, _, _, _) in NewStory443And444Routes)
        {
            KnownUngovernedEndpoints.All.Should().NotContain(
                e => e.Method == method && e.Pattern == pattern,
                $"'{method} {pattern}' must be born .Governs-bound, never baselined");
        }

        KnownUngovernedEndpoints.PinnedCount.Should().Be(207,
            "44-3/44-4 must NOT modify PinnedCount (shrink-only ratchet)");
        KnownUngovernedEndpoints.PinHistory[^1].Should().Be(KnownUngovernedEndpoints.PinnedCount);
        for (var i = 1; i < KnownUngovernedEndpoints.PinHistory.Length; i++)
        {
            KnownUngovernedEndpoints.PinHistory[i].Should().BeLessThan(
                KnownUngovernedEndpoints.PinHistory[i - 1]);
        }
    }

    [Test]
    public void New_44_3_and_44_4_descriptors_have_exact_SiteKeys_and_issue_tracking_group()
    {
        foreach (var (method, pattern, effect, handler, expectedRisk, expectedMin) in NewStory443And444Routes)
        {
            var key = new ActionKey(ActionNamespace.Effect, effect.ToWire());
            ActionCatalog.ByKey.Should().ContainKey(key);
            var descriptor = ActionCatalog.ByKey[key];
            descriptor.Group.Should().Be(ActionGroup.IssueTracking);
            descriptor.Risk.Should().Be(expectedRisk);
            descriptor.DefaultMinAutonomy.Should().Be(expectedMin);
            descriptor.SiteKey.Should().Be($"{method} {pattern} — {handler}");
        }
    }
}
