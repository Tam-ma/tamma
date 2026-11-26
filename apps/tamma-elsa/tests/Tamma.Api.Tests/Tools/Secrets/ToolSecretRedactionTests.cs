using System.Reflection;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Tools.Secrets;

namespace Tamma.Api.Tests.Tools.Secrets;

/// <summary>
/// Story 42-4 AC4 &amp; D8 — no plaintext in tool output, DCB events, error text, or logs
/// (using a pattern-non-matching 40-char random token so a regression cannot hide behind
/// pattern regexes), plus the structural never-hold assertion on audit/emitter signatures.
/// </summary>
[TestFixture]
public class ToolSecretRedactionTests
{
    // Deliberately matches NO ToolOutputHelper.RedactSecrets or CredentialRedactor regex
    // (no sk-, AKIA, ghp_, glpat-, xoxb-, JWT, PEM, or key=value prefix).
    private const string OpaqueToken = "zx9q4m7k2p8v1w5n3b6c0f4h8j2l9r7t5y3u1a8e";

    [Test]
    public async Task AC4_OpaqueNonPatternToken_NeverAppearsInOutputEventsErrorsOrLogs()
    {
        // Sanity check: confirm pattern-only redaction does NOT match OpaqueToken on its own,
        // proving this test genuinely exercises D8's by-value boundary + never-hold downstream.
        ToolOutputHelper.RedactSecrets($"echo:{OpaqueToken}").Should().Contain(OpaqueToken);

        var tenantId = Guid.NewGuid();
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => OpaqueToken);
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var emitterLogger = new CapturingLogger<ToolSecretAuditEmitter>();
        var providerLogger = new CapturingLogger<ToolSecretProvider>();

        var auditEmitter = new ToolSecretAuditEmitter(events, emitterLogger);
        var provider = new ToolSecretProvider(
            spyReader,
            new DefaultToolSecretNameResolver(),
            auditEmitter,
            auditor,
            providerLogger);

        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/opaque-token", Required: true);

        // Case 1: external vendor echoes the credential in body + header.
        var echoExecutor = new FakeExternalToolExecutor(
            provider,
            tenantId,
            req,
            vendorCall: token => $"HTTP/1.1 200 OK\nX-Echo-Auth: {token}\nbody={token}");

        var okResult = await echoExecutor.ExecuteAsync("call-echo-ok", "{}");
        okResult.Success.Should().BeTrue();
        okResult.Output.Should().NotContain(OpaqueToken);
        okResult.Output.Should().Contain(ToolSecretValueScrubber.Placeholder);

        // Case 2: external vendor throws an exception whose message interpolates the credential.
        var errorExecutor = new FakeExternalToolExecutor(
            provider,
            tenantId,
            req,
            vendorCall: token => throw new InvalidOperationException($"Upstream rejected credential {token} at /deploy"));

        var errResult = await errorExecutor.ExecuteAsync("call-echo-err", "{}");
        errResult.Success.Should().BeFalse();
        errResult.Output.Should().NotContain(OpaqueToken);
        errResult.ErrorMessage.Should().NotContain(OpaqueToken);
        errResult.ErrorMessage.Should().Contain(ToolSecretValueScrubber.Placeholder);

        // Grep EVERY emitted DCB event's Tags, Data, and Metadata.
        events.Appended.Should().NotBeEmpty();
        foreach (var evt in events.Appended)
        {
            evt.Tags.Should().NotContain(OpaqueToken);
            evt.Data.Should().NotContain(OpaqueToken);
            evt.Metadata.Should().NotContain(OpaqueToken);
        }

        // Grep EVERY ISecretAccessAuditor event.
        auditor.Events.Should().NotBeEmpty();
        foreach (var audit in auditor.Events)
        {
            audit.Reference.ToStorageKey().Should().NotContain(OpaqueToken);
            (audit.Detail ?? string.Empty).Should().NotContain(OpaqueToken);
        }

        // Grep EVERY captured log line.
        foreach (var entry in providerLogger.Entries.Concat(emitterLogger.Entries))
        {
            entry.Message.Should().NotContain(OpaqueToken);
            (entry.Exception?.ToString() ?? string.Empty).Should().NotContain(OpaqueToken);
        }
    }

    [Test]
    public void AC4_StructuralNeverHold_AuditEmittersAndRecordsAcceptNoPlaintextOrCredential()
    {
        var auditSurfaceTypes = new[]
        {
            typeof(IToolSecretAuditEmitter),
            typeof(ToolSecretAuditEmitter),
            typeof(ToolSecretAccessAuditRecord),
            typeof(ToolCredentialTag),
        };

        var forbiddenParamNames = new[] { "plaintext", "secretvalue", "credential", "apikey", "password", "token" };

        foreach (var type in auditSurfaceTypes)
        {
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                foreach (var param in method.GetParameters())
                {
                    param.ParameterType.Should().NotBe(
                        typeof(ToolCredential),
                        $"{type.Name}.{method.Name} must NEVER accept a ToolCredential (D8 never-hold)");

                    var lowerName = (param.Name ?? string.Empty).ToLowerInvariant();
                    foreach (var forbidden in forbiddenParamNames)
                    {
                        lowerName.Should().NotContain(
                            forbidden,
                            $"{type.Name}.{method.Name} parameter '{param.Name}' must not carry secret plaintext");
                    }
                }
            }

            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                prop.PropertyType.Should().NotBe(typeof(ToolCredential));
                var lowerName = prop.Name.ToLowerInvariant();
                foreach (var forbidden in forbiddenParamNames)
                {
                    lowerName.Should().NotContain(
                        forbidden,
                        $"{type.Name}.{prop.Name} must not carry secret plaintext");
                }
            }
        }
    }
}
