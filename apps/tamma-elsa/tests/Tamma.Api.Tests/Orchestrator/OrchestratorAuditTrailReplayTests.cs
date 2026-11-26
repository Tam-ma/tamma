using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Core.Documents;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC5 / AC7) — audit-trail replay proof: reconstruct the complete
/// decision trail (request correlation → rules version → ordered
/// <c>ORCHESTRATOR.TOOL.INVOKED</c> events with SHA-256 digests →
/// <c>ORCHESTRATOR.DECISION.MADE</c>) purely from the emitted DCB stream.
/// </summary>
[TestFixture]
public class OrchestratorAuditTrailReplayTests
{
    [Test]
    public async Task Emitted_DCB_events_alone_reconstruct_complete_ordered_decision_trail()
    {
        var rig = new OrchestratorTestHarness.Rig();
        var req = OrchestratorTestHarness.MakeRequest(
            docType: DocumentTypeKey.Findings,
            autonomyLevel: 100,
            rulesVersion: 5);

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
                BodyJson = """{"summary":"Evidence"}""",
                Revision = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });

        var rulesArgs = """{"documentTypeKey":"findings"}""";
        var docArgs = $$"""{"documentId":"{{req.Document.Id}}"}""";

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            FinalResponse: """{"routing":"decide-self","decision":{"kind":"accept","note":"Verified."},"reasoningSummary":"Evidence checked."}""",
            ToolCalls: new[]
            {
                new ScriptedTurnRunner.ScriptedToolCall("get_acceptance_rules", rulesArgs, "call-1"),
                new ScriptedTurnRunner.ScriptedToolCall("document_get", docArgs, "call-2"),
            }));

        await rig.Instance.HandleAcceptanceRequestAsync(req);

        // Reconstruct solely from rig.EmittedEvents filtered by decisionSessionId tag
        var sessionTag = req.DecisionSessionId.ToString("D");
        var trail = rig.EmittedEvents
            .Where(e => e.Tags.Contains(sessionTag, StringComparison.Ordinal))
            .ToList();

        trail.Select(e => e.Type).Should().Equal(
            OrchestratorEvents.ToolInvoked,
            OrchestratorEvents.ToolInvoked,
            OrchestratorEvents.DecisionMade);

        using var tool1 = JsonDocument.Parse(trail[0].Data);
        tool1.RootElement.GetProperty("tool").GetString().Should().Be("get_acceptance_rules");
        tool1.RootElement.GetProperty("argsDigest").GetString().Should().Be(AuditedToolRegistry.ComputeArgsDigest(rulesArgs));

        using var tool2 = JsonDocument.Parse(trail[1].Data);
        tool2.RootElement.GetProperty("tool").GetString().Should().Be("document_get");
        tool2.RootElement.GetProperty("argsDigest").GetString().Should().Be(AuditedToolRegistry.ComputeArgsDigest(docArgs));

        using var decision = JsonDocument.Parse(trail[2].Data);
        decision.RootElement.GetProperty("kind").GetString().Should().Be("acceptance");
        decision.RootElement.GetProperty("routing").GetString().Should().Be("decide-self");
        decision.RootElement.GetProperty("decisionKind").GetString().Should().Be("accept");
        decision.RootElement.GetProperty("rulesVersion").GetInt32().Should().Be(5);
        decision.RootElement.GetProperty("reasoningSummary").GetString().Should().Contain("Evidence checked");
    }
}
