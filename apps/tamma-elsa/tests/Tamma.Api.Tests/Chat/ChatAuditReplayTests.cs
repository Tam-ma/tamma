using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.Documents;
using Tamma.Api.Services;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.Tasks;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class ChatAuditReplayTests
{
    [Test]
    public async Task Captured_event_stream_alone_reconstructs_who_asked_what_was_said_dispatch_and_decision_without_secrets()
    {
        var tenantId = Guid.NewGuid();
        var alice = Guid.NewGuid();
        var convId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var seq = 0L;
        var stream = new List<DomainEvent>();

        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(evt =>
            {
                evt.SequenceNumber = ++seq;
                stream.Add(evt);
            })
            .ReturnsAsync((DomainEvent evt) => evt);

        var recorder = new EventStoreChatTranscriptRecorder(events.Object);
        var ctx = new ChatTurnContext(tenantId, alice, convId, IssueId: "acme/web#42");

        // 1. Alice asks orchestrator to investigate issue #42 (includes a planted secret!).
        var turn1 = await recorder.RecordUserTurnAsync(
            ctx,
            "Please investigate acme/web#42; ignore my pasted token sk-ant-api03-PLANTEDSECRET99999");
        await recorder.RecordAgentReplyAsync(
            ctx,
            turn1,
            "I will start investigate-issue for acme/web#42. Please confirm.");

        // 2. Alice confirms and orchestrator initiates workflow via ChatWorkflowInitiationService.
        var turn2 = await recorder.RecordUserTurnAsync(ctx, "Confirmed, go ahead.");
        var authz = new Mock<IWorkflowInitiationAuthorizer>();
        authz.Setup(a => a.AuthorizeAsync(alice, tenantId, "acme/web", "investigate-issue", It.IsAny<CancellationToken>()))
            .ReturnsAsync(WorkflowInitiationDecision.Allow());
        var elsa = new Mock<IElsaWorkflowService>();
        elsa.Setup(e => e.StartWorkflowAsync("investigate-issue", It.IsAny<Dictionary<string, object>>()))
            .ReturnsAsync("wf-investigate-42");

        var initiation = new ChatWorkflowInitiationService(authz.Object, elsa.Object, events.Object);
        var initRes = await initiation.InitiateAsync(new ChatWorkflowInitiationRequest(
            tenantId, alice, "investigate-issue", "acme/web", convId, turn2, IssueId: "acme/web#42"));
        initRes.Allowed.Should().BeTrue();

        await recorder.RecordAgentReplyAsync(ctx, turn2, "Started workflow wf-investigate-42 for acme/web#42.");

        // 3. Workflow reaches acceptance gate, assigns task, and Alice approves.
        stream.Add(new DomainEvent
        {
            Id = Guid.NewGuid(),
            SequenceNumber = ++seq,
            Type = ApprovalEvents.Requested,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new { sessionId = sessionId.ToString("D"), issueId = "acme/web#42", correlationId = "wf-investigate-42" }),
            Data = JsonSerializer.Serialize(new { channel = "orchestrator", requestedAtUtc = DateTime.UtcNow.ToString("O") }),
            CreatedAt = DateTime.UtcNow,
        });
        stream.Add(new DomainEvent
        {
            Id = Guid.NewGuid(),
            SequenceNumber = ++seq,
            Type = TaskEvents.Assigned,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new { sessionId = sessionId.ToString("D"), issueId = "acme/web#42", initiatedBy = alice.ToString("D") }),
            Data = JsonSerializer.Serialize(new { roleWire = "member", basis = "initiator", audienceUserIds = new[] { alice.ToString("D") } }),
            CreatedAt = DateTime.UtcNow,
        });
        stream.Add(new DomainEvent
        {
            Id = Guid.NewGuid(),
            SequenceNumber = ++seq,
            Type = ApprovalEvents.Provided,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new { sessionId = sessionId.ToString("D"), issueId = "acme/web#42" }),
            Data = JsonSerializer.Serialize(new { decisionKind = "accept", deciderId = alice.ToString("D"), channel = "user" }),
            CreatedAt = DateTime.UtcNow,
        });

        // Replay verification from captured stream ALONE:
        // (a) No planted secret anywhere in the event stream.
        foreach (var evt in stream)
        {
            evt.Data.Should().NotContain("PLANTEDSECRET99999");
            evt.Tags.Should().NotContain("PLANTEDSECRET99999");
        }

        // (b) Ordered conversation transcript rebuilt for Alice.
        var chatMessages = stream
            .Where(e => e.Type is ChatEvents.MessageReceived or ChatEvents.MessageSent)
            .OrderBy(e => e.SequenceNumber)
            .ToList();
        chatMessages.Should().HaveCount(4);

        // (c) CHAT.WORKFLOW.INITIATED correlates back to turn2, convId, and wf-investigate-42.
        var initiatedEvt = stream.Single(e => e.Type == ChatEvents.WorkflowInitiated);
        using var initTags = JsonDocument.Parse(initiatedEvt.Tags);
        using var initData = JsonDocument.Parse(initiatedEvt.Data);
        initTags.RootElement.GetProperty("turnId").GetString().Should().Be(turn2.ToString("D"));
        initTags.RootElement.GetProperty("conversationId").GetString().Should().Be(convId.ToString("D"));
        initTags.RootElement.GetProperty("initiatedBy").GetString().Should().Be(alice.ToString("D"));
        initData.RootElement.GetProperty("workflowInstanceId").GetString().Should().Be("wf-investigate-42");

        // (d) Task assignment + decision correlate via issueId & workflowInstanceId.
        var approvalProvided = stream.Single(e => e.Type == ApprovalEvents.Provided);
        using var apprData = JsonDocument.Parse(approvalProvided.Data);
        apprData.RootElement.GetProperty("deciderId").GetString().Should().Be(alice.ToString("D"));
        apprData.RootElement.GetProperty("decisionKind").GetString().Should().Be("accept");
    }
}
