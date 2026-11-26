using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Platforms;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Secrets.Postgres;
using Tamma.Api.Services.Tools.Secrets;
using Tamma.Core;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Tools.Secrets;

/// <summary>
/// Story 42-4 AC3 &amp; rewritten AC6 — fail-closed behaviour when a required secret is
/// missing, inactive, scrubbed, or the secret provider itself is unavailable.
/// </summary>
[TestFixture]
public class ToolSecretFailClosedTests
{
    [Test]
    public async Task AC3_MissingSecret_ThrowsTypedTammaErrorAndExecutorMakesZeroVendorCalls()
    {
        var (provider, _, _, _) = CreateBackedProvider();
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/missing-token", Required: true);

        // Direct provider call throws typed fail-closed TammaError.
        var act = async () => await provider.ResolveAsync(Guid.NewGuid(), req);
        var ex = await act.Should().ThrowAsync<TammaError>();
        ex.Which.Code.Should().Be(ToolSecretErrorCodes.Unavailable);
        ex.Which.Retryable.Should().BeFalse();
        ex.Which.Severity.Should().Be(TammaErrorSeverity.High);

        // Wired through an external-touching executor: returns Success=false (never throws) with 0 vendor calls.
        var executor = new FakeExternalToolExecutor(
            provider,
            runTenantId: Guid.NewGuid(),
            req,
            vendorCall: _ => throw new AssertionException("Vendor MUST NOT be called when secret is missing"));

        var result = await executor.ExecuteAsync("call-missing", "{}");
        result.Success.Should().BeFalse();
        result.Output.Should().Contain(ToolSecretErrorCodes.Unavailable);
        executor.VendorCallCount.Should().Be(0);
    }

    [Test]
    public async Task AC3_InactiveSecretVersionZero_FailsClosedWithZeroVendorCalls()
    {
        var (provider, options, _, _) = CreateBackedProvider();
        var tenantId = Guid.NewGuid();
        await using (var ctx = new SecretsDbContext(options))
        {
            ctx.Secrets.Add(new SecretRow
            {
                Id = Guid.NewGuid(),
                Name = "cloud/inactive-token",
                Scope = "tenant",
                TenantId = tenantId,
                Purpose = "api_key",
                ActiveVersionNumber = 0,
            });
            await ctx.SaveChangesAsync();
        }

        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/inactive-token", Required: true);
        var executor = new FakeExternalToolExecutor(
            provider,
            tenantId,
            req,
            vendorCall: _ => "should-not-run");

        var result = await executor.ExecuteAsync("call-inactive", "{}");
        result.Success.Should().BeFalse();
        result.ErrorMessage.Should().Contain(ToolSecretErrorCodes.Unavailable);
        executor.VendorCallCount.Should().Be(0);
    }

    [Test]
    public async Task AC3_ScrubbedSecretVersion_FailsClosedWithZeroVendorCalls()
    {
        var (provider, options, _, _) = CreateBackedProvider();
        var secretId = Guid.NewGuid();
        await using (var ctx = new SecretsDbContext(options))
        {
            ctx.Secrets.Add(new SecretRow
            {
                Id = secretId,
                Name = "cloud/scrubbed-token",
                Scope = "platform",
                TenantId = null,
                Purpose = "api_key",
                ActiveVersionNumber = 2, // backend has no version 2 -> scrubbed/missing
            });
            await ctx.SaveChangesAsync();
        }

        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/scrubbed-token", Required: true);
        var executor = new FakeExternalToolExecutor(
            provider,
            runTenantId: null,
            req,
            vendorCall: _ => "should-not-run");

        var result = await executor.ExecuteAsync("call-scrubbed", "{}");
        result.Success.Should().BeFalse();
        result.ErrorMessage.Should().Contain(ToolSecretErrorCodes.Unavailable);
        executor.VendorCallCount.Should().Be(0);
    }

    [Test]
    public async Task AC6_NullToolSecretProvider_DegradesToFailClosedToolResultWithZeroVendorCalls()
    {
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var auditEmitter = new ToolSecretAuditEmitter(events, new CapturingLogger<ToolSecretAuditEmitter>());
        var nullProvider = new NullToolSecretProvider(
            auditEmitter,
            auditor,
            new CapturingLogger<NullToolSecretProvider>());

        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true);
        var toolFailedCount = 0;

        var executor = new FakeExternalToolExecutor(
            nullProvider,
            runTenantId: Guid.NewGuid(),
            req,
            vendorCall: _ => throw new AssertionException("Vendor MUST NOT be called when provider is unavailable"),
            onToolFailed: (_, _) => toolFailedCount++);

        var result = await executor.ExecuteAsync("call-unavail", "{}");

        result.Success.Should().BeFalse();
        result.Output.Should().Contain("Capability unconfigured");
        result.Output.Should().Contain(ToolSecretErrorCodes.Unavailable);
        executor.VendorCallCount.Should().Be(0);
        toolFailedCount.Should().Be(1);

        events.Appended.Should().ContainSingle(e =>
            e.Type == ToolSecretEventTypes.SecretAccessed
            && e.Data.Contains("secret_provider_unavailable"));
        auditor.Events.Should().ContainSingle(e =>
            e.EventType == SecretAuditEventTypes.Read
            && e.Outcome == SecretAuditOutcome.Failure
            && e.Detail == "secret_provider_unavailable");
    }

    [Test]
    public void DiWiring_BothRealAndNullProviders_ResolveCleanlyFromScopedContainer()
    {
        // Real provider graph
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<ISecretAccessAuditor, NullSecretAccessAuditor>();
        services.AddSingleton<IPlatformCredentialReader, NullPlatformCredentialReader>();
        services.AddScoped<IEventRepository>(_ => new CapturingEventRepository());
        services.AddSingleton<IToolSecretNameResolver, DefaultToolSecretNameResolver>();
        services.AddSingleton<ToolSecretCache>();
        services.AddScoped<IToolSecretAuditEmitter, ToolSecretAuditEmitter>();
        services.AddScoped<IToolSecretProvider, ToolSecretProvider>();

        using (var sp = services.BuildServiceProvider(validateScopes: true))
        using (var scope = sp.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IToolSecretProvider>()
                .Should().BeOfType<ToolSecretProvider>();
        }

        // Null fallback graph
        var fallbackServices = new ServiceCollection();
        fallbackServices.AddLogging();
        fallbackServices.AddSingleton(TimeProvider.System);
        fallbackServices.AddSingleton<ISecretAccessAuditor, NullSecretAccessAuditor>();
        fallbackServices.AddScoped<IEventRepository>(_ => new CapturingEventRepository());
        fallbackServices.AddScoped<IToolSecretAuditEmitter, ToolSecretAuditEmitter>();
        fallbackServices.AddScoped<IToolSecretProvider, NullToolSecretProvider>();

        using (var sp = fallbackServices.BuildServiceProvider(validateScopes: true))
        using (var scope = sp.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IToolSecretProvider>()
                .Should().BeOfType<NullToolSecretProvider>();
        }
    }

    private static (ToolSecretProvider Provider, DbContextOptions<SecretsDbContext> Options, CapturingEventRepository Events, CapturingSecretAccessAuditor Auditor)
        CreateBackedProvider()
    {
        var options = new DbContextOptionsBuilder<SecretsDbContext>()
            .UseInMemoryDatabase($"failclosed-{Guid.NewGuid():N}")
            .Options;
        var backend = new InMemorySecretStoreBackend();
        var auditor = new CapturingSecretAccessAuditor();
        var reader = new SecretStorePlatformCredentialReader(
            new SingleSecretsContextFactory(options),
            backend,
            auditor,
            TimeProvider.System);
        var events = new CapturingEventRepository();
        var auditEmitter = new ToolSecretAuditEmitter(events, new CapturingLogger<ToolSecretAuditEmitter>());
        var provider = new ToolSecretProvider(
            reader,
            new DefaultToolSecretNameResolver(),
            auditEmitter,
            auditor,
            new CapturingLogger<ToolSecretProvider>());

        return (provider, options, events, auditor);
    }
}
