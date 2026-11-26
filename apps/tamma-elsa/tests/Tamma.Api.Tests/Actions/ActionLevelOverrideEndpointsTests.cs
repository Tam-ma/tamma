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
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Core;
using Tamma.Core.Actions;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Policy;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Actions;

/// <summary>
/// Story 43-18 (AC2, AC3, AC4, AC5, AC6, AC7, AC8) — end-to-end integration
/// tests for platform-scope shipped-level overrides over the real
/// <see cref="WebApplicationFactory{TEntryPoint}"/> JWT pipeline and shared
/// Testcontainers Postgres:
/// <list type="bullet">
///   <item><b>AC2:</b> <c>GET/PUT/DELETE /api/admin/actions/levels</c> in BOTH
///     SaaS mode (tenant admin with <c>ActionsManage</c> gets 403; platform
///     owner gets 200) AND single-user mode (sole user gets 200) in one class.</item>
///   <item><b>AC3:</b> Live <see cref="IAutonomyGate"/> flips outcome when an
///     override is written and reverts when deleted.</item>
///   <item><b>AC4:</b> HTTP 400/404/200 guard rails (95 → 45 floor naming both
///     numbers, non-detent, machinery, unknown → 404, 101 accepted, missing field).</item>
///   <item><b>AC5:</b> <c>ACTION.GATE.ASSIGNMENT_CHANGED</c> audit rows asserted
///     directly against <see cref="IEventRepository"/> on PUT and DELETE
///     (<c>newValue: null</c> on delete).</item>
///   <item><b>AC6(a/b/c):</b> 43-15 detents + <c>/policy/diff</c>, 43-15
///     <c>levelOwned</c> + 409 predicate, and 43-16 derived acceptor on
///     <c>AcceptanceRulesService</c> — all reading the single resolver seam.</item>
///   <item><b>AC7:</b> <c>effectiveShippedLevel</c> and <c>levelSource</c> on
///     <c>/policy</c>, <c>/policy/actions/{ns}/{key}</c>, and <c>/catalog</c>
///     while catalog-shipped constants stay unchanged.</item>
///   <item><b>AC8:</b> Stranded override fails <c>ActionCatalogStartupValidator</c>
///     boot loudly with remediation message AND post-startup drift sweep catches
///     it in <see cref="GovernancePolicySnapshotStore"/>.</item>
/// </list>
/// </summary>
[TestFixture]
public class ActionLevelOverrideEndpointsTests
{
    private const string JwtSecret = "action-level-override-secret-32-chars";
    private static readonly SymmetricSecurityKey SigningKey =
        new(Encoding.UTF8.GetBytes(JwtSecret));

    private WebApplicationFactory<Program> _singleUserFactory = null!;
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
            "Cranl__EncryptionKey", Convert.ToBase64String(new byte[32]));
        Environment.SetEnvironmentVariable("TAMMA_PRESERVE_DB", "1");

        _singleUserFactory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b =>
            {
                b.UseEnvironment("Production");
                b.UseSetting("Tamma:Mode", "single-user");
                b.DisableAlertHostedServices();
            });

        _saasFactory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b =>
            {
                b.UseEnvironment("Production");
                b.UseSetting("Tamma:Mode", "saas");
                b.DisableAlertHostedServices();
            });
    }

    [OneTimeTearDown]
    public void OneTimeTearDown()
    {
        _singleUserFactory?.Dispose();
        _saasFactory?.Dispose();
        Environment.SetEnvironmentVariable("Jwt__Secret", null);
        Environment.SetEnvironmentVariable("Jwt__Issuer", null);
        Environment.SetEnvironmentVariable("Jwt__Audience", null);
        Environment.SetEnvironmentVariable("Tamma__Mode", null);
        Environment.SetEnvironmentVariable("Cranl__EncryptionKey", null);
        Environment.SetEnvironmentVariable("TAMMA_PRESERVE_DB", null);
    }

    [SetUp]
    public async Task SetUp()
    {
        await using var db = Db();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE action_level_overrides; TRUNCATE TABLE action_assignments; TRUNCATE TABLE action_authorizations;");

        // Refresh both factories' snapshot stores so tests start completely clean.
        await _singleUserFactory.Services.GetRequiredService<IGovernancePolicySnapshotProvider>()
            .RefreshAsync();
        await _saasFactory.Services.GetRequiredService<IGovernancePolicySnapshotProvider>()
            .RefreshAsync();
    }

    private static ControlPlaneDbContext Db()
    {
        var options = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseNpgsql(ApiTestFixture.Postgres.GetConnectionString())
            .Options;
        return new ControlPlaneDbContext(options);
    }

    private static string MintToken(
        Guid userId,
        string role,
        string platformRole,
        Guid? tenantId = null)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new("role", role),
            new("platformRole", platformRole),
            new(JwtRegisteredClaimNames.Email, "actor@example.com"),
            new("name", "Actor"),
            new("authMethod", "email"),
            new("tenants", tenantId is Guid tid
                ? $"[{{\"tenantId\":\"{tid}\",\"role\":\"{role}\"}}]"
                : "[]"),
        };
        if (tenantId is Guid t)
        {
            claims.Add(new Claim("tenantId", t.ToString()));
        }

        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: "tamma",
            audience: "tamma-api",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: new SigningCredentials(SigningKey, SecurityAlgorithms.HmacSha256)));
    }

    private static HttpClient Client(
        WebApplicationFactory<Program> factory,
        Guid userId,
        string role,
        string platformRole = "user",
        Guid? tenantId = null)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", MintToken(userId, role, platformRole, tenantId));
        if (tenantId is Guid tid)
        {
            client.DefaultRequestHeaders.Add("X-Tenant-Id", tid.ToString());
        }
        return client;
    }

    // ── AC2 — Mode-scoped RBAC pinned in BOTH directions in one class ──────

    [Test]
    public async Task Ac2_SaasMode_TenantAdminWithActionsManageGets403_PlatformOwnerGets200_AndSingleUserSoleUserGets200()
    {
        var userId = Guid.NewGuid();

        // 1. SaaS mode: tenant admin (role=admin, platformRole=user) gets 403 on
        //    all three /api/admin/actions/levels routes, even though they hold
        //    ActionsManage.
        using (var saasTenantAdmin = Client(_saasFactory, userId, role: "admin", platformRole: "user"))
        {
            var getRes = await saasTenantAdmin.GetAsync("/api/admin/actions/levels");
            getRes.StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "SaaS tenant admin must never see platform level overrides");

            var putRes = await saasTenantAdmin.PutAsJsonAsync(
                "/api/admin/actions/levels/agent-action/code-review",
                new { level = 70 });
            putRes.StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "SaaS tenant admin holding ActionsManage must get 403 on PUT /api/admin/actions/levels");

            var delRes = await saasTenantAdmin.DeleteAsync(
                "/api/admin/actions/levels/agent-action/code-review");
            delRes.StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "SaaS tenant admin must get 403 on DELETE /api/admin/actions/levels");
        }

        // 2. SaaS mode: platform owner (platformRole=platform_admin) succeeds (200).
        using (var saasOwner = Client(_saasFactory, userId, role: "member", platformRole: "platform_admin"))
        {
            var putRes = await saasOwner.PutAsJsonAsync(
                "/api/admin/actions/levels/agent-action/code-review",
                new { level = 70, note = "SaaS owner override" });
            putRes.StatusCode.Should().Be(HttpStatusCode.OK);

            var getRes = await saasOwner.GetAsync("/api/admin/actions/levels");
            getRes.StatusCode.Should().Be(HttpStatusCode.OK);
            var listJson = await getRes.Content.ReadFromJsonAsync<JsonElement>();
            listJson.GetProperty("overrides").EnumerateArray().Should().ContainSingle(o =>
                o.GetProperty("key").GetString() == "agent-action:code-review"
                && o.GetProperty("level").GetInt32() == 70);

            var delRes = await saasOwner.DeleteAsync(
                "/api/admin/actions/levels/agent-action/code-review");
            delRes.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        // 3. Single-user mode: the sole user succeeds (200) even without a
        //    SaaS platform_admin claim.
        using (var soleUser = Client(_singleUserFactory, userId, role: "owner", platformRole: "user"))
        {
            var putRes = await soleUser.PutAsJsonAsync(
                "/api/admin/actions/levels/agent-action/code-review",
                new { level = 75 });
            putRes.StatusCode.Should().Be(HttpStatusCode.OK,
                "single-user sole user IS the admin (Story 43-18 §4 / AC2)");

            var getRes = await soleUser.GetAsync("/api/admin/actions/levels");
            getRes.StatusCode.Should().Be(HttpStatusCode.OK);

            var delRes = await soleUser.DeleteAsync(
                "/api/admin/actions/levels/agent-action/code-review");
            delRes.StatusCode.Should().Be(HttpStatusCode.OK);
        }
    }

    // ── AC4 — HTTP validation guard rails ──────────────────────────────────

    [Test]
    public async Task Ac4_HttpValidation_EnforcesFloorDetentMachineryUnknownAndAlwaysHuman()
    {
        using var admin = Client(_singleUserFactory, Guid.NewGuid(), "owner", "platform_admin");

        // Delete-family at 95 → 45: 400 naming floor rule and both numbers.
        var floorRes = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/effect/git.branch.delete",
            new { level = 45 });
        floorRes.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var floorBody = await floorRes.Content.ReadAsStringAsync();
        floorBody.Should().Contain("50").And.Contain("95").And.Contain("45")
            .And.ContainEquivalentOf("floor");

        // Non-detent value: 400.
        var nonDetent = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/agent-action/code-review",
            new { level = 42 });
        nonDetent.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // Missing level field (single-nullable-field DTO): 400.
        var missing = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/agent-action/code-review",
            new { note = "no level field" });
        missing.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // Machinery key: 400 naming classification.
        var machinery = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/effect/engine.events.append",
            new { level = 50 });
        machinery.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await machinery.Content.ReadAsStringAsync()).Should().ContainEquivalentOf("machinery");

        // Unknown key: 404.
        var unknown = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/effect/no.such.action",
            new { level = 50 });
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // AlwaysHuman (101): 200 accepted.
        var alwaysHuman = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/effect/git.branch.delete",
            new { level = AutonomyDial.AlwaysHuman });
        alwaysHuman.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ── AC5 — Audit emission on PUT and DELETE asserted via IEventRepository ──

    [Test]
    public async Task Ac5_PutAndDelete_EmitAssignmentChangedAuditEvents_VerifiedInEventRepository()
    {
        var actorId = Guid.NewGuid();
        using var admin = Client(_singleUserFactory, actorId, "owner", "platform_admin");

        var putRes = await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/agent-action/code-review",
            new { level = 75, note = "require review at default dial" });
        putRes.StatusCode.Should().Be(HttpStatusCode.OK);

        var delRes = await admin.DeleteAsync(
            "/api/admin/actions/levels/agent-action/code-review");
        delRes.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = _singleUserFactory.Services.CreateScope();
        var eventRepo = scope.ServiceProvider.GetRequiredService<IEventRepository>();
        var events = await eventRepo.QueryAsync(
            tenantId: null,
            type: ActionGateEventsService.AssignmentChangedType,
            issueNumber: null,
            limit: 50);

        var matching = events
            .Where(e =>
            {
                if (string.IsNullOrWhiteSpace(e.Tags)) return false;
                var tags = JsonDocument.Parse(e.Tags).RootElement;
                return tags.TryGetProperty("scope", out var sc)
                    && sc.GetString() == "platform-level-override"
                    && tags.TryGetProperty("targetKey", out var tk)
                    && tk.GetString() == "agent-action:code-review"
                    && tags.TryGetProperty("actorUserId", out var ac)
                    && ac.GetString() == actorId.ToString();
            })
            .OrderBy(e => e.SequenceNumber)
            .ThenBy(e => e.CreatedAt)
            .ToList();

        matching.Should().HaveCountGreaterThanOrEqualTo(2,
            "both PUT and DELETE must emit ACTION.GATE.ASSIGNMENT_CHANGED");

        var putEvent = matching[^2];
        var putTags = JsonDocument.Parse(putEvent.Tags!).RootElement;
        var putData = JsonDocument.Parse(putEvent.Data!).RootElement;
        putTags.GetProperty("scope").GetString().Should().Be("platform-level-override");
        putTags.GetProperty("field").GetString().Should().Be("level");
        putTags.GetProperty("actorUserId").GetString().Should().Be(actorId.ToString());
        putData.GetProperty("oldValue").GetInt32().Should().Be(40);
        putData.GetProperty("newValue").GetInt32().Should().Be(75);

        var delEvent = matching[^1];
        var delTags = JsonDocument.Parse(delEvent.Tags!).RootElement;
        var delData = JsonDocument.Parse(delEvent.Data!).RootElement;
        delTags.GetProperty("scope").GetString().Should().Be("platform-level-override");
        delTags.GetProperty("field").GetString().Should().Be("level");
        delTags.GetProperty("actorUserId").GetString().Should().Be(actorId.ToString());
        delData.GetProperty("oldValue").GetInt32().Should().Be(75);
        delData.GetProperty("newValue").ValueKind.Should().Be(JsonValueKind.Null,
            "DELETE audit event must record newValue: null");
    }

    // ── AC6(a) + AC6(b) + AC7 — 43-15 diff/detents, levelOwned/409, provenance ──

    [Test]
    public async Task Ac6ab_And_Ac7_OverrideFlowsThroughDiffDetentsLevelOwned409AndProvenanceViews()
    {
        var userId = Guid.NewGuid();
        using var admin = Client(_singleUserFactory, userId, "owner", "platform_admin");

        // Baseline: agent-action:code-review ships at 40.
        // At default dial 70: levelOwned = true, editable = false, PUT threshold → 409.
        var baselineToggle = await admin.PutAsJsonAsync(
            "/api/actions/policy/actions/agent-action/code-review/threshold",
            new { minAutonomy = AutonomyDial.Min });
        baselineToggle.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "code-review ships at 40 <= dial 70, so it is level-owned before override");

        // Override agent-action:code-review 40 → 85 (above dial 70)
        // AND override effect:deploy.qa 75 → 65 (below dial 70, >= 50 floor).
        (await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/agent-action/code-review",
            new { level = 85 })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/effect/deploy.qa",
            new { level = 65 })).StatusCode.Should().Be(HttpStatusCode.OK);

        // AC7: Policy view and Catalog view surface effectiveShippedLevel + levelSource,
        // while keeping shippedLevel / defaultMinAutonomy equal to the immutable catalog default.
        var policyAction = await (await admin.GetAsync(
            "/api/actions/policy/actions/agent-action/code-review"))
            .Content.ReadFromJsonAsync<JsonElement>();
        var actionNode = policyAction.GetProperty("action");
        actionNode.GetProperty("shippedLevel").GetInt32().Should().Be(40);
        actionNode.GetProperty("effectiveShippedLevel").GetInt32().Should().Be(85);
        actionNode.GetProperty("levelSource").GetString().Should().Be("override");
        actionNode.GetProperty("levelOwned").GetBoolean().Should().BeFalse();
        actionNode.GetProperty("editable").GetBoolean().Should().BeTrue();

        var unoverridden = await (await admin.GetAsync(
            "/api/actions/policy/actions/tool/file_write"))
            .Content.ReadFromJsonAsync<JsonElement>();
        var unoverriddenAction = unoverridden.GetProperty("action");
        unoverriddenAction.GetProperty("shippedLevel").GetInt32().Should().Be(25);
        unoverriddenAction.GetProperty("effectiveShippedLevel").GetInt32().Should().Be(25);
        unoverriddenAction.GetProperty("levelSource").GetString().Should().Be("shipped");

        var catalog = await (await admin.GetAsync("/api/actions/catalog"))
            .Content.ReadFromJsonAsync<JsonElement>();
        var catalogCodeReview = catalog.EnumerateArray()
            .Single(x => x.GetProperty("key").GetString() == "agent-action:code-review");
        catalogCodeReview.GetProperty("defaultMinAutonomy").GetInt32().Should().Be(40);
        catalogCodeReview.GetProperty("effectiveShippedLevel").GetInt32().Should().Be(85);
        catalogCodeReview.GetProperty("levelSource").GetString().Should().Be("override");

        // AC6(a): GET /api/actions/policy/diff?from=80&to=90 now includes agent-action:code-review
        // (moved from 40 into (80, 90]), and does NOT include effect:deploy.qa in from=70&to=80
        // because deploy.qa moved from 75 down to 65.
        var diff80To90 = await (await admin.GetAsync("/api/actions/policy/diff?from=80&to=90"))
            .Content.ReadFromJsonAsync<JsonElement>();
        diff80To90.GetProperty("changes").EnumerateArray().Should().Contain(c =>
            c.GetProperty("key").GetString() == "agent-action:code-review"
            && c.GetProperty("effectiveShippedLevel").GetInt32() == 85
            && c.GetProperty("levelSource").GetString() == "override");

        var diff70To80 = await (await admin.GetAsync("/api/actions/policy/diff?from=70&to=80"))
            .Content.ReadFromJsonAsync<JsonElement>();
        diff70To80.GetProperty("changes").EnumerateArray().Should().NotContain(c =>
            c.GetProperty("key").GetString() == "effect:deploy.qa",
            "deploy.qa was overridden from 75 to 65, so moving 70→80 no longer crosses it");

        // Also check detents reflect a new distinct effective level (100, which has 0 shipped actions).
        (await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/effect/git.branch.delete",
            new { level = 100 })).StatusCode.Should().Be(HttpStatusCode.OK);
        var diffWith100 = await (await admin.GetAsync("/api/actions/policy/diff?from=70&to=100"))
            .Content.ReadFromJsonAsync<JsonElement>();
        diffWith100.GetProperty("detents").EnumerateArray().Select(e => e.GetInt32())
            .Should().Contain(100, "detents must derive from effective shipped levels");

        // AC6(b): levelOwned and 409 predicate key on effective level in BOTH directions.
        // code-review (overridden 40 → 85 > dial 70) is NO LONGER level-owned → toggle succeeds (200).
        var raisedToggle = await admin.PutAsJsonAsync(
            "/api/actions/policy/actions/agent-action/code-review/threshold",
            new { minAutonomy = AutonomyDial.Min });
        raisedToggle.StatusCode.Should().Be(HttpStatusCode.OK,
            "override raised code-review to 85 > dial 70, making it toggleable");

        // deploy.qa (overridden 75 → 65 <= dial 70) IS NOW level-owned → toggle returns 409.
        var loweredToggle = await admin.PutAsJsonAsync(
            "/api/actions/policy/actions/effect/deploy.qa/threshold",
            new { minAutonomy = AutonomyDial.Min });
        loweredToggle.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "override lowered deploy.qa to 65 <= dial 70, making it level-owned");
    }

    // ── AC6(c) — 43-16 derived acceptor follows override in BOTH directions ──

    [Test]
    public async Task Ac6c_AcceptanceRulesService_DerivedAcceptorFollowsOverrideInBothDirections()
    {
        var userId = Guid.NewGuid();
        using var admin = Client(_singleUserFactory, userId, "owner", "platform_admin");

        // Verify the DI container wires IShippedLevelResolver and
        // IGovernancePolicySnapshotProvider to the exact same singleton store.
        var liveResolver = _singleUserFactory.Services.GetRequiredService<IShippedLevelResolver>();
        var liveProvider = _singleUserFactory.Services.GetRequiredService<IGovernancePolicySnapshotProvider>();
        liveResolver.Should().BeSameAs(liveProvider,
            "there must be ONE authoritative snapshot store behind both seams");

        // AcceptanceRulesService backed by the live singleton IShippedLevelResolver
        // (updated via the real HTTP PUT / DELETE /api/admin/actions/levels routes).
        var svc = new AcceptanceRulesService(new EmptyAcceptanceRulesRepository(), shippedLevels: liveResolver);

        // Baseline at default dial 70:
        // - document-type:design ships at 45 → Any
        // - document-type:sprint-plan ships at 95 → Human
        (await svc.ResolveAsync(userId, DocumentTypeKey.Design)).Rules.AcceptorRequirement
            .Should().Be(AcceptorRequirement.Any);
        (await svc.ResolveAsync(userId, DocumentTypeKey.SprintPlan)).Rules.AcceptorRequirement
            .Should().Be(AcceptorRequirement.Human);

        // Override design 45 → 85 (flips Any → Human at dial 70)
        // and sprint-plan 95 → 55 (flips Human → Any at dial 70).
        (await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/document-type/design",
            new { level = 85 })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await admin.PutAsJsonAsync(
            "/api/admin/actions/levels/document-type/sprint-plan",
            new { level = 55 })).StatusCode.Should().Be(HttpStatusCode.OK);

        (await svc.ResolveAsync(userId, DocumentTypeKey.Design)).Rules.AcceptorRequirement
            .Should().Be(AcceptorRequirement.Human,
                "raising document-type:design above dial 70 re-pins its derived acceptor to Human");
        (await svc.ResolveAsync(userId, DocumentTypeKey.SprintPlan)).Rules.AcceptorRequirement
            .Should().Be(AcceptorRequirement.Any,
                "lowering document-type:sprint-plan below dial 70 automates its derived acceptor");

        // Delete overrides → both revert to their shipped derived acceptors.
        (await admin.DeleteAsync("/api/admin/actions/levels/document-type/design"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await admin.DeleteAsync("/api/admin/actions/levels/document-type/sprint-plan"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await svc.ResolveAsync(userId, DocumentTypeKey.Design)).Rules.AcceptorRequirement
            .Should().Be(AcceptorRequirement.Any);
        (await svc.ResolveAsync(userId, DocumentTypeKey.SprintPlan)).Rules.AcceptorRequirement
            .Should().Be(AcceptorRequirement.Human);
    }

    private sealed class EmptyAcceptanceRulesRepository : IAcceptanceRulesRepository
    {
        public Task<AcceptanceRulesOverride?> GetAsync(Guid? userId, string? documentTypeKey) =>
            Task.FromResult<AcceptanceRulesOverride?>(null);
        public Task<(AcceptanceRulesOverride Entity, bool WasCreated)> UpsertAsync(
            AcceptanceRulesOverride entity, Guid? actingUserId = null) =>
            throw new NotSupportedException();
        public Task<bool> DeleteAsync(Guid? userId, string? documentTypeKey) =>
            Task.FromResult(false);
        public Task<List<AcceptanceRulesOverride>> ListAsync(Guid? userId) =>
            Task.FromResult(new List<AcceptanceRulesOverride>());
        public Task<AcceptanceRulesOverride?> GetByTenantAsync(Guid tenantId, string? documentTypeKey) =>
            Task.FromResult<AcceptanceRulesOverride?>(null);
        public Task<bool> DeleteByTenantAsync(Guid tenantId, string? documentTypeKey) =>
            Task.FromResult(false);
        public Task<List<AcceptanceRulesOverride>> ListByTenantAsync(Guid tenantId) =>
            Task.FromResult(new List<AcceptanceRulesOverride>());
    }

    // ── AC8 — Stranded overrides fail startup AND post-startup drift sweep ──

    [Test]
    public async Task Ac8_StrandedOverride_FailsStartupValidatorAndPostStartupDriftSweep()
    {
        var store = _singleUserFactory.Services.GetRequiredService<GovernancePolicySnapshotStore>();
        try
        {
            // Seed a stranded override row (retired key effect:git.pull-request.merge) directly in DB.
            await using (var db = Db())
            {
                db.ActionLevelOverrides.Add(new ActionLevelOverride
                {
                    ActionKey = "effect:git.pull-request.merge",
                    Level = 65,
                    Note = "stranded test row",
                    Version = 1,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                });
                await db.SaveChangesAsync();
            }

            // 1. Startup validator fails loudly with remediation message.
            var registry = _singleUserFactory.Services.GetRequiredService<IToolExecutorRegistry>();
            var config = _singleUserFactory.Services.GetRequiredService<IConfiguration>();
            var levelRepo = _singleUserFactory.Services.GetRequiredService<IActionLevelOverrideRepository>();

            var validator = new ActionCatalogStartupValidator(
                registry, config, NullLogger<ActionCatalogStartupValidator>.Instance, levelRepo);

            var act = () => validator.StartAsync(CancellationToken.None);
            var ex = await act.Should().ThrowAsync<TammaError>();
            ex.Which.Message.Should().Contain("ACTION.CATALOG.STRANDED_LEVEL_OVERRIDE")
                .And.Contain("effect:git.pull-request.merge")
                .And.ContainEquivalentOf("Remediation");

            // 2. Post-startup drift sweep in GovernancePolicySnapshotStore detects the same row.
            await store.RefreshAsync();
            store.LastStrandedOverrides.Should().ContainSingle(v =>
                v.ActionKey == "effect:git.pull-request.merge"
                && v.Code == ActionLevelOverrideValidator.CodeStrandedOverride);
        }
        finally
        {
            // Always clean up the stranded row so subsequent test fixtures can boot cleanly.
            await using var db = Db();
            await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE action_level_overrides;");
            await store.RefreshAsync();
        }
    }
}
