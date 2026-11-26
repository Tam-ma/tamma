using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Activities.ToolExecution;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Streaming;

namespace Tamma.Api.Tests.Agents.ToolAudit;

/// <summary>
/// Story 42-5 AC6 &amp; AC7 — durable <c>TOOL.*</c> emission is completely independent of
/// <see cref="IToolLoopEventSink"/> / <c>EnableStreaming</c>, and the ephemeral
/// <c>TOOL_LOOP.*</c> SSE baseline (including Z1's never-emitted <c>TOOL_LOOP.COMPLETED</c>)
/// is preserved unchanged.
/// </summary>
[TestFixture]
public class ToolAuditSinkIndependenceTests
{
    [Test]
    public async Task AC6_NullSinkAndStreamingDisabled_StillPersistsDurableToolAuditRows()
    {
        var repo = new RecordingAuditEventRepository();
        var auditEmitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var sseEmitter = new ToolLoopEventEmitter(
            NullLogger<ToolLoopEventEmitter>.Instance,
            NullToolLoopEventSink.Instance);

        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-nosse", "file_read", new { path = "a.txt" })),
            ToolAuditTestFixtures.AnthropicEndTurn("done"));

        var executor = new LambdaToolExecutor(
            "file_read",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "file_read", true, "hello", 3)));
        var registry = new ToolExecutorRegistry(new[] { executor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, auditEmitter, sseEmitter: sseEmitter);

        var loopConfig = new ToolLoopConfig { EnableStreaming = false, EnableParallelTools = false };
        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "file_read" } },
            enableToolLoop: true,
            loopConfig: loopConfig,
            correlationId: "corr-nosse",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        repo.Events.Select(e => e.Type).Should().Equal(
            ToolAuditEventTypes.Invoked,
            ToolAuditEventTypes.Succeeded);
    }

    [Test]
    public async Task AC7_StreamingEnabled_PreservesEphemeralSseEventsAndZ1Baseline()
    {
        var repo = new RecordingAuditEventRepository();
        var auditEmitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var capturingSink = new CapturingToolLoopEventSink();
        var sseEmitter = new ToolLoopEventEmitter(
            NullLogger<ToolLoopEventEmitter>.Instance,
            capturingSink);

        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-sse", "file_read", new { path = "a.txt" })),
            ToolAuditTestFixtures.AnthropicEndTurn("done"));

        var executor = new LambdaToolExecutor(
            "file_read",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "file_read", true, "hello", 3)));
        var registry = new ToolExecutorRegistry(new[] { executor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, auditEmitter, sseEmitter: sseEmitter);

        var loopConfig = new ToolLoopConfig { EnableStreaming = true, EnableParallelTools = false };
        await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "file_read" } },
            enableToolLoop: true,
            loopConfig: loopConfig,
            correlationId: "corr-sse",
            repair: null,
            trailContext: ToolAuditTestFixtures.SampleTrailContext(),
            ct: CancellationToken.None);

        // Durable audit persisted alongside SSE.
        repo.Events.Select(e => e.Type).Should().Equal(
            ToolAuditEventTypes.Invoked,
            ToolAuditEventTypes.Succeeded);

        // Ephemeral SSE baseline unchanged (TURN_STARTED, TOOL_EXECUTING, TOOL_COMPLETED, TURN_COMPLETED, TURN_STARTED).
        capturingSink.EventTypes.Should().ContainInOrder(
            "TOOL_LOOP.TURN_STARTED",
            "TOOL_LOOP.TOOL_EXECUTING",
            "TOOL_LOOP.TOOL_COMPLETED",
            "TOOL_LOOP.TURN_COMPLETED");

        // Z1 baseline pin: InlineToolLoopRunner does NOT emit TOOL_LOOP.COMPLETED (filed separately;
        // Story 42-5 deliberately does not alter the SSE contract).
        capturingSink.EventTypes.Should().NotContain("TOOL_LOOP.COMPLETED");

        // Confirm BusToolLoopEventSink.Map keeps its exact 3-event mapping untouched.
        var sampleObj = JsonSerializer.SerializeToElement(new
        {
            toolName = "file_read",
            toolCallId = "tc-sse",
            turnNumber = 0,
            success = true,
            durationMs = 3,
            exhausted = false,
            totalTurns = 1,
            totalTokens = 10,
            totalDurationMs = 5,
        });
        BusToolLoopEventSink.Map("TOOL_LOOP.TOOL_EXECUTING", sampleObj).Should().NotBeNull();
        BusToolLoopEventSink.Map("TOOL_LOOP.TOOL_COMPLETED", sampleObj).Should().NotBeNull();
        BusToolLoopEventSink.Map("TOOL_LOOP.COMPLETED", sampleObj).Should().NotBeNull();
        BusToolLoopEventSink.Map("TOOL_LOOP.TURN_STARTED", sampleObj).Should().BeNull();
    }

    private sealed class CapturingToolLoopEventSink : IToolLoopEventSink
    {
        public List<string> EventTypes { get; } = new();

        public Task WriteEventAsync(string eventType, object data, CancellationToken cancellationToken = default)
        {
            EventTypes.Add(eventType);
            return Task.CompletedTask;
        }
    }
}
