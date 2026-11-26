using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Agents;

namespace Tamma.Api.Tests.Agents.ToolAudit;

/// <summary>
/// Story 42-5 AC1 &amp; AC2 — the mandatory branch-coverage pair proving durable
/// <c>TOOL.INVOKED</c> → terminal <c>TOOL.SUCCEEDED</c> / <c>TOOL.FAILED</c> emission on
/// BOTH the default sequential branch (<c>EnableParallelTools == false</c>) AND the
/// opt-in parallel branch (<c>EnableParallelTools == true</c>).
/// </summary>
[TestFixture]
public class ToolAuditBothBranchesTests
{
    [Test]
    public async Task AC1_AC2_SequentialBranch_DefaultEnableParallelToolsFalse_EmitsInvokedThenSucceeded()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());

        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(("tc-seq-1", "file_read", new { path = "README.md" })),
            ToolAuditTestFixtures.AnthropicEndTurn("finished sequential"));

        var executor = new LambdaToolExecutor(
            "file_read",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "file_read", true, "readme contents", 7)));
        var registry = new ToolExecutorRegistry(new[] { executor }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter);

        // Explicitly exercise the default ToolLoopConfig where EnableParallelTools == false.
        var loopConfig = new ToolLoopConfig();
        loopConfig.EnableParallelTools.Should().BeFalse("default config must exercise the sequential branch");

        var trailCtx = ToolAuditTestFixtures.SampleTrailContext(issueId: "TAM-SEQ-1");
        var result = await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[] { new ResolvedTool { Name = "file_read", Description = "read" } },
            enableToolLoop: true,
            loopConfig: loopConfig,
            correlationId: trailCtx.CorrelationId,
            repair: null,
            trailContext: trailCtx,
            ct: CancellationToken.None);

        result.Response.Success.Should().BeTrue();
        // D6: InlineToolLoopResult.ToolCalls stays empty (do not revive dead AGENT.TOOL_CALL.*).
        result.ToolCalls.Should().BeEmpty();

        repo.Events.Should().HaveCount(2);
        repo.Events[0].Type.Should().Be(ToolAuditEventTypes.Invoked);
        repo.Events[1].Type.Should().Be(ToolAuditEventTypes.Succeeded);

        ReadTag(repo.Events[0], "toolCallId").Should().Be("tc-seq-1");
        ReadTag(repo.Events[1], "toolCallId").Should().Be("tc-seq-1");
        ReadTag(repo.Events[0], "toolName").Should().Be("file_read");
        ReadTag(repo.Events[1], "toolName").Should().Be("file_read");
    }

    [Test]
    public async Task AC1_AC2_ParallelBranch_EnableParallelToolsTrue_EmitsInvokedThenTerminalPerCall()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());

        var handler = new SequencedAnthropicHandler(
            ToolAuditTestFixtures.AnthropicToolUse(
                ("tc-par-1", "file_read", new { path = "a.txt" }),
                ("tc-par-2", "search_code", new { query = "hello" })),
            ToolAuditTestFixtures.AnthropicEndTurn("finished parallel"));

        var readExec = new LambdaToolExecutor(
            "file_read",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "file_read", true, "alpha", 4)));
        var searchExec = new LambdaToolExecutor(
            "search_code",
            (id, _, _) => Task.FromResult(new ToolExecutionResult(id, "search_code", true, "beta", 6)));
        var registry = new ToolExecutorRegistry(new IToolExecutor[] { readExec, searchExec }, NullLogger<ToolExecutorRegistry>.Instance);
        var runner = ToolAuditTestFixtures.CreateRunner(handler, registry, emitter);

        var loopConfig = new ToolLoopConfig { EnableParallelTools = true };
        var trailCtx = ToolAuditTestFixtures.SampleTrailContext(issueId: "TAM-PAR-1");

        var result = await runner.RunAsync(
            "anthropic", ToolAuditTestFixtures.ProviderConfig(), ToolAuditTestFixtures.Model,
            "sys", "user", 1024, 0.0,
            tools: new[]
            {
                new ResolvedTool { Name = "file_read", Description = "read" },
                new ResolvedTool { Name = "search_code", Description = "search" },
            },
            enableToolLoop: true,
            loopConfig: loopConfig,
            correlationId: trailCtx.CorrelationId,
            repair: null,
            trailContext: trailCtx,
            ct: CancellationToken.None);

        result.Response.Success.Should().BeTrue();
        result.ToolCalls.Should().BeEmpty();

        repo.Events.Should().HaveCount(4);
        // Both TOOL.INVOKED fire before parallel execution, followed by one TOOL.SUCCEEDED per call.
        repo.Events.Take(2).Select(e => e.Type).Should().OnlyContain(t => t == ToolAuditEventTypes.Invoked);
        repo.Events.Skip(2).Select(e => e.Type).Should().OnlyContain(t => t == ToolAuditEventTypes.Succeeded);

        foreach (var callId in new[] { "tc-par-1", "tc-par-2" })
        {
            var forCall = repo.Events.Where(e => ReadTag(e, "toolCallId") == callId).ToList();
            forCall.Select(e => e.Type).Should().Equal(ToolAuditEventTypes.Invoked, ToolAuditEventTypes.Succeeded);
        }
    }

    private static string? ReadTag(Tamma.Data.Entities.DomainEvent evt, string key)
    {
        using var doc = JsonDocument.Parse(evt.Tags);
        return doc.RootElement.TryGetProperty(key, out var val) ? val.GetString() : null;
    }
}
