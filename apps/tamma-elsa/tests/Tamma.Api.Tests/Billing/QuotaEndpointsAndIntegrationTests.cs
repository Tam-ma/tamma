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
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using NUnit.Framework;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Core.Billing;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-6 (AC1–AC14) — end-to-end Testcontainers PostgreSQL integration
/// tests for SaaS quota enforcement, observability endpoints, RBAC, tenant
/// isolation, upgrade invalidation, and the <c>quota_notifications</c> schema.
/// </summary>
[TestFixture]
public class QuotaEndpointsAndIntegrationTests
{
    private const string JwtSecret = "quota-enforcement-test-secret-32-chars!!";
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
        scope.ServiceProvider.GetRequiredService<QuotaCache>().Clear();
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

    private static string MintJwt(
        Guid userId,
        Guid tenantId,
        string role = "member",
        string platformRole = "user",
        string? tenantsJson = null)
    {
        var tenantsClaim = tenantsJson
            ?? JsonSerializer.Serialize(new[] { new { id = tenantId.ToString("D"), role } });

        var jwt = new JwtSecurityToken(
            issuer: "tamma",
            audience: "tamma-api",
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString("D")),
                new Claim("tenantId", tenantId.ToString("D")),
                new Claim("role", role),
                new Claim("platformRole", platformRole),
                new Claim(JwtRegisteredClaimNames.Email, $"{role}@example.com"),
                new Claim("name", role),
                new Claim("authMethod", "email"),
                new Claim("tenants", tenantsClaim),
            },
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: new SigningCredentials(SigningKey, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    private async Task<(Guid TenantId, Guid UserId)> SeedTenantAsync(
        string planSlug,
        long platformTokensUsed,
        string billingMode = "PlatformProvided",
        int memberCount = 1)
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        var period = BillingPeriod.ForUtcMonth(now);

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();

            if (!await cp.Plans.AnyAsync(p => p.Slug == "free"))
            {
                cp.Plans.Add(new Plan
                {
                    Id = Guid.NewGuid(),
                    Slug = "free",
                    DisplayName = "Free",
                    Version = 1,
                    Status = "active",
                    Quotas = """{"llmTokensPerMonth":100000,"overageBehavior":"hard_block","seats":2,"concurrentWorkflows":1,"connectedRepos":1}""",
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }
            if (!await cp.Plans.AnyAsync(p => p.Slug == "team"))
            {
                cp.Plans.Add(new Plan
                {
                    Id = Guid.NewGuid(),
                    Slug = "team",
                    DisplayName = "Team",
                    Version = 1,
                    Status = "active",
                    Quotas = """{"llmTokensPerMonth":2000000,"overageBehavior":"allow_with_overage","seats":10,"concurrentWorkflows":10,"connectedRepos":25}""",
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }

            cp.Tenants.Add(new Tenant
            {
                Id = tenantId,
                Name = $"Tenant {planSlug}",
                Slug = $"t-{tenantId:N}"[..16],
                Plan = planSlug,
            });
            cp.Users.Add(new User
            {
                Id = userId,
                Email = $"u-{userId:N}@example.com",
                DisplayName = "Owner",
                CreatedAt = now,
                UpdatedAt = now,
            });
            cp.TenantMemberships.Add(new TenantMembership
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                UserId = userId,
                Role = "owner",
                JoinedAt = now,
            });
            for (var i = 1; i < memberCount; i++)
            {
                var extraUser = Guid.NewGuid();
                cp.Users.Add(new User
                {
                    Id = extraUser,
                    Email = $"m-{extraUser:N}@example.com",
                    DisplayName = $"Member {i}",
                    CreatedAt = now,
                    UpdatedAt = now,
                });
                cp.TenantMemberships.Add(new TenantMembership
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenantId,
                    UserId = extraUser,
                    Role = "member",
                    JoinedAt = now,
                });
            }

            cp.BillingCustomers.Add(new BillingCustomer
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                StripeCustomerId = $"cus_{tenantId:N}"[..18],
                BillingMode = billingMode,
                CreatedAt = now,
                UpdatedAt = now,
            });
            cp.BillingSubscriptions.Add(new BillingSubscription
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                StripeSubscriptionId = $"sub_{tenantId:N}"[..18],
                PlanSlug = planSlug,
                Status = "active",
                CurrentPeriodStart = period.StartUtc,
                CurrentPeriodEnd = period.EndUtc,
                Seats = planSlug == "free" ? 2 : 10,
                CreatedAt = now,
                UpdatedAt = now,
            });
            cp.BillingUsageRollups.Add(new BillingUsageRollup
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                PeriodStart = period.StartUtc,
                PeriodEnd = period.EndUtc,
                PlatformInputTokens = platformTokensUsed,
                PlatformOutputTokens = 0,
                UpdatedAt = now,
            });
            await cp.SaveChangesAsync();
        }

        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantId);
        return (tenantId, userId);
    }

    [Test]
    public async Task Admin_And_Org_Quota_Endpoints_Enforce_Rbac_And_TenantIsolation()
    {
        var (tenantA, userA) = await SeedTenantAsync("free", platformTokensUsed: 75_000, memberCount: 2);
        var (tenantB, userB) = await SeedTenantAsync("team", platformTokensUsed: 5_000, memberCount: 1);

        var client = _saasFactory.CreateClient();

        // 1. Platform admin can read GET /api/v1/admin/quota/{tenantA}
        using var adminReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/admin/quota/{tenantA:D}");
        adminReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(userA, tenantA, "owner", "platform_admin"));
        var adminResp = await client.SendAsync(adminReq);
        adminResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var adminSnap = await adminResp.Content.ReadFromJsonAsync<QuotaSnapshotDto>();
        adminSnap.Should().NotBeNull();
        adminSnap!.Plan.Should().Be("free");
        adminSnap.TokenAllowance.Should().Be(100_000L);
        adminSnap.TokensUsed.Should().Be(75_000L);
        adminSnap.SeatsLimit.Should().Be(1, "PlansSeeder seeds free tier with 1 seat");
        adminSnap.SeatsUsed.Should().Be(2);

        // 2. Regular member on admin route -> 403 Forbidden
        using var nonAdminReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/admin/quota/{tenantA:D}");
        nonAdminReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(userA, tenantA, "member", "user"));
        (await client.SendAsync(nonAdminReq)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 3. Member reads own org quota -> 200 with Tenant B's own numbers (never A's)
        using var ownOrgReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/orgs/{tenantB:D}/quota");
        ownOrgReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(userB, tenantB, "member"));
        var ownOrgResp = await client.SendAsync(ownOrgReq);
        ownOrgResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var snapB = await ownOrgResp.Content.ReadFromJsonAsync<QuotaSnapshotDto>();
        snapB!.Plan.Should().Be("team");
        snapB.TokensUsed.Should().Be(5_000L);

        // 4. Cross-tenant member attempting to read Tenant A's org quota -> rejected (403/404)
        using var crossReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/orgs/{tenantA:D}/quota");
        crossReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(userB, tenantB, "member"));
        var crossResp = await client.SendAsync(crossReq);
        crossResp.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
    }

    [Test]
    public async Task Engine_TokenQuota_Endpoint_Blocks_Exhausted_Free_Allows_Byok_And_Lifts_On_Upgrade()
    {
        var (freeTenant, freeUser) = await SeedTenantAsync("free", platformTokensUsed: 100_000);
        var (byokTenant, byokUser) = await SeedTenantAsync("free", platformTokensUsed: 500_000, billingMode: "Byok");

        var client = _saasFactory.CreateClient();

        // Exhausted free platform tenant -> allowed: false, http_status: 402
        using var req1 = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/billing/quota/{freeTenant:D}/token");
        req1.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(freeUser, freeTenant, "owner"));
        var resp1 = await client.SendAsync(req1);
        resp1.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc1 = JsonDocument.Parse(await resp1.Content.ReadAsStringAsync());
        doc1.RootElement.GetProperty("allowed").GetBoolean().Should().BeFalse();
        doc1.RootElement.GetProperty("http_status").GetInt32().Should().Be(402);

        // BYOK tenant over allowance -> allowed: true
        using var reqByok = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/billing/quota/{byokTenant:D}/token");
        reqByok.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(byokUser, byokTenant, "owner"));
        var respByok = await client.SendAsync(reqByok);
        respByok.StatusCode.Should().Be(HttpStatusCode.OK);
        using var docByok = JsonDocument.Parse(await respByok.Content.ReadAsStringAsync());
        docByok.RootElement.GetProperty("allowed").GetBoolean().Should().BeTrue();

        // Upgrade freeTenant -> team + Invalidate -> next call immediately returns allowed: true
        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            var sub = await cp.BillingSubscriptions.FirstAsync(s => s.TenantId == freeTenant);
            sub.PlanSlug = "team";
            sub.UpdatedAt = DateTime.UtcNow.AddSeconds(1);
            await cp.SaveChangesAsync();
            scope.ServiceProvider.GetRequiredService<IQuotaService>().Invalidate(freeTenant);
        }

        using var reqAfter = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/billing/quota/{freeTenant:D}/token");
        reqAfter.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(freeUser, freeTenant, "owner"));
        var respAfter = await client.SendAsync(reqAfter);
        using var docAfter = JsonDocument.Parse(await respAfter.Content.ReadAsStringAsync());
        docAfter.RootElement.GetProperty("allowed").GetBoolean().Should().BeTrue();
    }

    [Test]
    public async Task LlmChat_Returns_402_QuotaExceeded_For_Exhausted_Free_Tenant_With_TenantIsolation()
    {
        var (tenantA, userA) = await SeedTenantAsync("free", platformTokensUsed: 100_000);
        var (tenantB, userB) = await SeedTenantAsync("free", platformTokensUsed: 0);

        var client = _saasFactory.CreateClient();

        // Exhausted Tenant A -> HTTP 402 { error: "quota_exceeded", which_quota: "platform_tokens" }
        using var reqA = new HttpRequestMessage(HttpMethod.Post, "/api/v1/llm/chat")
        {
            Content = JsonContent.Create(new { messages = new[] { new { role = "user", content = "hello" } } }),
        };
        reqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(userA, tenantA, "owner"));
        reqA.Headers.Add("X-Api-Key", "sk-test-platform-key");

        var respA = await client.SendAsync(reqA);
        respA.StatusCode.Should().Be(HttpStatusCode.PaymentRequired);
        var bodyA = await respA.Content.ReadFromJsonAsync<QuotaResponse>();
        bodyA.Should().NotBeNull();
        bodyA!.Error.Should().Be("quota_exceeded");
        bodyA.WhichQuota.Should().Be("platform_tokens");
        bodyA.Limit.Should().Be(100_000L);
        bodyA.Used.Should().Be(100_000L);
        bodyA.ResetAt.Should().NotBeNullOrWhiteSpace();

        // Tenant B at 0% is NOT blocked by Tenant A's quota (fails later at upstream mock / non-402)
        using var reqB = new HttpRequestMessage(HttpMethod.Post, "/api/v1/llm/chat")
        {
            Content = JsonContent.Create(new { messages = new[] { new { role = "user", content = "hello" } } }),
        };
        reqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(userB, tenantB, "owner"));
        reqB.Headers.Add("X-Api-Key", "sk-test-platform-key");

        var respB = await client.SendAsync(reqB);
        respB.StatusCode.Should().NotBe(HttpStatusCode.PaymentRequired);
    }

    [Test]
    public async Task Invite_ExecuteTask_And_RepoActivate_Return_429_When_Caps_Exhausted()
    {
        var (tenantId, userId) = await SeedTenantAsync("free", platformTokensUsed: 0, memberCount: 2);
        var client = _saasFactory.CreateClient();
        var jwt = MintJwt(userId, tenantId, "owner");

        // 1. Seat cap (free = 2, seeded 2 members) -> POST /api/v1/orgs/{id}/invites returns 429
        using var inviteReq = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/orgs/{tenantId:D}/invites")
        {
            Content = JsonContent.Create(new { email = "third@example.com", role = "member" }),
        };
        inviteReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        var inviteResp = await client.SendAsync(inviteReq);
        inviteResp.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        var inviteQuota = await inviteResp.Content.ReadFromJsonAsync<QuotaResponse>();
        inviteQuota!.Error.Should().Be("quota_exceeded");
        inviteQuota.WhichQuota.Should().Be("seats");

        // 2. Concurrent workflow cap (free = 1) -> seed 1 running WorkflowInstance in tenant DB
        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var factory = scope.ServiceProvider.GetRequiredService<ITenantDbContextFactory>();
            await using var tenantDb = await factory.CreateAsync(tenantId);
            var def = new WorkflowDefinition
            {
                Id = Guid.NewGuid(),
                Name = "wf-def",
                Version = 1,
                Steps = "[]",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            tenantDb.WorkflowDefinitions.Add(def);
            tenantDb.WorkflowInstances.Add(new WorkflowInstance
            {
                Id = Guid.NewGuid(),
                DefinitionId = def.Id,
                TenantId = tenantId,
                Status = "running",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            await tenantDb.SaveChangesAsync();
        }

        using var execReq = new HttpRequestMessage(HttpMethod.Post, "/api/engine/execute-task")
        {
            Content = JsonContent.Create(new { prompt = "Analyze issue #1", repository = "acme/app" }),
        };
        execReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        var execResp = await client.SendAsync(execReq);
        execResp.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        var execQuota = await execResp.Content.ReadFromJsonAsync<QuotaResponse>();
        execQuota!.Error.Should().Be("quota_exceeded");
        execQuota.WhichQuota.Should().Be("concurrent_workflows");

        // 3. Connected repo cap (free = 1) -> 1 active repo, activating 2nd returns 429
        long installId = 9001;
        long inactiveRepoId = 9002;
        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            var inst = new GitHubInstallation
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                InstallationId = installId,
                AccountLogin = "acme",
                AccountType = "Organization",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            cp.GitHubInstallations.Add(inst);
            cp.GitHubInstallationRepos.AddRange(
                new GitHubInstallationRepo { Id = Guid.NewGuid(), InstallationEntityId = inst.Id, RepoId = 9001, RepoFullName = "acme/one", Owner = "acme", Name = "one", IsActive = true },
                new GitHubInstallationRepo { Id = Guid.NewGuid(), InstallationEntityId = inst.Id, RepoId = inactiveRepoId, RepoFullName = "acme/two", Owner = "acme", Name = "two", IsActive = false });
            await cp.SaveChangesAsync();
        }

        using var repoReq = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/onboarding/repos/{installId}/{inactiveRepoId}")
        {
            Content = JsonContent.Create(new { active = true }),
        };
        repoReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        var repoResp = await client.SendAsync(repoReq);
        repoResp.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        var repoQuota = await repoResp.Content.ReadFromJsonAsync<QuotaResponse>();
        repoQuota!.Error.Should().Be("quota_exceeded");
        repoQuota.WhichQuota.Should().Be("connected_repos");
    }

    [Test]
    public async Task QuotaNotifications_Entity_Model_Has_Dedup_UniqueIndex_And_Level_Check()
    {
        await using var scope = _saasFactory.Services.CreateAsyncScope();
        var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
        var model = cp.GetService<IDesignTimeModel>().Model;

        var entity = model.FindEntityType(typeof(QuotaNotification));
        entity.Should().NotBeNull();
        entity!.GetTableName().Should().Be("quota_notifications");

        entity.GetIndexes().Should().Contain(idx =>
            idx.GetDatabaseName() == "IX_quota_notifications_dedup" && idx.IsUnique);

        entity.GetCheckConstraints().Should().Contain(ck =>
            ck.Name == "ck_quota_notifications_level");
    }
}

/// <summary>
/// Story 35-6 (AC10) — verifies single-user mode registers
/// <see cref="NullQuotaService"/> and leaves SaaS quota routes unmapped (404).
/// </summary>
[TestFixture]
public class QuotaSingleUserModeTests
{
    [Test]
    public async Task SingleUser_Registers_NullQuotaService_And_Leaves_SaaS_Quota_Routes_Unmapped()
    {
        await using var scope = ApiTestFixture.Factory.Services.CreateAsyncScope();
        var mode = scope.ServiceProvider.GetRequiredService<ITammaModeProvider>().Mode;
        mode.Should().Be(TammaMode.SingleUser);
        scope.ServiceProvider.GetRequiredService<IQuotaService>().Should().BeOfType<NullQuotaService>();

        var client = ApiTestFixture.CreateClient();
        var id = Guid.NewGuid();

        (await client.GetAsync($"/api/v1/admin/quota/{id:D}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.GetAsync($"/api/v1/orgs/{id:D}/quota")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        var engineResp = await client.GetAsync($"/api/v1/billing/quota/{id:D}/token");
        engineResp.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await engineResp.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("allowed").GetBoolean().Should().BeTrue();
    }
}
