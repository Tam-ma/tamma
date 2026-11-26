using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Billing;
using Tamma.Core.Billing;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-6 (AC1, AC6, AC9) — unit tests for <see cref="QuotaResolver"/> and
/// <see cref="QuotaCache"/>: subscription→plan→<see cref="PlanQuota"/> parsing,
/// PlanEntitlement overlay, fail-closed on malformed JSON, pre-checkout
/// <see cref="Tenant.Plan"/> fallback, TTL caching, and immediate invalidation.
/// </summary>
[TestFixture]
public class QuotaResolverTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private QuotaCache _cache = null!;
    private StubTimeProvider _clock = null!;
    private Mock<ILogger<QuotaResolver>> _logger = null!;
    private QuotaResolver _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"quota-resolver-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);
        _cache = new QuotaCache();
        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));
        _logger = new Mock<ILogger<QuotaResolver>>();
        _sut = new QuotaResolver(
            _cp,
            _cache,
            Options.Create(new QuotaOptions { WarnThreshold = 0.8, CacheTtlSeconds = 60 }),
            _clock,
            _logger.Object);
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    [Test]
    public async Task ResolveAsync_Parses_PlanQuotas_Json_For_Free_Team_And_Enterprise()
    {
        var freeTenant = Guid.NewGuid();
        var teamTenant = Guid.NewGuid();
        var entTenant = Guid.NewGuid();

        _cp.Plans.AddRange(
            new Plan
            {
                Id = Guid.NewGuid(),
                Slug = "free",
                DisplayName = "Free",
                Version = 1,
                Status = "active",
                Quotas = """{"llmTokensPerMonth":100000,"overageBehavior":"hard_block","seats":2,"concurrentWorkflows":1,"connectedRepos":2,"warnThreshold":0.75}""",
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            },
            new Plan
            {
                Id = Guid.NewGuid(),
                Slug = "team",
                DisplayName = "Team",
                Version = 1,
                Status = "active",
                Quotas = """{"llmTokensPerMonth":5000000,"overageBehavior":"allow_with_overage","seats":10,"concurrentWorkflows":10,"connectedRepos":25}""",
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            },
            new Plan
            {
                Id = Guid.NewGuid(),
                Slug = "enterprise",
                DisplayName = "Enterprise",
                Version = 1,
                Status = "active",
                Quotas = """{"llmTokensPerMonth":-1,"seats":null,"concurrentWorkflows":100,"connectedRepos":-1}""",
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            });

        _cp.Tenants.Add(new Tenant { Id = freeTenant, Name = "Free", Slug = "free-co", Plan = "free" });
        _cp.BillingSubscriptions.AddRange(
            new BillingSubscription
            {
                Id = Guid.NewGuid(),
                TenantId = teamTenant,
                StripeSubscriptionId = "sub_team",
                PlanSlug = "team",
                Status = "active",
                Seats = 15,
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            },
            new BillingSubscription
            {
                Id = Guid.NewGuid(),
                TenantId = entTenant,
                StripeSubscriptionId = "sub_ent",
                PlanSlug = "enterprise",
                Status = "active",
                Seats = 50,
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            });
        await _cp.SaveChangesAsync();

        var freeQuota = await _sut.ResolveAsync(freeTenant);
        freeQuota.PlanSlug.Should().Be("free");
        freeQuota.PlatformTokenAllowance.Should().Be(100_000L);
        freeQuota.TokenOverage.Should().Be(OverageBehavior.HardBlock);
        freeQuota.MaxSeats.Should().Be(2);
        freeQuota.MaxConcurrentWorkflows.Should().Be(1);
        freeQuota.MaxConnectedRepos.Should().Be(2);
        freeQuota.WarnThreshold.Should().Be(0.75);

        var teamQuota = await _sut.ResolveAsync(teamTenant);
        teamQuota.PlanSlug.Should().Be("team");
        teamQuota.PlatformTokenAllowance.Should().Be(5_000_000L);
        teamQuota.TokenOverage.Should().Be(OverageBehavior.AllowWithOverage);
        teamQuota.MaxSeats.Should().Be(15, "purchased subscription seats lift the paid plan baseline");
        teamQuota.MaxConcurrentWorkflows.Should().Be(10);
        teamQuota.MaxConnectedRepos.Should().Be(25);
        teamQuota.WarnThreshold.Should().Be(0.8);

        var entQuota = await _sut.ResolveAsync(entTenant);
        entQuota.PlanSlug.Should().Be("enterprise");
        entQuota.PlatformTokenAllowance.Should().BeNull("-1 sentinel means unlimited");
        entQuota.TokenOverage.Should().Be(OverageBehavior.AllowWithOverage);
        entQuota.MaxSeats.Should().BeNull();
        entQuota.MaxConcurrentWorkflows.Should().Be(100);
        entQuota.MaxConnectedRepos.Should().BeNull();
    }

    [Test]
    public async Task ResolveAsync_Malformed_PlanQuotas_FailsClosed_To_FreeDefault_And_Logs_Warning()
    {
        var tenantId = Guid.NewGuid();
        _cp.Plans.Add(new Plan
        {
            Id = Guid.NewGuid(),
            Slug = "broken-team",
            DisplayName = "Broken",
            Version = 1,
            Status = "active",
            Quotas = "{not valid json!!!",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.BillingSubscriptions.Add(new BillingSubscription
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeSubscriptionId = "sub_broken",
            PlanSlug = "broken-team",
            Status = "active",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        var quota = await _sut.ResolveAsync(tenantId);

        quota.Should().Be(PlanQuota.FreeDefault(0.8));
        quota.TokenOverage.Should().Be(OverageBehavior.HardBlock);
        _logger.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.AtLeastOnce);
    }

    [Test]
    public async Task ResolveAsync_NonObject_PlanQuotas_FailsClosed_To_FreeDefault()
    {
        var tenantId = Guid.NewGuid();
        _cp.Plans.Add(new Plan
        {
            Id = Guid.NewGuid(),
            Slug = "array-plan",
            DisplayName = "Array",
            Version = 1,
            Status = "active",
            Quotas = "[1, 2, 3]",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "Arr", Slug = "arr", Plan = "array-plan" });
        await _cp.SaveChangesAsync();

        var quota = await _sut.ResolveAsync(tenantId);

        quota.Should().Be(PlanQuota.FreeDefault(0.8));
    }

    [Test]
    public async Task ResolveAsync_Overlays_PlanEntitlements_When_Json_Omits_Keys()
    {
        var tenantId = Guid.NewGuid();
        var planId = Guid.NewGuid();
        _cp.Plans.Add(new Plan
        {
            Id = planId,
            Slug = "custom",
            DisplayName = "Custom",
            Version = 1,
            Status = "active",
            Quotas = """{"concurrentWorkflows":4}""",
            Entitlements =
            {
                new PlanEntitlement
                {
                    Id = Guid.NewGuid(),
                    PlanId = planId,
                    MetricKey = EntitlementMetricKey.LlmTokens,
                    LimitValue = 750_000,
                    OverageMode = "block",
                },
                new PlanEntitlement
                {
                    Id = Guid.NewGuid(),
                    PlanId = planId,
                    MetricKey = EntitlementMetricKey.Seats,
                    LimitValue = 6,
                },
                new PlanEntitlement
                {
                    Id = Guid.NewGuid(),
                    PlanId = planId,
                    MetricKey = EntitlementMetricKey.Repos,
                    LimitValue = 9,
                },
            },
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "Custom", Slug = "custom-co", Plan = "custom" });
        await _cp.SaveChangesAsync();

        var quota = await _sut.ResolveAsync(tenantId);

        quota.PlatformTokenAllowance.Should().Be(750_000L);
        quota.TokenOverage.Should().Be(OverageBehavior.HardBlock);
        quota.MaxSeats.Should().Be(6);
        quota.MaxConcurrentWorkflows.Should().Be(4);
        quota.MaxConnectedRepos.Should().Be(9);
    }

    [Test]
    public async Task ResolveAsync_Caches_Within_Ttl_And_Invalidate_Forces_Immediate_Recompute()
    {
        var tenantId = Guid.NewGuid();
        _cp.Plans.AddRange(
            new Plan
            {
                Id = Guid.NewGuid(),
                Slug = "free",
                DisplayName = "Free",
                Version = 1,
                Status = "active",
                Quotas = """{"llmTokensPerMonth":100000,"overageBehavior":"hard_block","seats":2}""",
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            },
            new Plan
            {
                Id = Guid.NewGuid(),
                Slug = "team",
                DisplayName = "Team",
                Version = 1,
                Status = "active",
                Quotas = """{"llmTokensPerMonth":5000000,"overageBehavior":"allow_with_overage","seats":10}""",
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            });
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "Upgrade", Slug = "upg", Plan = "free" });
        await _cp.SaveChangesAsync();

        var initial = await _sut.ResolveAsync(tenantId);
        initial.PlanSlug.Should().Be("free");
        initial.TokenOverage.Should().Be(OverageBehavior.HardBlock);

        // Upgrade subscription in DB while cache is still warm
        _cp.BillingSubscriptions.Add(new BillingSubscription
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeSubscriptionId = "sub_upg",
            PlanSlug = "team",
            Status = "active",
            Seats = 10,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow.AddSeconds(5),
        });
        await _cp.SaveChangesAsync();

        // Within TTL (10s < 60s), cache still returns free
        _clock.Advance(TimeSpan.FromSeconds(10));
        var stillCached = await _sut.ResolveAsync(tenantId);
        stillCached.PlanSlug.Should().Be("free");

        // Invalidate immediately lifts the stale cache entry (AC9)
        _sut.Invalidate(tenantId);
        var upgraded = await _sut.ResolveAsync(tenantId);
        upgraded.PlanSlug.Should().Be("team");
        upgraded.TokenOverage.Should().Be(OverageBehavior.AllowWithOverage);
        upgraded.PlatformTokenAllowance.Should().Be(5_000_000L);
    }

    [Test]
    public async Task ResolveAsync_Refreshes_Automatically_After_CacheTtl_Expires()
    {
        var tenantId = Guid.NewGuid();
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "Ttl", Slug = "ttl-co", Plan = "free" });
        await _cp.SaveChangesAsync();

        (await _sut.ResolveAsync(tenantId)).PlanSlug.Should().Be("free");

        _cp.BillingSubscriptions.Add(new BillingSubscription
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeSubscriptionId = "sub_ttl",
            PlanSlug = "team",
            Status = "active",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        _clock.Advance(TimeSpan.FromSeconds(61));
        (await _sut.ResolveAsync(tenantId)).PlanSlug.Should().Be("team");
    }
}
