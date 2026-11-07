using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using NUnit.Framework;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Api.Services.GitHub;
using Tamma.Api.Services.PromptStore;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-3 (AC1, AC5, AC7, AC8) — <see cref="AgentRunWaitRepository"/> against REAL
/// Postgres with BOTH migrations applied: the control-plane <c>agent_run_waits</c>
/// (single-user rows) and the tenant-schema one (SaaS rows). Every case runs once per
/// plane; the single-user plane passes with a NULL tenant id — an implementation that only
/// reaches <see cref="ITenantDbContextFactory"/> fails it.
///
/// <para>The cross-pod case (AC5) writes the row through "pod A" (its own contexts) and
/// delivers the webhook through a separately composed "pod B" (fresh contexts, no
/// in-memory registry) over the same store.</para>
///
/// <para>REQUIRES DOCKER to run (CI-verified).</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class AgentRunWaitRepositoryTests
{
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-7";
    private const long Installation = 4242;

    private PostgreSqlContainer _postgres = null!;
    private string _cs = null!;
    private Guid _tenantId;
    private string _schema = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("agent_run_waits_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _cs = _postgres.GetConnectionString();

        await using (var cp = NewCp())
            await cp.Database.MigrateAsync();

        _tenantId = Guid.NewGuid();
        _schema = TenantNaming.SchemaName(_tenantId);
        await new EfTenantDbMigrator().MigrateTenantAppAsync(
            new NpgsqlConnectionStringBuilder(_cs) { SearchPath = _schema }.ConnectionString);
    }

    [OneTimeTearDown]
    public async Task OneTimeTearDown() => await _postgres.DisposeAsync();

    [SetUp]
    public async Task Clear()
    {
        await using var conn = new NpgsqlConnection(_cs);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            $"TRUNCATE TABLE public.agent_run_waits; TRUNCATE TABLE {_schema}.agent_run_waits;", conn);
        await cmd.ExecuteNonQueryAsync();
    }

    // ── composition (one "pod" = one set of contexts) ──

    // EnableServiceProviderCaching(false): a WebApplicationFactory test can leave EF's
    // process-wide cached provider holding a disposed Npgsql data source.
    private ControlPlaneDbContext NewCp() => new(new DbContextOptionsBuilder<ControlPlaneDbContext>()
        .UseNpgsql(_cs).EnableServiceProviderCaching(false).Options);

    private sealed class SchemaFactory(string cs, Guid tenantId, string schema) : ITenantDbContextFactory
    {
        public ValueTask<TenantDbContext> CreateAsync(Guid id, CancellationToken ct = default)
        {
            if (id != tenantId) throw new InvalidOperationException($"Tenant {id} not reachable.");
            var opts = new DbContextOptionsBuilder<TenantDbContext>()
                .UseNpgsql(new NpgsqlConnectionStringBuilder(cs) { SearchPath = schema }.ConnectionString)
                .EnableServiceProviderCaching(false).Options;
            return new ValueTask<TenantDbContext>(new TenantDbContext(opts, id));
        }
    }

    private (AgentRunWaitRepository Repo, ControlPlaneDbContext Cp) NewPod()
    {
        var cp = NewCp();
        return (new AgentRunWaitRepository(cp, new SchemaFactory(_cs, _tenantId, _schema)), cp);
    }

    /// <summary>One plane of the matrix: SaaS (tenant schema) or single-user (CP, null tenant).</summary>
    public enum Plane { SaaS, SingleUser }

    private sealed record PlaneOps(
        Func<AgentRunWaitRegistration, Task<AgentRunWait>> Upsert,
        Func<long?, string, string, Task<IReadOnlyList<AgentRunWait>>> ListPending,
        Func<Guid, long, Task<bool>> MarkReceived,
        Func<Guid, Task<AgentRunWait?>> Get);

    private PlaneOps Ops(AgentRunWaitRepository r, Plane plane, Guid userId) => plane == Plane.SaaS
        ? new(reg => r.UpsertPendingByTenantAsync(_tenantId, reg),
            (i, repo, b) => r.ListPendingByTenantAsync(_tenantId, i, repo, b),
            (id, run) => r.TryMarkReceivedByTenantAsync(_tenantId, id, run),
            id => r.GetByTenantAsync(_tenantId, id))
        : new(reg => r.UpsertPendingByUserAsync(userId, reg),
            (i, repo, b) => r.ListPendingByUserAsync(userId, i, repo, b),
            (id, run) => r.TryMarkReceivedByUserAsync(userId, id, run),
            id => r.GetByUserAsync(userId, id));

    private AgentRunWaitRegistration Reg(Plane plane, string session = "adl-7-task-0", string instance = "wf-1")
    {
        Guid? bookmarkTenant = plane == Plane.SaaS ? _tenantId : null;
        return new(Repo, Branch, session, Installation, instance,
            LifecycleBookmarks.ForAgentRun(bookmarkTenant?.ToString(), Repo, Branch, session),
            bookmarkTenant, new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc));
    }

    // ── AC1: pending → received, per plane ──

    [TestCase(Plane.SaaS)]
    [TestCase(Plane.SingleUser)]
    public async Task Pending_to_received_round_trip(Plane plane)
    {
        var (repo, cp) = NewPod();
        await using var _ = cp;
        var ops = Ops(repo, plane, Guid.NewGuid());

        var row = await ops.Upsert(Reg(plane));
        row.Status.Should().Be(AgentRunWaitStatus.Pending);
        if (plane == Plane.SingleUser) row.TenantId.Should().BeNull("single-user rows carry no tenant id");

        var pending = await ops.ListPending(Installation, Repo, Branch);
        pending.Should().ContainSingle().Which.Id.Should().Be(row.Id);

        (await ops.MarkReceived(row.Id, 991)).Should().BeTrue();
        (await ops.MarkReceived(row.Id, 991)).Should().BeFalse("the pending → received CAS has exactly one winner (redelivery no-op)");

        var stored = await ops.Get(row.Id);
        stored!.Status.Should().Be(AgentRunWaitStatus.Received);
        stored.WorkflowRunId.Should().Be(991);
        stored.ReceivedAt.Should().NotBeNull();
        (await ops.ListPending(Installation, Repo, Branch)).Should().BeEmpty();
    }

    [TestCase(Plane.SaaS)]
    [TestCase(Plane.SingleUser)]
    public async Task Redispatch_under_the_same_session_rearms_the_one_row(Plane plane)
    {
        var (repo, cp) = NewPod();
        await using var _ = cp;
        var ops = Ops(repo, plane, Guid.NewGuid());

        var first = await ops.Upsert(Reg(plane, instance: "wf-1"));
        await ops.MarkReceived(first.Id, 1);
        var second = await ops.Upsert(Reg(plane, instance: "wf-2"));

        second.Id.Should().Be(first.Id, "unique on principal + (repository, branch, session)");
        var stored = await ops.Get(first.Id);
        stored!.Status.Should().Be(AgentRunWaitStatus.Pending);
        stored.WorkflowInstanceId.Should().Be("wf-2");
        stored.WorkflowRunId.Should().BeNull();
    }

    [TestCase(Plane.SaaS)]
    [TestCase(Plane.SingleUser)]
    public async Task Match_folds_the_installation_id(Plane plane)
    {
        var (repo, cp) = NewPod();
        await using var _ = cp;
        var ops = Ops(repo, plane, Guid.NewGuid());
        await ops.Upsert(Reg(plane));

        (await ops.ListPending(Installation + 1, Repo, Branch)).Should().BeEmpty(
            "a completion from another installation never matches (review-finding-5)");
        (await ops.ListPending(null, Repo, Branch)).Should().BeEmpty();
        (await ops.ListPending(Installation, Repo, "main")).Should().BeEmpty();
    }

    // ── AC7: the planes never join ──

    [Test]
    public async Task Planes_never_join()
    {
        var (repo, cp) = NewPod();
        await using var _ = cp;
        var userId = Guid.NewGuid();
        var saas = await repo.UpsertPendingByTenantAsync(_tenantId, Reg(Plane.SaaS));
        var su = await repo.UpsertPendingByUserAsync(userId, Reg(Plane.SingleUser));

        (await repo.ListPendingByUserAsync(_tenantId, Installation, Repo, Branch)).Should().BeEmpty();
        (await repo.ListPendingByUserAsync(userId, Installation, Repo, Branch)).Should().ContainSingle().Which.Id.Should().Be(su.Id);
        (await repo.ListPendingByTenantAsync(_tenantId, Installation, Repo, Branch)).Should().ContainSingle().Which.Id.Should().Be(saas.Id);
        (await repo.TryMarkReceivedByUserAsync(userId, saas.Id, 1)).Should().BeFalse("the user plane cannot reach a tenant row");
        (await repo.TryMarkReceivedByTenantAsync(_tenantId, su.Id, 1)).Should().BeFalse("the tenant plane cannot reach a user row");
    }

    [Test]
    public async Task Principal_xor_is_enforced_by_the_database()
    {
        await using var cp = NewCp();
        cp.AgentRunWaits.Add(new AgentRunWait
        {
            Id = Guid.NewGuid(), Repository = Repo, BranchName = Branch, SessionId = "s",
            WorkflowInstanceId = "wf", BookmarkName = "agent-run-x", DispatchedAt = DateTime.UtcNow,
        });
        var neither = () => cp.SaveChangesAsync();
        (await neither.Should().ThrowAsync<DbUpdateException>())
            .WithInnerException<PostgresException>().Which.ConstraintName.Should().Be("ck_agent_run_waits_principal_xor");
    }

    // ── AC5: cross-pod delivery ──

    [TestCase(Plane.SaaS)]
    [TestCase(Plane.SingleUser)]
    public async Task Webhook_on_pod_B_resumes_the_wait_dispatched_on_pod_A(Plane plane)
    {
        var userId = Guid.NewGuid();
        var mode = new AgentRunResumerTests.StubMode(plane == Plane.SaaS ? TammaMode.SaaS : TammaMode.SingleUser);
        var soleUser = new Mock<ISoleUserProvider>();
        soleUser.Setup(s => s.GetSoleUserIdAsync(It.IsAny<CancellationToken>())).ReturnsAsync(userId);
        var installations = new Mock<IInstallationRepository>();
        var install = new GitHubInstallation
        {
            InstallationId = Installation, TenantId = _tenantId, AccountLogin = "acme", AccountType = "Organization",
        };
        installations.Setup(i => i.GetByRepoFullNameAsync(Repo)).ReturnsAsync(install);
        installations.Setup(i => i.GetByInstallationIdAsync(Installation)).ReturnsAsync(install);

        // Pod A — the mediated dispatch writes the row, then pod A goes away.
        var session = "adl-7-task-0";
        string? bookmarkTenant = plane == Plane.SaaS ? _tenantId.ToString() : null;
        var expectedName = LifecycleBookmarks.ForAgentRun(bookmarkTenant, Repo, Branch, session);
        var (repoA, cpA) = NewPod();
        await using (cpA)
        {
            var recorder = new AgentRunWaitRecorder(repoA, installations.Object, mode, soleUser.Object,
                NullLogger<AgentRunWaitRecorder>.Instance);
            (await recorder.RecordAsync(plane == Plane.SaaS ? _tenantId : null, Repo, new DispatchAgentRunRequest
            {
                Ref = Branch, CorrelationId = session, WorkflowInstanceId = "wf-a",
                BookmarkName = expectedName, BookmarkTenantId = bookmarkTenant,
            }, DateTime.UtcNow)).Should().BeTrue();
        }

        // Pod B — fresh contexts, NO in-memory registry, receives the webhook.
        var (repoB, cpB) = NewPod();
        await using var _ = cpB;
        using var engine = new AgentRunResumerTests.StubEngine(HttpStatusCode.OK);
        var resumer = new AgentRunResumer(repoB, installations.Object, mode, soleUser.Object,
            new AgentRunResumerTests.StubHttpClientFactory(engine), Mock.Of<IEventRepository>(),
            NullLogger<AgentRunResumer>.Instance);
        var router = new InstallationRouterService(
            installations.Object, Mock.Of<IEventRepository>(), Mock.Of<ITenantRepository>(), Mock.Of<IUserRepository>(),
            new MemoryCache(new MemoryCacheOptions()), Mock.Of<Tamma.Platforms.GitHub.IGitHubAppInstallationReader>(),
            Mock.Of<IInstallationSecretsPusher>(), Mock.Of<IApiKeyRepository>(),
            NullLogger<InstallationRouterService>.Instance, webhookSignals: null, agentRunResumer: resumer);

        var payload = JsonDocument.Parse($$"""
            {
              "action": "completed",
              "workflow_run": {
                "id": 991, "status": "completed", "conclusion": "success",
                "html_url": "https://github.com/acme/widgets/actions/runs/991",
                "artifacts_url": "https://api.github.com/repos/acme/widgets/actions/runs/991/artifacts",
                "head_branch": "{{Branch}}",
                "created_at": "{{DateTime.UtcNow.AddMinutes(1):O}}",
                "updated_at": "{{DateTime.UtcNow.AddMinutes(6):O}}"
              },
              "repository": { "full_name": "{{Repo}}" },
              "installation": { "id": {{Installation}} }
            }
            """).RootElement;

        var result = await router.HandleWebhookAsync("workflow_run", payload);

        result.Skipped.Should().BeFalse();
        engine.Bodies.Should().ContainSingle();
        engine.Bodies[0].GetProperty("bookmarkName").GetString().Should().Be(expectedName);
        engine.Bodies[0].GetProperty("workflowInstanceId").GetString().Should().Be("wf-a");

        // The row is received in the shared store; a GitHub redelivery is a no-op.
        var ops = Ops(repoB, plane, userId);
        (await ops.ListPending(Installation, Repo, Branch)).Should().BeEmpty();
        var redelivery = await router.HandleWebhookAsync("workflow_run", payload);
        redelivery.Skipped.Should().BeTrue("an already-received row is never resumed twice");
        engine.Bodies.Should().ContainSingle();
    }
}
