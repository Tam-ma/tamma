using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Endpoints;
using Tamma.Core.Actions;
using Tamma.Core.Documents.Policy;

namespace Tamma.Api.Tests.Actions;

/// <summary>
/// Story 43-6 — <see cref="ActionPolicyEndpoints.PreservingGroupThreshold"/>:
/// the threshold a FIRST group-enforce write materializes must leave every
/// member's effective threshold where it is, or there must be none.
/// </summary>
[TestFixture]
public class GroupEnforceMaterializationTests
{
    private static Dictionary<string, ActionAssignmentValue> Rows(params (string Key, int Min)[] rows) =>
        rows.ToDictionary(r => r.Key, r => new ActionAssignmentValue(r.Min, null, null, null), StringComparer.Ordinal);

    private static GovernancePolicySnapshot Snapshot(
        Dictionary<string, ActionAssignmentValue>? platformActions = null,
        Dictionary<string, ActionAssignmentValue>? platformGroups = null,
        Dictionary<string, ActionAssignmentValue>? principalActions = null) =>
        GovernancePolicySnapshot.FromSuccessfulRead(
            platformActions ?? Rows(), platformGroups ?? Rows(), principalActions ?? Rows(), Rows());

    private static IReadOnlyList<ActionDescriptor> DialMembers(ActionGroup g) =>
        ActionCatalog.ByGroup[g].Select(k => ActionCatalog.ByKey[k])
            .Where(d => d.Enforceable && !d.IsMachinery).ToList();

    [Test]
    public void ASingleLevelGroup_MaterializesThatLevel()
    {
        var only = DialMembers(ActionGroup.CodeWrite).Should().ContainSingle().Subject;
        ActionPolicyEndpoints.PreservingGroupThreshold(ActionGroup.CodeWrite, Snapshot())
            .Should().Be(only.DefaultMinAutonomy);
    }

    [Test]
    public void AMixedLevelGroup_HasNoPreservingValue()
    {
        DialMembers(ActionGroup.DeployControl).Select(d => d.DefaultMinAutonomy).Distinct()
            .Should().HaveCountGreaterThan(1, "the premise: deploy-control members sit at different levels");
        ActionPolicyEndpoints.PreservingGroupThreshold(ActionGroup.DeployControl, Snapshot())
            .Should().BeNull();
    }

    [Test]
    public void MembersWithAnActionThreshold_AreUnconstrained()
    {
        var members = DialMembers(ActionGroup.DeployControl);
        var kept = members[0];
        var pinned = Rows(members.Skip(1).Select(d => (d.Key.ToWire(), 50)).ToArray());

        ActionPolicyEndpoints.PreservingGroupThreshold(
                ActionGroup.DeployControl, Snapshot(principalActions: pinned))
            .Should().Be(kept.DefaultMinAutonomy, "an action row beats the group row");
    }

    [Test]
    public void MembersHeldAtACeiling_OnlyBoundTheValue()
    {
        // A group ceiling at AlwaysHuman holds every member there, so any value
        // ≤ the ceiling preserves them all; the highest such value is chosen.
        ActionPolicyEndpoints.PreservingGroupThreshold(
                ActionGroup.DeployControl,
                Snapshot(platformGroups: Rows((ActionGroup.DeployControl.ToWire(), AutonomyDial.AlwaysHuman))))
            .Should().Be(AutonomyDial.AlwaysHuman);
    }

    [Test]
    public void ACeilingAboveTheShippedLevel_Bounds_ACeilingBelowIt_Pins()
    {
        // code-write's member ships at L. A ceiling on it ABOVE L holds it at the
        // ceiling (bound only); a ceiling BELOW L leaves it at L (pins T = L).
        var member = DialMembers(ActionGroup.CodeWrite).Single();
        var wire = member.Key.ToWire();

        ActionPolicyEndpoints.PreservingGroupThreshold(
                ActionGroup.CodeWrite, Snapshot(platformActions: Rows((wire, member.DefaultMinAutonomy + 10))))
            .Should().Be(member.DefaultMinAutonomy + 10);
        ActionPolicyEndpoints.PreservingGroupThreshold(
                ActionGroup.CodeWrite, Snapshot(platformActions: Rows((wire, AutonomyDial.Min))))
            .Should().Be(member.DefaultMinAutonomy);
    }

    [Test]
    public void EveryMaterializedValue_LeavesEveryMemberWhereItWas()
    {
        // The property itself, over every shipped group with no rows.
        foreach (var group in Enum.GetValues<ActionGroup>())
        {
            var t = ActionPolicyEndpoints.PreservingGroupThreshold(group, Snapshot());
            if (t is not int threshold) continue;

            var withRow = GovernancePolicySnapshot.FromSuccessfulRead(
                Rows(), Rows(), Rows(),
                Rows((group.ToWire(), threshold)));
            foreach (var d in DialMembers(group))
            {
                AutonomyGateEvaluator.ResolveEffectiveMinAutonomy(d, withRow).EffectiveMinAutonomy
                    .Should().Be(AutonomyGateEvaluator.ResolveEffectiveMinAutonomy(d, Snapshot()).EffectiveMinAutonomy,
                        $"{d.Key.ToWire()} in group '{group.ToWire()}'");
            }
        }
    }
}
