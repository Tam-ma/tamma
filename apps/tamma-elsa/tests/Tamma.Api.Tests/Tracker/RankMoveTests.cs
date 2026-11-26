using System.Data.Common;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Tracker;
using Tamma.Api.Tests.Documents;
using Tamma.Core;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-3 AC3 / D3 — neighbour-addressed backlog moves:
/// - Writes EXACTLY ONE SQL <c>UPDATE</c> statement and touches no other row's <c>Rank</c>
/// - <c>(null, x)</c>, <c>(x, null)</c>, <c>(null, null)</c>, and <c>(a, b)</c> all defined
/// - 1,000 random moves preserve exact SQL <c>(Rank, Id)</c> order against in-memory intent
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class RankMoveTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;

    private SqlCountingInterceptor _interceptor = null!;
    private CountingTenantDbContextFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private WorkItemRepository _workItems = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_move_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _baseConnectionString = _postgres.GetConnectionString();

        _tenantId = Guid.NewGuid();
        _schema = TenantNaming.SchemaName(_tenantId);
        await new EfTenantDbMigrator().MigrateTenantAppAsync(CsFor(_schema));

        _interceptor = new SqlCountingInterceptor();
        _factory = new CountingTenantDbContextFactory(_baseConnectionString, _tenantId, _schema, _interceptor);
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

    private TrackerHierarchyService Hierarchy() => new(_workItems, _tenantContext);

    private Task<ProjectEntity> NewProjectAsync(string key = "TAM") =>
        _projects.CreateAsync(new ProjectEntity { Key = key, Name = key, EstimateScale = "not_used" });

    private Task<WorkItemEntity> NewItemAsync(Guid projectId, string title) =>
        _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = projectId,
            Kind = "task",
            Status = "backlog",
            Title = title,
        });

    [Test]
    public async Task Move_writes_exactly_one_row()
    {
        var project = await NewProjectAsync();
        var a = await NewItemAsync(project.Id, "A");
        var b = await NewItemAsync(project.Id, "B");
        var c = await NewItemAsync(project.Id, "C");
        var d = await NewItemAsync(project.Id, "D");

        var ranksBefore = new Dictionary<Guid, string>
        {
            [a.Id] = a.Rank,
            [b.Id] = b.Rank,
            [c.Id] = c.Rank,
            [d.Id] = d.Rank,
        };

        _interceptor.Reset();
        var ctx = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var result = await TrackerEndpoints.MoveWorkItem(
            d.Id, new MoveWorkItemRequest(AfterId: a.Id, BeforeId: b.Id), Hierarchy(), ctx);
        await result.ExecuteAsync(ctx);

        ctx.Response.StatusCode.Should().Be(StatusCodes.Status200OK);
        _interceptor.UpdateCommands.Should().HaveCount(1,
            "AC3: dragging a card MUST execute exactly ONE SQL UPDATE statement");

        // Verify NO other row's Rank changed and SQL order is now A, D, B, C.
        var ordered = await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 10 });
        ordered.Select(w => w.Id).Should().Equal(a.Id, d.Id, b.Id, c.Id);
        ordered.Single(w => w.Id == a.Id).Rank.Should().Be(ranksBefore[a.Id]);
        ordered.Single(w => w.Id == b.Id).Rank.Should().Be(ranksBefore[b.Id]);
        ordered.Single(w => w.Id == c.Id).Rank.Should().Be(ranksBefore[c.Id]);
        ordered.Single(w => w.Id == d.Id).Rank.Should().NotBe(ranksBefore[d.Id]);
    }

    [Test]
    public async Task Move_to_ends_and_between_are_all_defined()
    {
        var project = await NewProjectAsync();
        var a = await NewItemAsync(project.Id, "A");
        var b = await NewItemAsync(project.Id, "B");
        var c = await NewItemAsync(project.Id, "C");

        // (null, a) — move C before A -> [C, A, B]
        await Hierarchy().MoveAsync(c.Id, afterId: null, beforeId: a.Id, ifMatchVersion: null);
        (await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 10 }))
            .Select(w => w.Id).Should().Equal(c.Id, a.Id, b.Id);

        // (b, null) — move C after B -> [A, B, C]
        await Hierarchy().MoveAsync(c.Id, afterId: b.Id, beforeId: null, ifMatchVersion: null);
        (await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 10 }))
            .Select(w => w.Id).Should().Equal(a.Id, b.Id, c.Id);

        // (null, null) — move A to the end -> [B, C, A]
        await Hierarchy().MoveAsync(a.Id, afterId: null, beforeId: null, ifMatchVersion: null);
        (await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 10 }))
            .Select(w => w.Id).Should().Equal(b.Id, c.Id, a.Id);

        // (b, c) — move A between B and C -> [B, A, C]
        await Hierarchy().MoveAsync(a.Id, afterId: b.Id, beforeId: c.Id, ifMatchVersion: null);
        (await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 10 }))
            .Select(w => w.Id).Should().Equal(b.Id, a.Id, c.Id);

        // Stale If-Match returns TRACKER.CONCURRENCY_CONFLICT.
        var stale = () => Hierarchy().MoveAsync(a.Id, afterId: null, beforeId: null, ifMatchVersion: 1);
        (await stale.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("TRACKER.CONCURRENCY_CONFLICT");
    }

    [Test]
    public async Task Order_survives_a_thousand_random_moves()
    {
        var project = await NewProjectAsync();
        const int count = 15;
        var expectedOrder = new List<Guid>(count);
        for (var i = 0; i < count; i++)
        {
            var item = await NewItemAsync(project.Id, $"item-{i:D2}");
            expectedOrder.Add(item.Id);
        }

        var rng = new Random(4403);
        var hierarchy = Hierarchy();

        for (var step = 0; step < 1000; step++)
        {
            var fromIdx = rng.Next(count);
            var itemId = expectedOrder[fromIdx];
            expectedOrder.RemoveAt(fromIdx);

            var toIdx = rng.Next(count); // 0 .. count-1 in the (count-1)-sized list
            Guid? afterId = toIdx > 0 ? expectedOrder[toIdx - 1] : null;
            Guid? beforeId = toIdx < expectedOrder.Count ? expectedOrder[toIdx] : null;

            await hierarchy.MoveAsync(itemId, afterId, beforeId, ifMatchVersion: null);
            expectedOrder.Insert(toIdx, itemId);
        }

        var actual = await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 100 });
        actual.Select(w => w.Id).Should().Equal(expectedOrder,
            "SQL COLLATE \"C\" ORDER BY Rank must match the exact intended order after 1,000 random moves");
    }

    internal sealed class SqlCountingInterceptor : DbCommandInterceptor
    {
        private readonly List<string> _commands = [];
        private readonly object _lock = new();

        public IReadOnlyList<string> AllCommands
        {
            get { lock (_lock) return _commands.ToList(); }
        }

        public IReadOnlyList<string> UpdateCommands
        {
            get
            {
                lock (_lock)
                    return _commands.Where(c => c.TrimStart().StartsWith("UPDATE", StringComparison.OrdinalIgnoreCase)).ToList();
            }
        }

        public IReadOnlyList<string> SelectCommands
        {
            get
            {
                lock (_lock)
                    return _commands.Where(c =>
                    {
                        var t = c.TrimStart();
                        return t.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
                            || t.StartsWith("WITH", StringComparison.OrdinalIgnoreCase);
                    }).ToList();
            }
        }

        public void Reset()
        {
            lock (_lock) _commands.Clear();
        }

        private void Record(DbCommand command)
        {
            lock (_lock) _commands.Add(command.CommandText);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    internal sealed class CountingTenantDbContextFactory(
        string baseCs, Guid tenantId, string schema, SqlCountingInterceptor interceptor)
        : ITenantDbContextFactory
    {
        public ValueTask<TenantDbContext> CreateAsync(Guid requestedTenantId, CancellationToken ct = default)
        {
            if (requestedTenantId != tenantId)
                throw new InvalidOperationException($"Tenant {requestedTenantId} not reachable.");

            var cs = new NpgsqlConnectionStringBuilder(baseCs) { SearchPath = schema }.ConnectionString;
            var opts = new DbContextOptionsBuilder<TenantDbContext>()
                .UseNpgsql(cs)
                .AddInterceptors(interceptor)
                .Options;
            return ValueTask.FromResult(new TenantDbContext(opts));
        }
    }
}
