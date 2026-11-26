using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Tracker;
using Tamma.Api.Tests.Documents;
using Tamma.Core;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-4 AC1–AC4 (D1–D3) — iteration lifecycle, at-most-one-active
/// invariant (both service check and Postgres partial unique index
/// <c>ix_iterations_one_active</c>), concurrency race, three-mode carry-over on
/// close with terminal items pinned, FK <c>SET NULL</c> delete safety, and
/// bulk commitment.
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class IterationTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;

    private DocumentTestData.SchemaRoutingFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private IterationRepository _iterations = null!;
    private WorkItemRepository _workItems = null!;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_iterations_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _baseConnectionString = _postgres.GetConnectionString();

        _tenantId = Guid.NewGuid();
        _schema = TenantNaming.SchemaName(_tenantId);
        await new EfTenantDbMigrator().MigrateTenantAppAsync(CsFor(_schema));

        _factory = new DocumentTestData.SchemaRoutingFactory(_baseConnectionString).Map(_tenantId, _schema);
        _tenantContext = new DocumentTestData.FakeTenantContext(_tenantId);
        _projects = new ProjectRepository(_factory, _tenantContext);
        _iterations = new IterationRepository(_factory, _tenantContext);
        _workItems = new WorkItemRepository(_factory, _tenantContext);
    }

    [OneTimeTearDown]
    public async Task OneTimeTearDown() => await _postgres.DisposeAsync();

    [SetUp]
    public async Task ClearTables()
    {
        await using var conn = new NpgsqlConnection(CsFor(_schema));
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            $"""
            TRUNCATE TABLE {_schema}.work_item_relations, {_schema}.work_items,
                           {_schema}.iterations, {_schema}.projects,
                           {_schema}.tracker_preferences CASCADE;
            """, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    private IterationService Service() => new(_projects, _iterations, _workItems, _tenantContext);

    private static DefaultHttpContext Context(string? ifMatch = null)
    {
        var ctx = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        if (ifMatch is not null)
            ctx.Request.Headers["If-Match"] = ifMatch;
        return ctx;
    }

    private static async Task<(int Status, JsonElement Body, string? ETag)> Exec(
        IResult result, DefaultHttpContext ctx)
    {
        await result.ExecuteAsync(ctx);
        ctx.Response.Body.Position = 0;
        var raw = await new StreamReader(ctx.Response.Body).ReadToEndAsync();
        var body = string.IsNullOrWhiteSpace(raw)
            ? default
            : JsonDocument.Parse(raw).RootElement.Clone();
        var etag = ctx.Response.Headers.ETag.ToString();
        return (ctx.Response.StatusCode, body, string.IsNullOrEmpty(etag) ? null : etag);
    }

    private Task<ProjectEntity> NewProjectAsync(string key = "TAM") =>
        _projects.CreateAsync(new ProjectEntity { Key = key, Name = key, EstimateScale = "fibonacci" });

    private Task<WorkItemEntity> NewItemAsync(
        Guid projectId, string status = "backlog", string title = "item", Guid? iterationId = null) =>
        _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = projectId,
            Kind = "task",
            Status = status,
            Title = title,
            IterationId = iterationId,
        });

    [Test]
    public async Task Only_one_active_per_project()
    {
        var project = await NewProjectAsync();
        var s1 = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 1", null, null, "active", 20m));
        var s2 = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 2", null, null, "planned", 20m));

        // Service-level check returns 409 ITERATION_ALREADY_ACTIVE naming the incumbent.
        var http = Context();
        var (status, body, _) = await Exec(
            await TrackerEndpoints.PatchIteration(
                s2.Id,
                JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"active"}""", Json)!,
                Service(), http),
            http);

        status.Should().Be(StatusCodes.Status409Conflict);
        body.GetProperty("code").GetString().Should().Be("ITERATION_ALREADY_ACTIVE");
        body.GetProperty("error").GetString().Should().Contain(s1.Name);

        // Database-level partial unique index ix_iterations_one_active ALSO enforces it directly.
        await using var conn = new NpgsqlConnection(CsFor(_schema));
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            $"""
            INSERT INTO {_schema}.iterations ("Id","ProjectId","Name","Status","CreatedAt","UpdatedAt","Version")
            VALUES (@id, @pid, 'Direct Active', 'active', now(), now(), 1)
            """, conn);
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("pid", project.Id);

        var act = () => cmd.ExecuteNonQueryAsync();
        var ex = await act.Should().ThrowAsync<PostgresException>(
            "D1: ix_iterations_one_active partial unique index must enforce at-most-one-active at DB level");
        ex.Which.SqlState.Should().Be("23505");
        ex.Which.ConstraintName.Should().Be("ix_iterations_one_active");
    }

    [Test]
    public async Task Concurrent_activation_races_cleanly()
    {
        // AC2: two parallel activations for the same project -> EXACTLY ONE succeeds.
        var project = await NewProjectAsync();
        var i1 = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter A", null, null, "planned", null));
        var i2 = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter B", null, null, "planned", null));

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<(bool Succeeded, string? Code)> Activate(Guid id)
        {
            await gate.Task;
            try
            {
                await Service().PatchAsync(
                    id,
                    JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"active"}""", Json)!,
                    ifMatchVersion: null);
                return (true, null);
            }
            catch (TammaError te)
            {
                return (false, te.Code);
            }
        }

        var t1 = Task.Run(() => Activate(i1.Id));
        var t2 = Task.Run(() => Activate(i2.Id));
        gate.SetResult();

        var results = await Task.WhenAll(t1, t2);
        results.Count(r => r.Succeeded).Should().Be(1,
            "AC2: exactly one of two simultaneous activations may succeed");
        results.Single(r => !r.Succeeded).Code.Should().Be("ITERATION_ALREADY_ACTIVE");

        var all = await _iterations.ListByProjectAsync(project.Id);
        all.Count(i => i.Status == IterationRepository.StatusActive).Should().Be(1);
    }

    [Test]
    public async Task Closed_cannot_reopen()
    {
        var project = await NewProjectAsync();
        var iter = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 1", null, null, "active", null));
        await Service().PatchAsync(
            iter.Id,
            JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"closed"}""", Json)!,
            null);

        var http = Context();
        var (status, body, _) = await Exec(
            await TrackerEndpoints.PatchIteration(
                iter.Id,
                JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"active"}""", Json)!,
                Service(), http),
            http);

        status.Should().Be(StatusCodes.Status409Conflict);
        body.GetProperty("code").GetString().Should().Be("ITERATION_INVALID_TRANSITION");
    }

    [Test]
    public async Task Close_to_backlog_accounts_for_every_item()
    {
        // AC4: default carryOver mode is `to-backlog` — non-terminal items return to
        // backlog (IterationId = null), terminal items (`done` and `cancelled`) stay attached.
        var project = await NewProjectAsync();
        var iter = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 1", null, null, "active", null));

        var todo = await NewItemAsync(project.Id, "backlog", "backlog item", iter.Id);
        var inProg = await NewItemAsync(project.Id, "in_progress", "in progress item", iter.Id);
        var blocked = await NewItemAsync(project.Id, "blocked", "blocked item", iter.Id);
        var done = await NewItemAsync(project.Id, "done", "done item", iter.Id);
        var cancelled = await NewItemAsync(project.Id, "cancelled", "cancelled item", iter.Id);

        var http = Context();
        var (status, body, _) = await Exec(
            await TrackerEndpoints.PatchIteration(
                iter.Id,
                JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"closed"}""", Json)!,
                Service(), http),
            http);

        status.Should().Be(StatusCodes.Status200OK);
        body.GetProperty("status").GetString().Should().Be("closed");
        body.GetProperty("carryOverMovedCount").GetInt32().Should().Be(3);
        body.GetProperty("carryOverLeftCount").GetInt32().Should().Be(2);

        (await _workItems.GetAsync(todo.Id))!.IterationId.Should().BeNull();
        (await _workItems.GetAsync(inProg.Id))!.IterationId.Should().BeNull();
        (await _workItems.GetAsync(blocked.Id))!.IterationId.Should().BeNull();
        (await _workItems.GetAsync(done.Id))!.IterationId.Should().Be(iter.Id, "terminal items never move");
        (await _workItems.GetAsync(cancelled.Id))!.IterationId.Should().Be(iter.Id, "terminal items never move");
    }

    [Test]
    public async Task Close_move_to_requires_an_open_target()
    {
        var project = await NewProjectAsync();
        var closedTarget = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 0", null, null, "active", null));
        await Service().PatchAsync(
            closedTarget.Id,
            JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"closed"}""", Json)!,
            null);

        var active = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 1", null, null, "active", null));
        var plannedNext = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 2", null, null, "planned", null));

        var openItem = await NewItemAsync(project.Id, "in_progress", "open work", active.Id);
        var doneItem = await NewItemAsync(project.Id, "done", "completed work", active.Id);

        // Closed target MUST be rejected with 409 ITERATION_INVALID_CARRYOVER_TARGET.
        var badHttp = Context();
        var (badStatus, badBody, _) = await Exec(
            await TrackerEndpoints.PatchIteration(
                active.Id,
                JsonSerializer.Deserialize<PatchIterationRequest>(
                    $$"""{"status":"closed","carryOver":"move-to","carryOverTargetIterationId":"{{closedTarget.Id}}"}""", Json)!,
                Service(), badHttp),
            badHttp);
        badStatus.Should().Be(StatusCodes.Status409Conflict);
        badBody.GetProperty("code").GetString().Should().Be("ITERATION_INVALID_CARRYOVER_TARGET");

        // Planned target succeeds: non-terminal moves to plannedNext; terminal stays on active.
        var okHttp = Context();
        var (okStatus, okBody, _) = await Exec(
            await TrackerEndpoints.PatchIteration(
                active.Id,
                JsonSerializer.Deserialize<PatchIterationRequest>(
                    $$"""{"status":"closed","carryOver":"move-to","carryOverTargetIterationId":"{{plannedNext.Id}}"}""", Json)!,
                Service(), okHttp),
            okHttp);
        okStatus.Should().Be(StatusCodes.Status200OK);
        okBody.GetProperty("carryOverMovedCount").GetInt32().Should().Be(1);
        okBody.GetProperty("carryOverLeftCount").GetInt32().Should().Be(1);

        (await _workItems.GetAsync(openItem.Id))!.IterationId.Should().Be(plannedNext.Id);
        (await _workItems.GetAsync(doneItem.Id))!.IterationId.Should().Be(active.Id);
    }

    [Test]
    public async Task Close_leave_keeps_attachment()
    {
        var project = await NewProjectAsync();
        var active = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 1", null, null, "active", null));
        var openItem = await NewItemAsync(project.Id, "in_progress", "staying", active.Id);
        var doneItem = await NewItemAsync(project.Id, "done", "finished", active.Id);

        var result = await Service().PatchAsync(
            active.Id,
            JsonSerializer.Deserialize<PatchIterationRequest>("""{"status":"closed","carryOver":"leave"}""", Json)!,
            null);

        result!.MovedCount.Should().Be(0);
        result.LeftCount.Should().Be(2);
        (await _workItems.GetAsync(openItem.Id))!.IterationId.Should().Be(active.Id);
        (await _workItems.GetAsync(doneItem.Id))!.IterationId.Should().Be(active.Id);
    }

    [Test]
    public async Task Delete_never_deletes_work()
    {
        var project = await NewProjectAsync();
        var iter = await Service().CreateAsync(project.Id, new CreateIterationRequest("Iter 1", null, null, "planned", null));
        var item = await NewItemAsync(project.Id, "ready", "survives delete", iter.Id);

        var deleted = await Service().DeleteAsync(iter.Id, null);
        deleted.Should().BeTrue();

        var after = await _workItems.GetAsync(item.Id);
        after.Should().NotBeNull("deleting an iteration MUST never delete committed work items");
        after!.IterationId.Should().BeNull("FK ON DELETE SET NULL returns the item to backlog");
    }

    [Test]
    public async Task Commit_and_uncommit_reject_cross_project_items()
    {
        var projectA = await NewProjectAsync("AAA");
        var projectB = await NewProjectAsync("BBB");
        var iterA = await Service().CreateAsync(projectA.Id, new CreateIterationRequest("Iter A", null, null, "planned", null));

        var a1 = await NewItemAsync(projectA.Id, "ready", "A1");
        var a2 = await NewItemAsync(projectA.Id, "ready", "A2");
        var b1 = await NewItemAsync(projectB.Id, "ready", "B1");

        // Cross-project bulk commit is rejected without mutating any item.
        var crossCommit = () => Service().CommitItemsAsync(iterA.Id, [a1.Id, b1.Id]);
        (await crossCommit.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("TRACKER.CROSS_PROJECT_ITERATION_COMMIT");
        (await _workItems.GetAsync(a1.Id))!.IterationId.Should().BeNull();

        // Same-project bulk commit sets IterationId on all requested items.
        var committed = await Service().CommitItemsAsync(iterA.Id, [a1.Id, a2.Id]);
        committed.CommittedCount.Should().Be(2);
        (await _workItems.GetAsync(a1.Id))!.IterationId.Should().Be(iterA.Id);
        (await _workItems.GetAsync(a2.Id))!.IterationId.Should().Be(iterA.Id);

        // Cross-project uncommit is rejected.
        var crossUncommit = () => Service().UncommitItemAsync(iterA.Id, b1.Id);
        (await crossUncommit.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("TRACKER.CROSS_PROJECT_ITERATION_COMMIT");

        // Same-project uncommit returns item to backlog.
        (await Service().UncommitItemAsync(iterA.Id, a1.Id)).Should().BeTrue();
        (await _workItems.GetAsync(a1.Id))!.IterationId.Should().BeNull();
        (await _workItems.GetAsync(a2.Id))!.IterationId.Should().Be(iterA.Id);
    }
}
