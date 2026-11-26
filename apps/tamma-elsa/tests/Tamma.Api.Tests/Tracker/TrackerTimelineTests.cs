using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Tracker;
using Tamma.Api.Tests.Documents;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-5 AC7 (D7) — <c>GET /api/work-items/{id}/timeline</c>:
/// - Test 9: Interleaves tracker (<c>WORKITEM.*</c>) and foreign Epic 39
///   (<c>DOCUMENT.*</c>, <c>APPROVAL.*</c>, <c>ESCALATION.*</c>) events sharing
///   the same <c>tags.issueId</c>, in <see cref="DomainEvent.SequenceNumber"/> order
/// - Test 10: Cursor pages on <see cref="DomainEvent.SequenceNumber"/>, never
///   <c>CreatedAt</c> (immune to same-millisecond timestamp collisions)
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class TrackerTimelineTests
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
    private EventRepository _eventRepo = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_timeline_test")
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
                           {_schema}.tracker_preferences, {_schema}.domain_events CASCADE;
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

    private static async Task<(int Status, JsonElement Body)> ExecGetTimeline(
        Guid id, long? cursor, int? limit, ITrackerService tracker)
    {
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var result = await TrackerEndpoints.GetTimeline(id, cursor, limit, tracker);
        await result.ExecuteAsync(http);
        http.Response.Body.Position = 0;
        var raw = await new StreamReader(http.Response.Body).ReadToEndAsync();
        return (http.Response.StatusCode, JsonDocument.Parse(raw).RootElement.Clone());
    }

    [Test]
    public async Task Interleaves_document_and_tracker_events()
    {
        var tracker = MakeTracker();
        var project = await tracker.CreateProjectAsync(
            new CreateProjectRequest("TAM", "Tamma", null, null, null), null);
        var item = await tracker.CreateWorkItemAsync(
            new CreateWorkItemRequest(
                ProjectId: project.Id, Title: "Payoff item", Kind: "task",
                Status: null, Priority: null, IssueType: null, Description: null,
                ParentId: null, IterationId: null, AssigneeUserId: null, Estimate: null, ExternalRef: null),
            null);
        var unrelated = await tracker.CreateWorkItemAsync(
            new CreateWorkItemRequest(
                ProjectId: project.Id, Title: "Other item", Kind: "task",
                Status: null, Priority: null, IssueType: null, Description: null,
                ParentId: null, IterationId: null, AssigneeUserId: null, Estimate: null, ExternalRef: null),
            null);

        // Seed foreign Epic 39 workflow events carrying the SAME tags.issueId join key.
        var tagsJson = JsonSerializer.Serialize(new { issueId = item.Key, tenantId = _tenantId.ToString() });
        await _eventRepo.AppendAsync(new DomainEvent
        {
            Type = "DOCUMENT.PRODUCED",
            TenantId = _tenantId,
            Tags = tagsJson,
            Metadata = "{}",
            Data = """{"documentType":"findings","revision":1}""",
        });
        await _eventRepo.AppendAsync(new DomainEvent
        {
            Type = "APPROVAL.REQUESTED",
            TenantId = _tenantId,
            Tags = tagsJson,
            Metadata = "{}",
            Data = """{"decisionSessionId":"sess-1"}""",
        });
        await _eventRepo.AppendAsync(new DomainEvent
        {
            Type = "ESCALATION.TRIGGERED",
            TenantId = _tenantId,
            Tags = tagsJson,
            Metadata = "{}",
            Data = """{"reason":"timeout"}""",
        });
        // Followed by another tracker mutation on the same work item.
        await tracker.SetWorkItemStatusAsync(item.Id, "in_progress", null);

        var (status, body) = await ExecGetTimeline(item.Id, cursor: null, limit: 50, tracker);
        status.Should().Be(StatusCodes.Status200OK);
        body.GetProperty("workItemId").GetGuid().Should().Be(item.Id);
        body.GetProperty("issueId").GetString().Should().Be(item.Key);
        body.GetProperty("hasMore").GetBoolean().Should().BeFalse();

        var events = body.GetProperty("events").EnumerateArray().ToList();
        events.Select(e => e.GetProperty("type").GetString()).Should().Equal(
            [
                WorkItemEvents.Created,
                "DOCUMENT.PRODUCED",
                "APPROVAL.REQUESTED",
                "ESCALATION.TRIGGERED",
                WorkItemEvents.StatusChanged,
            ],
            "AC7 / D7: timeline must interleave tracker and foreign Epic 39 families in SequenceNumber order, excluding unrelated items");

        // Strictly increasing SequenceNumbers, and unrelated item's events excluded.
        var seqs = events.Select(e => e.GetProperty("sequenceNumber").GetInt64()).ToList();
        seqs.Should().BeInAscendingOrder();
        seqs.Distinct().Should().HaveCount(seqs.Count);
        events.Select(e => e.GetProperty("tags").TryGetProperty("issueId", out var idProp) ? idProp.GetString() : null)
            .Should().NotContain(unrelated.Key);
    }

    [Test]
    public async Task Cursor_is_sequence_number()
    {
        var tracker = MakeTracker();
        var project = await _projects.CreateAsync(new ProjectEntity { Key = "TAM", Name = "Tamma" });
        var item = await _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = project.Id,
            Kind = "task",
            Status = "backlog",
            Title = "Same-millisecond timeline",
        });

        // Insert 5 rows with the EXACT SAME CreatedAt timestamp so CreatedAt-based
        // paging would collide, while SequenceNumber paging stays lossless.
        var identicalTimestamp = new DateTime(2026, 11, 26, 12, 0, 0, DateTimeKind.Utc);
        await using (var conn = new NpgsqlConnection(CsFor(_schema)))
        {
            await conn.OpenAsync();
            for (var i = 1; i <= 5; i++)
            {
                await using var cmd = new NpgsqlCommand(
                    $$"""
                    INSERT INTO {{_schema}}.domain_events ("Id", "Type", "TenantId", "IssueNumber", "Tags", "Metadata", "Data", "CreatedAt")
                    VALUES (@id, @type, @tenantId, NULL, @tags::jsonb, '{}'::jsonb, @data::jsonb, @createdAt);
                    """, conn);
                cmd.Parameters.AddWithValue("id", Guid.NewGuid());
                cmd.Parameters.AddWithValue("type", $"WORKITEM.STEP_{i}.SUCCESS");
                cmd.Parameters.AddWithValue("tenantId", _tenantId);
                cmd.Parameters.AddWithValue("tags", JsonSerializer.Serialize(new { issueId = item.Key }));
                cmd.Parameters.AddWithValue("data", JsonSerializer.Serialize(new { step = i }));
                cmd.Parameters.AddWithValue("createdAt", identicalTimestamp);
                await cmd.ExecuteNonQueryAsync();
            }
        }

        // Page 2 at a time using SequenceNumber cursor.
        var seenTypes = new List<string>();
        var seenSeqs = new List<long>();
        long? cursor = null;
        var pages = 0;

        while (true)
        {
            pages++;
            var (status, body) = await ExecGetTimeline(item.Id, cursor, limit: 2, tracker);
            status.Should().Be(StatusCodes.Status200OK);

            foreach (var ev in body.GetProperty("events").EnumerateArray())
            {
                seenTypes.Add(ev.GetProperty("type").GetString()!);
                seenSeqs.Add(ev.GetProperty("sequenceNumber").GetInt64());
            }

            if (!body.GetProperty("hasMore").GetBoolean())
            {
                body.GetProperty("nextCursor").ValueKind.Should().Be(JsonValueKind.Null);
                break;
            }

            cursor = body.GetProperty("nextCursor").GetInt64();
            pages.Should().BeLessThan(10, "pagination must terminate");
        }

        pages.Should().Be(3);
        seenTypes.Should().Equal(
            [
                "WORKITEM.STEP_1.SUCCESS",
                "WORKITEM.STEP_2.SUCCESS",
                "WORKITEM.STEP_3.SUCCESS",
                "WORKITEM.STEP_4.SUCCESS",
                "WORKITEM.STEP_5.SUCCESS",
            ],
            "AC7 / D7: SequenceNumber cursor must page same-millisecond rows with zero skips and zero duplicates");
        seenSeqs.Should().BeInAscendingOrder();
        seenSeqs.Distinct().Should().HaveCount(5);
    }

    private sealed class FixedModeProvider(TammaMode mode) : ITammaModeProvider
    {
        public TammaMode Mode { get; } = mode;
    }
}
