using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC2 / AC5 / D5) — verifies <see cref="AuditedToolRegistry"/>:
/// every invocation emits <c>ORCHESTRATOR.TOOL.INVOKED</c> with a SHA-256 args
/// digest (never raw args), stamps correlation/tenant/decisionSession/user tags,
/// swallows emission failure without losing the tool result, and refuses
/// dynamic <c>Register</c>/<c>Unregister</c>.
/// </summary>
[TestFixture]
public class AuditedToolRegistryTests
{
    private sealed class StubTool(string name, Func<string, Task<ToolExecutionResult>> handler) : IToolExecutor
    {
        public string ToolName => name;
        public string Description => "stub";
        public Dictionary<string, object> InputSchema => new();
        public ToolDescriptor Descriptor => ToolDescriptor.Default;
        public Task<ToolExecutionResult> ExecuteAsync(string toolCallId, string argumentsJson, CancellationToken cancellationToken = default)
            => handler(argumentsJson);
    }

    [Test]
    public async Task ExecuteAsync_emits_ORCHESTRATOR_TOOL_INVOKED_with_sha256_digest_and_no_raw_args()
    {
        var emitted = new List<DomainEvent>();
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(ev => emitted.Add(ev))
            .ReturnsAsync((DomainEvent ev) => ev);

        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var ctx = new OrchestratorToolContext(
            TenantId: tenantId,
            UserId: null,
            ActingUserId: userId,
            DecisionSessionId: sessionId,
            CorrelationId: "corr-audit-1",
            IssueId: "org/repo#99");

        const string secretArgs = """{"secretNeedle":"super-sensitive-value-123"}""";
        var tool = new StubTool("document_get", _ =>
            Task.FromResult(new ToolExecutionResult("tc-1", "document_get", true, """{"ok":true}""", 4)));

        var registry = new AuditedToolRegistry(new[] { tool }, ctx, events.Object);
        var result = await registry.ExecuteAsync("tc-1", "document_get", secretArgs);

        result.Success.Should().BeTrue();
        emitted.Should().ContainSingle();
        var ev = emitted[0];
        ev.Type.Should().Be(OrchestratorEvents.ToolInvoked);
        ev.TenantId.Should().Be(tenantId);

        // Raw args must NEVER appear in Data or Tags.
        ev.Data.Should().NotContain("super-sensitive-value-123");
        ev.Tags.Should().NotContain("super-sensitive-value-123");

        using var dataDoc = JsonDocument.Parse(ev.Data);
        dataDoc.RootElement.GetProperty("tool").GetString().Should().Be("document_get");
        dataDoc.RootElement.GetProperty("toolCallId").GetString().Should().Be("tc-1");
        dataDoc.RootElement.GetProperty("argsDigest").GetString().Should().Be(AuditedToolRegistry.ComputeArgsDigest(secretArgs));
        dataDoc.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        dataDoc.RootElement.GetProperty("correlationId").GetString().Should().Be("corr-audit-1");

        using var tagsDoc = JsonDocument.Parse(ev.Tags);
        tagsDoc.RootElement.GetProperty("tenantId").GetString().Should().Be(tenantId.ToString("D"));
        tagsDoc.RootElement.GetProperty("userId").GetString().Should().Be(userId.ToString("D"));
        tagsDoc.RootElement.GetProperty("decisionSessionId").GetString().Should().Be(sessionId.ToString("D"));
        tagsDoc.RootElement.GetProperty("issueId").GetString().Should().Be("org/repo#99");
    }

    [Test]
    public async Task ExecuteAsync_preserves_tool_result_when_event_store_throws()
    {
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ThrowsAsync(new InvalidOperationException("DCB temporarily unavailable"));

        var ctx = new OrchestratorToolContext(Guid.NewGuid(), null, null, null, "corr-err");
        var tool = new StubTool("git_read", _ =>
            Task.FromResult(new ToolExecutionResult("tc-2", "git_read", true, "branch-list", 2)));

        var registry = new AuditedToolRegistry(new[] { tool }, ctx, events.Object);
        var result = await registry.ExecuteAsync("tc-2", "git_read", """{"operation":"branches"}""");

        result.Success.Should().BeTrue();
        result.Output.Should().Be("branch-list");
    }

    [Test]
    public void Register_and_Unregister_are_forbidden_on_closed_registry()
    {
        var events = new Mock<IEventRepository>();
        var ctx = new OrchestratorToolContext(Guid.NewGuid(), null, null, null, "corr-closed");
        var tool = new StubTool("git_read", _ => Task.FromResult(new ToolExecutionResult("c", "git_read", true, "", 0)));
        var registry = new AuditedToolRegistry(new[] { tool }, ctx, events.Object);

        FluentActions.Invoking(() => registry.Register(tool)).Should().Throw<NotSupportedException>();
        FluentActions.Invoking(() => registry.Unregister("git_read")).Should().Throw<NotSupportedException>();
    }
}
