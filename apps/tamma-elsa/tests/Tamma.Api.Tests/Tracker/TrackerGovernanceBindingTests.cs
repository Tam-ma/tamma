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
    internal static readonly (string Method, string Pattern, ExternalEffect ExpectedEffect, string ExpectedHandler)[]
        NewStory443Routes =
        [
            ("POST", "/api/work-items/{id:guid}/parent", ExternalEffect.TrackerWorkItemReparent, "TrackerEndpoints.SetParent"),
            ("POST", "/api/work-items/{id:guid}/move", ExternalEffect.TrackerWorkItemMove, "TrackerEndpoints.MoveWorkItem"),
            ("POST", "/api/projects/{projectId:guid}/apply-ordering", ExternalEffect.TrackerBacklogApplyOrdering, "TrackerEndpoints.ApplyOrdering"),
        ];

    [Test]
    public void New_44_3_routes_are_not_in_KnownUngovernedEndpoints_and_ratchet_is_unmodified()
    {
        foreach (var (method, pattern, _, _) in NewStory443Routes)
        {
            KnownUngovernedEndpoints.All.Should().NotContain(
                e => e.Method == method && e.Pattern == pattern,
                $"AC11: '{method} {pattern}' must be born .Governs-bound, never baselined");
        }

        KnownUngovernedEndpoints.PinnedCount.Should().Be(207,
            "AC11: 44-3 must NOT modify PinnedCount (shrink-only ratchet)");
        KnownUngovernedEndpoints.PinHistory[^1].Should().Be(KnownUngovernedEndpoints.PinnedCount);
        for (var i = 1; i < KnownUngovernedEndpoints.PinHistory.Length; i++)
        {
            KnownUngovernedEndpoints.PinHistory[i].Should().BeLessThan(
                KnownUngovernedEndpoints.PinHistory[i - 1]);
        }
    }

    [Test]
    public void New_44_3_descriptors_have_exact_SiteKeys_and_issue_tracking_group()
    {
        foreach (var (method, pattern, effect, handler) in NewStory443Routes)
        {
            var key = new ActionKey(ActionNamespace.Effect, effect.ToWire());
            ActionCatalog.ByKey.Should().ContainKey(key);
            var descriptor = ActionCatalog.ByKey[key];
            descriptor.Group.Should().Be(ActionGroup.IssueTracking);
            descriptor.Risk.Should().Be(ActionRisk.Mutating);
            descriptor.DefaultMinAutonomy.Should().Be(20);
            descriptor.SiteKey.Should().Be($"{method} {pattern} — {handler}");
        }
    }
}
