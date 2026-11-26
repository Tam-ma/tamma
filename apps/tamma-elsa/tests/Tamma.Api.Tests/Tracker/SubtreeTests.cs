using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Tracker;
using Tamma.Api.Tests.Documents;
using Tamma.Core;
using Tamma.Core.Documents;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-3 AC5 &amp; AC6 (D5) — single-query recursive CTE subtree reads and
/// constant-query-count SQL roll-up counts (<c>childCount</c>,
/// <c>childCountByStatus</c>) on both <c>GET /api/work-items</c> and
/// <c>GET /api/work-items/{id}/subtree</c>.
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class SubtreeTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;

    private RankMoveTests.SqlCountingInterceptor _interceptor = null!;
    private RankMoveTests.CountingTenantDbContextFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private WorkItemRepository _workItems = null!;
    private TrackerPreferenceRepository _preferences = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_subtree_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _baseConnectionString = _postgres.GetConnectionString();

        _tenantId = Guid.NewGuid();
        _schema = TenantNaming.SchemaName(_tenantId);
        await new EfTenantDbMigrator().MigrateTenantAppAsync(CsFor(_schema));

        _interceptor = new RankMoveTests.SqlCountingInterceptor();
        _factory = new RankMoveTests.CountingTenantDbContextFactory(_baseConnectionString, _tenantId, _schema, _interceptor);
        _tenantContext = new DocumentTestData.FakeTenantContext(_tenantId);
        _projects = new ProjectRepository(_factory, _tenantContext);
        _workItems = new WorkItemRepository(_factory, _tenantContext);
        _preferences = new TrackerPreferenceRepository(_factory, _tenantContext);
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
        _interceptor.Reset();
    }

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    private TrackerHierarchyService Hierarchy() => new(_workItems, _tenantContext);

    private TrackerService Service() => new(
        _projects, _workItems, _preferences,
        new InitiatorOnlyTaskAudienceResolver(),
        new StubModeProvider(), _tenantContext);

    private sealed class StubModeProvider : ITammaModeProvider
    {
        public TammaMode Mode => TammaMode.SingleUser;
    }

    private Task<ProjectEntity> NewProjectAsync(string key = "TAM") =>
        _projects.CreateAsync(new ProjectEntity { Key = key, Name = key, EstimateScale = "not_used" });

    private Task<WorkItemEntity> NewItemAsync(
        Guid projectId, string kind, string status, string title, Guid? parentId = null) =>
        _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = projectId,
            Kind = kind,
            Status = status,
            Title = title,
            ParentId = parentId,
        });

    [Test]
    public async Task Returns_descendants_to_max_depth_in_one_query()
    {
        var project = await NewProjectAsync();
        // Build a branching tree reaching depth TrackerHierarchy.MaxDepth (6):
        // root (d1)
        //   ├── branchA (d2, in_progress)
        //   │     └── d3 -> d4 -> d5 -> d6
        //   └── branchB (d2, done)
        var root = await NewItemAsync(project.Id, "epic", "in_progress", "root");
        var branchA = await NewItemAsync(project.Id, "story", "in_progress", "branch-A", root.Id);
        var branchB = await NewItemAsync(project.Id, "story", "done", "branch-B", root.Id);
        var d3 = await NewItemAsync(project.Id, "task", "backlog", "depth-3", branchA.Id);
        var d4 = await NewItemAsync(project.Id, "task", "ready", "depth-4", d3.Id);
        var d5 = await NewItemAsync(project.Id, "task", "in_review", "depth-5", d4.Id);
        var d6 = await NewItemAsync(project.Id, "task", "done", "depth-6", d5.Id);

        // Also seed an unrelated sibling root that MUST NOT appear in root's subtree.
        _ = await NewItemAsync(project.Id, "epic", "backlog", "unrelated");

        _interceptor.Reset();
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var result = await TrackerEndpoints.GetSubtree(root.Id, Hierarchy());
        await result.ExecuteAsync(http);

        http.Response.StatusCode.Should().Be(StatusCodes.Status200OK);
        _interceptor.AllCommands.Should().HaveCount(1,
            "AC5: subtree read + roll-up counts must execute in ONE recursive CTE SQL statement");

        http.Response.Body.Position = 0;
        using var doc = JsonDocument.Parse(await new StreamReader(http.Response.Body).ReadToEndAsync());
        var body = doc.RootElement;
        body.GetProperty("rootId").GetGuid().Should().Be(root.Id);
        body.GetProperty("maxDepth").GetInt32().Should().Be(TrackerHierarchy.MaxDepth);

        var items = body.GetProperty("items").EnumerateArray().ToList();
        // Exact DFS pre-order so a client can render the tree with zero client-side sorting.
        items.Select(i => i.GetProperty("id").GetGuid()).Should().Equal(
            root.Id, branchA.Id, d3.Id, d4.Id, d5.Id, d6.Id, branchB.Id);
        items.Select(i => i.GetProperty("depth").GetInt32()).Should().Equal(
            1, 2, 3, 4, 5, TrackerHierarchy.MaxDepth, 2);

        // Root has 2 direct children: 1 in_progress (branchA), 1 done (branchB).
        items[0].GetProperty("childCount").GetInt32().Should().Be(2);
        items[0].GetProperty("childCountByStatus").GetProperty("in_progress").GetInt32().Should().Be(1);
        items[0].GetProperty("childCountByStatus").GetProperty("done").GetInt32().Should().Be(1);

        // Leaf d6 has 0 children.
        items[5].GetProperty("childCount").GetInt32().Should().Be(0);
    }

    [Test]
    public async Task Rollup_query_count_is_constant()
    {
        // AC6: 5 items vs 500 items MUST execute the EXACT same SQL statement count (1)
        // on GET /api/work-items, with accurate childCount and childCountByStatus.
        var projectSmall = await NewProjectAsync("SML");
        var smallParent = await NewItemAsync(projectSmall.Id, "epic", "in_progress", "parent-small");
        await NewItemAsync(projectSmall.Id, "task", "backlog", "c1", smallParent.Id);
        await NewItemAsync(projectSmall.Id, "task", "done", "c2", smallParent.Id);
        await NewItemAsync(projectSmall.Id, "task", "done", "c3", smallParent.Id);
        await NewItemAsync(projectSmall.Id, "task", "in_progress", "standalone");

        _interceptor.Reset();
        var smallHttp = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var smallRes = await TrackerEndpoints.ListWorkItems(
            projectSmall.Id, null, null, null, null, null, null, null, null, null, 500,
            Service(), new ClaimsPrincipal(new ClaimsIdentity()));
        await smallRes.ExecuteAsync(smallHttp);
        var smallQueryCount = _interceptor.AllCommands.Count;
        smallQueryCount.Should().Be(1, "GET /api/work-items with roll-ups is ONE SQL statement");

        smallHttp.Response.Body.Position = 0;
        using var smallDoc = JsonDocument.Parse(await new StreamReader(smallHttp.Response.Body).ReadToEndAsync());
        var smallItems = smallDoc.RootElement.GetProperty("items").EnumerateArray().ToList();
        smallItems.Should().HaveCount(5);
        var smallParentJson = smallItems.Single(i => i.GetProperty("id").GetGuid() == smallParent.Id);
        smallParentJson.GetProperty("childCount").GetInt32().Should().Be(3);
        smallParentJson.GetProperty("childCountByStatus").GetProperty("backlog").GetInt32().Should().Be(1);
        smallParentJson.GetProperty("childCountByStatus").GetProperty("done").GetInt32().Should().Be(2);

        // Now seed 500 items directly in Postgres for speed and query all 500.
        var projectLarge = await NewProjectAsync("LRG");
        var rootIds = new List<Guid>(50);
        await using (var conn = new NpgsqlConnection(CsFor(_schema)))
        {
            await conn.OpenAsync();
            var rank = Rank.First();
            for (var i = 0; i < 50; i++)
            {
                var rid = UuidV7.NewGuid();
                rootIds.Add(rid);
                rank = Rank.Append(rank);
                await using var cmd = new NpgsqlCommand(
                    $$"""
                    INSERT INTO {{_schema}}.work_items
                        ("Id","ProjectId","Key","PreviousKeys","Number","Kind","Status","Title",
                         "Rank","SiblingRank","CreatedAt","UpdatedAt","Version")
                    VALUES
                        (@id,@pid,@key,'{}'::text[],@num,'epic','in_progress',@title,
                         @rank,@rank,now(),now(),1)
                    """, conn);
                cmd.Parameters.AddWithValue("id", rid);
                cmd.Parameters.AddWithValue("pid", projectLarge.Id);
                cmd.Parameters.AddWithValue("key", $"LRG-{i + 1}");
                cmd.Parameters.AddWithValue("num", i + 1);
                cmd.Parameters.AddWithValue("title", $"epic-{i}");
                cmd.Parameters.AddWithValue("rank", rank);
                await cmd.ExecuteNonQueryAsync();
            }

            // 9 children under each of the 50 epics = 450 children → 500 items total.
            var num = 51;
            for (var i = 0; i < 50; i++)
            {
                for (var c = 0; c < 9; c++)
                {
                    rank = Rank.Append(rank);
                    var status = c < 3 ? "backlog" : (c < 6 ? "in_progress" : "done");
                    await using var cmd = new NpgsqlCommand(
                        $$"""
                        INSERT INTO {{_schema}}.work_items
                            ("Id","ProjectId","Key","PreviousKeys","Number","Kind","Status","Title",
                             "ParentId","Rank","SiblingRank","CreatedAt","UpdatedAt","Version")
                        VALUES
                            (@id,@pid,@key,'{}'::text[],@num,'task',@status,@title,
                             @parentId,@rank,@rank,now(),now(),1)
                        """, conn);
                    cmd.Parameters.AddWithValue("id", UuidV7.NewGuid());
                    cmd.Parameters.AddWithValue("pid", projectLarge.Id);
                    cmd.Parameters.AddWithValue("key", $"LRG-{num}");
                    cmd.Parameters.AddWithValue("num", num++);
                    cmd.Parameters.AddWithValue("status", status);
                    cmd.Parameters.AddWithValue("title", $"task-{i}-{c}");
                    cmd.Parameters.AddWithValue("parentId", rootIds[i]);
                    cmd.Parameters.AddWithValue("rank", rank);
                    await cmd.ExecuteNonQueryAsync();
                }
            }
        }

        _interceptor.Reset();
        var largePage = await Service().ListWorkItemsAsync(new WorkItemListQuery
        {
            ProjectId = projectLarge.Id,
            Limit = 500,
        }, null);
        var largeQueryCount = _interceptor.AllCommands.Count;

        largePage.Items.Should().HaveCount(500);
        largeQueryCount.Should().Be(smallQueryCount,
            "AC6: SQL query count must be CONSTANT between 5 items and 500 items (no N+1)");
        largePage.Rollups![rootIds[0]].ChildCount.Should().Be(9);
        largePage.Rollups![rootIds[0]].ChildCountByStatus["backlog"].Should().Be(3);
        largePage.Rollups![rootIds[0]].ChildCountByStatus["in_progress"].Should().Be(3);
        largePage.Rollups![rootIds[0]].ChildCountByStatus["done"].Should().Be(3);
    }
}
