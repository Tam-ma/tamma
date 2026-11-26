using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Tracker;
using Tamma.Api.Tests.Documents;
using Tamma.Core.Documents;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-7 AC6 &amp; AC8 (Test 12 — the payoff test):
/// A native work item (<c>TAM-1</c>) selected from the tracker carries
/// <c>WorkItem.Key == "TAM-1"</c>. When a document lifecycle runs against that
/// <c>issueId</c>, <see cref="DocumentInstance.IssueId"/> equals <c>"TAM-1"</c>,
/// idempotent loop status write-back emits <c>WORKITEM.STATUS_CHANGED.SUCCESS</c>
/// with <c>Data.actor == "loop"</c> once (replaying is a no-op), and
/// <c>GET /api/work-items/{id}/timeline</c> interleaves the tracker and
/// <c>DOCUMENT.*</c> rows with ZERO adapter.
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class IssueIdJoinTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;

    private RankMoveTests.CountingTenantDbContextFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private WorkItemRepository _workItems = null!;
    private TrackerPreferenceRepository _preferences = null!;
    private DocumentInstanceRepository _documents = null!;
    private EventRepository _eventRepo = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_issueid_join_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _baseConnectionString = _postgres.GetConnectionString();

        _tenantId = Guid.NewGuid();
        _schema = TenantNaming.SchemaName(_tenantId);
        await new EfTenantDbMigrator().MigrateTenantAppAsync(CsFor(_schema));

        _factory = new RankMoveTests.CountingTenantDbContextFactory(
            _baseConnectionString, _tenantId, _schema, new RankMoveTests.SqlCountingInterceptor());
        _tenantContext = new DocumentTestData.FakeTenantContext(_tenantId);
        _projects = new ProjectRepository(_factory, _tenantContext);
        _workItems = new WorkItemRepository(_factory, _tenantContext);
        _preferences = new TrackerPreferenceRepository(_factory, _tenantContext);
        _documents = new DocumentInstanceRepository(_factory, _tenantContext);
        _eventRepo = new EventRepository(_factory, _tenantContext);
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
                           {_schema}.tracker_preferences, {_schema}.document_instances,
                           {_schema}.domain_events CASCADE;
            """, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    private TrackerService MakeTracker() => new(
        _projects,
        _workItems,
        _preferences,
        new InitiatorOnlyTaskAudienceResolver(),
        new FixedModeProvider(TammaMode.SingleUser),
        _tenantContext,
        new TrackerEventsService(_eventRepo, _tenantContext));

    [Test]
    public async Task Native_item_documents_attach_to_its_key()
    {
        var tracker = MakeTracker();

        // 1. Create a native project opted into automationMode = "auto" (default is "off").
        var defaultProj = await tracker.CreateProjectAsync(
            new CreateProjectRequest("DEF", "Default Off", null, null, null), null);
        defaultProj.AutomationMode.Should().Be("off", "AC7/D6: AutomationMode must default to 'off'");

        var project = await tracker.CreateProjectAsync(
            new CreateProjectRequest("TAM", "Tamma Core", null, null, "fibonacci", AutomationMode: "auto"), null);
        project.AutomationMode.Should().Be("auto");

        // 2. Create a ready native work item -> minted key TAM-1.
        var created = await tracker.CreateWorkItemAsync(
            new CreateWorkItemRequest(
                ProjectId: project.Id, Title: "End-to-end native join item", Kind: "task",
                Status: "ready", Priority: "high", IssueType: null, Description: null,
                ParentId: null, IterationId: null, AssigneeUserId: null, Estimate: 5m, ExternalRef: null),
            null);
        created.Key.Should().Be("TAM-1");

        // 3. Construct the unified WorkItem carrier as TrackerIntakeSource emits it.
        var candidate = new WorkItem
        {
            Key = created.Key,
            Source = WorkIntakeSourceKind.Tracker,
            Number = 0,
            Title = created.Title,
            Type = "work-item",
            Priority = created.Priority ?? "normal",
            Rank = created.Rank,
        };
        var roundTripped = JsonSerializer.Deserialize<WorkItem>(JsonSerializer.Serialize(candidate))!;
        roundTripped.Key.Should().Be("TAM-1");
        roundTripped.Source.Should().Be(WorkIntakeSourceKind.Tracker);
        roundTripped.Number.Should().Be(0);

        // 4. Produce a lifecycle document keyed on WorkItem.Key (zero adapter!).
        var doc = await _documents.InsertAsync(
            _tenantId,
            DocumentTestData.DecompositionEnvelope(roundTripped.Key),
            correlatingEventId: null,
            CancellationToken.None);
        doc.IssueId.Should().Be("TAM-1",
            "AC6: DocumentInstance.IssueId must equal WorkItem.Key for native tracker items");

        await _eventRepo.AppendAsync(new DomainEvent
        {
            Type = "DOCUMENT.PRODUCED",
            TenantId = _tenantId,
            IssueNumber = null,
            Tags = JsonSerializer.Serialize(new { issueId = roundTripped.Key, tenantId = _tenantId.ToString() }),
            Metadata = "{}",
            Data = JsonSerializer.Serialize(new { documentId = doc.Id, documentType = doc.DocumentType }),
        });

        // 5. Loop status write-back (ready -> in_progress with actor="loop"), replayed TWICE.
        var first = (await tracker.SetWorkItemStatusAsync(created.Id, "in_progress", null, actor: "loop"))!;
        var second = (await tracker.SetWorkItemStatusAsync(created.Id, "in_progress", null, actor: "loop"))!;
        second.Version.Should().Be(first.Version,
            "AC8 / D7: replaying status write-back to the status already held is an idempotent no-op");

        // 6. Query GET /api/work-items/{id}/timeline -> WORKITEM.* and DOCUMENT.* interleave natively!
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var result = await TrackerEndpoints.GetTimeline(created.Id, cursor: null, limit: 50, tracker);
        await result.ExecuteAsync(http);
        http.Response.Body.Position = 0;
        var body = JsonDocument.Parse(await new StreamReader(http.Response.Body).ReadToEndAsync()).RootElement;

        http.Response.StatusCode.Should().Be(StatusCodes.Status200OK);
        body.GetProperty("issueId").GetString().Should().Be("TAM-1");

        var timelineEvents = body.GetProperty("events").EnumerateArray().ToList();
        timelineEvents.Select(e => e.GetProperty("type").GetString()).Should().Equal(
            [
                WorkItemEvents.Created,
                "DOCUMENT.PRODUCED",
                WorkItemEvents.StatusChanged,
            ],
            "AC6 & AC8: timeline interleaves tracker and DOCUMENT.* events on TAM-1 with exactly ONE STATUS_CHANGED after replay");

        var statusEvtData = timelineEvents[2].GetProperty("data");
        statusEvtData.GetProperty("from").GetString().Should().Be("ready");
        statusEvtData.GetProperty("to").GetString().Should().Be("in_progress");
        statusEvtData.GetProperty("actor").GetString().Should().Be("loop");
    }

    private sealed class FixedModeProvider(TammaMode mode) : ITammaModeProvider
    {
        public TammaMode Mode { get; } = mode;
    }
}
