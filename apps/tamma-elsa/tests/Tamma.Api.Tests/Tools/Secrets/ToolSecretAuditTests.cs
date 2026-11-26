using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Platforms;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Secrets.Postgres;
using Tamma.Api.Services.Tools.Secrets;
using Tamma.Core;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Tools.Secrets;

/// <summary>
/// Story 42-4 AC5, D5 &amp; D7 — every resolve attempt (success, cache hit, missing secret,
/// and EVERY rejection path including cross-tenant attempts) appends exactly one
/// <c>TOOL.SECRET_ACCESSED</c> DCB row (no secret value) and triggers exactly one
/// <see cref="ISecretAccessAuditor.EmitAsync"/> call; a throwing <see cref="Tamma.Data.Repositories.IEventRepository"/>
/// is swallowed with a WARN and never fails the resolve.
/// </summary>
[TestFixture]
public class ToolSecretAuditTests
{
    [Test]
    public async Task AC5_SuccessfulFetchAndCacheHit_EachEmitExactlyOneDcbRowAndOneAuditorCall()
    {
        var tenantId = Guid.NewGuid();
        const string secretVal = "audit-test-secret-never-in-events-9911";
        var (provider, options, backend, events, auditor, _, time) = CreateRealBackedStack();

        var secretId = Guid.NewGuid();
        await using (var ctx = new SecretsDbContext(options))
        {
            ctx.Secrets.Add(new SecretRow
            {
                Id = secretId,
                Name = "cloud/api-token",
                Scope = "tenant",
                TenantId = tenantId,
                Purpose = "api_key",
                ActiveVersionNumber = 4,
            });
            await ctx.SaveChangesAsync();
        }
        await backend.PutVersionAsync(secretId, 4, secretVal);

        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/api-token", Required: true);
        var accessCtx = new ToolSecretAccessContext(ToolName: "cloud_deploy", CorrelationId: "corr-audit-1");

        // 1) Cache miss -> reads through real SecretStorePlatformCredentialReader
        var cred1 = await provider.ResolveAsync(tenantId, req, accessCtx);
        cred1.Plaintext.Should().Be(secretVal);

        events.Appended.Should().HaveCount(1);
        var missRow = events.Appended[0];
        missRow.Type.Should().Be(ToolSecretEventTypes.SecretAccessed);
        missRow.TenantId.Should().Be(tenantId);
        missRow.Tags.Should().NotContain(secretVal);
        missRow.Data.Should().NotContain(secretVal);

        using (var tagsDoc = JsonDocument.Parse(missRow.Tags))
        {
            tagsDoc.RootElement.GetProperty("secretRefStorageKey").GetString()
                .Should().Be($"tenant:{tenantId}:cloud/api-token");
            tagsDoc.RootElement.GetProperty("purpose").GetString().Should().Be("ApiKey");
            tagsDoc.RootElement.GetProperty("tenantId").GetString().Should().Be(tenantId.ToString());
            tagsDoc.RootElement.GetProperty("toolName").GetString().Should().Be("cloud_deploy");
            tagsDoc.RootElement.GetProperty("correlationId").GetString().Should().Be("corr-audit-1");
        }
        using (var dataDoc = JsonDocument.Parse(missRow.Data))
        {
            dataDoc.RootElement.GetProperty("outcome").GetString().Should().Be("success");
            dataDoc.RootElement.GetProperty("cacheHit").GetBoolean().Should().BeFalse();
        }

        // Capturing fake auditor received exactly 1 SECRET.READ (from SecretStorePlatformCredentialReader; no double-emit).
        auditor.Events.Should().HaveCount(1);
        auditor.Events[0].EventType.Should().Be(SecretAuditEventTypes.Read);
        auditor.Events[0].Outcome.Should().Be(SecretAuditOutcome.Success);
        auditor.Events[0].Reference.ToStorageKey().Should().Be($"tenant:{tenantId}:cloud/api-token");

        // 2) Cache hit at t + 10s -> still emits exactly 1 DCB row + 1 auditor call
        time.Advance(TimeSpan.FromSeconds(10));
        var cred2 = await provider.ResolveAsync(tenantId, req, accessCtx);
        cred2.Plaintext.Should().Be(secretVal);

        events.Appended.Should().HaveCount(2);
        using (var hitData = JsonDocument.Parse(events.Appended[1].Data))
        {
            hitData.RootElement.GetProperty("outcome").GetString().Should().Be("success");
            hitData.RootElement.GetProperty("cacheHit").GetBoolean().Should().BeTrue();
        }

        auditor.Events.Should().HaveCount(2);
        auditor.Events[1].EventType.Should().Be(SecretAuditEventTypes.Read);
        auditor.Events[1].Outcome.Should().Be(SecretAuditOutcome.Success);
        auditor.Events[1].Detail.Should().Be("cache_hit");
    }

    [Test]
    public async Task AC5_D5_RejectionPaths_EachEmitOneDcbRowAndOneAuditorCall()
    {
        var runTenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var (provider, _, _, events, auditor, _, _) = CreateRealBackedStack();

        // 1) Cross-tenant RequestedTenantId
        var act1 = async () => await provider.ResolveAsync(
            runTenantId,
            new SecretRequirement(SecretPurpose.ApiKey, "cloud/token", Required: true),
            new ToolSecretAccessContext(ToolName: "deploy", CorrelationId: "c1", RequestedTenantId: otherTenantId));
        await act1.Should().ThrowAsync<TammaError>();

        // 2) Smuggled scope prefix in name
        var act2 = async () => await provider.ResolveAsync(
            runTenantId,
            new SecretRequirement(SecretPurpose.ApiKey, $"tenant:{otherTenantId}:cloud/token", Required: true));
        await act2.Should().ThrowAsync<TammaError>();

        // 3) Empty/whitespace secret name
        var act3 = async () => await provider.ResolveAsync(
            runTenantId,
            new SecretRequirement(SecretPurpose.ApiKey, "   ", Required: true));
        await act3.Should().ThrowAsync<TammaError>();

        // 4) Guid.Empty tenant id
        var act4 = async () => await provider.ResolveAsync(
            Guid.Empty,
            new SecretRequirement(SecretPurpose.ApiKey, "cloud/token", Required: true));
        await act4.Should().ThrowAsync<ArgumentException>();

        // 5) Missing secret (store miss)
        var act5 = async () => await provider.ResolveAsync(
            runTenantId,
            new SecretRequirement(SecretPurpose.ApiKey, "cloud/does-not-exist", Required: true));
        await act5.Should().ThrowAsync<TammaError>();

        events.Appended.Should().HaveCount(5);
        events.Appended.Should().OnlyContain(e => e.Type == ToolSecretEventTypes.SecretAccessed);

        auditor.Events.Should().HaveCount(5);
        auditor.Events.Should().OnlyContain(e =>
            e.EventType == SecretAuditEventTypes.Read
            && e.Outcome == SecretAuditOutcome.Failure);
    }

    [Test]
    public async Task D7_ThrowingEventRepository_DoesNotFailResolveAndLogsWarning()
    {
        var (provider, options, backend, events, auditor, emitterLogger, _) = CreateRealBackedStack();
        var secretId = Guid.NewGuid();
        await using (var ctx = new SecretsDbContext(options))
        {
            ctx.Secrets.Add(new SecretRow
            {
                Id = secretId,
                Name = "cloud/resilient-token",
                Scope = "platform",
                TenantId = null,
                Purpose = "api_key",
                ActiveVersionNumber = 1,
            });
            await ctx.SaveChangesAsync();
        }
        await backend.PutVersionAsync(secretId, 1, "resilient-secret-value");

        events.ThrowOnAppend = new InvalidOperationException("Simulated Postgres event-store outage");

        var cred = await provider.ResolveAsync(
            runTenantId: null,
            new SecretRequirement(SecretPurpose.ApiKey, "cloud/resilient-token", Required: true));

        cred.Plaintext.Should().Be("resilient-secret-value");
        auditor.Events.Should().ContainSingle(e => e.Outcome == SecretAuditOutcome.Success);
        emitterLogger.Entries.Should().Contain(e =>
            e.Level == LogLevel.Warning
            && e.Message.Contains("TOOL.SECRET_ACCESSED"));
    }

    private static (
        ToolSecretProvider Provider,
        DbContextOptions<SecretsDbContext> Options,
        InMemorySecretStoreBackend Backend,
        CapturingEventRepository Events,
        CapturingSecretAccessAuditor Auditor,
        CapturingLogger<ToolSecretAuditEmitter> EmitterLogger,
        ManualTimeProvider Time)
        CreateRealBackedStack()
    {
        var time = new ManualTimeProvider();
        var options = new DbContextOptionsBuilder<SecretsDbContext>()
            .UseInMemoryDatabase($"audit-{Guid.NewGuid():N}")
            .Options;
        var backend = new InMemorySecretStoreBackend();
        var auditor = new CapturingSecretAccessAuditor();
        var reader = new SecretStorePlatformCredentialReader(
            new SingleSecretsContextFactory(options),
            backend,
            auditor,
            time);
        var events = new CapturingEventRepository();
        var emitterLogger = new CapturingLogger<ToolSecretAuditEmitter>();
        var auditEmitter = new ToolSecretAuditEmitter(events, emitterLogger, time);
        var provider = new ToolSecretProvider(
            reader,
            new DefaultToolSecretNameResolver(),
            auditEmitter,
            auditor,
            new CapturingLogger<ToolSecretProvider>(),
            new ToolSecretCache(),
            time);

        return (provider, options, backend, events, auditor, emitterLogger, time);
    }
}
