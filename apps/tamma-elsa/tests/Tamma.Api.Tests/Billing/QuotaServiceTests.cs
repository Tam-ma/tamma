using System.Net;
using System.Net.Http;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.Diagnostics;
using Tamma.Api.Services.Diagnostics.Models;
using Tamma.Api.Services.SaaS;
using Tamma.Core.Billing;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-6 (AC2, AC3, AC5, AC7, AC8, AC9, AC10, AC13, AC14) — unit tests for
/// <see cref="QuotaService"/>, <see cref="QuotaNotifier"/>,
/// <see cref="NullQuotaService"/>, <see cref="LlmProxyService"/> token-quota
/// enforcement, and <see cref="SubscriptionMirrorUpdater"/> cache invalidation.
/// </summary>
[TestFixture]
public class QuotaServiceTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);
    private static readonly BillingPeriod JunePeriod = new(
        new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
        new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));

    private ControlPlaneDbContext _cp = null!;
    private QuotaCache _cache = null!;
    private StubTimeProvider _clock = null!;
    private Mock<IEventRepository> _events = null!;
    private List<DomainEvent> _appendedEvents = null!;
    private QuotaResolver _resolver = null!;
    private QuotaNotifier _notifier = null!;
    private QuotaService _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"quota-service-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);
        _cache = new QuotaCache();
        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));
        _appendedEvents = [];
        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(e => _appendedEvents.Add(e))
            .ReturnsAsync((DomainEvent e) => e);

        _resolver = new QuotaResolver(
            _cp,
            _cache,
            Options.Create(new QuotaOptions { WarnThreshold = 0.8, CacheTtlSeconds = 60 }),
            _clock,
            Mock.Of<ILogger<QuotaResolver>>());

        _notifier = new QuotaNotifier(
            _cp,
            _events.Object,
            _clock,
            Mock.Of<ILogger<QuotaNotifier>>());

        _sut = new QuotaService(
            _cp,
            _resolver,
            _notifier,
            _clock,
            Mock.Of<ILogger<QuotaService>>());
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    private async Task SeedPlansAsync()
    {
        _cp.Plans.AddRange(
            new Plan
            {
                Id = Guid.NewGuid(),
                Slug = "free",
                DisplayName = "Free",
                Version = 1,
                Status = "active",
                Quotas = """{"llmTokensPerMonth":100000,"overageBehavior":"hard_block","seats":2,"concurrentWorkflows":1,"connectedRepos":2}""",
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
                Quotas = """{"llmTokensPerMonth":1000000,"overageBehavior":"allow_with_overage","seats":5,"concurrentWorkflows":4,"connectedRepos":10}""",
                CreatedAt = FixedNow,
                UpdatedAt = FixedNow,
            });
        await _cp.SaveChangesAsync();
    }

    private async Task<Guid> SeedTenantWithRollupAsync(string planSlug, long platformIn, long platformOut, string billingMode = "PlatformProvided")
    {
        var tenantId = Guid.NewGuid();
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = planSlug, Slug = $"{planSlug}-{tenantId:N}"[..16], Plan = planSlug });
        _cp.BillingCustomers.Add(new BillingCustomer
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeCustomerId = $"cus_{tenantId:N}"[..18],
            BillingMode = billingMode,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.BillingSubscriptions.Add(new BillingSubscription
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeSubscriptionId = $"sub_{tenantId:N}"[..18],
            PlanSlug = planSlug,
            Status = "active",
            CurrentPeriodStart = JunePeriod.StartUtc,
            CurrentPeriodEnd = JunePeriod.EndUtc,
            Seats = planSlug == "free" ? 2 : 5,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.BillingUsageRollups.Add(new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = JunePeriod.StartUtc,
            PeriodEnd = JunePeriod.EndUtc,
            PlatformInputTokens = platformIn,
            PlatformOutputTokens = platformOut,
            ByokInputTokens = 5_000_000,
            ByokOutputTokens = 5_000_000,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();
        return tenantId;
    }

    [Test]
    public async Task FreeTier_At_100Percent_HardBlocks_With_402_And_ResetAt_And_Emits_Once()
    {
        await SeedPlansAsync();
        var tenantId = await SeedTenantWithRollupAsync("free", 70_000, 30_000);

        var first = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform, projectedTokens: 0);
        var second = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform, projectedTokens: 500);
        var third = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform, projectedTokens: 1_000);

        first.Allowed.Should().BeFalse();
        first.WhichQuota.Should().Be(QuotaDimension.PlatformTokens);
        first.HttpStatus.Should().Be(StatusCodes.Status402PaymentRequired);
        first.Limit.Should().Be(100_000L);
        first.Used.Should().Be(100_000L);
        first.ResetAt.Should().Be(new DateTimeOffset(JunePeriod.EndUtc, TimeSpan.Zero));

        second.Allowed.Should().BeFalse();
        third.Allowed.Should().BeFalse();

        // AC13: hot over-quota loop emits BILLING.QUOTA.EXCEEDED at most once per period
        _appendedEvents.Should().ContainSingle(e => e.Type == QuotaEvents.Exceeded && e.TenantId == tenantId);
    }

    [Test]
    public async Task PaidTier_At_100Percent_AllowsWithOverage_And_Emits_Exceeded_Once()
    {
        await SeedPlansAsync();
        var tenantId = await SeedTenantWithRollupAsync("team", 800_000, 300_000);

        var decision = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform, projectedTokens: 0);

        decision.Allowed.Should().BeTrue("team plan uses AllowWithOverage");
        decision.Limit.Should().Be(1_000_000L);
        decision.Used.Should().Be(1_100_000L);
        decision.HttpStatus.Should().Be(0);
        _appendedEvents.Should().ContainSingle(e => e.Type == QuotaEvents.Exceeded);
    }

    [Test]
    public async Task Byok_Tenant_Over_Allowance_ShortCircuits_Allow_With_Zero_DbReads_And_No_Events()
    {
        // Dispose the DbContext BEFORE the check — any DB access would throw ObjectDisposedException.
        var tenantId = Guid.NewGuid();
        _cp.Dispose();
        _cp = null!;

        var decision = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Byok, projectedTokens: 999_999_999);

        decision.Allowed.Should().BeTrue();
        decision.WhichQuota.Should().Be(QuotaDimension.PlatformTokens);
        _appendedEvents.Should().BeEmpty();
    }

    [Test]
    public async Task Crossing_80Percent_Allows_And_Emits_Warn_Once_Then_New_Period_Emits_Fresh_Event()
    {
        await SeedPlansAsync();
        var tenantId = await SeedTenantWithRollupAsync("free", 60_000, 25_000); // 85%

        var d1 = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);
        var d2 = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);

        d1.Allowed.Should().BeTrue();
        d2.Allowed.Should().BeTrue();
        _appendedEvents.Should().ContainSingle(e => e.Type == QuotaEvents.Warn);

        // Advance into next billing period (July) with a new rollup crossing 80%
        var julyStart = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc);
        var julyEnd = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc);
        var sub = await _cp.BillingSubscriptions.FirstAsync(s => s.TenantId == tenantId);
        sub.CurrentPeriodStart = julyStart;
        sub.CurrentPeriodEnd = julyEnd;
        _cp.BillingUsageRollups.Add(new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = julyStart,
            PeriodEnd = julyEnd,
            PlatformInputTokens = 82_000,
            PlatformOutputTokens = 0,
            UpdatedAt = julyStart.AddDays(2),
        });
        await _cp.SaveChangesAsync();
        _clock.Advance(TimeSpan.FromDays(20));

        var d3 = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);
        d3.Allowed.Should().BeTrue();
        _appendedEvents.Count(e => e.Type == QuotaEvents.Warn).Should().Be(2);
    }

    [Test]
    public async Task SeatCap_ConnectedRepoCap_And_ConcurrentWorkflowCap_Enforce_429()
    {
        await SeedPlansAsync();
        var tenantId = await SeedTenantWithRollupAsync("free", 0, 0);

        // 1. Seat cap (free = 2)
        _cp.TenantMemberships.AddRange(
            new TenantMembership { Id = Guid.NewGuid(), TenantId = tenantId, UserId = Guid.NewGuid(), Role = "owner", JoinedAt = FixedNow },
            new TenantMembership { Id = Guid.NewGuid(), TenantId = tenantId, UserId = Guid.NewGuid(), Role = "member", JoinedAt = FixedNow });
        await _cp.SaveChangesAsync();

        var seatDeny = await _sut.CheckSeatQuotaAsync(tenantId);
        seatDeny.Allowed.Should().BeFalse();
        seatDeny.WhichQuota.Should().Be(QuotaDimension.Seats);
        seatDeny.HttpStatus.Should().Be(StatusCodes.Status429TooManyRequests);
        seatDeny.Limit.Should().Be(2);
        seatDeny.Used.Should().Be(2);

        // 2. Connected repos cap (free = 2 active; inactive does not count)
        var install = new GitHubInstallation
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            InstallationId = 4242,
            AccountLogin = "acme",
            AccountType = "Organization",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        };
        _cp.GitHubInstallations.Add(install);
        _cp.GitHubInstallationRepos.AddRange(
            new GitHubInstallationRepo { Id = Guid.NewGuid(), InstallationEntityId = install.Id, RepoId = 1, RepoFullName = "acme/one", Owner = "acme", Name = "one", IsActive = true },
            new GitHubInstallationRepo { Id = Guid.NewGuid(), InstallationEntityId = install.Id, RepoId = 2, RepoFullName = "acme/two", Owner = "acme", Name = "two", IsActive = false });
        await _cp.SaveChangesAsync();

        var repoAllow = await _sut.CheckConnectedRepoQuotaAsync(tenantId);
        repoAllow.Allowed.Should().BeTrue("only 1 of 2 active repos used");

        _cp.GitHubInstallationRepos.Add(
            new GitHubInstallationRepo { Id = Guid.NewGuid(), InstallationEntityId = install.Id, RepoId = 3, RepoFullName = "acme/three", Owner = "acme", Name = "three", IsActive = true });
        await _cp.SaveChangesAsync();

        var repoDeny = await _sut.CheckConnectedRepoQuotaAsync(tenantId);
        repoDeny.Allowed.Should().BeFalse();
        repoDeny.WhichQuota.Should().Be(QuotaDimension.ConnectedRepos);
        repoDeny.HttpStatus.Should().Be(StatusCodes.Status429TooManyRequests);

        // 3. Concurrent workflow cap (free = 1) using an in-memory TenantDbContext
        var tenantDbOpts = new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase($"tenant-wf-{Guid.NewGuid():N}")
            .Options;
        await using (var seedTenantDb = new TenantDbContext(tenantDbOpts))
        {
            seedTenantDb.WorkflowInstances.AddRange(
                new WorkflowInstance { Id = Guid.NewGuid(), DefinitionId = Guid.NewGuid(), TenantId = tenantId, Status = "running", CreatedAt = FixedNow, UpdatedAt = FixedNow },
                new WorkflowInstance { Id = Guid.NewGuid(), DefinitionId = Guid.NewGuid(), TenantId = tenantId, Status = "completed", CreatedAt = FixedNow, UpdatedAt = FixedNow });
            await seedTenantDb.SaveChangesAsync();
        }

        var tenantDbFactory = new Mock<ITenantDbContextFactory>();
        tenantDbFactory.Setup(f => f.CreateAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => new TenantDbContext(tenantDbOpts));

        var sutWithTenantDb = new QuotaService(
            _cp, _resolver, _notifier, _clock, Mock.Of<ILogger<QuotaService>>(), tenantDbFactory.Object);

        var wfDeny = await sutWithTenantDb.CheckConcurrentWorkflowQuotaAsync(tenantId);
        wfDeny.Allowed.Should().BeFalse();
        wfDeny.WhichQuota.Should().Be(QuotaDimension.ConcurrentWorkflows);
        wfDeny.HttpStatus.Should().Be(StatusCodes.Status429TooManyRequests);
        wfDeny.Limit.Should().Be(1);
        wfDeny.Used.Should().Be(1);
    }

    [Test]
    public async Task SubscriptionMirrorUpdater_Upgrade_Invalidates_QuotaCache_And_Lifts_HardBlock_Immediately()
    {
        await SeedPlansAsync();
        var tenantId = await SeedTenantWithRollupAsync("free", 100_000, 5_000);
        var subRow = await _cp.BillingSubscriptions.FirstAsync(s => s.TenantId == tenantId);
        var teamPriceId = "price_team_monthly";
        _cp.BillingPlanPrices.Add(new BillingPlanPrice
        {
            Id = Guid.NewGuid(),
            PlanSlug = "team",
            StripeProductId = "prod_team",
            StripePriceId = teamPriceId,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        // Warm cache & confirm HardBlock
        (await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform)).Allowed.Should().BeFalse();

        // Apply SUBSCRIPTION.UPDATED via SubscriptionMirrorUpdater with _sut wired as IQuotaService
        var updater = new SubscriptionMirrorUpdater(
            _cp,
            new BillingSubscriptionRepository(_cp),
            _events.Object,
            _clock,
            Mock.Of<ILogger<SubscriptionMirrorUpdater>>(),
            _sut);

        var stripeSub = new Stripe.Subscription
        {
            Id = subRow.StripeSubscriptionId,
            CustomerId = (await _cp.BillingCustomers.FirstAsync(c => c.TenantId == tenantId)).StripeCustomerId,
            Status = "active",
            Items = new Stripe.StripeList<Stripe.SubscriptionItem>
            {
                Data =
                [
                    new Stripe.SubscriptionItem
                    {
                        Price = new Stripe.Price { Id = teamPriceId },
                        Quantity = 5,
                        CurrentPeriodStart = JunePeriod.StartUtc,
                        CurrentPeriodEnd = JunePeriod.EndUtc,
                    }
                ]
            }
        };

        await updater.ApplyAsync(tenantId, stripeSub, SubscriptionMirrorUpdater.TransitionUpdated);

        // Very next request immediately sees Team plan (AllowWithOverage) without restart or waiting for TTL!
        var afterUpgrade = await _sut.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);
        afterUpgrade.Allowed.Should().BeTrue();
        afterUpgrade.Limit.Should().Be(1_000_000L);
    }

    [Test]
    public async Task NullQuotaService_Always_Allows_With_Zero_DbReads()
    {
        var nullSvc = new NullQuotaService();
        var tenantId = Guid.NewGuid();

        (await nullSvc.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform, 10_000_000)).Allowed.Should().BeTrue();
        (await nullSvc.CheckConcurrentWorkflowQuotaAsync(tenantId)).Allowed.Should().BeTrue();
        (await nullSvc.CheckSeatQuotaAsync(tenantId)).Allowed.Should().BeTrue();
        (await nullSvc.CheckConnectedRepoQuotaAsync(tenantId)).Allowed.Should().BeTrue();

        var quota = await nullSvc.GetQuotaAsync(tenantId);
        quota.PlanSlug.Should().Be("single-user");
        quota.PlatformTokenAllowance.Should().BeNull();

        var snap = await nullSvc.GetQuotaSnapshotAsync(tenantId);
        snap.Plan.Should().Be("single-user");
        snap.TokenAllowance.Should().BeNull();
    }

    [Test]
    public async Task LlmProxyService_HardBlock_Returns_QuotaExceeded_Without_Upstream_Call_And_Allows_Byok()
    {
        var upstreamCalls = 0;
        var handler = new StubHttpHandler(_ =>
        {
            upstreamCalls++;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":10,"output_tokens":5}}""",
                    Encoding.UTF8,
                    "application/json"),
            };
        });
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.anthropic.com") };
        var httpFactory = new Mock<IHttpClientFactory>();
        httpFactory.Setup(f => f.CreateClient(It.IsAny<string>())).Returns(httpClient);

        var diagnostics = new Mock<IDiagnosticsService>();
        diagnostics.Setup(d => d.GetBudgetAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid acct, CancellationToken _) => new BudgetStatus(
                acct, JunePeriod.StartUtc, JunePeriod.EndUtc, 0m, 0m, 0m, 0d, 0.8d, false, false));

        var tenantId = Guid.NewGuid();
        var tagger = new Mock<IBillingModeTagger>();
        tagger.Setup(t => t.ResolveTagAsync(tenantId, It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(BillingModeTokens.Platform);

        var quotaMock = new Mock<IQuotaService>();
        var resetAt = new DateTimeOffset(JunePeriod.EndUtc, TimeSpan.Zero);
        quotaMock.Setup(q => q.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform, It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(QuotaDecision.Deny(QuotaDimension.PlatformTokens, 100_000, 100_000, resetAt, 402));
        quotaMock.Setup(q => q.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Byok, It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(QuotaDecision.Allow(QuotaDimension.PlatformTokens));

        var proxy = new LlmProxyService(
            httpFactory.Object,
            diagnostics.Object,
            tagger.Object,
            _events.Object,
            Mock.Of<ILogger<LlmProxyService>>(),
            settings: null,
            quotaService: quotaMock.Object);

        // 1. Platform mode over allowance -> denied with quota_exceeded, zero upstream HTTP calls
        var denied = await proxy.ChatAsync(
            new ChatRequest(null, [new ChatMessage("user", "hi")], null, null),
            tenantId);

        denied.Success.Should().BeFalse();
        denied.ErrorReason.Should().Be("quota_exceeded");
        denied.QuotaDenial.Should().NotBeNull();
        denied.QuotaDenial!.HttpStatus.Should().Be(402);
        upstreamCalls.Should().Be(0);

        // 2. BYOK mode -> allowed and reaches upstream
        tagger.Setup(t => t.ResolveTagAsync(tenantId, It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(BillingModeTokens.Byok);

        var allowed = await proxy.ChatAsync(
            new ChatRequest(null, [new ChatMessage("user", "hi")], null, null),
            tenantId);

        allowed.Success.Should().BeTrue();
        allowed.Text.Should().Be("hello");
        upstreamCalls.Should().Be(1);
    }

    private sealed class StubHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(responder(request));
    }
}
