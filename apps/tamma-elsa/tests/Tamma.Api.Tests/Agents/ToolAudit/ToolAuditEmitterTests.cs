using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Credentials;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Tools.Secrets;

namespace Tamma.Api.Tests.Agents.ToolAudit;

/// <summary>
/// Story 42-5 unit tests for <see cref="ToolAuditEmitter"/> — verifies the trio's
/// tag/data shape through <see cref="AgentTrailTags"/>, the structural never-hold
/// guarantee (AC4), and the swallow-and-warn failure policy (D8 / AC8).
/// </summary>
[TestFixture]
public class ToolAuditEmitterTests
{
    [Test]
    public async Task Trio_TagsAndDataShape_UseAgentTrailTagsWithNoGovernanceFields()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var ctx = ToolAuditTestFixtures.SampleTrailContext(issueId: "TAM-101");

        await emitter.EmitInvokedAsync(ctx, "file_read", "call-1", """{"path":"README.md"}""", ToolDescriptor.Default);
        await emitter.EmitSucceededAsync(ctx, "file_read", "call-1", durationMs: 12, outputSizeBytes: 256);
        await emitter.EmitFailedAsync(ctx, "file_read", "call-2", durationMs: 4, failureReason: "not found");

        repo.Events.Should().HaveCount(3);
        repo.Events.Select(e => e.Type).Should().Equal(
            ToolAuditEventTypes.Invoked,
            ToolAuditEventTypes.Succeeded,
            ToolAuditEventTypes.Failed);

        foreach (var evt in repo.Events)
        {
            evt.TenantId.Should().Be(ctx.TenantId);
            using var tags = JsonDocument.Parse(evt.Tags);
            tags.RootElement.GetProperty("issueId").GetString().Should().Be("TAM-101");
            tags.RootElement.GetProperty("tenantId").GetString().Should().Be(ctx.TenantId!.Value.ToString());
            tags.RootElement.GetProperty("toolName").GetString().Should().Be("file_read");
            tags.RootElement.GetProperty("correlationId").GetString().Should().Be(ctx.CorrelationId);
            tags.RootElement.GetProperty("agentId").GetString().Should().Be(ctx.AgentId.ToString());
            tags.RootElement.GetProperty("role").GetString().Should().Be("developer");

            // Dropped per Epic 43 reconciliation (D3): no governance fields on TOOL.* events.
            tags.RootElement.TryGetProperty("permissionClass", out _).Should().BeFalse();
            tags.RootElement.TryGetProperty("autonomyAtCall", out _).Should().BeFalse();
        }

        using (var invokedData = JsonDocument.Parse(repo.Events[0].Data))
        {
            invokedData.RootElement.GetProperty("argsRedacted").GetString().Should().Contain("README.md");
        }
        using (var succeededData = JsonDocument.Parse(repo.Events[1].Data))
        {
            succeededData.RootElement.GetProperty("durationMs").GetInt64().Should().Be(12);
            succeededData.RootElement.GetProperty("outputSizeBytes").GetInt32().Should().Be(256);
        }
        using (var failedData = JsonDocument.Parse(repo.Events[2].Data))
        {
            failedData.RootElement.GetProperty("durationMs").GetInt64().Should().Be(4);
            failedData.RootElement.GetProperty("failureReason").GetString().Should().Be("not found");
        }
    }

    [Test]
    public void AC4_StructuralNeverHold_NoEmitterMethodAcceptsCredentialOrPlaintextParameter()
    {
        var forbiddenTypes = new[] { typeof(ToolCredential), typeof(ProviderCredential), typeof(IToolSecretProvider) };
        var forbiddenNames = new[] { "plaintext", "credential", "secretvalue", "apikey", "password", "token" };

        foreach (var type in new[] { typeof(IToolAuditEmitter), typeof(ToolAuditEmitter) })
        {
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                foreach (var param in method.GetParameters())
                {
                    forbiddenTypes.Should().NotContain(
                        param.ParameterType,
                        $"{type.Name}.{method.Name} must NEVER accept a credential type (D5 never-hold)");

                    var lower = (param.Name ?? string.Empty).ToLowerInvariant();
                    foreach (var forbidden in forbiddenNames)
                    {
                        lower.Should().NotContain(
                            forbidden,
                            $"{type.Name}.{method.Name} parameter '{param.Name}' violates D5 never-hold");
                    }
                }
            }
        }
    }

    [Test]
    public async Task D8_ThrowingEventRepository_SwallowsExceptionAndLogsWarning()
    {
        var repo = new RecordingAuditEventRepository
        {
            ThrowOnAppend = new InvalidOperationException("Simulated event-store outage"),
        };
        var logger = new CapturingAuditLogger<ToolAuditEmitter>();
        var emitter = new ToolAuditEmitter(repo, logger);
        var ctx = ToolAuditTestFixtures.SampleTrailContext();

        var act = async () =>
        {
            await emitter.EmitInvokedAsync(ctx, "file_read", "call-err", "{}", ToolDescriptor.Default);
            await emitter.EmitSucceededAsync(ctx, "file_read", "call-err", 5, 10);
            await emitter.EmitFailedAsync(ctx, "file_read", "call-err", 5, "boom");
        };

        await act.Should().NotThrowAsync("audit persistence failures must never abort tool execution (D8)");

        logger.Entries.Should().HaveCount(3);
        logger.Entries.Should().OnlyContain(e => e.Level == LogLevel.Warning && e.Message.Contains("Tool audit write failed"));
    }
}
