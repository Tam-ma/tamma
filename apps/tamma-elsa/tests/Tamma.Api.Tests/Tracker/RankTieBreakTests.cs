using FluentAssertions;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.PromptStore;
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
/// Story 44-3 AC12 (D13 / Amendment A4) — the compound failure 44-2's
/// <c>(Rank, Key)</c> cursor could not survive: duplicate ranks within a project
/// PLUS a sanctioned <see cref="IWorkItemRepository.RekeyAsync"/> mid-pagination.
/// Moving the secondary sort key and keyset cursor from mutable <c>Key</c> to
/// immutable UUIDv7 <c>Id</c> closes the defect with no schema migration.
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class RankTieBreakTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;

    private DocumentTestData.SchemaRoutingFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private WorkItemRepository _workItems = null!;
    private TrackerPreferenceRepository _preferences = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_tiebreak_test")
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
    }

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    private TrackerService Service() =>
        new(_projects, _workItems, _preferences,
            new InitiatorOnlyTaskAudienceResolver(),
            new StubModeProvider(), _tenantContext);

    private sealed class StubModeProvider : ITammaModeProvider
    {
        public TammaMode Mode => TammaMode.SingleUser;
    }

    [Test]
    public async Task Duplicate_rank_plus_rekey_does_not_dup_or_skip()
    {
        var project = await _projects.CreateAsync(new ProjectEntity
        {
            Key = "TAM",
            Name = "Tie-break test",
            EstimateScale = "not_used",
        });

        var a = await _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = project.Id,
            Kind = "task",
            Status = "backlog",
            Title = "first",
        });
        var b = await _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = project.Id,
            Kind = "task",
            Status = "backlog",
            Title = "second",
        });

        // Collide both items onto the exact same Rank within the project.
        await _workItems.SetRanksAsync(b.Id, a.Rank, null);

        var service = Service();

        // Page 1: fetch exactly one row.
        var page1 = await service.ListWorkItemsAsync(new WorkItemListQuery
        {
            ProjectId = project.Id,
            Limit = 1,
        }, null);
        page1.Items.Should().HaveCount(1);
        page1.NextCursor.Should().NotBeNull();
        var served = page1.Items[0];

        // Sanctioned re-key of the already-served row to a key that sorts
        // AFTER every existing key in the project. Under the old (Rank, Key)
        // cursor, the rekeyed row crosses the cursor boundary and is served a
        // SECOND time on page 2.
        await _workItems.RekeyAsync(served.Id, "ZZZ-999");

        // Page 2: fetch the remainder using page 1's cursor.
        var page2 = await service.ListWorkItemsAsync(new WorkItemListQuery
        {
            ProjectId = project.Id,
            Cursor = page1.NextCursor,
            Limit = 10,
        }, null);

        var allSeenIds = page1.Items.Select(i => i.Id)
            .Concat(page2.Items.Select(i => i.Id))
            .ToList();

        allSeenIds.Should().OnlyHaveUniqueItems(
            "rekeying an already-served row across a duplicate-rank tie must never duplicate it on the next page");
        allSeenIds.Should().BeEquivalentTo([a.Id, b.Id],
            "every row in the project must be visited exactly once with no skip and no duplicate");
    }

    [Test]
    public async Task Legacy_rank_key_cursor_is_rejected_with_INVALID_CURSOR()
    {
        // D13 cursor compatibility: pre-44-3 cursors carried a work-item Key
        // ("TAM-1") as the second field instead of a Guid. Reject loud as
        // TRACKER.INVALID_CURSOR rather than silently restarting at page 1.
        var legacyCursor = Convert.ToBase64String(
                System.Text.Encoding.UTF8.GetBytes("V\u001FTAM-1"))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var act = () => Service().ListWorkItemsAsync(new WorkItemListQuery
        {
            Cursor = legacyCursor,
            Limit = 10,
        }, null);

        (await act.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("TRACKER.INVALID_CURSOR");
    }
}
