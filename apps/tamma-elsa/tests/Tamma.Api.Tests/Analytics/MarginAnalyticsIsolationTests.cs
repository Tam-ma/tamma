using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Services.Analytics;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Analytics;

/// <summary>
/// Story 36-7 (AC6, AC7, AC8, AC11, AC13) — Postgres 17 Testcontainer integration
/// tests proving:
/// <list type="number">
///   <item>Physical schema isolation between tenant A and tenant B for
///     <see cref="MarginAnalyticsService"/>.</item>
///   <item>Platform-aggregate fan-out via
///     <see cref="PlatformAnalyticsService.GetPlatformMarginAsync"/> summing
///     persisted <c>PlatformBilledUsd</c> and <c>CostUsd</c> across active tenants
///     + top-N ordering + fleet trend.</item>
///   <item>Per-tenant fault tolerance: an unreachable/failing tenant is caught,
///     skipped, and counted in <c>TenantsSkipped</c> while healthy tenants still
///     contribute to the fleet aggregate.</item>
///   <item>Zero active tenants returns a zeroed <see cref="PlatformMarginReport"/>.</item>
/// </list>
/// </summary>
[TestFixture]
public class MarginAnalyticsIsolationTests
{
    private static readonly DateTimeOffset June15 = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTime WindowFrom = new(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime WindowTo = new(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc);

    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("margin_analytics_isolation_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _baseConnectionString = _postgres.GetConnectionString();
    }

    [OneTimeTearDown]
    public async Task OneTimeTearDown() => await _postgres.DisposeAsync();

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    [Test]
    public async Task GetTenantMarginAsync_PhysicalSchemaIsolation_TenantAExcludesTenantB()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var schemaA = TenantNaming.SchemaName(tenantA);
        var schemaB = TenantNaming.SchemaName(tenantB);

        var migrator = new EfTenantDbMigrator();
        await migrator.MigrateTenantAppAsync(CsFor(schemaA));
        await migrator.MigrateTenantAppAsync(CsFor(schemaB));

        var day = new DateTime(2026, 6, 5, 0, 0, 0, DateTimeKind.Utc);
        await SeedDailyAsync(schemaA, tenantA, day, CostBasis.Platform, cost: 10m, billed: 15m, provider: "anthropic");
        await SeedDailyAsync(schemaB, tenantB, day, CostBasis.Platform, cost: 100m, billed: 250m, provider: "openai");

        var factory = new SchemaRoutingFactory(_baseConnectionString)
            .Map(tenantA, schemaA)
            .Map(tenantB, schemaB);

        var svc = new MarginAnalyticsService(
            factory, NoOpEvents(), new FixedClock(June15), NullLogger<MarginAnalyticsService>.Instance);

        var reportA = await svc.GetTenantMarginAsync(tenantA, WindowFrom, WindowTo);
        reportA.Summary.CostUsd.Should().Be(10m);
        reportA.Summary.RevenueUsd.Should().Be(15m);
        reportA.Summary.MarginUsd.Should().Be(5m);
        reportA.Breakdowns.Should().NotContain(b => b.Key == "openai");

        var reportB = await svc.GetTenantMarginAsync(tenantB, WindowFrom, WindowTo);
        reportB.Summary.CostUsd.Should().Be(100m);
        reportB.Summary.RevenueUsd.Should().Be(250m);
        reportB.Summary.MarginUsd.Should().Be(150m);
        reportB.Breakdowns.Should().NotContain(b => b.Key == "anthropic");
    }

    [Test]
    public async Task GetPlatformMarginAsync_FansOutAcrossTenants_AndToleratesSingleTenantFailure()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var tenantBroken = Guid.NewGuid();
        var schemaA = TenantNaming.SchemaName(tenantA);
        var schemaB = TenantNaming.SchemaName(tenantB);

        var migrator = new EfTenantDbMigrator();
        await migrator.MigrateTenantAppAsync(CsFor(schemaA));
        await migrator.MigrateTenantAppAsync(CsFor(schemaB));

        var day1 = new DateTime(2026, 6, 4, 0, 0, 0, DateTimeKind.Utc);
        var day2 = new DateTime(2026, 6, 5, 0, 0, 0, DateTimeKind.Utc);

        await SeedDailyAsync(schemaA, tenantA, day1, CostBasis.Platform, cost: 20m, billed: 30m, provider: "anthropic");
        await SeedDailyAsync(schemaB, tenantB, day1, CostBasis.Platform, cost: 40m, billed: 80m, provider: "openai");
        await SeedDailyAsync(schemaB, tenantB, day2, CostBasis.Byok, cost: 5m, billed: 0m, provider: "openai");

        // ControlPlane DbContext in memory with all 3 active tenants (tenantBroken has no schema -> throws!)
        var cpOpts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"cp-platform-margin-{Guid.NewGuid():N}")
            .Options;
        await using var cp = new ControlPlaneDbContext(cpOpts);
        cp.Tenants.AddRange(
            new Tenant { Id = tenantA, Slug = "alpha", Name = "Alpha", Plan = "team" },
            new Tenant { Id = tenantB, Slug = "beta", Name = "Beta", Plan = "enterprise" },
            new Tenant { Id = tenantBroken, Slug = "broken", Name = "Broken", Plan = "free" });
        await cp.SaveChangesAsync();

        var factory = new SchemaRoutingFactory(_baseConnectionString)
            .Map(tenantA, schemaA)
            .Map(tenantB, schemaB);
        // Deliberately DO NOT map tenantBroken -> factory throws InvalidOperationException

        var marginSvc = new MarginAnalyticsService(
            factory, NoOpEvents(), new FixedClock(June15), NullLogger<MarginAnalyticsService>.Instance);

        var emitted = new List<DomainEvent>();
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent evt) =>
            {
                emitted.Add(evt);
                return evt;
            });

        var platformSvc = new PlatformAnalyticsService(
            cp,
            factory,
            new FixedClock(June15),
            marginSvc,
            events.Object,
            NullLogger<PlatformAnalyticsService>.Instance);

        var report = await platformSvc.GetPlatformMarginAsync(WindowFrom, WindowTo, MarginGrain.Day, topN: 10);

        report.TenantsIncluded.Should().Be(2);
        report.TenantsSkipped.Should().Be(1, "broken tenant must be skipped and counted, never aborting the aggregate");

        // Fleet total: Cost = 20 + 40 + 5 = 65; Revenue = 30 + 80 + 0 = 110; Margin = 45
        report.Summary.CostUsd.Should().Be(65m);
        report.Summary.RevenueUsd.Should().Be(110m);
        report.Summary.MarginUsd.Should().Be(45m);

        // Top tenants ordered by margin descending: Beta (35) before Alpha (10)
        report.TopTenantsByMargin.Should().HaveCount(2);
        report.TopTenantsByMargin[0].TenantId.Should().Be(tenantB);
        report.TopTenantsByMargin[0].MarginUsd.Should().Be(35m);
        report.TopTenantsByMargin[1].TenantId.Should().Be(tenantA);
        report.TopTenantsByMargin[1].MarginUsd.Should().Be(10m);

        // Fleet trend reconciles losslessly to fleet total
        report.Trend.Should().HaveCount(2);
        report.Trend[0].Bucket.Should().Be(day1);
        report.Trend[0].CostUsd.Should().Be(60m);
        report.Trend[0].RevenueUsd.Should().Be(110m);
        report.Trend[1].Bucket.Should().Be(day2);
        report.Trend[1].CostUsd.Should().Be(5m);
        report.Trend[1].RevenueUsd.Should().Be(0m);
        report.Trend.Sum(t => t.MarginUsd).Should().Be(report.Summary.MarginUsd);

        // Single platform-scoped ANALYTICS.MARGIN.VIEWED event emitted
        emitted.Should().ContainSingle();
        emitted[0].Type.Should().Be(MarginAnalyticsEvents.MarginViewed);
        emitted[0].TenantId.Should().BeNull();
    }

    [Test]
    public async Task GetPlatformMarginAsync_ZeroActiveTenants_ReturnsZeroedReport()
    {
        var cpOpts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"cp-empty-margin-{Guid.NewGuid():N}")
            .Options;
        await using var cp = new ControlPlaneDbContext(cpOpts);

        var platformSvc = new PlatformAnalyticsService(
            cp,
            new SchemaRoutingFactory(_baseConnectionString),
            new FixedClock(June15),
            marginAnalytics: null,
            events: NoOpEvents(),
            logger: NullLogger<PlatformAnalyticsService>.Instance);

        var report = await platformSvc.GetPlatformMarginAsync(WindowFrom, WindowTo);

        report.TenantsIncluded.Should().Be(0);
        report.TenantsSkipped.Should().Be(0);
        report.Summary.CostUsd.Should().Be(0m);
        report.Summary.RevenueUsd.Should().Be(0m);
        report.Summary.MarginUsd.Should().Be(0m);
        report.Summary.MarginPct.Should().Be(0m);
        report.TopTenantsByMargin.Should().BeEmpty();
        report.Trend.Should().BeEmpty();
    }

    private async Task SeedDailyAsync(
        string schema, Guid tenantId, DateTime day, CostBasis basis,
        decimal cost, decimal billed, string? provider)
    {
        var opts = new DbContextOptionsBuilder<TenantDbContext>().UseNpgsql(CsFor(schema)).Options;
        await using var ctx = new TenantDbContext(opts, tenantId);
        ctx.AnalyticsUsageDaily.Add(new AnalyticsUsageDaily
        {
            Id = Guid.NewGuid(),
            Day = day,
            Provider = provider,
            CostBasis = basis,
            CostUsd = cost,
            PlatformBilledUsd = billed,
            ComputedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private static IEventRepository NoOpEvents()
    {
        var m = new Mock<IEventRepository>();
        m.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent e) => e);
        return m.Object;
    }

    private sealed class SchemaRoutingFactory(string baseCs) : ITenantDbContextFactory
    {
        private readonly Dictionary<Guid, string> _schemas = new();

        public SchemaRoutingFactory Map(Guid tenantId, string schema)
        {
            _schemas[tenantId] = schema;
            return this;
        }

        public ValueTask<TenantDbContext> CreateAsync(Guid tenantId, CancellationToken ct = default)
        {
            if (!_schemas.TryGetValue(tenantId, out var schema))
            {
                throw new InvalidOperationException($"Tenant {tenantId} schema is unreachable.");
            }

            var cs = new NpgsqlConnectionStringBuilder(baseCs) { SearchPath = schema }.ConnectionString;
            var opts = new DbContextOptionsBuilder<TenantDbContext>().UseNpgsql(cs).Options;
            return new ValueTask<TenantDbContext>(new TenantDbContext(opts, tenantId));
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
