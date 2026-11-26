using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Core.Documents.Channels;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class OrchestratorChatServiceTests
{
    [Test]
    public async Task Offline_agent_returns_Offline_emits_zero_events_and_touches_no_channel()
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var agents = new Mock<IOrchestratorAgentRegistry>(MockBehavior.Strict);
        OrchestratorAgentInstance? none = null;
        agents.Setup(a => a.TryGet(tenantId, out none)).Returns(false);

        var recorder = new Mock<IChatTranscriptRecorder>(MockBehavior.Strict);
        var sender = new Mock<IUserChannelSender>(MockBehavior.Strict);

        var svc = new OrchestratorChatService(
            agents.Object,
            recorder.Object,
            sender.Object,
            Options.Create(new OrchestratorHostOptions { Enabled = false }),
            NullLogger<OrchestratorChatService>.Instance);

        var result = await svc.RelayUserMessageAsync(
            tenantId,
            userId,
            new AgentConversationMessage(Guid.NewGuid(), userId, "user->agent", "Are you there?"),
            CancellationToken.None);

        result.Accepted.Should().BeFalse();
        result.Reason.Should().Contain("offline");
        recorder.VerifyNoOtherCalls();
        sender.VerifyNoOtherCalls();
    }

    [Test]
    public async Task Online_agent_records_RECEIVED_before_turn_and_SENT_before_channel_push_with_scope_refusal()
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var convId = Guid.NewGuid();
        var callOrder = new List<string>();
        var pushedEnvelopes = new List<(Guid TenantId, Guid UserId, ChannelEnvelope Env)>();

        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent evt) => evt);

        // Scripted turn runner that simulates checking an inaccessible repo tool (denied)
        // and responding with a permission-shaped refusal containing zero foreign data.
        var turnRunner = new Mock<IOrchestratorTurnRunner>();
        turnRunner.Setup(r => r.RunTurnAsync(It.IsAny<OrchestratorTurnRequest>(), It.IsAny<CancellationToken>()))
            .Returns(async (OrchestratorTurnRequest req, CancellationToken ct) =>
            {
                callOrder.Add("agent-turn");
                // Probe git_read on an inaccessible repo; RepoAccessEvaluator denies userId.
                var toolRes = await req.Registry.ExecuteAsync(
                    "git_read", "call-1", """{"verb":"list_files","repository":"acme/secret-repo"}""", ct);
                toolRes.Success.Should().BeFalse("attenuated tool must refuse inaccessible repo");
                return new OrchestratorTurnResult(
                    Success: true,
                    ResponseText: "I cannot access acme/secret-repo because your account does not have permission on that repository.",
                    InputTokens: 100,
                    OutputTokens: 25,
                    CostUsd: 0m);
            });

        var repoAccess = new Mock<IRepoAccessEvaluator>();
        repoAccess.Setup(r => r.GetEffectiveAccessLevelAsync(userId, tenantId, null, "acme/secret-repo", It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        var configService = new Mock<IOrchestratorConfigService>();
        configService.Setup(c => c.ResolveForTenantAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ResolvedOrchestratorConfig(
                new OrchestratorAgentConfig
                {
                    Model = "claude-sonnet-4-6",
                    Provider = "anthropic",
                    MaxSessionTokens = 100_000,
                    CompactAfterTurns = 40,
                    MaxUsdPerDay = 10m,
                },
                Source: "default",
                Version: 1,
                UpdatedAt: DateTimeOffset.UtcNow));

        var elsa = new Mock<IElsaWorkflowService>();
        var docs = new Mock<IDocumentInstanceRepository>();
        var platforms = new Mock<IPlatformResolver>();
        var rulesRepo = new Mock<IAcceptanceRulesRepository>();
        var rulesFactory = new GetAcceptanceRulesToolFactory(
            new AcceptanceRulesService(rulesRepo.Object, new AcceptanceRulesEventsService(events.Object)));
        var taskAssignment = new Mock<ITaskAssignmentService>();
        var inbox = new InMemoryOrchestratorInbox();

        var toolDeps = new OrchestratorToolDependencies(
            events.Object,
            elsa.Object,
            docs.Object,
            platforms.Object,
            rulesFactory,
            Diagnostics: null,
            AudienceResolver: null,
            RepoAccessEvaluator: repoAccess.Object);

        var instance = new OrchestratorAgentInstance(
            tenantId,
            ownerUserId: null,
            inbox,
            turnRunner.Object,
            configService.Object,
            toolDeps,
            new DocumentDecisionSubmissionService(elsa.Object),
            new EscalationDispositionService(events.Object, NullLogger<EscalationDispositionService>.Instance),
            taskAssignment.Object,
            events.Object,
            NullLogger<OrchestratorAgentInstance>.Instance);

        var agents = new Mock<IOrchestratorAgentRegistry>();
        OrchestratorAgentInstance? outInstance = instance;
        agents.Setup(a => a.TryGet(tenantId, out outInstance)).Returns(true);

        var recorder = new Mock<IChatTranscriptRecorder>();
        recorder.Setup(r => r.RecordReceivedAsync(tenantId, userId, It.IsAny<AgentConversationMessage>(), It.IsAny<CancellationToken>()))
            .Callback(() => callOrder.Add("record-received"))
            .Returns(Task.CompletedTask);
        recorder.Setup(r => r.RecordSentAsync(tenantId, userId, It.IsAny<AgentConversationMessage>(), It.IsAny<CancellationToken>()))
            .Callback(() => callOrder.Add("record-sent"))
            .Returns(Task.CompletedTask);

        var sender = new Mock<IUserChannelSender>();
        sender.Setup(s => s.SendToUserAsync(tenantId, userId, It.IsAny<ChannelEnvelope>(), It.IsAny<CancellationToken>()))
            .Callback<Guid, Guid, ChannelEnvelope, CancellationToken>((t, u, env, _) =>
            {
                callOrder.Add("channel-push");
                pushedEnvelopes.Add((t, u, env));
            })
            .Returns(Task.CompletedTask);

        var svc = new OrchestratorChatService(
            agents.Object,
            recorder.Object,
            sender.Object,
            Options.Create(new OrchestratorHostOptions { Enabled = true }),
            NullLogger<OrchestratorChatService>.Instance);

        var res = await svc.RelayUserMessageAsync(
            tenantId,
            userId,
            new AgentConversationMessage(convId, Guid.NewGuid(), "user->agent", "Summarize acme/secret-repo"),
            CancellationToken.None);

        res.Accepted.Should().BeTrue();
        callOrder.Should().Equal("record-received", "agent-turn", "record-sent", "channel-push");
        pushedEnvelopes.Should().HaveCount(1);
        pushedEnvelopes[0].TenantId.Should().Be(tenantId);
        pushedEnvelopes[0].UserId.Should().Be(userId);
        var replyMsg = pushedEnvelopes[0].Env.Message.Should().BeOfType<AgentConversationMessage>().Subject;
        replyMsg.ConversationId.Should().Be(convId);
        replyMsg.Direction.Should().Be("agent->user");
        replyMsg.Text.Should().Contain("permission");
    }
}
