using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Endpoints;
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
/// Story 44-4 AC5–AC7 (D4–D6, Amendment A1) — single-statement window-function
/// board projection:
/// - <c>groupBy=status</c> derives every column from <see cref="Enum.GetValues{WorkItemStatus}"/>
///   in exact enum order, including empties (never a hardcoded count or literal list)
/// - Constant ONE SQL statement regardless of column count (2 vs all statuses vs 20+ assignees)
/// - Exact SQL <c>COLLATE "C"</c> rank order inside each column
/// - Per-column limit, <c>totalCount</c>, <c>hasMore</c>, and keyset cursor paging
/// - <c>groupBy=assignee</c> caps at 20 + <c>unassigned</c> + <c>other</c> with cap on the wire
/// - Unknown <c>groupBy</c> returns 400 naming the accepted vocabulary
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class BoardTests
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

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_board_test")
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

    private BoardProjectionService Board() => new(_workItems, _tenantContext);

    private Task<ProjectEntity> NewProjectAsync(string key = "TAM") =>
        _projects.CreateAsync(new ProjectEntity { Key = key, Name = key, EstimateScale = "not_used" });

    private Task<WorkItemEntity> NewItemAsync(
        Guid projectId, string status = "backlog", string? rank = null, Guid? assigneeId = null, string title = "item") =>
        _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = projectId,
            Kind = "task",
            Status = status,
            Rank = rank ?? string.Empty,
            AssigneeUserId = assigneeId,
            Title = title,
        });

    [Test]
    public async Task Status_board_returns_every_status_column_in_enum_order()
    {
        // AC7 / D6 / A1: assert against Enum.GetValues<WorkItemStatus>(), NEVER a literal count.
        var project = await NewProjectAsync();
        await NewItemAsync(project.Id, "in_progress", title: "active card");

        var board = await Board().GetBoardAsync(project.Id, "status", null, null, null, null);
        var expectedWires = Enum.GetValues<WorkItemStatus>().Select(s => s.ToWire()).ToArray();

        board.Columns.Select(c => c.Key).Should().Equal(expectedWires,
            "every WorkItemStatus member must appear in enum order, including empty columns");
        board.Columns.Single(c => c.Key == "in_progress").TotalCount.Should().Be(1);
        board.Columns.Where(c => c.Key != "in_progress")
            .Should().OnlyContain(c => c.TotalCount == 0 && c.Items.Count == 0 && !c.HasMore);
    }

    [Test]
    public async Task One_statement_regardless_of_column_count()
    {
        // AC5 / D4: 2 populated columns vs all status columns vs 25 assignees -> ALWAYS 1 SQL statement.
        var projectTwo = await NewProjectAsync("TWO");
        await NewItemAsync(projectTwo.Id, "backlog", title: "b1");
        await NewItemAsync(projectTwo.Id, "done", title: "d1");

        _interceptor.Reset();
        await Board().GetBoardAsync(projectTwo.Id, "status", null, null, null, 50);
        _interceptor.AllCommands.Should().HaveCount(1, "2-column board must be 1 SQL statement");

        var projectAll = await NewProjectAsync("ALL");
        foreach (var status in Enum.GetValues<WorkItemStatus>())
            await NewItemAsync(projectAll.Id, status.ToWire(), title: $"s-{status}");

        _interceptor.Reset();
        await Board().GetBoardAsync(projectAll.Id, "status", null, null, null, 50);
        _interceptor.AllCommands.Should().HaveCount(1, "full-status board must be 1 SQL statement");

        var projectMany = await NewProjectAsync("MNY");
        for (var i = 0; i < 25; i++)
            await NewItemAsync(projectMany.Id, "ready", assigneeId: Guid.NewGuid(), title: $"a-{i}");

        _interceptor.Reset();
        await Board().GetBoardAsync(projectMany.Id, "assignee", null, null, null, 50);
        _interceptor.AllCommands.Should().HaveCount(1, "25-assignee board must still be 1 SQL statement");
    }

    [Test]
    public async Task Items_are_rank_ordered_within_a_column()
    {
        // Base-62 ordinal order: '9' < 'A' < 'Z' < 'a' < 'z' (COLLATE "C").
        var project = await NewProjectAsync();
        var iLowerA = await NewItemAsync(project.Id, "ready", rank: "a", title: "rank-a");
        var iUpperZ = await NewItemAsync(project.Id, "ready", rank: "Z", title: "rank-Z");
        var iDigit9 = await NewItemAsync(project.Id, "ready", rank: "9", title: "rank-9");
        var iUpperA = await NewItemAsync(project.Id, "ready", rank: "A", title: "rank-A");

        var board = await Board().GetBoardAsync(project.Id, "status", null, null, null, 50);
        var readyCol = board.Columns.Single(c => c.Key == "ready");

        readyCol.Items.Select(i => i.Id).Should().Equal(
            [iDigit9.Id, iUpperA.Id, iUpperZ.Id, iLowerA.Id],
            "items within a column must follow COLLATE \"C\" ordinal rank order");
    }

    [Test]
    public async Task Per_column_limit_and_hasMore_are_correct()
    {
        var project = await NewProjectAsync();
        var seededIds = new List<Guid>(60);
        await using (var conn = new NpgsqlConnection(CsFor(_schema)))
        {
            await conn.OpenAsync();
            var rank = Rank.First();
            for (var i = 1; i <= 60; i++)
            {
                var id = UuidV7.NewGuid();
                seededIds.Add(id);
                rank = Rank.Append(rank);
                await using var cmd = new NpgsqlCommand(
                    $$"""
                    INSERT INTO {{_schema}}.work_items
                        ("Id","ProjectId","Key","PreviousKeys","Number","Kind","Status","Title",
                         "Rank","SiblingRank","CreatedAt","UpdatedAt","Version")
                    VALUES
                        (@id,@pid,@key,'{}'::text[],@num,'task','backlog',@title,
                         @rank,@rank,now(),now(),1)
                    """, conn);
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("pid", project.Id);
                cmd.Parameters.AddWithValue("key", $"TAM-{i}");
                cmd.Parameters.AddWithValue("num", i);
                cmd.Parameters.AddWithValue("title", $"item-{i:D2}");
                cmd.Parameters.AddWithValue("rank", rank);
                await cmd.ExecuteNonQueryAsync();
            }
        }

        var page1 = await Board().GetBoardAsync(project.Id, "status", null, null, null, perColumnLimit: 50);
        var col1 = page1.Columns.Single(c => c.Key == "backlog");
        col1.TotalCount.Should().Be(60);
        col1.Items.Should().HaveCount(50);
        col1.HasMore.Should().BeTrue();
        col1.NextCursor.Should().NotBeNullOrWhiteSpace();

        // Page the remaining 10 items of the column via its keyset cursor.
        var page2 = await Board().GetBoardAsync(
            project.Id, "status", null, null, null, perColumnLimit: 50,
            columnKey: "backlog", cursor: col1.NextCursor);
        var col2 = page2.Columns.Single(c => c.Key == "backlog");
        col2.TotalCount.Should().Be(60);
        col2.Items.Should().HaveCount(10);
        col2.HasMore.Should().BeFalse();
        col2.NextCursor.Should().BeNull();

        col1.Items.Concat(col2.Items).Select(i => i.Id).Should().Equal(seededIds);
    }

    [Test]
    public async Task Assignee_board_caps_and_folds()
    {
        // D6: 30 assignees + unassigned -> top 20 by item count + `unassigned` + `other` (10 folded).
        var project = await NewProjectAsync();
        await NewItemAsync(project.Id, "ready", assigneeId: null, title: "unassigned-1");

        var heavyAssignees = new List<Guid>(20);
        for (var i = 0; i < 20; i++)
        {
            var userId = Guid.NewGuid();
            heavyAssignees.Add(userId);
            await NewItemAsync(project.Id, "ready", assigneeId: userId, title: $"heavy-{i}-1");
            await NewItemAsync(project.Id, "ready", assigneeId: userId, title: $"heavy-{i}-2");
        }

        for (var i = 0; i < 10; i++)
        {
            var userId = Guid.NewGuid();
            await NewItemAsync(project.Id, "ready", assigneeId: userId, title: $"light-{i}");
        }

        var board = await Board().GetBoardAsync(project.Id, "assignee", null, null, null, perColumnLimit: 50);

        board.ColumnCap.Should().Be(BoardProjectionService.DefaultAssigneeColumnCap);
        board.FoldedColumnCount.Should().Be(10);
        board.Columns.Should().HaveCount(BoardProjectionService.DefaultAssigneeColumnCap + 2,
            "20 capped assignees + distinguished 'unassigned' + folded 'other'");
        board.Columns.Should().Contain(c => c.Key == BoardProjectionService.UnassignedKey && c.TotalCount == 1);
        board.Columns.Should().Contain(c => c.Key == BoardProjectionService.OtherKey && c.TotalCount == 10);

        var topAssigneeKeys = board.Columns
            .Where(c => c.Key is not (BoardProjectionService.UnassignedKey or BoardProjectionService.OtherKey))
            .Select(c => Guid.Parse(c.Key))
            .ToList();
        topAssigneeKeys.Should().BeEquivalentTo(heavyAssignees,
            "the top 20 columns by item count must be the 20 assignees with 2 items each");
    }

    [Test]
    public async Task Unknown_groupBy_is_400_naming_the_set()
    {
        var project = await NewProjectAsync();
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };

        var result = await TrackerEndpoints.GetBoard(
            project.Id, "sql; DROP TABLE work_items;--", null, null, null, null, null, null, Board());
        await result.ExecuteAsync(http);

        http.Response.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
        http.Response.Body.Position = 0;
        using var doc = JsonDocument.Parse(await new StreamReader(http.Response.Body).ReadToEndAsync());
        doc.RootElement.GetProperty("code").GetString().Should().Be("TRACKER.UNKNOWN_GROUP_BY");
        var message = doc.RootElement.GetProperty("error").GetString()!;
        foreach (var member in Enum.GetValues<BoardGroupBy>())
            message.Should().Contain(member.ToWire());
    }
}
