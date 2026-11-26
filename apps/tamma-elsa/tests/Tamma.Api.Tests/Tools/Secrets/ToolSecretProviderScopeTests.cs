using System.Reflection;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Platforms;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Secrets.Postgres;
using Tamma.Api.Services.Tools.Secrets;
using Tamma.Core;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Tools.Secrets;

/// <summary>
/// Story 42-4 AC1 — Scope resolution per mode, null-tenant rejection, cross-tenant
/// rejection BEFORE any store read, and the structural absence of any <see cref="SecretRef"/>-accepting
/// overload on <see cref="IToolSecretProvider"/>.
/// </summary>
[TestFixture]
public class ToolSecretProviderScopeTests
{
    [Test]
    public async Task AC1a_SingleUserMode_ResolvesPlatformSecretRef()
    {
        var spyReader = new SpyPlatformCredentialReader((scope, tid, name) => "platform-secret-val");
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var provider = CreateProvider(spyReader, events, auditor);
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true);

        var cred = await provider.ResolveAsync(runTenantId: null, req);

        cred.Plaintext.Should().Be("platform-secret-val");
        cred.SecretRefStorageKey.Should().Be(SecretRef.ForPlatform("cloud/deploy-token").ToStorageKey());
        cred.SecretRefStorageKey.Should().Be("platform:cloud/deploy-token");

        spyReader.Calls.Should().ContainSingle().Which.Should().Be(("platform", (Guid?)null, "cloud/deploy-token"));
    }

    [Test]
    public async Task AC1a_SaasMode_ResolvesTenantSecretRefForRunTenant()
    {
        var tenantId = Guid.NewGuid();
        var spyReader = new SpyPlatformCredentialReader((scope, tid, name) => "tenant-secret-val");
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var provider = CreateProvider(spyReader, events, auditor);
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true);

        var cred = await provider.ResolveAsync(runTenantId: tenantId, req);

        cred.Plaintext.Should().Be("tenant-secret-val");
        cred.SecretRefStorageKey.Should().Be(SecretRef.ForTenant(tenantId, "cloud/deploy-token").ToStorageKey());
        cred.SecretRefStorageKey.Should().Be($"tenant:{tenantId}:cloud/deploy-token");

        spyReader.Calls.Should().ContainSingle().Which.Should().Be(("tenant", (Guid?)tenantId, "cloud/deploy-token"));
    }

    [Test]
    public async Task AC1b_TenantScopedRefWithNullTenantId_ThrowsArgumentException()
    {
        var act = () => new SecretRef(SecretScope.Tenant, tenantId: null, "cloud/deploy-token");
        act.Should().Throw<ArgumentException>().Where(ex => ex.ParamName == "tenantId");

        var options = new DbContextOptionsBuilder<SecretsDbContext>()
            .UseInMemoryDatabase($"scope-b-{Guid.NewGuid():N}")
            .Options;
        var reader = new SecretStorePlatformCredentialReader(
            new SingleSecretsContextFactory(options),
            new InMemorySecretStoreBackend(),
            new CapturingSecretAccessAuditor(),
            TimeProvider.System);

        var readerAct = async () => await reader.ReadActivePlaintextAsync("tenant", tenantId: null, "cloud/deploy-token");
        await readerAct.Should().ThrowAsync<ArgumentException>().Where(ex => ex.ParamName == "tenantId");
    }

    [Test]
    public async Task AC1b_EmptyGuidTenantId_RejectedWithArgumentExceptionBeforeAnyRead()
    {
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => "should-not-read");
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var provider = CreateProvider(spyReader, events, auditor);
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true);

        var act = async () => await provider.ResolveAsync(Guid.Empty, req);
        await act.Should().ThrowAsync<ArgumentException>().Where(ex => ex.ParamName == "runTenantId");

        spyReader.Calls.Should().BeEmpty("Guid.Empty must be rejected before touching the secret store");
        events.Appended.Should().ContainSingle(e => e.Type == ToolSecretEventTypes.SecretAccessed);
        auditor.Events.Should().ContainSingle();
    }

    [Test]
    public async Task AC1c_RequestedTenantOtherThanRunTenant_RejectedBeforeAnyRead()
    {
        var runTenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => "other-tenant-secret");
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var provider = CreateProvider(spyReader, events, auditor);
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true);

        var act = async () => await provider.ResolveAsync(
            runTenantId,
            req,
            new ToolSecretAccessContext(ToolName: "cloud_deploy", CorrelationId: "corr-1", RequestedTenantId: otherTenantId));

        var ex = await act.Should().ThrowAsync<TammaError>();
        ex.Which.Code.Should().Be(ToolSecretErrorCodes.CrossTenantDenied);
        ex.Which.Retryable.Should().BeFalse();
        ex.Which.Severity.Should().Be(TammaErrorSeverity.High);

        spyReader.Calls.Should().BeEmpty(
            "ISecretStore performs no authorization, so cross-tenant requests MUST be stopped at the provider before any store read");
    }

    [Test]
    public async Task AC1c_SingleUserRunWithRequestedTenantId_RejectedBeforeAnyRead()
    {
        var otherTenantId = Guid.NewGuid();
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => "tenant-secret");
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var provider = CreateProvider(spyReader, events, auditor);
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/deploy-token", Required: true);

        var act = async () => await provider.ResolveAsync(
            runTenantId: null,
            req,
            new ToolSecretAccessContext(ToolName: "cloud_deploy", RequestedTenantId: otherTenantId));

        var ex = await act.Should().ThrowAsync<TammaError>();
        ex.Which.Code.Should().Be(ToolSecretErrorCodes.CrossTenantDenied);

        spyReader.Calls.Should().BeEmpty();
    }

    [TestCase("tenant:11111111-1111-1111-1111-111111111111:cloud/token")]
    [TestCase("TENANT:11111111-1111-1111-1111-111111111111:cloud/token")]
    [TestCase("platform:cloud/token")]
    [TestCase("PLATFORM:cloud/token")]
    public async Task AC1c_SmuggledScopePrefixInRequirementName_RejectedBeforeAnyRead(string smuggledName)
    {
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => "leaked-secret");
        var events = new CapturingEventRepository();
        var auditor = new CapturingSecretAccessAuditor();
        var provider = CreateProvider(spyReader, events, auditor);
        var req = new SecretRequirement(SecretPurpose.ApiKey, smuggledName, Required: true);

        var act = async () => await provider.ResolveAsync(Guid.NewGuid(), req);

        var ex = await act.Should().ThrowAsync<TammaError>();
        ex.Which.Code.Should().Be(ToolSecretErrorCodes.CrossTenantDenied);
        spyReader.Calls.Should().BeEmpty();
    }

    [Test]
    public void AC1d_IToolSecretProvider_ExposesNoPublicMemberAcceptingSecretRef()
    {
        var providerType = typeof(IToolSecretProvider);
        var publicMethods = providerType.GetMethods(BindingFlags.Public | BindingFlags.Instance);
        publicMethods.Should().NotBeEmpty();

        foreach (var method in publicMethods)
        {
            foreach (var param in method.GetParameters())
            {
                param.ParameterType.Should().NotBe(
                    typeof(SecretRef),
                    $"IToolSecretProvider.{method.Name} must NEVER accept a caller-built SecretRef (Story 42-4 D2 / AC1(d))");
            }
        }

        // Also assert ToolSecretAccessContext does not smuggle a SecretRef property/parameter.
        typeof(ToolSecretAccessContext)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.PropertyType)
            .Should().NotContain(typeof(SecretRef));

        // D1 siting check: IToolSecretProvider must live in Tamma.Api, never on the engine surface.
        providerType.Assembly.GetName().Name.Should().Be("Tamma.Api");
    }

    private static ToolSecretProvider CreateProvider(
        IPlatformCredentialReader reader,
        CapturingEventRepository events,
        CapturingSecretAccessAuditor auditor)
    {
        var auditEmitter = new ToolSecretAuditEmitter(events, new CapturingLogger<ToolSecretAuditEmitter>());
        return new ToolSecretProvider(
            reader,
            new DefaultToolSecretNameResolver(),
            auditEmitter,
            auditor,
            new CapturingLogger<ToolSecretProvider>());
    }
}
