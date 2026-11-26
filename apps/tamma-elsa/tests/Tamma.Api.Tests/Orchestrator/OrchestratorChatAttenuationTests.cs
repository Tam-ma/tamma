using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents.Channels;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC4 / AC5 / D12) — per-user chat attenuation &amp; isolation:
/// serving user X attenuates <c>document_get</c>/<c>issue_read</c> to X's 39-20
/// scope, stamps X's <c>userId</c> on <c>ORCHESTRATOR.TOOL.INVOKED</c>, keeps
/// user Y's chat history isolated from X, and invokes <see cref="IChatTranscriptRecorder"/>.
/// </summary>
[TestFixture]
public class OrchestratorChatAttenuationTests
{
    [Test]
    public async Task Chat_serving_user_X_attenuates_document_access_stamps_userId_and_isolates_user_Y()
    {
        var rig = new OrchestratorTestHarness.Rig();
        var userX = Guid.NewGuid();
        var userY = Guid.NewGuid();
        var restrictedDocId = Guid.NewGuid();

        rig.Documents.Setup(d => d.GetByIdAsync(rig.TenantId, restrictedDocId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentInstance
            {
                Id = restrictedDocId,
                TenantId = rig.TenantId,
                DocumentType = "findings",
                SchemaVersion = 1,
                IssueId = "org/secret-repo#7",
                CorrelationId = "corr-secret",
                ProducedByRole = "architect",
                ProducedByAction = "context-scan",
                Status = "in_review",
                BodyJson = """{"topic":"secret","summary":"Confidential findings","findings":[{"title":"F1","summary":"Details","relevance":0.9,"confidence":0.9,"citations":["src/secret.cs"]}],"overallConfidence":0.9}""",
                Revision = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });

        // User X is DENIED by ITaskAudienceResolver; User Y is ALLOWED.
        rig.AudienceResolver.Setup(a => a.CanSeeAsync(userX, It.IsAny<TaskRef>())).ReturnsAsync(false);
        rig.AudienceResolver.Setup(a => a.CanSeeAsync(userY, It.IsAny<TaskRef>())).ReturnsAsync(true);

        var recorder = new Mock<IChatTranscriptRecorder>();

        // User X tries to read restrictedDocId
        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            FinalResponse: "Sorry, you do not have access to that document.",
            ToolCalls: new[]
            {
                new ScriptedTurnRunner.ScriptedToolCall("document_get", $$"""{"documentId":"{{restrictedDocId}}","repoKey":"org/secret-repo"}"""),
            }));

        var convX = Guid.NewGuid();
        var replyX = await rig.Instance.HandleConversationAsync(
            userX,
            new AgentConversationMessage(convX, userX, "user->agent", "Show me the secret plan."),
            allowWriteVerbs: false,
            recorder: recorder.Object);

        replyX.Direction.Should().Be("agent->user");
        rig.Runner.ExecutedToolResults.Should().ContainSingle();
        rig.Runner.ExecutedToolResults[0].Success.Should().BeFalse("user X lacks scope on org/secret-repo");
        rig.Runner.ExecutedToolResults[0].Output.Should().Contain("Access denied");

        // Tool invocation audit event carries userX's userId tag
        var toolEvent = rig.EmittedEvents.Single(e => e.Type == OrchestratorEvents.ToolInvoked);
        using (var tagsDoc = JsonDocument.Parse(toolEvent.Tags))
        {
            tagsDoc.RootElement.GetProperty("userId").GetString().Should().Be(userX.ToString("D"));
        }

        // Recorder captured received + sent
        recorder.Verify(r => r.RecordReceivedAsync(rig.TenantId, userX, It.IsAny<AgentConversationMessage>(), It.IsAny<CancellationToken>()), Times.Once);
        recorder.Verify(r => r.RecordSentAsync(rig.TenantId, userX, replyX, It.IsAny<CancellationToken>()), Times.Once);

        // Now user Y chats: Y's message list must NOT contain X's prompt or reply, and Y CAN read the doc
        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            FinalResponse: "Here is your plan summary.",
            ToolCalls: new[]
            {
                new ScriptedTurnRunner.ScriptedToolCall("document_get", $$"""{"documentId":"{{restrictedDocId}}","repoKey":"org/secret-repo"}"""),
            }));

        var replyY = await rig.Instance.HandleConversationAsync(
            userY,
            new AgentConversationMessage(Guid.NewGuid(), userY, "user->agent", "Summarize the plan."),
            allowWriteVerbs: false,
            recorder: recorder.Object);

        replyY.Text.Should().Contain("plan summary");
        rig.Runner.ExecutedToolResults[1].Success.Should().BeTrue("user Y has access to org/secret-repo");

        var yPromptHistory = rig.Runner.RecordedRequests[1].Messages;
        yPromptHistory.Should().NotContain(m => m.Content != null && m.Content.Contains("Show me the secret plan"),
            "user Y must never see user X's chat transcript");
    }
}
