using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Api.Services.Tasks;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class ChatNoBackdoorResumeTests
{
    [Test]
    public async Task Chat_resume_uses_DocumentDecisionSubmissionService_with_server_derived_actingUserId_and_ignores_spoofed_decider()
    {
        var tenantId = Guid.NewGuid();
        var actingUser = Guid.NewGuid();
        var spoofedUser = Guid.NewGuid();
        var sessionId = Guid.NewGuid();

        string? capturedDecider = null;
        string? capturedChannel = null;
        string? capturedTenant = null;
        Guid capturedSession = Guid.Empty;

        var elsa = new Mock<IElsaWorkflowService>(MockBehavior.Strict);
        elsa.Setup(e => e.ResumeDocumentDecisionAsync(
                sessionId,
                tenantId.ToString(),
                It.IsAny<string>(),
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                It.IsAny<string>(),
                It.IsAny<string?>()))
            .Callback<Guid, string?, string, string?, string?, string?, string, string?>((sid, tid, json, fb, decider, deciderDisplay, channel, rulesRef) =>
            {
                capturedSession = sid;
                capturedTenant = tid;
                capturedDecider = decider;
                capturedChannel = channel;
            })
            .ReturnsAsync(new MergeApprovalResumeResult(Resumed: true, GateNotFound: false, WorkflowInstanceId: "wf-doc-1"));

        var audience = new Mock<ITaskAudienceResolver>(MockBehavior.Strict);
        audience.Setup(a => a.CanSeeAsync(actingUser, It.IsAny<TaskRef>())).ReturnsAsync(true);

        var taskAssignment = new Mock<ITaskAssignmentService>(MockBehavior.Strict);
        taskAssignment.Setup(t => t.CompleteAsync(
                tenantId, It.IsAny<TaskRef>(), actingUser, TaskEvents.SurfaceChat, It.IsAny<CancellationToken>()))
            .ReturnsAsync(TaskCompletionResult.Completed());

        var ctx = new OrchestratorToolContext(
            TenantId: tenantId,
            UserId: null,
            ActingUserId: actingUser,
            DecisionSessionId: null,
            CorrelationId: $"chat:{Guid.NewGuid():D}",
            AllowWriteVerbs: true);

        var tool = new WorkflowControlTool(
            ctx,
            elsa.Object,
            chatInitiation: null,
            decisionSubmission: new DocumentDecisionSubmissionService(elsa.Object),
            audienceResolver: audience.Object,
            taskAssignment: taskAssignment.Object);

        // Attempt to spoof deciderId/channel in tool arguments — MUST be ignored.
        var res = await tool.ExecuteAsync("c1", $$"""
            {
                "verb": "resume",
                "sessionId": "{{sessionId:D}}",
                "decisionKind": "accept",
                "deciderId": "{{spoofedUser:D}}",
                "channel": "orchestrator",
                "repo": "acme/web",
                "feedback": "Looks good"
            }
            """);

        res.Success.Should().BeTrue();
        capturedSession.Should().Be(sessionId);
        capturedTenant.Should().Be(tenantId.ToString());
        capturedDecider.Should().Be(actingUser.ToString("D"), "chat resume MUST stamp the acting user's server-derived identity");
        capturedChannel.Should().Be("user", "chat resume MUST stamp channel=user, never orchestrator");
        taskAssignment.Verify(
            t => t.CompleteAsync(tenantId, It.IsAny<TaskRef>(), actingUser, TaskEvents.SurfaceChat, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Test]
    public async Task Chat_resume_refuses_raw_instanceId_bypass_cancel_and_unauthorized_user()
    {
        var tenantId = Guid.NewGuid();
        var actingUser = Guid.NewGuid();
        var sessionId = Guid.NewGuid();

        var elsa = new Mock<IElsaWorkflowService>(MockBehavior.Strict);
        var audience = new Mock<ITaskAudienceResolver>(MockBehavior.Strict);
        audience.Setup(a => a.CanSeeAsync(actingUser, It.IsAny<TaskRef>())).ReturnsAsync(false);

        var ctx = new OrchestratorToolContext(
            TenantId: tenantId,
            UserId: null,
            ActingUserId: actingUser,
            DecisionSessionId: null,
            CorrelationId: $"chat:{Guid.NewGuid():D}",
            AllowWriteVerbs: true);

        var tool = new WorkflowControlTool(
            ctx,
            elsa.Object,
            chatInitiation: null,
            decisionSubmission: new DocumentDecisionSubmissionService(elsa.Object),
            audienceResolver: audience.Object);

        // 1. Raw workflow instanceId resume without sessionId -> refused.
        var rawResume = await tool.ExecuteAsync("c1", """{"verb":"resume","instanceId":"wf-1"}""");
        rawResume.Success.Should().BeFalse();
        rawResume.Output.Should().Contain("no raw workflow resume backdoor");

        // 2. Cancel from chat -> refused.
        var cancel = await tool.ExecuteAsync("c2", """{"verb":"cancel","instanceId":"wf-1"}""");
        cancel.Success.Should().BeFalse();
        cancel.Output.Should().Contain("denied");

        // 3. Unauthorized user for repo -> refused before touching Elsa.
        var unauth = await tool.ExecuteAsync("c3", $$"""
            {"verb":"resume","sessionId":"{{sessionId:D}}","decisionKind":"accept","repo":"acme/secret"}
            """);
        unauth.Success.Should().BeFalse();
        unauth.Output.Should().Contain("not authorized");

        elsa.VerifyNoOtherCalls();
    }
}
