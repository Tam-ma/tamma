using FluentAssertions;
using NUnit.Framework;
using Tamma.Core.Actions;
using Tamma.Core.Documents.Policy;

namespace Tamma.Core.Tests.Actions;

/// <summary>
/// Story 43-6 (2026-11-07) — the catalog member that
/// <c>PUT /api/actions/policy/groups/{group}/enforce</c> is bound to, and the
/// group <c>enforce</c> field that route writes.
///
/// <para>The member is machinery so it never gates on the dial, but
/// <c>enabled=false</c> still denies a NON-human caller (43-13: the machinery
/// short-circuit sits after the enabled check). A person is never denied: the
/// Human short-circuit runs before any row is read.</para>
/// </summary>
[TestFixture]
public class GroupEnforceMemberTests
{
    private static readonly ActionKey Member =
        new(ActionNamespace.Effect, ExternalEffect.GovernancePolicyGroupEnforceSet.ToWire());

    private static readonly GovernancePrincipal User = GovernancePrincipal.ForUser(Guid.NewGuid());

    private static ResolvedAcceptanceRules BaseRules(int dial) =>
        new(AcceptanceDefaults.Rules with { AutonomyLevel = dial },
            AcceptanceRulesSource.SystemDefault, 1, "base", DateTimeOffset.UtcNow);

    private static Dictionary<string, ActionAssignmentValue> NoRows() => new(StringComparer.Ordinal);

    private static GovernancePolicySnapshot Snapshot(
        Dictionary<string, ActionAssignmentValue>? principalActions = null,
        Dictionary<string, ActionAssignmentValue>? principalGroups = null) =>
        GovernancePolicySnapshot.FromSuccessfulRead(
            NoRows(), NoRows(), principalActions ?? NoRows(), principalGroups ?? NoRows());

    private static GovernancePolicySnapshot MemberRow(bool? enabled) => Snapshot(
        principalActions: new(StringComparer.Ordinal)
        {
            [Member.ToWire()] = new(AutonomyDial.AlwaysHuman, Enforce: true, Enabled: enabled, AllowedRoles: null),
        });

    [Test]
    public void TheMember_IsMachinery_InPlatformAutomation_Mutating_Reversible_BoundToTheRoute()
    {
        var d = ActionCatalog.ByKey[Member];
        d.IsMachinery.Should().BeTrue();
        d.Group.Should().Be(ActionGroup.PlatformAutomation);
        d.Risk.Should().Be(ActionRisk.Mutating);
        d.Reversible.Should().BeTrue();
        d.SiteKey.Should().StartWith("PUT /api/actions/policy/groups/{group}/enforce ");
    }

    [Test]
    public void AnLlmCaller_IsAutomated_EvenAgainstAnAlwaysHumanRow_AtDialMin()
    {
        var decision = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(Member, User, Caller: CallerKind.Llm),
            MemberRow(enabled: null), BaseRules(AutonomyDial.Min));

        decision.Outcome.Should().Be(AutonomyOutcome.Automated);
        decision.Reason.Should().Be(AutonomyGateEvaluator.ReasonMachineryNotDialGoverned);
    }

    [Test]
    public void EnabledFalse_DeniesANonHumanCaller()
    {
        var decision = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(Member, User, Caller: CallerKind.Llm),
            MemberRow(enabled: false), BaseRules(AutonomyDial.Max));

        decision.Outcome.Should().Be(AutonomyOutcome.Denied,
            "machinery bypasses the dial, not the admin's off-switch");
        decision.Reason.Should().Be(AutonomyGateEvaluator.ReasonDisabled);
    }

    [Test]
    public void EnabledFalse_NeverDeniesAPerson()
    {
        var decision = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(Member, User, Caller: CallerKind.Human),
            MemberRow(enabled: false), BaseRules(AutonomyDial.Max));

        decision.Outcome.Should().Be(AutonomyOutcome.Automated,
            "an admin can never lock themselves out of the policy screen");
        decision.Reason.Should().Be(AutonomyGateEvaluator.ReasonCallerHuman);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void AGroupEnforceValue_ReachesAMemberWithNoActionRow(bool enforce)
    {
        var decision = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(ActionKey.Parse("tool:file_write"), User),
            Snapshot(principalGroups: new(StringComparer.Ordinal)
            {
                [ActionGroup.CodeWrite.ToWire()] = new(25, Enforce: enforce, Enabled: null, AllowedRoles: null),
            }),
            BaseRules(AcceptanceDefaults.DefaultAutonomyLevel));

        decision.Enforced.Should().Be(enforce);
    }
}
