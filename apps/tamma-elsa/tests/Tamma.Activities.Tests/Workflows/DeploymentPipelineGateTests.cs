using Elsa.Expressions.Models;
using Elsa.Extensions;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Memory;
using Elsa.Workflows.Runtime.Activities;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.Policy;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// The deployment pipeline's production-approval decision, routed on
/// <see cref="CheckActionGateActivity"/>'s answer for <c>effect:deploy.prod</c>
/// (Story 43-9 Seam E, re-based by the owner directive of 2026-08-18: <b>the
/// dial DECIDES</b> — automated → orchestrator deploys, below the dial → the
/// human wait, denied → refusal, unreadable → the human wait, with
/// <c>Deployment:RequireProdApproval</c> as the operator override).
///
/// <para>HISTORY, because two of this fixture's own pins have flipped with the
/// authority and the old text was load-bearing: 43-9 originally adopted the
/// gate as a third <b>OR</b> term ("by OR, never by replacement" — the
/// business-mode wait was untouchable then, and fail-open on an unreadable gate
/// was safe because that mode term backstopped it). The owner has since directed
/// the replacement, so mode no longer forces the wait and the unreadable arm
/// fails CLOSED. What survives from 43-9 unchanged: the gate is <b>on the
/// EFFECT, not the agent-action</b> — <c>StageDeployDispatch</c> is shared
/// across qa / uat / production, so only <c>effect:deploy.prod</c> at the
/// prod-approval decision can tell a production deploy apart.</para>
///
/// <para><b>2026-08-01 review finding F1 — these behaviour tests now drive the
/// REAL <c>FlowDecision</c> delegate.</b> They used to call a hand-copy of the
/// predicate re-derived in this file, which is how the shipped
/// <c>ADeniedOutcome_…</c> test came to assert the OPPOSITE of its own name and
/// stay green: a re-derived copy cannot disagree with itself. <see cref="ApprovalNeeded"/>
/// extracts the built decision's Delegate expression and invokes it against a real
/// <c>ExpressionExecutionContext</c> holding the workflow's own variables, so
/// nothing here can pass while the graph says something else.</para>
/// </summary>
[TestFixture]
public class DeploymentPipelineGateTests
{
    private Flowchart _flowchart = null!;

    [SetUp]
    public void SetUp()
    {
        var builder = WorkflowTestHelper.BuildWorkflow(new DeploymentPipelineWorkflow());
        _flowchart = WorkflowTestHelper.GetFlowchart(builder);
    }

    private bool HasEdge(string sourceId, string? port, string targetId) =>
        _flowchart.Connections.Any(c =>
            c.Source.Activity.Id == sourceId &&
            (port is null || c.Source.Port == port) &&
            WorkflowTestHelper.ResolvedTargetId(_flowchart, c) == targetId);

    private CheckActionGateActivity Gate(string id = "CheckProdDeployGate") =>
        _flowchart.Activities.OfType<CheckActionGateActivity>()
            .Single(a => a.Id == id);

    /// <summary>Everything reachable from one outcome port of one node.</summary>
    private HashSet<string> ReachableFromPort(string sourceId, string port)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<string>();
        foreach (var c in _flowchart.Connections.Where(c =>
                     c.Source.Activity.Id == sourceId && c.Source.Port == port))
        {
            if (c.Target.Activity.Id is { } t && seen.Add(t)) queue.Enqueue(t);
        }
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            foreach (var c in _flowchart.Connections.Where(c => c.Source.Activity.Id == id))
            {
                if (c.Target.Activity.Id is { } t && seen.Add(t)) queue.Enqueue(t);
            }
        }
        return seen;
    }

    // ====================================================================
    // The node exists, on the right action, on the right path
    // ====================================================================

    [Test]
    public void TheGateNode_existsOncePerStage_andRunsBeforeEachApprovalDecision()
    {
        // Story 43-19: one stage-entry gate per live pipeline stage (QA, UAT, Prod).
        var gates = _flowchart.Activities.OfType<CheckActionGateActivity>().ToList();
        gates.Select(g => g.Id).Should().BeEquivalentTo(
            new[] { "CheckQaDeployGate", "CheckUatDeployGate", "CheckProdDeployGate" },
            "one gate check per live deploy stage (QA, UAT, Prod) — no more, no less");

        // QA gate sits between Init and QaApprovalNeeded.
        HasEdge("Init", null, "CheckQaDeployGate").Should().BeTrue();
        HasEdge("CheckQaDeployGate", "Automated", "QaApprovalNeeded").Should().BeTrue();
        HasEdge("CheckQaDeployGate", "RequiresHuman", "QaApprovalNeeded").Should().BeTrue();
        HasEdge("CheckQaDeployGate", "Denied", "QaApprovalNeeded").Should().BeFalse();

        // UAT gate sits between EmitQaSuccess and UatApprovalNeeded.
        HasEdge("EmitQaSuccess", null, "CheckUatDeployGate").Should().BeTrue();
        HasEdge("CheckUatDeployGate", "Automated", "UatApprovalNeeded").Should().BeTrue();
        HasEdge("CheckUatDeployGate", "RequiresHuman", "UatApprovalNeeded").Should().BeTrue();
        HasEdge("CheckUatDeployGate", "Denied", "UatApprovalNeeded").Should().BeFalse();

        // Prod gate sits between UAT success and ProdApprovalNeeded (AC4 regression pin).
        HasEdge("EmitUatSuccess", null, "CheckProdDeployGate").Should().BeTrue(
            "the gate check sits between UAT success and the prod-approval decision, so the "
            + "decision reads a variable that has already been written");

        // Automated and RequiresHuman converge on the SAME next node. For those two
        // the activity's job is to SET the outcome variable; the routing decision
        // stays where it already was. Splitting them would create a second,
        // competing prod gate that the existing predicate knows nothing about.
        HasEdge("CheckProdDeployGate", "Automated", "ProdApprovalNeeded").Should().BeTrue();
        HasEdge("CheckProdDeployGate", "RequiresHuman", "ProdApprovalNeeded").Should().BeTrue();

        // Denied does NOT converge — see ADeniedOutcome_isAHardStop_notAnEscalation.
        HasEdge("CheckProdDeployGate", "Denied", "ProdApprovalNeeded").Should().BeFalse(
            "a denial must not be answerable by the deployment-approval wait: the only answer "
            + "that wait has is 'a human approves', and a denial is exactly the case where no "
            + "human on this graph may");
    }

    [Test]
    public void EveryGateOutcome_isWired_noDanglingEdge()
    {
        // F1's remedy for the objection that used to justify folding `denied` into
        // `RequiresHuman`: every outcome on EVERY CheckActionGateActivity in the
        // workflow must leave the node.
        var gates = _flowchart.Activities.OfType<CheckActionGateActivity>().ToList();
        gates.Should().HaveCount(3);

        foreach (var gate in gates)
        {
            var wired = _flowchart.Connections
                .Where(c => c.Source.Activity == gate)
                .Select(c => c.Source.Port)
                .ToHashSet(StringComparer.Ordinal);

            wired.Should().BeEquivalentTo(CheckActionGateActivity.Edges,
                $"gate '{gate.Id}' has an unwired outcome — a governance decision the graph "
                + "would silently drop");
        }
    }

    [Test]
    public void Gate_is_on_the_effect_not_the_shared_dispatch()
    {
        Gate("CheckQaDeployGate").ActionKey.Expression?.Value.Should().Be("effect:deploy.qa");
        Gate("CheckUatDeployGate").ActionKey.Expression?.Value.Should().Be("effect:deploy.uat");
        Gate("CheckProdDeployGate").ActionKey.Expression?.Value.Should().Be("effect:deploy.prod",
            "gating agent-action:deploy would gate the SHARED StageDeployDispatch, which cannot "
            + "distinguish qa / uat / production — the same member would gate a staging deploy as "
            + "though it were a production promotion");

        // The shared dispatch itself is NOT individually gated: no gate node is
        // adjacent to any StageDeployDispatch node.
        var dispatchIds = _flowchart.Activities.OfType<DispatchWorkflow>()
            .Select(d => d.Id).ToHashSet(StringComparer.Ordinal);

        var adjacentToADispatch = _flowchart.Connections
            .Where(c => c.Source.Activity is CheckActionGateActivity
                        || c.Target.Activity is CheckActionGateActivity)
            .Where(c => dispatchIds.Contains(c.Source.Activity.Id)
                        || dispatchIds.Contains(c.Target.Activity.Id))
            .Select(c => $"  {c.Source.Activity.Id} → {c.Target.Activity.Id}")
            .ToList();

        adjacentToADispatch.Should().BeEmpty(
            "the gate is on the stage TRANSITION, never on the shared dispatch:"
            + Environment.NewLine + string.Join(Environment.NewLine, adjacentToADispatch));
    }

    [Test]
    public void DevAndStagingDeployKeys_RemainReserved_NeverReferencedByPipeline()
    {
        // Story 43-19 AC3 — deploy.dev (70) and deploy.staging (85) stay reserved;
        // DeploymentPipelineWorkflow ships QA -> UAT -> Prod only.
        var actionKeys = _flowchart.Activities.OfType<CheckActionGateActivity>()
            .Select(g => g.ActionKey.Expression?.Value?.ToString())
            .ToList();

        actionKeys.Should().NotContain("effect:deploy.dev",
            "deploy.dev stays reserved — no dev stage exists in DeploymentPipelineWorkflow");
        actionKeys.Should().NotContain("effect:deploy.staging",
            "deploy.staging stays reserved — no staging stage exists in DeploymentPipelineWorkflow");

        var waitStages = _flowchart.Activities.OfType<WaitForDeploymentApprovalActivity>()
            .Select(w => w.Stage.Expression?.Value?.ToString())
            .ToList();
        waitStages.Should().BeEquivalentTo(new[] { "qa", "uat", "production" });
        waitStages.Should().NotContain("dev").And.NotContain("staging");
    }

    [Test]
    public void Structural_EveryDeployStage_HasALiveGateBeforeItsStageEntry()
    {
        // Story 43-19 AC5 — every forward deploy stage (QADeploy, UATDeploy, ProdDeploy)
        // must be preceded by its own CheckActionGateActivity + ApprovalNeeded +
        // WaitForDeploymentApprovalActivity. If someone adds a 4th deploy stage without
        // wiring a gate before it, this test fails loudly.
        var deployDispatches = _flowchart.Activities.OfType<DispatchWorkflow>()
            .Where(d => d.Id is not null && !d.Id.Contains("Rollback", StringComparison.OrdinalIgnoreCase))
            .ToList();

        deployDispatches.Select(d => d.Id).Should().BeEquivalentTo(
            new[] { "QADeploy", "UATDeploy", "ProdDeploy" });

        // For each deploy dispatch, verify NO path from Init reaches it without passing
        // through a CheckActionGateActivity dedicated to that stage.
        var stageGateByDeploy = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["QADeploy"] = "CheckQaDeployGate",
            ["UATDeploy"] = "CheckUatDeployGate",
            ["ProdDeploy"] = "CheckProdDeployGate",
        };

        foreach (var deploy in deployDispatches)
        {
            stageGateByDeploy.Should().ContainKey(deploy.Id!,
                $"deploy stage '{deploy.Id}' has no declared stage-entry gate");

            var gateId = stageGateByDeploy[deploy.Id!];
            var reachableWithoutGate = ReachableFromStartExcluding(gateId);
            reachableWithoutGate.Should().NotContain(deploy.Id!,
                $"deploy stage '{deploy.Id}' is reachable from Init without passing through '{gateId}'");
        }
    }

    private HashSet<string> ReachableFromStartExcluding(string blockedId)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var startId = _flowchart.Start?.Id;
        if (startId is null || startId == blockedId) return seen;

        var queue = new Queue<string>();
        seen.Add(startId);
        queue.Enqueue(startId);
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            foreach (var c in _flowchart.Connections.Where(c => c.Source.Activity.Id == id))
            {
                var next = c.Target.Activity.Id;
                if (next is not null && next != blockedId && seen.Add(next))
                    queue.Enqueue(next);
            }
        }
        return seen;
    }

    [Test]
    public void TheGateOutcome_isWrittenToAWorkflowVariable_theDecisionCanRead()
    {
        var builder = WorkflowTestHelper.BuildWorkflow(new DeploymentPipelineWorkflow());
        builder.Object.Variables.Select(v => v.Name).Should().Contain("ProdGateOutcome",
            "the decision predicate is a synchronous FlowDecision — it cannot make an HTTP call, "
            + "so the activity must have already written its answer somewhere the predicate reads");

        Gate().Outcome.Should().NotBeNull(
            "an activity whose Outcome output is unbound would leave the predicate reading an "
            + "empty string for ever — the gate would be decorative");

        Gate().Reason.Should().NotBeNull(
            "F1: the denial terminal writes the gate's reason into the audit payload. An unbound "
            + "Reason leaves an operator staring at a stopped pipeline with nothing to act on");
    }

    // ====================================================================
    // The REAL predicate, extracted from the built graph and invoked
    // ====================================================================

    /// <summary>
    /// Invoke the pipeline's ACTUAL <c>ProdApprovalNeeded</c> delegate.
    ///
    /// <para>The built <c>FlowDecision</c> holds its condition as a
    /// <c>Delegate</c> expression — a <c>Func&lt;ExpressionExecutionContext,
    /// ValueTask&lt;object&gt;&gt;</c>. Giving it a real
    /// <see cref="ExpressionExecutionContext"/> over a
    /// <see cref="MemoryRegister"/> holding the workflow's own three input
    /// variables is all it needs; no workflow runtime, no host. This is
    /// deliberately NOT a re-derived copy of the predicate — a copy is what let a
    /// shipped test assert the opposite of its own name and stay green.</para>
    /// </summary>
    private static bool ApprovalNeeded(
        string mode, bool requireProdApproval, string gateOutcome, bool enforced = true)
    {
        var builder = WorkflowTestHelper.BuildWorkflow(new DeploymentPipelineWorkflow());
        var flowchart = WorkflowTestHelper.GetFlowchart(builder);
        var decision = flowchart.Activities.OfType<FlowDecision>()
            .Single(a => a.Id == "ProdApprovalNeeded");

        var variables = builder.Object.Variables;
        // Mode is still DECLARED and SET here although the predicate no longer
        // reads it (owner directive 2026-08-18: the dial decides, mode is
        // audit/event context) — keeping it lets the mode-independence sweep
        // prove that claim against the real delegate instead of assuming it.
        var modeVar = (Variable<string>)variables.Single(v => v.Name == "Mode");
        var flagVar = (Variable<bool>)variables.Single(v => v.Name == "RequireProdApproval");
        var gateVar = (Variable<string>)variables.Single(v => v.Name == "ProdGateOutcome");
        var enforcedVar = (Variable<bool>)variables.Single(v => v.Name == "ProdGateEnforced");

        var register = new MemoryRegister();
        register.Declare(new MemoryBlockReference[] { modeVar, flagVar, gateVar, enforcedVar });

        using var services = new ServiceCollection().BuildServiceProvider();
        var context = new ExpressionExecutionContext(services, register);

        modeVar.Set(context, mode);
        flagVar.Set(context, requireProdApproval);
        gateVar.Set(context, gateOutcome);
        enforcedVar.Set(context, enforced);

        var condition = decision.Condition.Expression?.Value
            as Func<ExpressionExecutionContext, ValueTask<object>>;
        condition.Should().NotBeNull(
            "ProdApprovalNeeded must still be a Delegate-expression FlowDecision; if it became a "
            + "JS/Liquid expression these behaviour pins stop testing the real thing and must be "
            + "rewritten rather than deleted");

        return (bool)condition!(context).AsTask().GetAwaiter().GetResult()!;
    }

    // ====================================================================
    // AC11's named behaviour pins, driven through the REAL predicate
    // ====================================================================

    [Test]
    public void TheDialDecides_ModeNoLongerForcesTheWait()
    {
        // Owner directive 2026-08-18: "check the automation level, then go to
        // orchestrator or human." Until then `mode == business` forced the wait
        // unconditionally, which made the dial irrelevant in exactly the
        // deployments the dial exists to govern. Now a gate that POSITIVELY
        // grants automation routes production to the orchestrator in every mode —
        // and the sweep below proves the predicate never reads mode at all.
        foreach (var mode in new[] { "dev", "business", "" })
        {
            ApprovalNeeded(mode, requireProdApproval: false,
                gateOutcome: GovernanceEvaluateResponse.OutcomeAutomated).Should().BeFalse(
                $"mode={mode}: an automated resolution IS the grant — the dial decided");

            ApprovalNeeded(mode, requireProdApproval: false,
                gateOutcome: GovernanceEvaluateResponse.OutcomeRequiresHuman).Should().BeTrue(
                $"mode={mode}: below the dial goes to a human, whatever the mode");
        }
    }

    [Test]
    public void RequireProdApproval_IsAnOverride_thatForcesTheWaitPastAnAutomatingDial()
    {
        // The config flag survives the re-base as the operator's override: it can
        // only ADD a wait. A dial that automates does not silence it.
        ApprovalNeeded("dev", requireProdApproval: true,
            gateOutcome: GovernanceEvaluateResponse.OutcomeAutomated).Should().BeTrue();
        ApprovalNeeded("business", requireProdApproval: true,
            gateOutcome: GovernanceEvaluateResponse.OutcomeAutomated).Should().BeTrue();
    }

    [Test]
    public void ObserveOnly_IsHonoured_theAdminsReportDontBlockPassesProduction()
    {
        // Enforced=false is an admin explicitly watching a tightening before it
        // bites. The DECISION must honour it, not only the edge selection — the
        // predicate reads the raw outcome variable, and before ProdGateEnforced
        // was bound it would have blocked on the requires-human wire the admin
        // asked to only observe.
        ApprovalNeeded("business", requireProdApproval: false,
            gateOutcome: GovernanceEvaluateResponse.OutcomeRequiresHuman, enforced: false)
            .Should().BeFalse("observe-only reports, it does not block");

        // The cell the 2026-08-19 review found wrong: an UNENFORCED denial. It is
        // reachable (Enabled=false or any AllowedRoles restriction under an admin's
        // Enforce=false resolves denied/unenforced, and SelectEdge honours
        // observe-only first, so it arrives at this predicate on the Automated
        // edge). Checking the denied arm before the observe-only arm parked it at
        // the APPROVABLE human wait — neither observe-only's pass-through nor F1's
        // hard stop, and a human could approve past a denied action. Observe-only
        // now wins: report, don't block.
        ApprovalNeeded("business", requireProdApproval: false,
            gateOutcome: GovernanceEvaluateResponse.OutcomeDenied, enforced: false)
            .Should().BeFalse("an unenforced denial is an observed denial — reported, not blocking");

        // The ENFORCED denial is untouched by that fix: the edge routes it to the
        // refusal terminal, and the predicate's safety net still blocks it.
        ApprovalNeeded("business", requireProdApproval: false,
            gateOutcome: GovernanceEvaluateResponse.OutcomeDenied, enforced: true)
            .Should().BeTrue("an enforced denial stays at least as blocking as requires-human");

        // But observe-only never rescues an UNREADABLE gate: unavailable carries
        // Enforced=false from the activity's error arm, and an error is not an
        // admin's decision.
        ApprovalNeeded("business", requireProdApproval: false,
            gateOutcome: CheckActionGateActivity.OutcomeUnavailable, enforced: false)
            .Should().BeTrue("fail closed: an error posture must not read as observe-only");
    }

    [Test]
    public void GateAutomated_Proceeds_GateRequiresHuman_Waits()
    {
        // The two live routes of the 2026-08-18 semantics, at the seam with the
        // real human wait: the dial's grant deploys, the dial's refusal waits.
        ApprovalNeeded("dev", requireProdApproval: false,
            gateOutcome: GovernanceEvaluateResponse.OutcomeAutomated).Should().BeFalse(
            "THE ANTI-NO-OP HALF: with the gate granting, production must deploy under the "
            + "orchestrator, or 'the dial decides' would be satisfiable by a predicate that is "
            + "always true");

        ApprovalNeeded("dev", requireProdApproval: false,
            gateOutcome: GovernanceEvaluateResponse.OutcomeRequiresHuman).Should().BeTrue();
    }

    [Test]
    public void ShippedDefaults_RouteProductionToAHuman()
    {
        // effect:deploy.prod ships at zone level 90 and the dial defaults to 70,
        // with enforcement ON when no policy row has an opinion (epic D1). So at
        // shipped defaults the evaluator answers an enforced `requires-human`,
        // and the predicate routes to the wait — in every mode. Automating
        // production is a deliberate act: raise the dial to 90+, lower the
        // action's level, or set observe-only. It is never the out-of-the-box
        // state.
        foreach (var mode in new[] { "dev", "business", "" })
        {
            ApprovalNeeded(mode, requireProdApproval: false,
                gateOutcome: GovernanceEvaluateResponse.OutcomeRequiresHuman, enforced: true)
                .Should().BeTrue($"mode={mode}: shipped defaults must not auto-deploy production");
        }
    }

    [Test]
    public void ThePredicate_NeverReadsMode()
    {
        // The claim "mode is audit/event context now, not a gate term", proven
        // against the real delegate: for every outcome/flag/enforced combination,
        // every mode answers identically.
        foreach (var flag in new[] { true, false })
        foreach (var enforced in new[] { true, false })
        foreach (var outcome in new[]
        {
            GovernanceEvaluateResponse.OutcomeAutomated,
            GovernanceEvaluateResponse.OutcomeRequiresHuman,
            GovernanceEvaluateResponse.OutcomeDenied,
            CheckActionGateActivity.OutcomeUnavailable,
            "",
        })
        {
            var dev = ApprovalNeeded("dev", flag, outcome, enforced);
            ApprovalNeeded("business", flag, outcome, enforced).Should().Be(dev,
                $"outcome={outcome}, flag={flag}, enforced={enforced}");
            ApprovalNeeded("", flag, outcome, enforced).Should().Be(dev,
                $"outcome={outcome}, flag={flag}, enforced={enforced}");
        }
    }

    [Test]
    public void AnUnavailableGate_FailsClosed_ontoTheHumanWait()
    {
        // INVERTED on 2026-08-18, deliberately — the prior pin here said the exact
        // opposite ("treated as no opinion, not as a block") and even predicted
        // this moment: "a future adoption that REPLACED a predicate would make
        // this posture wrong." That adoption has happened. While mode==business
        // was the unconditional backstop, an unreadable gate could contribute
        // nothing and production was still protected; with the dial as the
        // DECIDER there is nothing behind it, so an unreadable answer must land
        // on the human wait. Absence of evidence that automation was granted is
        // not a grant (the finding-36 rule).
        ApprovalNeeded("dev", requireProdApproval: false,
            gateOutcome: CheckActionGateActivity.OutcomeUnavailable).Should().BeTrue();
        ApprovalNeeded("dev", requireProdApproval: false, gateOutcome: "").Should().BeTrue(
            "the unwritten empty string is indistinguishable from a gate that never ran");
    }

    // ====================================================================
    // F1 — a denial is at least as blocking as requires-human, and is a
    //      HARD STOP rather than an escalation
    // ====================================================================

    [Test]
    public void ADeniedOutcome_doesNotSilentlyPassTheApprovalDecision()
    {
        // THE F1 REGRESSION PIN, asserting what its name says. This test previously
        // asserted the OPPOSITE — that `denied` fell to False here — and justified
        // it with "safe only because the routing already went down the RequiresHuman
        // edge". That edge led to the SAME node as Automated, so it protected
        // nothing: dev mode + requireProdApproval=false + `denied` deployed to
        // production with no human, which an admin reaches by DISABLING
        // effect:deploy.prod or putting any AllowedRoles restriction on it
        // or its deploy-control group (this call passes Role unset, so every
        // restriction excludes it).
        ApprovalNeeded("dev", requireProdApproval: false,
            gateOutcome: GovernanceEvaluateResponse.OutcomeDenied).Should().BeTrue(
            "a denied resolution must never be read as 'no opinion'. It is the STRONGEST refusal "
            + "the gate can produce; falling through it deployed production unattended.");
    }

    [Test]
    public void TheApprovalPredicate_isMonotone_inAdminStrictness()
    {
        // THE INVARIANT the F1 defect violated, stated directly: every strengthening
        // of the admin's setting must be at least as blocking as the one below it.
        // `denied` (action disabled / role-restricted) is strictly stronger than
        // `requires-human` (AlwaysHuman), so it cannot be less blocking.
        foreach (var mode in new[] { "dev", "business", "" })
        {
            foreach (var flag in new[] { true, false })
            {
                var automated = ApprovalNeeded(mode, flag, GovernanceEvaluateResponse.OutcomeAutomated);
                var requiresHuman = ApprovalNeeded(mode, flag, GovernanceEvaluateResponse.OutcomeRequiresHuman);
                var denied = ApprovalNeeded(mode, flag, GovernanceEvaluateResponse.OutcomeDenied);

                (requiresHuman || !automated).Should().BeTrue(
                    $"mode={mode}, flag={flag}: requires-human must block wherever automated does");
                (denied || !requiresHuman).Should().BeTrue(
                    $"mode={mode}, flag={flag}: DISABLING the action must be at least as blocking "
                    + "as pinning it to AlwaysHuman — the inversion F1 found");
            }
        }
    }

    [Test]
    public void ADeniedOutcome_isAHardStop_notAnEscalation()
    {
        // THE ROUTING half of F1, and the design call it records. `denied` arises
        // from an Enabled=false row or an AllowedRoles restriction. Neither means
        // "a person may approve this": the human on WaitProdApproval is approving a
        // DEPLOYMENT, and letting them approve past an action an admin switched OFF
        // would make the deploy-control dial advisory. So the Denied edge reaches
        // the refusal terminal and NEVER the approval wait or the prod deploy.
        HasEdge("CheckProdDeployGate", "Denied", "SetProdGateDenied").Should().BeTrue();
        HasEdge("SetProdGateDenied", null, "EmitProdRejected").Should().BeTrue(
            "a governance refusal is a PRODUCTION.REJECTED audit row, not a silent stall");

        var reachable = ReachableFromPort("CheckProdDeployGate", "Denied");

        reachable.Should().NotContain("WaitProdApproval",
            "a denial must not be routable into the standing deployment-approval flow — that "
            + "would make a human able to approve past an action an admin DISABLED");
        reachable.Should().NotContain("ProdDeploy",
            "and it must certainly not reach the production deploy");
        reachable.Should().NotContain("EmitProdStarted",
            "nor the production stage at all");

        reachable.Should().Contain("SetProdFailed",
            "the denial terminates the pipeline fail-closed (deploymentStatus = failed:production)");
        reachable.Should().Contain("EmitPipelineFailed",
            "loudly — PIPELINE.FAILED carries the gate's reason via stageError");
    }

    // ====================================================================
    // The full chain (owner directive 2026-08-18): the check is a STEP in the
    // deployment workflow, and both of its live routes land on the SAME
    // deployment step, which calls the orchestrator through llm-call.
    // ====================================================================

    [Test]
    public void BothRoutes_ConvergeOnTheOneDeployStep_whichCallsTheOrchestratorViaLlmCall()
    {
        // Automated: gate step → decision False → PROD STARTED → the deploy step.
        HasEdge("ProdApprovalNeeded", "False", "EmitProdStarted").Should().BeTrue(
            "the dial's grant must route into the production stage, not around it");

        // Human: decision True → wait → Approve → PROD APPROVED → the SAME entry.
        HasEdge("ProdApprovalNeeded", "True", "WaitProdApproval").Should().BeTrue();
        HasEdge("WaitProdApproval", "Approve", "EmitProdApproved").Should().BeTrue();
        HasEdge("EmitProdApproved", null, "EmitProdStarted").Should().BeTrue(
            "an approved deploy and an automated deploy must be the same deploy — one step, "
            + "one audit shape, no second code path");

        // The deployment step itself: exactly one, entered only via PROD STARTED,
        // and it is a dispatch of the mediated llm-call workflow — the engine
        // calls the orchestrator (POST /api/v1/llm/call, tools enabled), never a
        // provider directly.
        HasEdge("EmitProdStarted", null, "ProdDeploy").Should().BeTrue();

        _flowchart.Connections
            .Where(c => c.Target.Activity.Id == "ProdDeploy")
            .Select(c => c.Source.Activity.Id)
            .Should().BeEquivalentTo(new[] { "EmitProdStarted" },
                "every route into the production deploy funnels through the one STARTED emit — "
                + "there is no path that reaches the deploy step around the gate");

        var deploy = _flowchart.Activities.OfType<Elsa.Workflows.Runtime.Activities.DispatchWorkflow>()
            .Single(d => d.Id == "ProdDeploy");
        var definitionId = typeof(Elsa.Workflows.Runtime.Activities.DispatchWorkflow)
            .GetProperty("WorkflowDefinitionId")?.GetValue(deploy);
        var expression = definitionId?.GetType().GetProperty("Expression")?.GetValue(definitionId)
            as Elsa.Expressions.Models.Expression;
        expression?.Value?.ToString().Should().Be("llm-call",
            "the deployment step IS an orchestrator call — the mediated llm-call workflow with "
            + "the devops deploy action — so the whole chain is: check step (autonomy dial, the "
            + "shared action engine) → deploy step → orchestrator");
    }

    // ====================================================================
    // The wait it routes into is the EXISTING one
    // ====================================================================

    [Test]
    public void TheGate_routesIntoTheExistingHumanWait_andMintsNoNewSuspendActivity()
    {
        // D11 / Story 43-19: reuse WaitForDeploymentApprovalActivity across all three
        // stages (QA, UAT, Production), each carrying its own Stage input so bookmarks
        // never collide, without minting any new suspend activity type.
        var waits = _flowchart.Activities.OfType<WaitForDeploymentApprovalActivity>().ToList();
        waits.Select(w => (w.Id, Stage: w.Stage.Expression?.Value?.ToString())).Should().BeEquivalentTo(
            new[]
            {
                ("WaitQaApproval", "qa"),
                ("WaitUatApproval", "uat"),
                ("WaitProdApproval", "production"),
            });

        HasEdge("QaApprovalNeeded", "True", "WaitQaApproval").Should().BeTrue();
        HasEdge("QaApprovalNeeded", "False", "EmitQaStarted").Should().BeTrue();
        HasEdge("UatApprovalNeeded", "True", "WaitUatApproval").Should().BeTrue();
        HasEdge("UatApprovalNeeded", "False", "EmitUatStarted").Should().BeTrue();
        HasEdge("ProdApprovalNeeded", "True", "WaitProdApproval").Should().BeTrue();
        HasEdge("ProdApprovalNeeded", "False", "EmitProdStarted").Should().BeTrue();

        _flowchart.Activities.OfType<CheckActionGateActivity>()
            .Select(a => a.Id)
            .Should().BeEquivalentTo(
                new[] { "CheckQaDeployGate", "CheckUatDeployGate", "CheckProdDeployGate" },
                "the gate checks are not suspend activities and only the three live stages are gated");
    }

    [TestCase("QaApprovalNeeded", "QaGateOutcome", "QaGateEnforced")]
    [TestCase("UatApprovalNeeded", "UatGateOutcome", "UatGateEnforced")]
    public void StageApprovalDecisions_FollowTheSameAutonomyRuleAsProd(
        string decisionId, string outcomeVarName, string enforcedVarName)
    {
        // Story 43-19 AC1: QA and UAT FlowDecision delegates route on the gate answer
        // with the exact same fail-closed / observe-only / monotone semantics as Prod.
        bool Eval(string outcome, bool enforced = true)
        {
            var builder = WorkflowTestHelper.BuildWorkflow(new DeploymentPipelineWorkflow());
            var flowchart = WorkflowTestHelper.GetFlowchart(builder);
            var decision = flowchart.Activities.OfType<FlowDecision>()
                .Single(a => a.Id == decisionId);

            var outcomeVar = (Variable<string>)builder.Object.Variables.Single(v => v.Name == outcomeVarName);
            var enforcedVar = (Variable<bool>)builder.Object.Variables.Single(v => v.Name == enforcedVarName);

            var register = new MemoryRegister();
            register.Declare(new MemoryBlockReference[] { outcomeVar, enforcedVar });
            using var services = new ServiceCollection().BuildServiceProvider();
            var ctx = new ExpressionExecutionContext(services, register);
            outcomeVar.Set(ctx, outcome);
            enforcedVar.Set(ctx, enforced);

            var cond = decision.Condition.Expression?.Value
                as Func<ExpressionExecutionContext, ValueTask<object>>;
            cond.Should().NotBeNull();
            return (bool)cond!(ctx).AsTask().GetAwaiter().GetResult()!;
        }

        Eval(GovernanceEvaluateResponse.OutcomeAutomated).Should().BeFalse("automated proceeds without human wait");
        Eval(GovernanceEvaluateResponse.OutcomeRequiresHuman).Should().BeTrue("below-dial suspends on stage bookmark");
        Eval(GovernanceEvaluateResponse.OutcomeDenied, enforced: true).Should().BeTrue("enforced denial never falls open");
        Eval(GovernanceEvaluateResponse.OutcomeRequiresHuman, enforced: false).Should().BeFalse("observe-only passes through");
        Eval(CheckActionGateActivity.OutcomeUnavailable, enforced: false).Should().BeTrue("unreadable gate fails closed");
        Eval("").Should().BeTrue("unwritten outcome fails closed");
    }

    [TestCase("CheckQaDeployGate", "SetQaGateDenied", "EmitQaRejected", "WaitQaApproval", "QADeploy", "SetQAFailed")]
    [TestCase("CheckUatDeployGate", "SetUatGateDenied", "EmitUatRejected", "WaitUatApproval", "UATDeploy", "SetUATFailed")]
    public void StageDeniedOutcome_IsAHardStop_NotAnEscalation(
        string gateId, string deniedSetId, string rejectedEmitId, string waitId, string deployId, string failId)
    {
        HasEdge(gateId, "Denied", deniedSetId).Should().BeTrue();
        HasEdge(deniedSetId, null, rejectedEmitId).Should().BeTrue();

        var reachable = ReachableFromPort(gateId, "Denied");
        reachable.Should().NotContain(waitId);
        reachable.Should().NotContain(deployId);
        reachable.Should().Contain(failId);
        reachable.Should().Contain("EmitPipelineFailed");
    }

    // ====================================================================
    // The edge-selection rule the activity applies (F1)
    // ====================================================================

    [Test]
    public void SelectEdge_mapsEachResolution_ontoTheEdgeItsSeverityDeserves()
    {
        // Enforced blocks.
        CheckActionGateActivity.SelectEdge(true, GovernanceEvaluateResponse.OutcomeAutomated)
            .Should().Be(CheckActionGateActivity.EdgeAutomated);
        CheckActionGateActivity.SelectEdge(true, GovernanceEvaluateResponse.OutcomeRequiresHuman)
            .Should().Be(CheckActionGateActivity.EdgeRequiresHuman);
        CheckActionGateActivity.SelectEdge(true, GovernanceEvaluateResponse.OutcomeDenied)
            .Should().Be(CheckActionGateActivity.EdgeDenied,
            "F1: a denial is a hard refusal, not an escalation — folding it onto RequiresHuman is "
            + "what made DISABLING the action weaker than pinning it to AlwaysHuman");

        // Observe-only NEVER hard-refuses, whatever the wire says: `enforced = false`
        // is the admin's explicit "report but do not block", and an observe-mode
        // rollout that could terminate a production pipeline would be unusable.
        foreach (var wire in new[]
                 {
                     GovernanceEvaluateResponse.OutcomeAutomated,
                     GovernanceEvaluateResponse.OutcomeRequiresHuman,
                     GovernanceEvaluateResponse.OutcomeDenied,
                 })
        {
            CheckActionGateActivity.SelectEdge(false, wire)
                .Should().Be(CheckActionGateActivity.EdgeAutomated,
                    $"observe-only must take the Automated edge for '{wire}'");
        }

        // An enforced wire this build does not recognise fails CLOSED onto the safe
        // edge rather than proceeding.
        CheckActionGateActivity.SelectEdge(true, "allowed-with-audit")
            .Should().Be(CheckActionGateActivity.EdgeRequiresHuman);
        CheckActionGateActivity.SelectEdge(true, null)
            .Should().Be(CheckActionGateActivity.EdgeRequiresHuman);
    }
}
