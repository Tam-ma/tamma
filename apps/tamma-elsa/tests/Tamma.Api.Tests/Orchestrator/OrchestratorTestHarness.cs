using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Tamma.Api.Services;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Core.Documents.Policy;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Shared builder helpers for deterministic Story 39-17 orchestrator tests.
/// </summary>
internal static class OrchestratorTestHarness
{
    public static DocumentEnvelope MakeDoc(
        DocumentTypeKey type,
        string issueId = "org/repo#42",
        string correlationId = "corr-42",
        string payloadJson = """{"summary":"Test document"}""",
        string action = "plan-implementation")
    {
        using var payloadDoc = JsonDocument.Parse(payloadJson);
        return DocumentEnvelope.CreateDraft(
            type,
            schemaVersion: 1,
            issueId: issueId,
            correlationId: correlationId,
            producedBy: new DocumentProducer { Role = "architect", Action = action, WorkflowDefinitionId = "document-lifecycle" },
            payload: payloadDoc.RootElement.Clone());
    }

    public static DocumentEnvelope MakeReview(
        string decision = "approve",
        bool hasBlockingIssues = false,
        string issueId = "org/repo#42",
        string correlationId = "corr-42")
    {
        var payload = $$"""{"decision":"{{decision}}","hasBlockingIssues":{{(hasBlockingIssues ? "true" : "false")}},"comments":[]}""";
        return MakeDoc(DocumentTypeKey.Review, issueId, correlationId, payload, action: "code-review");
    }

    public static AcceptanceRequest MakeRequest(
        DocumentTypeKey docType = DocumentTypeKey.Findings,
        int autonomyLevel = 100,
        int roundsUsed = 0,
        int maxRevisionRounds = 3,
        string reviewDecision = "approve",
        bool hasBlockingIssues = false,
        EscalationClass[]? alwaysEscalate = null,
        string issueId = "org/repo#42",
        int rulesVersion = 2)
    {
        var doc = MakeDoc(docType, issueId: issueId);
        var review = MakeReview(reviewDecision, hasBlockingIssues, issueId: issueId);
        var rules = AcceptanceDefaults.Rules with
        {
            AutonomyLevel = autonomyLevel,
            MaxRevisionRounds = maxRevisionRounds,
            AlwaysEscalate = alwaysEscalate ?? Array.Empty<EscalationClass>(),
        };
        var resolved = new ResolvedAcceptanceRules(
            rules,
            AcceptanceRulesSource.TypeOverride,
            rulesVersion,
            docType.ToWire(),
            DateTimeOffset.UtcNow);

        return new AcceptanceRequest
        {
            DecisionSessionId = Guid.NewGuid(),
            Document = doc,
            Review = review,
            Lineage = new[] { doc, review },
            RoundsUsed = roundsUsed,
            Rules = resolved,
            IssueId = issueId,
        };
    }

    public sealed class Rig
    {
        public Guid TenantId { get; init; } = Guid.NewGuid();
        public Guid? OwnerUserId { get; init; }
        public InMemoryOrchestratorInbox Inbox { get; } = new();
        public ScriptedTurnRunner Runner { get; } = new();
        public List<DomainEvent> EmittedEvents { get; } = new();
        public List<(Guid SessionId, string DecisionJson, string Channel)> ResumeCalls { get; } = new();
        public List<(Guid TenantId, GuidanceReply Reply)> GuidanceReplies { get; } = new();

        public Mock<IEventRepository> Events { get; } = new();
        public Mock<IElsaWorkflowService> Elsa { get; } = new();
        public Mock<IDocumentInstanceRepository> Documents { get; } = new();
        public Mock<IPlatformResolver> Platforms { get; } = new();
        public Mock<IAcceptanceRulesResolver> RulesResolver { get; } = new();
        public Mock<IOrchestratorConfigService> ConfigService { get; } = new();
        public Mock<ITaskAssignmentService> TaskAssignment { get; } = new();
        public Mock<ITaskAudienceResolver> AudienceResolver { get; } = new();
        public Mock<IRepoAccessEvaluator> RepoAccess { get; } = new();

        public OrchestratorAgentInstance Instance { get; }

        public Rig(
            Guid? tenantId = null,
            Guid? ownerUserId = null,
            OrchestratorAgentConfig? config = null,
            bool gateNotFound = false)
        {
            TenantId = tenantId ?? Guid.NewGuid();
            OwnerUserId = ownerUserId;

            Events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
                .Callback<DomainEvent>(ev => EmittedEvents.Add(ev))
                .ReturnsAsync((DomainEvent ev) => ev);

            Events.Setup(e => e.QueryEventsAsync(
                    It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<bool>(),
                    It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<DateTimeOffset?>(),
                    It.IsAny<DateTimeOffset?>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<bool>()))
                .ReturnsAsync((new List<DomainEvent>(), (int?)0));

            Elsa.Setup(e => e.ResumeDocumentDecisionAsync(
                    It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<string>(),
                    It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(),
                    It.IsAny<string>(), It.IsAny<string?>()))
                .ReturnsAsync((Guid dsid, string? _, string decisionJson, string? _, string? _, string? _, string channel, string? _) =>
                {
                    ResumeCalls.Add((dsid, decisionJson, channel));
                    return new MergeApprovalResumeResult(!gateNotFound, gateNotFound, gateNotFound ? null : "wf-1");
                });

            RulesResolver.Setup(r => r.ResolveForTenantAsync(It.IsAny<Guid>(), It.IsAny<DocumentTypeKey>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid _, DocumentTypeKey dt, CancellationToken _) => new ResolvedAcceptanceRules(
                    AcceptanceDefaults.Rules, AcceptanceRulesSource.SystemDefault, 1, dt.ToWire(), DateTimeOffset.UtcNow));

            var effectiveConfig = config ?? OrchestratorAgentDefaults.Config;
            ConfigService.Setup(c => c.ResolveForTenantAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ResolvedOrchestratorConfig(effectiveConfig, "tenant", 1, DateTimeOffset.UtcNow));

            TaskAssignment.Setup(t => t.AssignAsync(
                    It.IsAny<Guid>(), It.IsAny<TaskRef>(), It.IsAny<string>(),
                    It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid _, TaskRef _, string role, string _, string? _, CancellationToken _) =>
                    AssignmentResult.Accepted(role, new[] { new AudienceMember(Guid.NewGuid(), role) }));

            var rulesFactory = new GetAcceptanceRulesToolFactory(RulesResolver.Object);
            var toolDeps = new OrchestratorToolDependencies(
                Events.Object,
                Elsa.Object,
                Documents.Object,
                Platforms.Object,
                rulesFactory,
                Diagnostics: null,
                AudienceResolver: AudienceResolver.Object,
                RepoAccessEvaluator: RepoAccess.Object);

            Instance = new OrchestratorAgentInstance(
                TenantId,
                OwnerUserId,
                Inbox,
                Runner,
                ConfigService.Object,
                toolDeps,
                new DocumentDecisionSubmissionService(Elsa.Object),
                new EscalationDispositionService(Events.Object, NullLogger<EscalationDispositionService>.Instance),
                TaskAssignment.Object,
                Events.Object,
                NullLogger<OrchestratorAgentInstance>.Instance,
                timeProvider: null,
                onGuidanceReply: (tid, reply, _) =>
                {
                    GuidanceReplies.Add((tid, reply));
                    return Task.CompletedTask;
                });
        }
    }
}
