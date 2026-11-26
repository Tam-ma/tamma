using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Policy;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC3 / AC7) — proves server-side guardrails
/// (<see cref="AcceptanceGuardrails.PreGate"/> and <see cref="AcceptanceGuardrails.Clamp"/>)
/// cannot be overridden by the LLM:
/// <list type="bullet">
///   <item>Scripted <c>Accept</c> on a blocking review is clamped to <c>Escalate(BlockingReviewViolation)</c>.</item>
///   <item>Scripted <c>Reject</c> is clamped to <c>Escalate(RejectRequiresHuman)</c>.</item>
///   <item>Pre-gate (<c>AlwaysEscalate</c> or <c>RoundsExhausted</c>) short-circuits with ZERO LLM calls.</item>
/// </list>
/// </summary>
[TestFixture]
public class OrchestratorGuardrailOverrideTests
{
    [Test]
    public async Task Scripted_Accept_on_blocking_review_is_clamped_to_Escalate_BlockingReviewViolation()
    {
        var rig = new OrchestratorTestHarness.Rig();
        var req = OrchestratorTestHarness.MakeRequest(
            docType: DocumentTypeKey.Findings,
            autonomyLevel: 100,
            reviewDecision: "request-changes",
            hasBlockingIssues: true);

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            """{"routing":"decide-self","decision":{"kind":"accept","note":"Ignoring review."},"reasoningSummary":"Trying to accept despite blocking review."}"""));

        var res = await rig.Instance.HandleAcceptanceRequestAsync(req);

        res.Clamped.Should().BeTrue();
        res.Decision.Should().BeOfType<AcceptanceDecision.Escalate>()
            .Which.Reason.Should().Be(AcceptanceEscalationReason.BlockingReviewViolation);

        rig.ResumeCalls.Should().ContainSingle();
        rig.ResumeCalls[0].SessionId.Should().Be(req.DecisionSessionId);
        rig.ResumeCalls[0].Channel.Should().Be("orchestrator");
        rig.ResumeCalls[0].DecisionJson.Should().Contain("blocking-review-violation");
    }

    [Test]
    public async Task Scripted_Reject_is_clamped_to_Escalate_RejectRequiresHuman()
    {
        var rig = new OrchestratorTestHarness.Rig();
        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 100);

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            """{"routing":"decide-self","decision":{"kind":"reject","reason":"Do not want it."},"reasoningSummary":"Attempting reject."}"""));

        var res = await rig.Instance.HandleAcceptanceRequestAsync(req);

        res.Clamped.Should().BeTrue();
        res.Decision.Should().BeOfType<AcceptanceDecision.Escalate>()
            .Which.Reason.Should().Be(AcceptanceEscalationReason.RejectRequiresHuman);
    }

    [Test]
    public async Task PreGate_AlwaysEscalate_and_RoundsExhausted_short_circuit_with_zero_LLM_calls()
    {
        var rig = new OrchestratorTestHarness.Rig();

        var alwaysEscReq = OrchestratorTestHarness.MakeRequest(
            docType: DocumentTypeKey.Findings,
            autonomyLevel: 100,
            alwaysEscalate: new[] { new EscalationClass(EscalationClassKind.AgentAction, "plan-implementation") });
        var res1 = await rig.Instance.HandleAcceptanceRequestAsync(alwaysEscReq);

        res1.PreGated.Should().BeTrue();
        res1.Decision.Should().BeOfType<AcceptanceDecision.Escalate>()
            .Which.Reason.Should().Be(AcceptanceEscalationReason.AlwaysEscalateClass);

        var roundsReq = OrchestratorTestHarness.MakeRequest(
            docType: DocumentTypeKey.Findings,
            autonomyLevel: 100,
            roundsUsed: 3,
            maxRevisionRounds: 3);
        var res2 = await rig.Instance.HandleAcceptanceRequestAsync(roundsReq);

        res2.PreGated.Should().BeTrue();
        res2.Decision.Should().BeOfType<AcceptanceDecision.Escalate>()
            .Which.Reason.Should().Be(AcceptanceEscalationReason.RoundsExhausted);

        rig.Runner.CallCount.Should().Be(0, "PreGate must short-circuit BEFORE invoking the LLM");
    }
}
