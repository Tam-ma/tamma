using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using NUnit.Framework;
using Tamma.Api.Extensions;
using Tamma.Api.Services.Alerts;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Api.Services.Pricing;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-3 (AC1, AC8, AC12, AC13, AC14) — host-level endpoint, tenant
/// isolation, single-user no-op seam, DI registration, and EF model-shape tests
/// for <c>GET /api/v1/billing/usage</c> and the new control-plane billing usage
/// tables.
/// </summary>
[TestFixture]
public class BillingUsageEndpointsTests
{
    private const string JwtSecret = "billing-usage-test-secret-32-chars-min!!";
    private static readonly SymmetricSecurityKey SigningKey =
        new(Encoding.UTF8.GetBytes(JwtSecret));

    private WebApplicationFactory<Program> _saasFactory = null!;

    [OneTimeSetUp]
    public void OneTimeSetUp()
    {
        Environment.SetEnvironmentVariable("Jwt__Secret", JwtSecret);
        Environment.SetEnvironmentVariable("Jwt__Issuer", "tamma");
        Environment.SetEnvironmentVariable("Jwt__Audience", "tamma-api");
        Environment.SetEnvironmentVariable("Cranl__ApiKey", null);
        Environment.SetEnvironmentVariable(
            "ConnectionStrings__DefaultConnection", ApiTestFixture.Postgres.GetConnectionString());
        Environment.SetEnvironmentVariable(
            "ConnectionStrings__TammaDb", ApiTestFixture.Postgres.GetConnectionString());
        Environment.SetEnvironmentVariable(
            "ConnectionStrings__ControlPlane", ApiTestFixture.Postgres.GetConnectionString());
        Environment.SetEnvironmentVariable(
            "Cranl__EncryptionKey", Convert.ToBase64String(new byte[32]));

        _saasFactory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b =>
            {
                b.UseEnvironment("Production");
                b.UseSetting("Tamma:Mode", "saas");
                b.DisableAlertHostedServices();
            });
    }

    [SetUp]
    public async Task SetUp()
    {
        await ApiTestFixture.ResetDatabaseAsync();
        await using var scope = _saasFactory.Services.CreateAsyncScope();
        var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
        await cp.TenantDatabases.ExecuteDeleteAsync();
        await TestTenantProvisioning.ReseedPoolAsync(
            _saasFactory.Services, ApiTestFixture.Postgres.GetConnectionString());
    }

    [OneTimeTearDown]
    public void OneTimeTearDown()
    {
        _saasFactory?.Dispose();
        Environment.SetEnvironmentVariable("Jwt__Secret", null);
        Environment.SetEnvironmentVariable("Jwt__Issuer", null);
        Environment.SetEnvironmentVariable("Jwt__Audience", null);
        Environment.SetEnvironmentVariable("ConnectionStrings__ControlPlane", null);
        Environment.SetEnvironmentVariable("Cranl__EncryptionKey", null);
    }

    private static string MintTenantJwt(Guid tenantId, string role = "member")
    {
        var jwt = new JwtSecurityToken(
            issuer: "tamma",
            audience: "tamma-api",
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString()),
                new Claim("tenantId", tenantId.ToString("D")),
                new Claim("role", role),
                new Claim("platformRole", "user"),
                new Claim(JwtRegisteredClaimNames.Email, "member@example.com"),
                new Claim("name", "Member"),
                new Claim("authMethod", "email"),
                new Claim("tenants", "[]"),
            },
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: new SigningCredentials(SigningKey, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    [Test]
    public async Task GetUsage_Returns_Caller_Tenant_Rollup_And_Enforces_CrossTenant_Isolation()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var period = BillingPeriod.ForUtcMonth(DateTime.UtcNow);

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            cp.Tenants.AddRange(
                new Tenant { Id = tenantA, Name = "Tenant A", Slug = $"ta-{tenantA:N}"[..16] },
                new Tenant { Id = tenantB, Name = "Tenant B", Slug = $"tb-{tenantB:N}"[..16] });
            await cp.SaveChangesAsync();
        }

        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantA);
        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantB);

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            cp.BillingUsageRollups.AddRange(
                new BillingUsageRollup
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenantA,
                    PeriodStart = period.StartUtc,
                    PeriodEnd = period.EndUtc,
                    PlatformInputTokens = 111_000,
                    PlatformOutputTokens = 22_000,
                    ByokInputTokens = 5_000,
                    ByokOutputTokens = 1_000,
                    PlatformCostUsd = 1.1000m,
                    BillableAmountUsd = 1.4300m,
                    Seats = 4,
                    UpdatedAt = DateTime.UtcNow,
                },
                new BillingUsageRollup
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenantB,
                    PeriodStart = period.StartUtc,
                    PeriodEnd = period.EndUtc,
                    PlatformInputTokens = 999_000,
                    PlatformOutputTokens = 888_000,
                    ByokInputTokens = 77_000,
                    ByokOutputTokens = 66_000,
                    PlatformCostUsd = 99.0000m,
                    BillableAmountUsd = 128.7000m,
                    Seats = 42,
                    UpdatedAt = DateTime.UtcNow,
                });
            await cp.SaveChangesAsync();
        }

        // Tenant A sees ONLY Tenant A's rollup.
        using var clientA = _saasFactory.CreateClient();
        clientA.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", MintTenantJwt(tenantA, "member"));
        var respA = await clientA.GetAsync("/api/v1/billing/usage");
        respA.StatusCode.Should().Be(HttpStatusCode.OK);
        var jsonA = await respA.Content.ReadFromJsonAsync<JsonElement>();
        jsonA.GetProperty("platformInputTokens").GetInt64().Should().Be(111_000);
        jsonA.GetProperty("platformOutputTokens").GetInt64().Should().Be(22_000);
        jsonA.GetProperty("byokInputTokens").GetInt64().Should().Be(5_000);
        jsonA.GetProperty("byokOutputTokens").GetInt64().Should().Be(1_000);
        jsonA.GetProperty("platformCostUsd").GetDecimal().Should().Be(1.1000m);
        jsonA.GetProperty("billableUsd").GetDecimal().Should().Be(1.4300m);
        jsonA.GetProperty("seats").GetInt32().Should().Be(4);

        // Tenant B sees ONLY Tenant B's rollup (never Tenant A's).
        using var clientB = _saasFactory.CreateClient();
        clientB.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", MintTenantJwt(tenantB, "member"));
        var respB = await clientB.GetAsync("/api/v1/billing/usage");
        respB.StatusCode.Should().Be(HttpStatusCode.OK);
        var jsonB = await respB.Content.ReadFromJsonAsync<JsonElement>();
        jsonB.GetProperty("platformInputTokens").GetInt64().Should().Be(999_000);
        jsonB.GetProperty("billableUsd").GetDecimal().Should().Be(128.7000m);
        jsonB.GetProperty("seats").GetInt32().Should().Be(42);
    }

    [Test]
    public async Task GetUsage_Requires_Authentication_In_SaaS()
    {
        using var client = _saasFactory.CreateClient();
        var resp = await client.GetAsync("/api/v1/billing/usage");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Test]
    public void AddBillingUsageMetering_ModeGating_Registers_In_SaaS_And_NoOp_In_SingleUser()
    {
        using var saasSp = BuildMeteringProvider("saas");
        using (var scope = saasSp.CreateScope())
        {
            var s = scope.ServiceProvider;
            s.GetService<IUsageMeteringService>().Should().NotBeNull();
            var handlers = s.GetServices<IPlatformTaskHandler>().ToList();
            handlers.Should().Contain(h => h is MeterEventFlushTaskHandler);
            handlers.Should().Contain(h => h is UsageReconciliationTaskHandler);
        }

        using var singleSp = BuildMeteringProvider("single-user");
        using (var scope = singleSp.CreateScope())
        {
            var s = scope.ServiceProvider;
            s.GetService<IUsageMeteringService>().Should().BeNull("single-user has zero Stripe/metering surface");
            var handlers = s.GetServices<IPlatformTaskHandler>().ToList();
            handlers.Should().NotContain(h => h is MeterEventFlushTaskHandler);
            handlers.Should().NotContain(h => h is UsageReconciliationTaskHandler);
        }
    }

    [Test]
    public void ControlPlane_Model_Maps_UsageRollup_And_MeterEventBuffer_With_Constraints()
    {
        using var ctx = new ControlPlaneDbContext(
            new DbContextOptionsBuilder<ControlPlaneDbContext>()
                .UseNpgsql("Host=localhost;Database=cp_test;Username=tamma;Password=tamma")
                .Options);

        var tables = ctx.Model.GetEntityTypes().Select(t => t.GetTableName()).ToHashSet();
        tables.Should().Contain("billing_usage_rollup");
        tables.Should().Contain("billing_meter_event_buffer");

        var rollupEntity = ctx.Model.FindEntityType(typeof(BillingUsageRollup))!;
        var rollupIdx = rollupEntity.GetIndexes()
            .Single(i => i.GetDatabaseName() == "UX_billing_usage_rollup_TenantId_PeriodStart");
        rollupIdx.IsUnique.Should().BeTrue();

        var bufferEntity = ctx.Model.FindEntityType(typeof(BillingMeterEventBuffer))!;
        bufferEntity.GetIndexes()
            .Single(i => i.GetDatabaseName() == "UX_billing_meter_event_buffer_IdempotencyKey")
            .IsUnique.Should().BeTrue();
        var pendingIdx = bufferEntity.GetIndexes()
            .Single(i => i.GetDatabaseName() == "IX_billing_meter_event_buffer_Pending");
        pendingIdx.GetFilter().Should().Contain("ReportedToStripe");

        var designModel = ctx.GetService<IDesignTimeModel>().Model;
        var bufferDesign = designModel.FindEntityType(typeof(BillingMeterEventBuffer))!;
        bufferDesign.GetCheckConstraints().Select(c => c.Name)
            .Should().Contain("ck_billing_meter_event_buffer_billing_mode");
    }

    private static ServiceProvider BuildMeteringProvider(string mode)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Tamma:Mode"] = mode })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(cfg);
        services.AddSingleton<ITammaModeProvider, TammaModeProvider>();
        services.AddDbContextFactory<ControlPlaneDbContext>(
            o => o.UseInMemoryDatabase($"usage-di-{Guid.NewGuid():N}"));
        services.AddScoped(sp =>
            sp.GetRequiredService<IDbContextFactory<ControlPlaneDbContext>>().CreateDbContext());
        services.AddScoped(_ => Moq.Mock.Of<IEventRepository>());
        services.AddScoped(_ => Moq.Mock.Of<IUsagePricingEngine>());
        services.AddScoped(_ => Moq.Mock.Of<IMarginPolicyResolver>());
        services.AddScoped(_ => Moq.Mock.Of<IBillingProvider>());
        services.AddScoped(_ => Moq.Mock.Of<IAlertSink>());
        services.AddScoped(_ => Moq.Mock.Of<IPlatformQueuedTaskRepository>());
        services.AddPlatformTaskWorker(cfg);
        services.AddBillingUsageMetering(cfg);
        return services.BuildServiceProvider();
    }
}

/// <summary>
/// Story 35-3 (AC12) — single-user mode leaves <c>GET /api/v1/billing/usage</c>
/// unmapped (returns 404). Mirrors <see cref="BillingWebhookSingleUserModeTests"/>.
/// </summary>
[TestFixture]
public class BillingUsageSingleUserModeTests
{
    [Test]
    public async Task Usage_Endpoint_Is_Unmapped_In_SingleUser()
    {
        using var client = ApiTestFixture.CreateClient();
        var resp = await client.GetAsync("/api/v1/billing/usage");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "single-user mode maps no Stripe/billing usage surface");
    }
}
