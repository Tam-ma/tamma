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
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using NUnit.Framework;
using Tamma.Api.Services.Pricing;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Pricing;

/// <summary>
/// Story 34-10 (AC2, AC8, AC9, AC10, AC11, AC12, AC13) — end-to-end
/// Testcontainers PostgreSQL smoke &amp; integration tests for:
/// <list type="bullet">
///   <item>Seeded <c>free</c> / <c>team</c> / <c>enterprise</c> tenants backfilled
///     via <c>POST /api/admin/pricing/backfill</c> (<c>PlatformOwnerAccess</c>).</item>
///   <item>All four <see cref="IPricingContract"/> operations succeeding with zero
///     errors for every tenant post-migration.</item>
///   <item>Second backfill invocation returning <c>WasNoOp = true</c>.</item>
///   <item>Tenant isolation &amp; legacy <c>PATCH /api/admin/tenants/{id}/plan</c>
///     flowing through <see cref="IPlanAssignmentService"/> → <see cref="IPricingContract"/>.</item>
/// </list>
/// </summary>
[TestFixture]
public class PricingContractAndBackfillIntegrationTests
{
    private const string JwtSecret = "pricing-contract-smoke-secret-32-chars!!";
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

    private static string MintJwt(Guid tenantId, string role = "member", string platformRole = "user")
    {
        var jwt = new JwtSecurityToken(
            issuer: "tamma",
            audience: "tamma-api",
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString("D")),
                new Claim("tenantId", tenantId.ToString("D")),
                new Claim("role", role),
                new Claim("platformRole", platformRole),
                new Claim(JwtRegisteredClaimNames.Email, $"{role}@example.com"),
                new Claim("name", role),
                new Claim("authMethod", "email"),
                new Claim("tenants", JsonSerializer.Serialize(new[] { new { id = tenantId.ToString("D"), role } })),
            },
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: new SigningCredentials(SigningKey, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    [Test]
    public async Task Smoke_Backfill_And_All_Four_PricingContract_Operations_Across_All_Tiers()
    {
        var freeTenant = Guid.NewGuid();
        var teamTenant = Guid.NewGuid();
        var entTenant = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();

            // Ensure a global margin policy exists so PriceUsageAsync/PriceNetAsync resolve cleanly
            if (!await cp.MarginPolicies.AnyAsync(m => m.Scope == "global" && m.Status == "active"))
            {
                cp.MarginPolicies.Add(new MarginPolicy
                {
                    Id = Guid.NewGuid(),
                    Scope = "global",
                    MarkupMultiplier = 1.25m,
                    Status = "active",
                    EffectiveFrom = now.AddDays(-1),
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }

            // Seed three tenants with NO active TenantPlanAssignment yet (simulating legacy state)
            cp.Tenants.AddRange(
                new Tenant { Id = freeTenant, Name = "FreeCo", Slug = $"free-{freeTenant:N}"[..16], Plan = "free" },
                new Tenant { Id = teamTenant, Name = "TeamCo", Slug = $"team-{teamTenant:N}"[..16], Plan = "team" },
                new Tenant { Id = entTenant, Name = "EntCo", Slug = $"ent-{entTenant:N}"[..16], Plan = "enterprise" });
            await cp.SaveChangesAsync();
        }

        var client = _saasFactory.CreateClient();

        // 1. Non-admin member cannot trigger POST /api/admin/pricing/backfill -> 403
        using var forbiddenReq = new HttpRequestMessage(HttpMethod.Post, "/api/admin/pricing/backfill");
        forbiddenReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(freeTenant, "owner", "user"));
        (await client.SendAsync(forbiddenReq)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 2. Platform admin triggers backfill -> 200 and assigns all 3 tenants
        using var run1Req = new HttpRequestMessage(HttpMethod.Post, "/api/admin/pricing/backfill");
        run1Req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(freeTenant, "owner", "platform_admin"));
        var run1Resp = await client.SendAsync(run1Req);
        run1Resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var report1 = await run1Resp.Content.ReadFromJsonAsync<BackfillReport>();
        report1.Should().NotBeNull();
        report1!.WasNoOp.Should().BeFalse();
        report1.TenantsAssigned.Should().BeGreaterThanOrEqualTo(3);

        // 3. Second backfill invocation is an idempotent no-op (AC9)
        using var run2Req = new HttpRequestMessage(HttpMethod.Post, "/api/admin/pricing/backfill");
        run2Req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(freeTenant, "owner", "platform_admin"));
        var run2Resp = await client.SendAsync(run2Req);
        run2Resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var report2 = await run2Resp.Content.ReadFromJsonAsync<BackfillReport>();
        report2!.WasNoOp.Should().BeTrue();
        report2.TenantsAssigned.Should().Be(0);
        report2.EntitlementsCreated.Should().Be(0);

        // 4. AC8 Smoke Test: invoke ALL 4 IPricingContract methods for free, team, and enterprise!
        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var contract = scope.ServiceProvider.GetRequiredService<IPricingContract>();
            var usage = new UsageLine("anthropic", "claude-sonnet-4-20250514", 10_000, 2_000, PricingMode.PlatformProvided, now);
            var byokUsage = new UsageLine("anthropic", "claude-sonnet-4-20250514", 10_000, 2_000, PricingMode.Byok, now);

            foreach (var (tid, expectedSlug) in new[] { (freeTenant, "free"), (teamTenant, "team"), (entTenant, "enterprise") })
            {
                var plan = await contract.ResolvePlanAsync(tid);
                plan.TenantId.Should().Be(tid);
                plan.Slug.Should().Be(expectedSlug);
                plan.PlanVersion.Should().BeGreaterThanOrEqualTo(1);

                var ents = await contract.ResolveEntitlementsAsync(tid);
                ents.TenantId.Should().Be(tid);
                ents.Limits.Should().HaveCount(7);

                var priced = await contract.PriceUsageAsync(tid, usage);
                priced.CostBasisUsd.Should().BeGreaterThan(0m);
                priced.SellPriceUsd.Should().BeGreaterThan(priced.CostBasisUsd);
                priced.PricingMode.Should().Be("platform_provided");

                var byokPriced = await contract.PriceUsageAsync(tid, byokUsage);
                byokPriced.SellPriceUsd.Should().Be(0m);
                byokPriced.PricingMode.Should().Be("byok");

                var net = await contract.PriceNetAsync(tid, usage);
                net.NetPriceUsd.Should().Be(net.SellPriceUsd - net.PromoDiscountUsd - net.CreditsAppliedUsd);
            }

            // Tenant isolation: free tenant's seat limit differs from enterprise tenant's seat limit
            var freeEnts = await contract.ResolveEntitlementsAsync(freeTenant);
            var entEnts = await contract.ResolveEntitlementsAsync(entTenant);
            freeEnts.Limits.Single(l => l.MetricKey == "seats").LimitValue
                .Should().NotBe(entEnts.Limits.Single(l => l.MetricKey == "seats").LimitValue);

            // AC11: legacy PATCH /api/admin/tenants/{id}/plan flows through IPlanAssignmentService
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            var teamPlanId = (await cp.Plans.FirstAsync(p => p.Slug == "team" && p.Status == "active")).Id;

            using var patchReq = new HttpRequestMessage(HttpMethod.Patch, $"/api/admin/tenants/{freeTenant:D}/plan")
            {
                Content = JsonContent.Create(new { planId = teamPlanId }),
            };
            patchReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(freeTenant, "owner", "platform_admin"));
            var patchResp = await client.SendAsync(patchReq);
            patchResp.StatusCode.Should().Be(HttpStatusCode.OK);

            var upgradedPlan = await contract.ResolvePlanAsync(freeTenant);
            upgradedPlan.Slug.Should().Be("team");
            upgradedPlan.PlanId.Should().Be(teamPlanId);
        }
    }
}
