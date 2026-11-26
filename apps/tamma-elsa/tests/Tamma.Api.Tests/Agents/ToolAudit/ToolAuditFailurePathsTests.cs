using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Activities.Security;
using Tamma.Api.Services.Agents;

namespace Tamma.Api.Tests.Agents.ToolAudit;

/// <summary>
/// Story 42-5 AC3 — failing, timing-out, throwing, validator-rejected, and
/// allowlist-rejected tool calls all emit <c>TOOL.INVOKED</c> followed by
/// <c>TOOL.FAILED</c> (never a silent success) on both sequential and parallel branches.
/// </summary>
[TestFixture]
public class ToolAuditFailurePathsTests
{
    [TestCase(false)]
    [TestCase(true)]
    public async Task AC3_FailingTool_EmitsInvokedThenFailed(bool enableParallel)
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-fail", "file_read", new { path = "missing.txt" })),
            ToolAuditTestFixtures.AnthropicEndTurn("handled failure"));

        var executor = new LambdaToolExecutor(
            "file_read",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "file_read", false, "file not found", 3)));
        var registry = new ToolExecutorRegistry(new[] { executor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter);

        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "file_read" } },
            enableToolLoop: true,
            loopConfig: new ToolLoopConfig { EnableParallelTools = enableParallel },
            correlationId: "corr-fail",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        repo.Events.Select(e => e.Type).Should().Equal(ToolAuditEventTypes.Invoked, ToolAuditEventTypes.Failed);
        repo.Events[1].Data.Should().Contain("file not found");
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task AC3_TimingOutTool_EmitsInvokedThenFailed(bool enableParallel)
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-timeout", "shell_execute", new { command = "sleep 10" })),
            ToolAuditTestFixtures.AnthropicEndTurn("handled timeout"));

        var slowExecutor = new LambdaToolExecutor(
            "shell_execute",
            async (id, _, ct) =>
            {
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
                return new ToolExecutionResult(id, "shell_execute", true, "should have timed out", 5000);
            });
        var registry = new ToolExecutorRegistry(new[] { slowExecutor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter);

        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "shell_execute" } },
            enableToolLoop: true,
            loopConfig: new ToolLoopConfig { EnableParallelTools = enableParallel, ToolTimeoutMs = 50 },
            correlationId: "corr-timeout",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        repo.Events.Select(e => e.Type).Should().Equal(ToolAuditEventTypes.Invoked, ToolAuditEventTypes.Failed);
        repo.Events[1].Data.Should().ContainEquivalentOf("timed out");
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task AC3_ThrowingTool_EmitsInvokedThenFailed(bool enableParallel)
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-throw", "file_read", new { path = "x" })),
            ToolAuditTestFixtures.AnthropicEndTurn("handled throw"));

        var throwingExecutor = new LambdaToolExecutor(
            "file_read",
            (_, _, _) => throw new InvalidOperationException("disk exploded"));
        var registry = new ToolExecutorRegistry(new[] { throwingExecutor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter);

        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "file_read" } },
            enableToolLoop: true,
            loopConfig: new ToolLoopConfig { EnableParallelTools = enableParallel },
            correlationId: "corr-throw",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        repo.Events.Select(e => e.Type).Should().Equal(ToolAuditEventTypes.Invoked, ToolAuditEventTypes.Failed);
        repo.Events[1].Data.Should().Contain("disk exploded");
    }

    [Test]
    public async Task AC3_ValidatorRejectedCall_EmitsInvokedThenFailed()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-val-rej", "file_read", new { path = "../../etc/passwd" })),
            ToolAuditTestFixtures.AnthropicEndTurn("handled rejection"));

        var validator = new Mock<IToolCallValidator>();
        validator.Setup(v => v.Validate(It.IsAny<LlmToolCall>(), It.IsAny<IReadOnlyList<string>>()))
            .Returns(new ToolCallValidationResult { IsValid = false, ErrorMessage = "Path traversal blocked" });

        var executor = new LambdaToolExecutor(
            "file_read",
            (_, _, _) => throw new AssertionException("Rejected call must never execute"));
        var registry = new ToolExecutorRegistry(new[] { executor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter, validator: validator.Object);

        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "file_read" } },
            enableToolLoop: true,
            loopConfig: new ToolLoopConfig(),
            correlationId: "corr-val-rej",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        repo.Events.Select(e => e.Type).Should().Equal(ToolAuditEventTypes.Invoked, ToolAuditEventTypes.Failed);
        repo.Events[1].Data.Should().Contain("Path traversal blocked");
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task AC3_LoopConfigAllowlistRejectedCall_EmitsInvokedThenFailed(bool enableParallel)
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-not-allowed", "shell_execute", new { command = "ls" })),
            ToolAuditTestFixtures.AnthropicEndTurn("handled allowlist"));

        var executor = new LambdaToolExecutor(
            "shell_execute",
            (_, _, _) => throw new AssertionException("Disallowed tool must never execute"));
        var registry = new ToolExecutorRegistry(new[] { executor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter);

        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "shell_execute" } },
            enableToolLoop: true,
            loopConfig: new ToolLoopConfig
            {
                EnableParallelTools = enableParallel,
                AllowedTools = new[] { "file_read" },
            },
            correlationId: "corr-allowlist",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        repo.Events.Select(e => e.Type).Should().Equal(ToolAuditEventTypes.Invoked, ToolAuditEventTypes.Failed);
        using var doc = JsonDocument.Parse(repo.Events[1].Data);
        doc.RootElement.GetProperty("failureReason").GetString().Should().Contain("not allowed");
    }
}
