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
using Tamma.Api.Services.PlatformTasks;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Data;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-8 (AC1, AC4, AC8, AC13, AC14) — end-to-end Testcontainers
/// PostgreSQL integration tests for <c>GET /api/v1/billing/invoices</c>,
/// <c>GET /api/v1/billing/invoices/{id}</c>, RBAC, tenant isolation,
/// <c>billing_suspended</c> 402 enforcement on <c>/api/v1/llm/chat</c>,
/// single-user mode short-circuit, and EF model constraints.
/// </summary>
[TestFixture]
public class InvoiceEndpointsIntegrationTests
{
    private const string JwtSecret = "invoice-dunning-test-secret-32-chars!!";
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

    private static string MintJwt(Guid tenantId, string role = "member")
    {
        var jwt = new JwtSecurityToken(
            issuer: "tamma",
            audience: "tamma-api",
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString("D")),
                new Claim("tenantId", tenantId.ToString("D")),
                new Claim("role", role),
                new Claim("platformRole", "user"),
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
    public async Task InvoiceEndpoints_Enforce_Rbac_Paging_Detail_And_TenantIsolation()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var invAId = Guid.NewGuid();
        var invBId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            cp.Tenants.AddRange(
                new Tenant { Id = tenantA, Name = "Tenant A", Slug = $"ta-{tenantA:N}"[..16], Plan = "team" },
                new Tenant { Id = tenantB, Name = "Tenant B", Slug = $"tb-{tenantB:N}"[..16], Plan = "team" });
            await cp.SaveChangesAsync();

            var invA = new BillingInvoice
            {
                Id = invAId,
                TenantId = tenantA,
                StripeInvoiceId = $"in_a_{tenantA:N}"[..18],
                Status = "open",
                AmountDue = 3400,
                AmountRemaining = 3400,
                Currency = "usd",
                AttemptCount = 2,
                HostedInvoiceUrl = "https://invoice.stripe.com/a",
                PdfUrl = "https://invoice.stripe.com/a.pdf",
                PeriodStart = now.AddDays(-30),
                PeriodEnd = now,
                CreatedAt = now,
                UpdatedAt = now,
                Lines =
                {
                    new BillingInvoiceLine { Id = Guid.NewGuid(), InvoiceId = invAId, Kind = "base", Description = "Team plan", Quantity = 1, UnitAmount = 2900, Amount = 2900, Currency = "usd" },
                    new BillingInvoiceLine { Id = Guid.NewGuid(), InvoiceId = invAId, Kind = "metered_overage", Description = "Tokens", Quantity = 5, UnitAmount = 100, Amount = 500, Currency = "usd" },
                },
            };
            var invB = new BillingInvoice
            {
                Id = invBId,
                TenantId = tenantB,
                StripeInvoiceId = $"in_b_{tenantB:N}"[..18],
                Status = "paid",
                AmountDue = 1000,
                AmountPaid = 1000,
                Currency = "usd",
                PeriodStart = now.AddDays(-30),
                PeriodEnd = now,
                CreatedAt = now,
                UpdatedAt = now,
            };
            cp.BillingInvoices.AddRange(invA, invB);
            cp.BillingDunningStates.Add(new BillingDunningState
            {
                Id = Guid.NewGuid(),
                TenantId = tenantA,
                Stage = DunningStages.PastDue,
                FailedAttempts = 2,
                CurrentInvoiceId = invAId,
                NextAdvanceAt = now.AddHours(72),
                UpdatedAt = now,
            });
            await cp.SaveChangesAsync();
        }

        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantA);
        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantB);

        var client = _saasFactory.CreateClient();

        // 1. Unauthenticated -> 401
        (await client.GetAsync("/api/v1/billing/invoices")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // 2. Member lists own tenant's invoices (never sees Tenant B's)
        using var listReq = new HttpRequestMessage(HttpMethod.Get, "/api/v1/billing/invoices");
        listReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "member"));
        var listResp = await client.SendAsync(listReq);
        listResp.StatusCode.Should().Be(HttpStatusCode.OK);
        using var listDoc = JsonDocument.Parse(await listResp.Content.ReadAsStringAsync());
        listDoc.RootElement.GetProperty("total").GetInt32().Should().Be(1);
        listDoc.RootElement.GetProperty("items")[0].GetProperty("id").GetGuid().Should().Be(invAId);

        // 3. Member reads own invoice detail -> includes lines + dunning summary
        using var detailReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/billing/invoices/{invAId:D}");
        detailReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantA, "member"));
        var detailResp = await client.SendAsync(detailReq);
        detailResp.StatusCode.Should().Be(HttpStatusCode.OK);
        using var detailDoc = JsonDocument.Parse(await detailResp.Content.ReadAsStringAsync());
        detailDoc.RootElement.GetProperty("lines").GetArrayLength().Should().Be(2);
        detailDoc.RootElement.GetProperty("dunning").GetProperty("stage").GetString().Should().Be("past_due");
        detailDoc.RootElement.GetProperty("hostedInvoiceUrl").GetString().Should().Be("https://invoice.stripe.com/a");
        detailDoc.RootElement.GetProperty("pdfUrl").GetString().Should().Be("https://invoice.stripe.com/a.pdf");

        // 4. Cross-tenant GET /invoices/{id} -> 404 (not 403, AC4)
        using var crossReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/billing/invoices/{invAId:D}");
        crossReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantB, "member"));
        (await client.SendAsync(crossReq)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Test]
    public async Task LlmChat_Returns_402_BillingSuspended_When_Tenant_Dunning_Is_Suspended()
    {
        var tenantId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using (var scope = _saasFactory.Services.CreateAsyncScope())
        {
            var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
            cp.Tenants.Add(new Tenant { Id = tenantId, Name = "Susp", Slug = $"susp-{tenantId:N}"[..16], Plan = "team" });
            cp.BillingCustomers.Add(new BillingCustomer
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                StripeCustomerId = $"cus_{tenantId:N}"[..18],
                BillingMode = "PlatformProvided",
                CreatedAt = now,
                UpdatedAt = now,
            });
            cp.BillingDunningStates.Add(new BillingDunningState
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                Stage = DunningStages.Suspended,
                FailedAttempts = 4,
                SuspendedAt = now,
                UpdatedAt = now,
            });
            await cp.SaveChangesAsync();
        }

        await TestTenantProvisioning.ProvisionAsync(_saasFactory.Services, tenantId);

        var client = _saasFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/llm/chat")
        {
            Content = JsonContent.Create(new { messages = new[] { new { role = "user", content = "hello" } } }),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MintJwt(tenantId, "owner"));
        req.Headers.Add("X-Api-Key", "sk-test-key");

        var resp = await client.SendAsync(req);
        resp.StatusCode.Should().Be(HttpStatusCode.PaymentRequired);
        var body = await resp.Content.ReadFromJsonAsync<QuotaResponse>();
        body.Should().NotBeNull();
        body!.Error.Should().Be("quota_exceeded");
        body.Reason.Should().Be("billing_suspended");
    }

    [Test]
    public async Task ControlPlane_Model_Has_BillingInvoices_Lines_And_DunningStates_Constraints()
    {
        await using var scope = _saasFactory.Services.CreateAsyncScope();
        var cp = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
        var model = cp.GetService<IDesignTimeModel>().Model;

        var inv = model.FindEntityType(typeof(BillingInvoice));
        inv!.GetTableName().Should().Be("billing_invoices");
        inv.GetCheckConstraints().Should().Contain(c => c.Name == "ck_billing_invoices_status");
        inv.GetIndexes().Should().Contain(i => i.GetDatabaseName() == "IX_billing_invoices_stripe_invoice_id" && i.IsUnique);

        var line = model.FindEntityType(typeof(BillingInvoiceLine));
        line!.GetTableName().Should().Be("billing_invoice_lines");
        line.GetCheckConstraints().Should().Contain(c => c.Name == "ck_billing_invoice_lines_kind");

        var dun = model.FindEntityType(typeof(BillingDunningState));
        dun!.GetTableName().Should().Be("billing_dunning_states");
        dun.GetCheckConstraints().Should().Contain(c => c.Name == "ck_billing_dunning_states_stage");
        dun.GetIndexes().Should().Contain(i => i.GetDatabaseName() == "IX_billing_dunning_states_tenant_id" && i.IsUnique);
    }
}

/// <summary>
/// Story 35-8 (AC13) — verifies single-user mode short-circuits
/// <c>InvoiceEndpoints</c> with a "Billing is SaaS-only" response and does NOT
/// register <see cref="IDunningStateMachine"/> or <see cref="DunningAdvanceTaskHandler"/>.
/// </summary>
[TestFixture]
public class InvoiceSingleUserModeTests
{
    [Test]
    public async Task SingleUser_ShortCircuits_InvoiceEndpoints_And_Skips_Dunning_Registration()
    {
        await using var scope = ApiTestFixture.Factory.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<ITammaModeProvider>().Mode.Should().Be(TammaMode.SingleUser);
        scope.ServiceProvider.GetService<IDunningStateMachine>().Should().BeNull();
        scope.ServiceProvider.GetServices<IPlatformTaskHandler>()
            .Should().NotContain(h => h is DunningAdvanceTaskHandler);

        var client = ApiTestFixture.CreateClient();
        var listResp = await client.GetAsync("/api/v1/billing/invoices");
        listResp.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await listResp.Content.ReadAsStringAsync()).Should().Contain("billing_saas_only");

        var detailResp = await client.GetAsync($"/api/v1/billing/invoices/{Guid.NewGuid():D}");
        detailResp.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await detailResp.Content.ReadAsStringAsync()).Should().Contain("billing_saas_only");
    }
}
