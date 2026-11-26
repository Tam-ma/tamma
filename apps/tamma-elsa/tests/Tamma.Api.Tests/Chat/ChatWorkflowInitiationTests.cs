using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class ChatWorkflowInitiationTests
{
    [Test]
    public async Task Authorized_initiation_stamps_server_derived_initiatedBy_and_emits_WORKFLOW_INITIATED()
    {
        var tenantId = Guid.NewGuid();
        var actingUser = Guid.NewGuid();
        var spoofedUser = Guid.NewGuid();
        var convId = Guid.NewGuid();
        var turnId = Guid.NewGuid();

        Dictionary<string, object>? capturedInput = null;
        var appended = new List<DomainEvent>();

        var authorizer = new Mock<IWorkflowInitiationAuthorizer>(MockBehavior.Strict);
        authorizer.Setup(a => a.AuthorizeAsync(actingUser, tenantId, "acme/web", "investigate-issue", It.IsAny<CancellationToken>()))
            .ReturnsAsync(WorkflowInitiationDecision.Allow());

        var elsa = new Mock<IElsaWorkflowService>(MockBehavior.Strict);
        elsa.Setup(e => e.StartWorkflowAsync("investigate-issue", It.IsAny<Dictionary<string, object>>()))
            .Callback<string, Dictionary<string, object>>((_, inp) => capturedInput = inp)
            .ReturnsAsync("wf-inst-99");

        var events = new Mock<IEventRepository>(MockBehavior.Strict);
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(evt => appended.Add(evt))
            .ReturnsAsync((DomainEvent evt) => evt);

        var svc = new ChatWorkflowInitiationService(authorizer.Object, elsa.Object, events.Object);
        var res = await svc.InitiateAsync(new ChatWorkflowInitiationRequest(
            TenantId: tenantId,
            UserId: actingUser,
            WorkflowName: "investigate-issue",
            RepoFullName: "acme/web",
            ConversationId: convId,
            TurnId: turnId,
            Input: new Dictionary<string, object>
            {
                // Attempt to spoof initiatedBy from LLM tool args — MUST be overwritten!
                ["initiatedBy"] = spoofedUser.ToString("D"),
                ["issueNumber"] = 42,
            },
            IssueId: "acme/web#42"));

        res.Allowed.Should().BeTrue();
        res.WorkflowInstanceId.Should().Be("wf-inst-99");

        capturedInput.Should().NotBeNull();
        capturedInput!["initiatedBy"].Should().Be(actingUser.ToString("D"));
        capturedInput["conversationId"].Should().Be(convId.ToString("D"));
        capturedInput["chatTurnId"].Should().Be(turnId.ToString("D"));
        capturedInput["tenantId"].Should().Be(tenantId.ToString("D"));
        capturedInput["issueNumber"].Should().Be(42);

        appended.Should().ContainSingle(e => e.Type == ChatEvents.WorkflowInitiated);
        var evt = appended.Single();
        using var tags = JsonDocument.Parse(evt.Tags);
        tags.RootElement.GetProperty("initiatedBy").GetString().Should().Be(actingUser.ToString("D"));
        tags.RootElement.GetProperty("conversationId").GetString().Should().Be(convId.ToString("D"));
        tags.RootElement.GetProperty("turnId").GetString().Should().Be(turnId.ToString("D"));
        tags.RootElement.GetProperty("issueId").GetString().Should().Be("acme/web#42");
    }

    [Test]
    public async Task Unauthorized_initiation_does_not_dispatch_and_emits_WORKFLOW_REFUSED()
    {
        var tenantId = Guid.NewGuid();
        var actingUser = Guid.NewGuid();
        var convId = Guid.NewGuid();
        var turnId = Guid.NewGuid();
        var appended = new List<DomainEvent>();

        var authorizer = new Mock<IWorkflowInitiationAuthorizer>(MockBehavior.Strict);
        authorizer.Setup(a => a.AuthorizeAsync(actingUser, tenantId, "acme/private", "investigate-issue", It.IsAny<CancellationToken>()))
            .ReturnsAsync(WorkflowInitiationDecision.Deny("user lacks contribute access on acme/private"));

        var elsa = new Mock<IElsaWorkflowService>(MockBehavior.Strict);
        var events = new Mock<IEventRepository>(MockBehavior.Strict);
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(evt => appended.Add(evt))
            .ReturnsAsync((DomainEvent evt) => evt);

        var svc = new ChatWorkflowInitiationService(authorizer.Object, elsa.Object, events.Object);
        var res = await svc.InitiateAsync(new ChatWorkflowInitiationRequest(
            TenantId: tenantId,
            UserId: actingUser,
            WorkflowName: "investigate-issue",
            RepoFullName: "acme/private",
            ConversationId: convId,
            TurnId: turnId));

        res.Allowed.Should().BeFalse();
        res.RefusalReason.Should().Contain("contribute");
        elsa.VerifyNoOtherCalls();

        appended.Should().ContainSingle(e => e.Type == ChatEvents.WorkflowRefused);
        appended.Single().Data.Should().Contain("acme/private");
    }

    [Test]
    public async Task WorkflowControlTool_chat_dispatch_routes_through_ChatWorkflowInitiationService_and_fails_closed_if_unwired()
    {
        var tenantId = Guid.NewGuid();
        var actingUser = Guid.NewGuid();
        var convId = Guid.NewGuid();
        var ctx = new OrchestratorToolContext(
            TenantId: tenantId,
            UserId: null,
            ActingUserId: actingUser,
            DecisionSessionId: null,
            CorrelationId: $"chat:{convId:D}",
            AllowWriteVerbs: true);

        var elsa = new Mock<IElsaWorkflowService>(MockBehavior.Strict);

        // Unwired -> fail closed, never touch Elsa directly.
        var unwiredTool = new WorkflowControlTool(ctx, elsa.Object);
        var unwiredRes = await unwiredTool.ExecuteAsync(
            "c1", """{"verb":"dispatch","workflowName":"investigate-issue","repo":"acme/web"}""");
        unwiredRes.Success.Should().BeFalse();
        unwiredRes.Output.Should().Contain("not configured");
        elsa.VerifyNoOtherCalls();

        // Wired -> routes through IChatWorkflowInitiationService.
        var init = new Mock<IChatWorkflowInitiationService>(MockBehavior.Strict);
        init.Setup(i => i.InitiateAsync(
                It.Is<ChatWorkflowInitiationRequest>(r =>
                    r.UserId == actingUser &&
                    r.TenantId == tenantId &&
                    r.ConversationId == convId &&
                    r.WorkflowName == "investigate-issue" &&
                    r.RepoFullName == "acme/web"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(ChatWorkflowInitiationResult.Initiated("wf-42"));

        var wiredTool = new WorkflowControlTool(ctx, elsa.Object, init.Object);
        var wiredRes = await wiredTool.ExecuteAsync(
            "c2", """{"verb":"dispatch","workflowName":"investigate-issue","repo":"acme/web","input":{"initiatedBy":"spoofed"}}""");
        wiredRes.Success.Should().BeTrue();
        wiredRes.Output.Should().Contain("wf-42");
        wiredRes.Output.Should().Contain(actingUser.ToString("D"));
        elsa.VerifyNoOtherCalls();
    }
}
