using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Credentials;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Providers;
using Tamma.Api.Services.Security;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Agents.ToolAudit;

/// <summary>
/// Story 42-5 AC5 &amp; D4 — verifies <see cref="ManagedAgentRequest.IssueId"/> round-trips
/// through <see cref="ManagedAgent"/> → <see cref="InlineToolLoopRunner"/> →
/// <see cref="ToolAuditEmitter"/> onto every <c>TOOL.*</c> DCB row (non-null <c>issueId</c>,
/// <c>tenantId</c>, <c>toolName</c>, <c>toolCallId</c>), and proves an issue's complete
/// tool timeline can be replayed from <c>domain_events</c> alone.
/// </summary>
[TestFixture]
public class ToolAuditLineageTests
{
    [Test]
    public async Task AC5_ManagedAgentThreadsIssueIdIntoToolEvents_AndReplayReconstructsTimeline()
    {
        var tenantId = Guid.NewGuid();
        var agentId = Guid.NewGuid();
        var eventRepo = new RecordingAuditEventRepository();
        var toolAuditEmitter = new ToolAuditEmitter(eventRepo, new CapturingAuditLogger<ToolAuditEmitter>());

        // Issue TAM-425 makes two tool calls across two turns; Issue TAM-999 makes one unrelated tool call.
        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-1", "file_read", new { path = "src/A.cs" })),
            ToolAuditTestFixtures.AnthropicToolUse(("tc-2", "run_tests", new { filter = "Unit" })),
            ToolAuditTestFixtures.AnthropicEndTurn("TAM-425 complete"),
            ToolAuditTestFixtures.AnthropicToolUse(("tc-other", "file_read", new { path = "other.cs" })),
            ToolAuditTestFixtures.AnthropicEndTurn("TAM-999 complete"));

        var readExec = new LambdaToolExecutor(
            "file_read",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "file_read", true, "code", 5)));
        var testExec = new LambdaToolExecutor(
            "run_tests",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "run_tests", true, "passed", 42)));

        var registry = new ToolExecutorRegistry(
            new IToolExecutor[] { readExec, testExec },
            NullLogger<ToolExecutorRegistry>.Instance);

        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, toolAuditEmitter);

        var managedAgent = CreateManagedAgent(agentId, runner, registry, eventRepo);

        // Run 1: Issue TAM-425
        var run1 = await managedAgent.RunAsync(new ManagedAgentRequest
        {
            TenantId = tenantId,
            Role = "developer",
            Action = "implement-feature",
            Prompt = "implement TAM-425",
            CorrelationId = "corr-tam-425",
            IssueId = "TAM-425",
            EnableToolLoop = true,
            Tools = new[] { "file_read", "run_tests" },
            Params = new LlmCallParams { MaxTokens = 1024, Temperature = 0.0 },
        });
        run1.Success.Should().BeTrue();

        // Run 2: Issue TAM-999 (noise to prove replay isolates by issueId)
        var run2 = await managedAgent.RunAsync(new ManagedAgentRequest
        {
            TenantId = tenantId,
            Role = "developer",
            Action = "implement-feature",
            Prompt = "implement TAM-999",
            CorrelationId = "corr-tam-999",
            IssueId = "TAM-999",
            EnableToolLoop = true,
            Tools = new[] { "file_read" },
            Params = new LlmCallParams { MaxTokens = 1024, Temperature = 0.0 },
        });
        run2.Success.Should().BeTrue();

        // Replay: reconstruct TAM-425's tool timeline from domain_events alone.
        var tam425Timeline = eventRepo.Events
            .Where(e => e.Type.StartsWith("TOOL.", StringComparison.Ordinal))
            .Where(e => ReadTag(e, "issueId") == "TAM-425")
            .ToList();

        tam425Timeline.Should().HaveCount(4, "2 tool calls * (TOOL.INVOKED + TOOL.SUCCEEDED)");
        tam425Timeline.Select(e => (e.Type, ReadTag(e, "toolName"), ReadTag(e, "toolCallId")))
            .Should().Equal(
                (ToolAuditEventTypes.Invoked, "file_read", "tc-1"),
                (ToolAuditEventTypes.Succeeded, "file_read", "tc-1"),
                (ToolAuditEventTypes.Invoked, "run_tests", "tc-2"),
                (ToolAuditEventTypes.Succeeded, "run_tests", "tc-2"));

        foreach (var evt in tam425Timeline)
        {
            evt.TenantId.Should().Be(tenantId);
            ReadTag(evt, "issueId").Should().Be("TAM-425");
            ReadTag(evt, "tenantId").Should().Be(tenantId.ToString());
            ReadTag(evt, "correlationId").Should().Be("corr-tam-425");
            ReadTag(evt, "agentId").Should().Be(agentId.ToString());
            ReadTag(evt, "role").Should().Be("developer");
        }

        // Also confirm AGENT.TASK.SUCCESS trail row itself now carries non-null issueId (D4 fix).
        var agentTaskRows = eventRepo.Events
            .Where(e => e.Type == AgentTrailEventTypes.TaskSuccess && ReadTag(e, "issueId") == "TAM-425")
            .ToList();
        agentTaskRows.Should().ContainSingle();
    }

    private static ManagedAgent CreateManagedAgent(
        Guid agentId,
        IInlineToolLoopRunner runner,
        IToolExecutorRegistry registry,
        RecordingAuditEventRepository eventRepo)
    {
        var gate = new Mock<ISaaSProviderGate>();
        gate.Setup(g => g.InspectAsync(It.IsAny<ProviderGateContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ProviderGateDecision.Allow(ProviderAuthModel.ApiKey));

        var budget = new Mock<IBudgetGuard>();
        budget.Setup(b => b.IsWithinBudgetAsync(It.IsAny<Guid?>(), It.IsAny<decimal>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var resolver = new Mock<IAgentResolverService>();
        resolver.Setup(r => r.ResolveForRoleAsync("developer", It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ResolvedAgentConfig
            {
                Role = "developer",
                Handle = "tamma-developer",
                Provider = "anthropic",
                Model = ToolAuditTestFixtures.Model,
                Temperature = 0.0,
                MaxTokens = 1024,
                TokenBudget = 100_000,
                SystemPrompt = "You are a developer.",
                AgentId = agentId,
                AgentVersion = 3,
                Source = "system-public",
            });

        var credentials = new Mock<IProviderCredentialResolver>();
        credentials.Setup(c => c.ResolveAsync(It.IsAny<Guid?>(), "anthropic", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ProviderCredential("test-api-key", CredentialSource.Platform, "platform:anthropic/api-key", null));

        var pricing = new Mock<IProviderPricingService>();
        pricing.Setup(p => p.Compute(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>()))
            .Returns(0.001m);

        var trailEmitter = new AgentTrailEmitter(eventRepo, NullLogger<AgentTrailEmitter>.Instance);

        return new ManagedAgent(
            gate.Object,
            budget.Object,
            resolver.Object,
            credentials.Object,
            runner,
            pricing.Object,
            new PassthroughProviderMarkupEngine(),
            new Mock<IUsageEmitter>().Object,
            eventRepo,
            NullLogger<ManagedAgent>.Instance,
            sanitizer: null,
            trail: trailEmitter,
            runStreamBus: null,
            repairOptions: null,
            toolRegistry: registry);
    }

    private static string? ReadTag(DomainEvent evt, string key)
    {
        using var doc = JsonDocument.Parse(evt.Tags);
        return doc.RootElement.TryGetProperty(key, out var val) ? val.GetString() : null;
    }
}
