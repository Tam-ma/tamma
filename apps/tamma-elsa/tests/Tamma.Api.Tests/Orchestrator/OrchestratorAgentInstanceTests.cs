using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Core.Documents.Policy;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC1 / AC3 / AC4 / AC5 / AC7) — end-to-end scripted tests for
/// <see cref="OrchestratorAgentInstance"/>: acceptance self-decision with tool
/// calls, escalation disposition, guidance reply, daily spend cap, and session
/// compaction.
/// </summary>
[TestFixture]
public class OrchestratorAgentInstanceTests
{
    [Test]
    public async Task AcceptanceRequest_executes_audited_tools_resumes_on_orchestrator_channel_and_emits_decision_event()
    {
        var rig = new OrchestratorTestHarness.Rig();
        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 100);

        rig.Documents.Setup(d => d.GetByIdAsync(rig.TenantId, req.Document.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentInstance
            {
                Id = req.Document.Id,
                TenantId = rig.TenantId,
                DocumentType = req.Document.Type,
                SchemaVersion = 1,
                IssueId = req.IssueId,
                CorrelationId = req.Document.CorrelationId,
                ProducedByRole = "architect",
                ProducedByAction = "context-scan",
                Status = "in_review",
                BodyJson = """{"summary":"Looks solid"}""",
                Revision = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            FinalResponse: """{"routing":"decide-self","decision":{"kind":"accept","note":"All criteria satisfied."},"reasoningSummary":"Verified findings against rules."}""",
            ToolCalls: new[]
            {
                new ScriptedTurnRunner.ScriptedToolCall("get_acceptance_rules", """{"documentTypeKey":"findings"}"""),
                new ScriptedTurnRunner.ScriptedToolCall("document_get", $$"""{"documentId":"{{req.Document.Id}}"}"""),
            },
            CostUsd: 0.04m));

        var outcome = await rig.Instance.HandleAcceptanceRequestAsync(req);

        outcome.Routing.Should().Be("decide-self");
        outcome.Decision.Should().BeOfType<AcceptanceDecision.Accept>();
        outcome.Clamped.Should().BeFalse();
        outcome.PreGated.Should().BeFalse();
        rig.Instance.DailySpendUsd.Should().Be(0.04m);

        // Verified 39-8 resume called with channel="orchestrator" and exact DecisionSessionId
        rig.ResumeCalls.Should().ContainSingle();
        rig.ResumeCalls[0].SessionId.Should().Be(req.DecisionSessionId);
        rig.ResumeCalls[0].Channel.Should().Be("orchestrator");
        rig.ResumeCalls[0].DecisionJson.Should().Contain("\"accept\"");

        // Audited tool calls + ORCHESTRATOR.DECISION.MADE emitted
        rig.EmittedEvents.Count(e => e.Type == OrchestratorEvents.ToolInvoked).Should().Be(2);
        rig.EmittedEvents.Should().ContainSingle(e => e.Type == OrchestratorEvents.DecisionMade);
    }

    [Test]
    public async Task HandleEscalationAsync_dispositions_via_EscalationDispositionService_and_emits_decision_event()
    {
        var rig = new OrchestratorTestHarness.Rig();
        rig.Events.Setup(e => e.QueryAsync(rig.TenantId, "ESCALATION.TRIGGERED", null, It.IsAny<int>()))
            .ReturnsAsync(new List<DomainEvent>
            {
                new()
                {
                    Type = "ESCALATION.TRIGGERED",
                    TenantId = rig.TenantId,
                    Tags = """{"escalationId":"esc-42","issueId":"org/repo#42"}""",
                    Metadata = "{}",
                    Data = "{}",
                    CreatedAt = DateTime.UtcNow.AddSeconds(-5),
                },
            });
        rig.Events.Setup(e => e.QueryAsync(rig.TenantId, "ESCALATION.RESOLVED", null, It.IsAny<int>()))
            .ReturnsAsync(new List<DomainEvent>());
        var escalation = new EscalationRaised(
            EscalationId: "esc-42",
            Outcome: "escalated",
            LineageJson: """{"issueId":"org/repo#42"}""",
            IssueId: "org/repo#42",
            RulesReference: "findings@v2");

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            """{"routing":"disposition","disposition":"resolved","note":"Cleared after check.","reasoningSummary":"Safe to resolve."}"""));

        var result = await rig.Instance.HandleEscalationAsync(escalation);

        result.Routing.Should().Be("disposition");
        result.DispositionOutcome.Should().Be(EscalationDispositionOutcome.Resolved);
        rig.EmittedEvents.Should().Contain(e => e.Type == "ESCALATION.RESOLVED");
        rig.EmittedEvents.Should().Contain(e => e.Type == OrchestratorEvents.DecisionMade);
    }

    [Test]
    public async Task HandleGuidanceAsync_replies_invokes_callback_and_emits_audit_event()
    {
        var rig = new OrchestratorTestHarness.Rig();
        var query = new GuidanceQuery(
            QueryId: Guid.NewGuid(),
            CorrelationId: "corr-guide-1",
            Question: "Should we prefer Option A or Option B?",
            ContextJson: """{"topic":"migration"}""");

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn("Use Option A for zero-downtime rollout."));

        var reply = await rig.Instance.HandleGuidanceAsync(query);

        reply.QueryId.Should().Be(query.QueryId);
        reply.Reply.Should().Contain("Option A");
        rig.GuidanceReplies.Should().ContainSingle(r => r.TenantId == rig.TenantId && r.Reply.QueryId == query.QueryId);
        rig.EmittedEvents.Should().ContainSingle(e => e.Type == OrchestratorEvents.DecisionMade);
    }

    [Test]
    public async Task DailySpendCap_blocks_LLM_turn_and_fails_closed_to_escalation()
    {
        var rig = new OrchestratorTestHarness.Rig(
            config: OrchestratorAgentDefaults.Config with { MaxUsdPerDay = 0.05m });

        // First turn burns the entire $0.05 daily budget
        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn("Guidance answer", CostUsd: 0.05m));
        await rig.Instance.HandleGuidanceAsync(new GuidanceQuery(Guid.NewGuid(), "c1", "q1", null));
        rig.Instance.DailySpendUsd.Should().Be(0.05m);

        // Second turn (acceptance request) must NOT invoke runner — fails closed to Escalate
        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 100);
        var res = await rig.Instance.HandleAcceptanceRequestAsync(req);

        rig.Runner.CallCount.Should().Be(1, "daily USD cap must stop further LLM turns");
        res.Decision.Should().BeOfType<AcceptanceDecision.Escalate>();
    }

    [Test]
    public void OrchestratorSession_compacts_deterministically_without_LLM_calls_when_turn_budget_exceeded()
    {
        var session = new OrchestratorSession(Guid.NewGuid());
        for (var i = 0; i < 12; i++)
        {
            session.AppendUserTurn($"Turn {i} user prompt with payload.");
            session.Messages.Add(new Tamma.Activities.LlmCall.Models.ConversationMessage
            {
                Role = "assistant",
                Content = $"Turn {i} assistant response.",
            });
        }

        var compacted = session.CompactIfNeeded(maxSessionTokens: 64_000, compactAfterTurns: 6);

        compacted.Should().BeTrue();
        session.CompactionCount.Should().Be(1);
        session.Messages.Should().Contain(m => m.Role == "system" && m.Content!.Contains("Compacted"));
        session.Messages.Count.Should().BeLessThan(20);
    }
}
