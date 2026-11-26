using FluentAssertions;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Services.Tracker;
using Tamma.Api.Tests.Documents;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-4 AC8 — SQL-computed iteration summary returning committed count,
/// per-<see cref="WorkItemStatusCategory"/> counts and <c>Estimate</c> sums
/// (derived via <see cref="WorkItemStatusCategoryExtensions.Category"/>, never
/// a hardcoded status set), <c>EstimateScale</c>, and <c>CapacityPoints</c> in
/// one constant-count SQL query.
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class SummaryTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;

    private RankMoveTests.SqlCountingInterceptor _interceptor = null!;
    private RankMoveTests.CountingTenantDbContextFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private IterationRepository _iterations = null!;
    private WorkItemRepository _workItems = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_summary_test")
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
        _interceptor.Reset();
    }

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    private IterationService Service() => new(_projects, _iterations, _workItems, _tenantContext);

    [Test]
    public async Task Counts_and_estimate_sums_are_sql_computed()
    {
        var project = await _projects.CreateAsync(new ProjectEntity
        {
            Key = "TAM",
            Name = "Summary project",
            EstimateScale = "fibonacci",
        });
        var iter = await Service().CreateAsync(
            project.Id, new CreateIterationRequest("Sprint 1", null, null, "active", 21m));

        // Seed items spanning ALL status categories, including all three `started`
        // statuses (`in_progress`, `in_review`, `blocked`) to prove WorkItemStatus.Category()
        // aggregates them together.
        var items = new (string Status, decimal? Estimate)[]
        {
            ("backlog", 2m),
            ("ready", 3m),
            ("in_progress", 5m),
            ("in_review", 3m),
            ("blocked", 2m),
            ("done", 8m),
            ("cancelled", 1m),
            ("triage", null),
        };
        foreach (var (status, est) in items)
        {
            await _workItems.CreateAsync(new WorkItemEntity
            {
                ProjectId = project.Id,
                Kind = "task",
                Status = status,
                Title = $"item-{status}",
                Estimate = est,
                IterationId = iter.Id,
            });
        }

        _interceptor.Reset();
        var summary = await Service().GetSummaryAsync(iter.Id);
        var queryCount = _interceptor.AllCommands.Count;

        queryCount.Should().Be(1, "AC8: iteration summary must be computed in ONE SQL statement");
        summary.Should().NotBeNull();
        summary!.EstimateScale.Should().Be("fibonacci");
        summary.CapacityPoints.Should().Be(21m);
        summary.CommittedCount.Should().Be(8);
        summary.TotalEstimate.Should().Be(24m);

        var byCat = summary.ByCategory.ToDictionary(c => c.Category);
        byCat[WorkItemStatusCategory.Triage.ToWire()].Should().BeEquivalentTo(new { Count = 1, EstimateSum = 0m });
        byCat[WorkItemStatusCategory.Backlog.ToWire()].Should().BeEquivalentTo(new { Count = 1, EstimateSum = 2m });
        byCat[WorkItemStatusCategory.Unstarted.ToWire()].Should().BeEquivalentTo(new { Count = 1, EstimateSum = 3m });
        byCat[WorkItemStatusCategory.Started.ToWire()].Should().BeEquivalentTo(new { Count = 3, EstimateSum = 10m });
        byCat[WorkItemStatusCategory.Completed.ToWire()].Should().BeEquivalentTo(new { Count = 1, EstimateSum = 8m });
        byCat[WorkItemStatusCategory.Cancelled.ToWire()].Should().BeEquivalentTo(new { Count = 1, EstimateSum = 1m });
    }
}
