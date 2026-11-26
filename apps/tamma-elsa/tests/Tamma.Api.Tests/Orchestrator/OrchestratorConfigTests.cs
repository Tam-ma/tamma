using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Auth;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Core;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC6 / D8) — tests for <see cref="OrchestratorAgentConfig"/>,
/// <see cref="OrchestratorConfigService"/>, <see cref="OrchestratorConfigEndpoints"/>,
/// RBAC permission matrix parity (<c>orchestrator:manage</c>), and Postgres schema
/// constraints (<c>ck_orchestrator_agent_configs_principal_xor</c> +
/// <c>NULLS NOT DISTINCT</c>).
/// </summary>
[TestFixture]
public class OrchestratorConfigTests
{
    private InMemoryDbFixture _fx = null!;
    private OrchestratorConfigService _service = null!;
    private List<DomainEvent> _emitted = null!;

    [SetUp]
    public void SetUp()
    {
        _fx = new InMemoryDbFixture();
        var tc = new TenantContext();
        tc.SetTenantId(Guid.NewGuid());
        var repo = new OrchestratorAgentConfigRepository(_fx.Factory, tc);
        _emitted = new List<DomainEvent>();
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(ev => _emitted.Add(ev))
            .ReturnsAsync((DomainEvent ev) => ev);
        _service = new OrchestratorConfigService(repo, events.Object, NullLogger<OrchestratorConfigService>.Instance);
    }

    [TearDown]
    public async Task TearDown() => await _fx.DisposeAsync();

    private static ClaimsPrincipal Principal(Guid userId, string? role = null)
    {
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, userId.ToString()) };
        if (role is not null) claims.Add(new Claim(ClaimTypes.Role, role));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private sealed class StubModeProvider(TammaMode mode) : ITammaModeProvider
    {
        public TammaMode Mode { get; } = mode;
    }

    private static async Task<(int Status, string Body)> Exec(IResult result)
    {
        var services = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider();
        var ctx = new DefaultHttpContext
        {
            RequestServices = services,
            Response = { Body = new MemoryStream() },
        };
        await result.ExecuteAsync(ctx);
        ctx.Response.Body.Position = 0;
        var body = await new StreamReader(ctx.Response.Body).ReadToEndAsync();
        return (ctx.Response.StatusCode, body);
    }

    [Test]
    public void Defaults_are_drift_pinned_and_valid()
    {
        var d = OrchestratorAgentDefaults.Config;
        d.Provider.Should().Be("anthropic");
        d.Model.Should().Be("claude-sonnet-4-20250514");
        d.MaxSessionTokens.Should().Be(64_000);
        d.CompactAfterTurns.Should().Be(24);
        d.MaxTokensPerDecision.Should().Be(4_096);
        d.MaxUsdPerDay.Should().Be(25.00m);
        d.IdleEvictAfterMinutes.Should().Be(30);
        d.MaxToolSteps.Should().Be(12);
        d.Temperature.Should().Be(0.2);

        FluentActions.Invoking(() => d.Validate()).Should().NotThrow();
    }

    [Test]
    public void Validate_rejects_out_of_range_knobs()
    {
        var badConfigs = new[]
        {
            OrchestratorAgentDefaults.Config with { Provider = "" },
            OrchestratorAgentDefaults.Config with { Model = "   " },
            OrchestratorAgentDefaults.Config with { MaxSessionTokens = 512 },
            OrchestratorAgentDefaults.Config with { MaxTokensPerDecision = 100_000 },
            OrchestratorAgentDefaults.Config with { CompactAfterTurns = 1 },
            OrchestratorAgentDefaults.Config with { MaxUsdPerDay = 0m },
            OrchestratorAgentDefaults.Config with { IdleEvictAfterMinutes = 0 },
            OrchestratorAgentDefaults.Config with { MaxToolSteps = 0 },
            OrchestratorAgentDefaults.Config with { Temperature = 1.5 },
        };

        foreach (var bad in badConfigs)
        {
            FluentActions.Invoking(() => bad.Validate())
                .Should().Throw<TammaError>()
                .Which.Code.Should().Be("ORCHESTRATOR.CONFIG.INVALID");
        }
    }

    [TestCase("member", false)]
    [TestCase("admin", true)]
    [TestCase("owner", true)]
    public void OrchestratorManage_permission_is_admin_and_owner_only(string role, bool allowed)
    {
        Permissions.HasPermission(role, "orchestrator:manage").Should().Be(allowed);
    }

    [Test]
    public async Task Endpoints_SaaS_upsert_get_and_delete_emit_audit_events_and_fallback_to_defaults()
    {
        var tenantId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        var tc = new TenantContext();
        tc.SetTenantId(tenantId);
        var mode = new StubModeProvider(TammaMode.SaaS);
        var admin = Principal(adminId, "admin");

        // Before upsert: returns system-default
        var initial = await Exec(await OrchestratorConfigEndpoints.GetEffective(_service, admin, tc, mode, default));
        initial.Status.Should().Be(StatusCodes.Status200OK);
        initial.Body.Should().Contain("system-default");

        // Upsert tenant override
        var custom = OrchestratorAgentDefaults.Config with { Model = "claude-opus-4-20250514", MaxUsdPerDay = 50m };
        var putRes = await Exec(await OrchestratorConfigEndpoints.Upsert(custom, _service, admin, tc, mode, default));
        putRes.Status.Should().Be(StatusCodes.Status200OK);
        putRes.Body.Should().Contain("claude-opus-4-20250514");
        _emitted.Should().Contain(e => e.Type == OrchestratorEvents.ConfigUpdated && e.TenantId == tenantId);

        // Effective read returns tenant override
        var getRes = await Exec(await OrchestratorConfigEndpoints.GetEffective(_service, Principal(Guid.NewGuid(), "member"), tc, mode, default));
        getRes.Status.Should().Be(StatusCodes.Status200OK);
        getRes.Body.Should().Contain("claude-opus-4-20250514");

        // Delete resets to system-default
        var delRes = await Exec(await OrchestratorConfigEndpoints.Delete(_service, admin, tc, mode, default));
        delRes.Status.Should().Be(StatusCodes.Status200OK);
        _emitted.Should().Contain(e => e.Type == OrchestratorEvents.ConfigDeleted && e.TenantId == tenantId);

        var afterDel = await Exec(await OrchestratorConfigEndpoints.GetEffective(_service, admin, tc, mode, default));
        afterDel.Body.Should().Contain("system-default");
    }

    [Test]
    public async Task Endpoints_SingleUser_writes_user_keyed_row_and_isolates_users()
    {
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var tc = new TenantContext();
        tc.SetTenantId(Guid.NewGuid());
        var mode = new StubModeProvider(TammaMode.SingleUser);

        var custom = OrchestratorAgentDefaults.Config with { MaxToolSteps = 20 };
        var putRes = await Exec(await OrchestratorConfigEndpoints.Upsert(custom, _service, Principal(userA, "owner"), tc, mode, default));
        putRes.Status.Should().Be(StatusCodes.Status200OK);

        var readA = await Exec(await OrchestratorConfigEndpoints.GetEffective(_service, Principal(userA, "owner"), tc, mode, default));
        readA.Body.Should().Contain("\"maxToolSteps\":20");

        var readB = await Exec(await OrchestratorConfigEndpoints.GetEffective(_service, Principal(userB, "owner"), tc, mode, default));
        readB.Body.Should().Contain("system-default");
    }

    [Test]
    public async Task Postgres_migration_enforces_principal_xor_and_nulls_not_distinct()
    {
        var connStr = ApiTestFixture.TenantPostgres.GetConnectionString();
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();

        var sample = JsonSerializer.Serialize(OrchestratorAgentDefaults.Config, OrchestratorAgentDefaults.JsonOptions);
        var uid = Guid.NewGuid();
        var tid = Guid.NewGuid();

        // Clean any prior rows
        await using (var clean = new NpgsqlCommand("DELETE FROM orchestrator_agent_configs;", conn))
            await clean.ExecuteNonQueryAsync();

        // Both set -> CHECK violation 23514
        await using (var bothSet = new NpgsqlCommand(
            """INSERT INTO orchestrator_agent_configs ("UserId","TenantId","ConfigJson") VALUES (@u,@t,@c::jsonb);""", conn))
        {
            bothSet.Parameters.AddWithValue("u", uid);
            bothSet.Parameters.AddWithValue("t", tid);
            bothSet.Parameters.AddWithValue("c", sample);
            var ex = await FluentActions.Awaiting(() => bothSet.ExecuteNonQueryAsync()).Should().ThrowAsync<PostgresException>();
            ex.Which.SqlState.Should().Be("23514");
            ex.Which.ConstraintName.Should().Be("ck_orchestrator_agent_configs_principal_xor");
        }

        // Both null -> CHECK violation 23514
        await using (var bothNull = new NpgsqlCommand(
            """INSERT INTO orchestrator_agent_configs ("UserId","TenantId","ConfigJson") VALUES (NULL,NULL,@c::jsonb);""", conn))
        {
            bothNull.Parameters.AddWithValue("c", sample);
            var ex = await FluentActions.Awaiting(() => bothNull.ExecuteNonQueryAsync()).Should().ThrowAsync<PostgresException>();
            ex.Which.SqlState.Should().Be("23514");
            ex.Which.ConstraintName.Should().Be("ck_orchestrator_agent_configs_principal_xor");
        }

        // Duplicate tenant row (UserId = NULL) -> UNIQUE violation 23505 (NULLS NOT DISTINCT)
        await using (var ins1 = new NpgsqlCommand(
            """INSERT INTO orchestrator_agent_configs ("UserId","TenantId","ConfigJson") VALUES (NULL,@t,@c::jsonb);""", conn))
        {
            ins1.Parameters.AddWithValue("t", tid);
            ins1.Parameters.AddWithValue("c", sample);
            (await ins1.ExecuteNonQueryAsync()).Should().Be(1);
        }

        await using (var ins2 = new NpgsqlCommand(
            """INSERT INTO orchestrator_agent_configs ("UserId","TenantId","ConfigJson") VALUES (NULL,@t,@c::jsonb);""", conn))
        {
            ins2.Parameters.AddWithValue("t", tid);
            ins2.Parameters.AddWithValue("c", sample);
            var ex = await FluentActions.Awaiting(() => ins2.ExecuteNonQueryAsync()).Should().ThrowAsync<PostgresException>();
            ex.Which.SqlState.Should().Be("23505");
        }
    }
}
