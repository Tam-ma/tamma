using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;
using Moq;
using NUnit.Framework;
using Tamma.Api.Endpoints;
using Tamma.Api.Endpoints.Analytics;
using Tamma.Api.Services.Analytics;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Analytics;

/// <summary>
/// Story 36-7 (AC6, AC7, AC9, AC10, AC11, AC13) — endpoint validation and full
/// HTTP RBAC matrix tests for:
/// <list type="bullet">
///   <item><c>GET /api/v1/orgs/{tenantId}/analytics/margin</c> (<c>MemberAccess</c>,
///     strict <see cref="ITenantContext"/> scoping, cross-tenant → 404)</item>
///   <item><c>GET /api/admin/analytics/margin</c> (<c>PlatformOwnerAccess</c>,
///     member / tenant-owner → 403, platform admin → 200)</item>
///   <item>Single-user mode: sole user reaches both endpoints (200).</item>
/// </list>
/// </summary>
[TestFixture]
public class MarginAnalyticsEndpointsTests
{
    private const string JwtSecret = "margin-analytics-rbac-secret-32-chars!!";
    private static readonly SymmetricSecurityKey SigningKey =
        new(Encoding.UTF8.GetBytes(JwtSecret));
    private static readonly DateTimeOffset June15 = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private WebApplicationFactory<Program> _saasFactory = null!;
    private WebApplicationFactory<Program> _singleUserFactory = null!;

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

        _singleUserFactory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b =>
            {
                b.UseEnvironment("Production");
                b.UseSetting("Tamma:Mode", "single-user");
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
        _singleUserFactory?.Dispose();
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

    // ───────────────────── HTTP RBAC matrix (AC6, AC7, AC9, AC10, AC11) ─────────────────────

    [Test]
    public async Task SaaS_RbacMatrix_MemberTenantOk_CrossTenant404_AdminOwnerOnly()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            cp.Tenants.AddRange(
                new Tenant { Id = tenantA, Name = "Tenant A", Slug = $"ta-{tenantA:N}"[..16], Plan = "team" },
                new Tenant { Id = tenantB, Name = "Tenant B", Slug = $"tb-{tenantB:N}"[..16], Plan = "free" });
            await cp.SaveChangesAsync();
        }

        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantA);
        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantB);

        var client = _saasFactory.CreateClient();

        // 1. Member of Tenant A -> own tenant margin -> 200 OK (zeroed empty report, AC11)
        using var memberOwnReq = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/orgs/{tenantA:D}/analytics/margin?from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z&grain=day");
        memberOwnReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "member", "user"));
        var memberOwnResp = await client.SendAsync(memberOwnReq);
        memberOwnResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var ownReport = await memberOwnResp.Content.ReadFromJsonAsync<TenantMarginReport>();
        ownReport.Should().NotBeNull();
        ownReport!.TenantId.Should().Be(tenantA);
        ownReport.Summary.CostUsd.Should().Be(0m);
        ownReport.Summary.RevenueUsd.Should().Be(0m);
        ownReport.Summary.MarginUsd.Should().Be(0m);

        // 2. Member of Tenant A -> Tenant B margin -> 404 Not Found (AC6)
        using var crossTenantReq = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/orgs/{tenantB:D}/analytics/margin");
        crossTenantReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "member", "user"));
        (await client.SendAsync(crossTenantReq)).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 3. Member of Tenant A -> /api/admin/analytics/margin -> 403 Forbidden (AC7/AC9)
        using var memberAdminReq = new HttpRequestMessage(HttpMethod.Get, "/api/admin/analytics/margin");
        memberAdminReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "member", "user"));
        (await client.SendAsync(memberAdminReq)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 4. Tenant owner (not platform admin) -> /api/admin/analytics/margin -> 403 Forbidden (AC7/AC9)
        using var tenantOwnerAdminReq = new HttpRequestMessage(HttpMethod.Get, "/api/admin/analytics/margin");
        tenantOwnerAdminReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "owner", "user"));
        (await client.SendAsync(tenantOwnerAdminReq)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 5. Platform admin -> BOTH /api/admin/analytics/margin AND own tenant margin -> 200 OK
        using var adminReq = new HttpRequestMessage(
            HttpMethod.Get,
            "/api/admin/analytics/margin?from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z&grain=day&limit=10");
        adminReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "owner", "platform_admin"));
        var adminResp = await client.SendAsync(adminReq);
        adminResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var platformReport = await adminResp.Content.ReadFromJsonAsync<PlatformMarginReport>();
        platformReport.Should().NotBeNull();
        platformReport!.Summary.CostUsd.Should().Be(0m);

        using var adminOwnReq = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/orgs/{tenantA:D}/analytics/margin");
        adminOwnReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "owner", "platform_admin"));
        (await client.SendAsync(adminOwnReq)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Test]
    public async Task SingleUserMode_SoleUserCanReadBothTenantAndPlatformMargin()
    {
        var soleTenantId = Guid.NewGuid();
        await using (var scope = _singleUserFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            cp.Tenants.Add(new Tenant
            {
                Id = soleTenantId,
                Name = "Sole Workspace",
                Slug = $"sole-{soleTenantId:N}"[..16],
                Plan = "free",
            });
            await cp.SaveChangesAsync();
        }

        await TestTenantProvisioning.ProvisionAsync(_singleUserFactory.Services, soleTenantId);

        var client = _singleUserFactory.CreateClient();
        var token = MintJwt(soleTenantId, role: "owner", platformRole: "platform_admin");

        // In single-user mode, the sole user is both the tenant user and platform owner (AC10).
        using var adminReq = new HttpRequestMessage(HttpMethod.Get, "/api/admin/analytics/margin?grain=day");
        adminReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var adminResp = await client.SendAsync(adminReq);
        adminResp.StatusCode.Should().Be(HttpStatusCode.OK);

        using var tenantReq = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/orgs/{soleTenantId:D}/analytics/margin?grain=day");
        tenantReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var tenantResp = await client.SendAsync(tenantReq);
        tenantResp.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ───────────────────── Direct handler validation tests (400s) ─────────────────────

    [Test]
    public async Task Handlers_ValidateGrainAndWindow_Return400OnBadInput()
    {
        var tenantId = Guid.NewGuid();
        var tc = new Mock<ITenantContext>();
        tc.SetupGet(c => c.TenantId).Returns(tenantId);
        var marginSvc = new Mock<IMarginAnalyticsService>(MockBehavior.Strict);
        var platformSvc = new Mock<IPlatformAnalyticsService>(MockBehavior.Strict);
        var clock = new FixedClock(June15);

        // Unknown grain -> 400
        var badGrainTenant = await MarginAnalyticsEndpoints.GetTenantMargin(
            tenantId, null, null, "week", tc.Object, marginSvc.Object, clock, NullLoggerFactory.Instance, default);
        (await ExecuteStatus(badGrainTenant)).Should().Be(StatusCodes.Status400BadRequest);

        var badGrainAdmin = await AdminAnalyticsEndpoints.GetMargin(
            null, null, "quarter", 10, platformSvc.Object, clock, default);
        (await ExecuteStatus(badGrainAdmin)).Should().Be(StatusCodes.Status400BadRequest);

        // from >= to -> 400
        var from = new DateTime(2026, 6, 10, 0, 0, 0, DateTimeKind.Utc);
        var to = new DateTime(2026, 6, 5, 0, 0, 0, DateTimeKind.Utc);
        var badWindow = await MarginAnalyticsEndpoints.GetTenantMargin(
            tenantId, from, to, "day", tc.Object, marginSvc.Object, clock, NullLoggerFactory.Instance, default);
        (await ExecuteStatus(badWindow)).Should().Be(StatusCodes.Status400BadRequest);

        // Span > 365 days -> 400
        var tooLong = await AdminAnalyticsEndpoints.GetMargin(
            new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            "month",
            10,
            platformSvc.Object,
            clock,
            default);
        (await ExecuteStatus(tooLong)).Should().Be(StatusCodes.Status400BadRequest);
    }

    private static async Task<int> ExecuteStatus(IResult result)
    {
        var sp = new ServiceCollection().AddLogging().BuildServiceProvider();
        var ctx = new DefaultHttpContext { RequestServices = sp };
        ctx.Response.Body = new MemoryStream();
        await result.ExecuteAsync(ctx);
        return ctx.Response.StatusCode;
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
