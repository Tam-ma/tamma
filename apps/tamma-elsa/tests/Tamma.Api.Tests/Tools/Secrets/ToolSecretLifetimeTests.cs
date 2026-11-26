using System.Reflection;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Secrets.Stopgap;
using Tamma.Api.Services.Tools.Secrets;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Tools.Secrets;

/// <summary>
/// Story 42-4 AC2 &amp; D4 — short-lived credential lifetime, tag-only outward projection,
/// 60 s uniform two-leg cache + explicit <see cref="IToolSecretProvider.Invalidate"/>.
/// </summary>
[TestFixture]
public class ToolSecretLifetimeTests
{
    [Test]
    public void AC2_ToolCredentialTag_ExposesNoPlaintextMember()
    {
        var tagType = typeof(ToolCredentialTag);
        var props = tagType.GetProperties(BindingFlags.Public | BindingFlags.Instance);
        props.Select(p => p.Name).Should().BeEquivalentTo(new[] { "SecretRef", "Version" });

        var forbiddenNames = new[] { "Plaintext", "Value", "SecretValue", "ApiKey", "Token", "Password", "Credential" };
        foreach (var member in tagType.GetMembers(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
        {
            foreach (var forbidden in forbiddenNames)
            {
                member.Name.Should().NotContainEquivalentOf(
                    forbidden,
                    "ToolCredentialTag must structurally never carry plaintext");
            }
        }
    }

    [Test]
    public void AC2_ToolCredential_ToTagAndToString_NeverExposePlaintext()
    {
        const string secret = "super-sensitive-opaque-token-424242424242";
        var cred = new ToolCredential(secret, "platform:cloud/token", VersionNumber: 3);

        var tag = cred.ToTag();
        tag.SecretRef.Should().Be("platform:cloud/token");
        tag.Version.Should().Be(3);
        tag.ToString().Should().NotContain(secret);
        cred.ToString().Should().NotContain(secret);
    }

    [Test]
    public async Task AC2_ExecutorDoesNotRetainPlaintextAfterExecuteAsyncReturns()
    {
        const string secret = "ephemeral-one-shot-secret-value-99887766";
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => secret);
        var provider = CreateProvider(spyReader, new ManualTimeProvider(), new ToolSecretCache());
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/token", Required: true);

        var executor = new FakeExternalToolExecutor(
            provider,
            runTenantId: null,
            req,
            vendorCall: token => $"deployed ok with token={token}");

        var result = await executor.ExecuteAsync("call-1", "{}");

        result.Success.Should().BeTrue();
        result.Output.Should().NotContain(secret);
        executor.LastUsedTag.Should().NotBeNull();
        executor.LastUsedTag!.SecretRef.Should().Be("platform:cloud/token");

        // Verify no field on the executor holds the plaintext after ExecuteAsync returns.
        foreach (var field in executor.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
        {
            var value = field.GetValue(executor);
            if (value is string s)
            {
                s.Should().NotContain(secret);
            }
            if (value is not null)
            {
                value.Should().NotBeOfType<ToolCredential>();
            }
        }
    }

    [TestCase(true)]
    [TestCase(false)]
    public async Task D4_TwoLegCache_Honours60SecondTtlAndExplicitInvalidate(bool isSaas)
    {
        ToolSecretProvider.DefaultCacheTtl.Should().Be(RuntimeSecretResolver.DefaultCacheTtl);
        ToolSecretProvider.DefaultCacheTtl.Should().Be(TimeSpan.FromSeconds(60));

        var time = new ManualTimeProvider();
        var cache = new ToolSecretCache();
        var version = 1;
        var spyReader = new SpyPlatformCredentialReader((_, _, _) => $"secret-v{version}");
        var provider = CreateProvider(spyReader, time, cache);
        var tenantId = isSaas ? Guid.NewGuid() : (Guid?)null;
        var req = new SecretRequirement(SecretPurpose.ApiKey, "cloud/token", Required: true);

        // 1) Initial fetch misses cache -> hits reader.
        var first = await provider.ResolveAsync(tenantId, req);
        first.Plaintext.Should().Be("secret-v1");
        spyReader.Calls.Should().HaveCount(1);
        // Explicitly documents D4's bounded in-provider cache exception:
        // plaintext IS held inside the provider's own ToolSecretCache for the 60s window.
        cache.Count.Should().Be(1);

        // 2) Second fetch at t + 30s -> served from cache (0 new reader calls).
        version = 2;
        time.Advance(TimeSpan.FromSeconds(30));
        var second = await provider.ResolveAsync(tenantId, req);
        second.Plaintext.Should().Be("secret-v1", "within the 60s TTL the bounded provider cache serves the entry");
        spyReader.Calls.Should().HaveCount(1);

        // 3) Advance past 60s TTL -> expires and re-reads.
        time.Advance(TimeSpan.FromSeconds(31));
        var third = await provider.ResolveAsync(tenantId, req);
        third.Plaintext.Should().Be("secret-v2");
        spyReader.Calls.Should().HaveCount(2);

        // 4) Explicit Invalidate immediately evicts before TTL expires.
        version = 3;
        time.Advance(TimeSpan.FromSeconds(5));
        provider.Invalidate(tenantId, "cloud/token");
        cache.Count.Should().Be(0);

        var fourth = await provider.ResolveAsync(tenantId, req);
        fourth.Plaintext.Should().Be("secret-v3");
        spyReader.Calls.Should().HaveCount(3);
    }

    private static ToolSecretProvider CreateProvider(
        IPlatformCredentialReader reader,
        TimeProvider timeProvider,
        ToolSecretCache cache)
    {
        var events = new CapturingEventRepository();
        var auditEmitter = new ToolSecretAuditEmitter(events, new CapturingLogger<ToolSecretAuditEmitter>(), timeProvider);
        return new ToolSecretProvider(
            reader,
            new DefaultToolSecretNameResolver(),
            auditEmitter,
            new CapturingSecretAccessAuditor(),
            new CapturingLogger<ToolSecretProvider>(),
            cache,
            timeProvider);
    }
}
