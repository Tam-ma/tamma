using System.Text.Json;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Secrets;

namespace Tamma.Api.Tests.Agents.ToolAudit;

/// <summary>
/// Story 42-5 AC4, D5 &amp; D7 — layered redaction: pattern redaction for credential-shaped
/// literals (<c>ghp_…</c>, <c>Authorization: Bearer …</c>, <c>api_key=…</c>), complete field
/// suppression when <see cref="ToolDescriptor.RequiredSecret"/> is present, and full pattern
/// redaction when the descriptor is <c>null</c> (soft dependency on 42-1).
/// </summary>
[TestFixture]
public class ToolAuditRedactionTests
{
    private const string FakeGitHubToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
    private const string FakeBearerToken = "super-secret-bearer-token-9876543210";
    private const string FakeApiKeyVal = "my-secret-api-key-value-123456";

    [Test]
    public async Task AC4_PatternRedaction_ScrubsGitHubBearerAndApiKeyLiterals()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var ctx = ToolAuditTestFixtures.SampleTrailContext();

        var rawArgs = JsonSerializer.Serialize(new
        {
            safeField = "keep-me",
            note = $"token={FakeGitHubToken} Authorization: Bearer {FakeBearerToken} api_key={FakeApiKeyVal} end",
        });

        await emitter.EmitInvokedAsync(ctx, "http_request", "call-red-1", rawArgs, ToolDescriptor.Default);

        repo.Events.Should().ContainSingle();
        var evt = repo.Events[0];
        evt.Data.Should().NotContain(FakeGitHubToken);
        evt.Data.Should().NotContain(FakeBearerToken);
        evt.Data.Should().NotContain(FakeApiKeyVal);
        evt.Data.Should().Contain("[REDACTED]");
        evt.Data.Should().Contain("keep-me");
    }

    [Test]
    public async Task AC4_WithRequiredSecretDescriptor_DropsMatchingArgumentFieldEntirely()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var ctx = ToolAuditTestFixtures.SampleTrailContext();

        var descriptor = new ToolDescriptor(
            RequiredSecret: new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true),
            Suspends: false);

        const string opaqueSecret = "zx9q4m7k2p8v1w5n3b6c0f4h8j2l9r7t5y3u1a8e";
        var rawArgs = JsonSerializer.Serialize(new
        {
            environment = "staging",
            deploy_token = opaqueSecret,
            nested = new { deployToken = opaqueSecret, region = "eu-central" },
        });

        await emitter.EmitInvokedAsync(ctx, "cloud_deploy", "call-red-2", rawArgs, descriptor);

        repo.Events.Should().ContainSingle();
        using var dataDoc = JsonDocument.Parse(repo.Events[0].Data);
        var argsRedacted = dataDoc.RootElement.GetProperty("argsRedacted").GetString()!;

        argsRedacted.Should().NotContain(opaqueSecret);
        argsRedacted.Should().NotContain("deploy_token", "field named by RequiredSecret must be absent entirely");
        argsRedacted.Should().NotContain("deployToken", "nested field named by RequiredSecret must be absent entirely");
        argsRedacted.Should().Contain("staging");
        argsRedacted.Should().Contain("eu-central");
    }

    [Test]
    public async Task AC4_D7_WithNullDescriptor_PatternRedactionStillProtectsArgumentsAndFailureReason()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var ctx = ToolAuditTestFixtures.SampleTrailContext();

        var rawArgs = $"{{\"header\":\"Authorization: Bearer {FakeBearerToken}\",\"gh\":\"{FakeGitHubToken}\"}}";
        await emitter.EmitInvokedAsync(ctx, "legacy_tool", "call-red-3", rawArgs, descriptor: null);
        await emitter.EmitFailedAsync(ctx, "legacy_tool", "call-red-3", 9, $"Upstream error with api_key={FakeApiKeyVal}");

        repo.Events.Should().HaveCount(2);
        foreach (var evt in repo.Events)
        {
            evt.Data.Should().NotContain(FakeGitHubToken);
            evt.Data.Should().NotContain(FakeBearerToken);
            evt.Data.Should().NotContain(FakeApiKeyVal);
            evt.Data.Should().Contain("[REDACTED]");
        }
    }

    [Test]
    public async Task AC4_OversizedArguments_AreTruncatedTo50KbLimit()
    {
        var repo = new RecordingAuditEventRepository();
        var emitter = new ToolAuditEmitter(repo, new CapturingAuditLogger<ToolAuditEmitter>());
        var ctx = ToolAuditTestFixtures.SampleTrailContext();

        var hugeArgs = new string('a', ToolOutputHelper.MaxOutputBytes + 8192);
        await emitter.EmitInvokedAsync(ctx, "file_write", "call-big", hugeArgs, ToolDescriptor.Default);

        using var dataDoc = JsonDocument.Parse(repo.Events[0].Data);
        var argsRedacted = dataDoc.RootElement.GetProperty("argsRedacted").GetString()!;
        argsRedacted.Should().Contain("[truncated:");
        System.Text.Encoding.UTF8.GetByteCount(argsRedacted).Should().BeLessOrEqualTo(ToolOutputHelper.MaxOutputBytes);
    }
}
