using System.Reflection;
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
using Tamma.Core.Documents;
using Tamma.Core.Documents.Types;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-3 AC7, AC8, AC9 (D6–D11) — the <c>BacklogOrdering</c> apply seam:
/// - Rejects non-accepted documents with <c>409 DOCUMENT_NOT_ACCEPTED</c>
/// - Rejects wrong document types with <c>409 DOCUMENT_NOT_BACKLOG_ORDERING</c>
/// - Rejects missing documents with <c>404 TRACKER.DOCUMENT_NOT_FOUND</c>
/// - Orders by <see cref="BacklogItem.Rank"/> (1-based int), NEVER array position (D6b#3)
/// - Round-trips free-text <c>value</c>/<c>effort</c> strings like <c>"high"</c>/<c>"1d"</c> (D6b#2)
/// - Reflection guard asserting NO type in <c>Tamma.Api.Services.Tracker</c> redeclares
///   <c>BacklogItem</c>'s entry shape (AC9)
/// - Partial application (<c>applied</c> / <c>not-found</c> / <c>wrong-project</c>) in ONE bulk UPDATE
/// - Unreferenced items appended after applied set preserving relative order; second apply is a 0-UPDATE no-op
/// - Emits NO <c>DOCUMENT.*</c> event and does NOT mutate <c>document_instances</c> (D11)
///
/// <para><b>Cross-Story Contract C2 note (recorded deliberately):</b>
/// <see cref="BacklogItem.ItemId"/> is unconstrained by 41-1b's validator; Story 41-3
/// is still drafted and has not yet pinned whether <c>itemId</c> carries work-item keys.
/// Until 41-3 fixes C2, the happy-path key resolution below is verified against fixtures
/// authored by this story using work-item keys (<c>TAM-1</c>, etc.).</para>
///
/// <para>REQUIRES DOCKER (except the pure reflection test).</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class ApplyOrderingTests
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
    private DocumentInstanceRepository _documents = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_apply_ordering_test")
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
        _documents = new DocumentInstanceRepository(_factory, _tenantContext);
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
        _interceptor.Reset();
    }

    private string CsFor(string schema) =>
        new NpgsqlConnectionStringBuilder(_baseConnectionString) { SearchPath = schema }.ConnectionString;

    private OrderingApplyService ApplyService() => new(
        _projects,
        _workItems,
        new DocumentBacklogOrderingReader(_documents),
        _tenantContext);

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

    private async Task<DocumentInstance> SeedBacklogOrderingDocAsync(
        string bodyJson, DocumentInstanceStatus status = DocumentInstanceStatus.Accepted)
    {
        var draft = DocumentEnvelope.CreateDraft(
            DocumentTypeKey.BacklogOrdering,
            1,
            "backlog:tam:main",
            "corr-apply-test",
            DocumentProducer.Create("product_owner", "prioritize-backlog", "backlog-prioritization"),
            DocumentTestData.Payload(bodyJson));

        var inserted = await _documents.InsertAsync(_tenantId, draft, correlatingEventId: null, CancellationToken.None);
        if (status != DocumentInstanceStatus.Draft)
            inserted = await _documents.SetStatusAsync(_tenantId, inserted.Id, status, correlatingEventId: null, CancellationToken.None);
        return inserted;
    }

    private static async Task<(int Status, JsonElement Body)> ExecApply(
        Guid projectId, Guid documentId, OrderingApplyService service)
    {
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var result = await TrackerEndpoints.ApplyOrdering(
            projectId, new ApplyOrderingRequest(documentId), service, CancellationToken.None);
        await result.ExecuteAsync(http);
        http.Response.Body.Position = 0;
        var raw = await new StreamReader(http.Response.Body).ReadToEndAsync();
        return (http.Response.StatusCode, JsonDocument.Parse(raw).RootElement.Clone());
    }

    [Test]
    public async Task Rejects_non_accepted_document_with_409()
    {
        var project = await NewProjectAsync();
        var item = await NewItemAsync(project.Id, "A");
        var body = $$"""
            {
              "items": [
                { "itemId": "{{item.Key}}", "rank": 1, "rationale": "Top priority.", "value": "high", "effort": "1d" }
              ]
            }
            """;

        foreach (var status in new[] { DocumentInstanceStatus.Draft, DocumentInstanceStatus.InReview, DocumentInstanceStatus.Rejected })
        {
            var doc = await SeedBacklogOrderingDocAsync(body, status);
            var (httpStatus, json) = await ExecApply(project.Id, doc.Id, ApplyService());
            httpStatus.Should().Be(StatusCodes.Status409Conflict,
                $"status '{status}' is not accepted and must be rejected with 409");
            json.GetProperty("code").GetString().Should().Be("DOCUMENT_NOT_ACCEPTED");
        }
    }

    [Test]
    public async Task Rejects_wrong_document_type_with_409()
    {
        var project = await NewProjectAsync();
        var decompEnvelope = DocumentTestData.DecompositionEnvelope("TAM-1");
        var inserted = await _documents.InsertAsync(_tenantId, decompEnvelope, null, CancellationToken.None);
        await _documents.SetStatusAsync(_tenantId, inserted.Id, DocumentInstanceStatus.Accepted, null, CancellationToken.None);

        var (status, json) = await ExecApply(project.Id, inserted.Id, ApplyService());
        status.Should().Be(StatusCodes.Status409Conflict);
        json.GetProperty("code").GetString().Should().Be("DOCUMENT_NOT_BACKLOG_ORDERING");
    }

    [Test]
    public async Task Rejects_missing_document_with_404()
    {
        var project = await NewProjectAsync();
        var (status, json) = await ExecApply(project.Id, Guid.NewGuid(), ApplyService());
        status.Should().Be(StatusCodes.Status404NotFound);
        json.GetProperty("code").GetString().Should().Be("TRACKER.DOCUMENT_NOT_FOUND");
    }

    [Test]
    public async Task Applies_shuffled_items_by_BacklogItem_Rank_not_array_position_and_handles_free_text_estimates()
    {
        // D6b#2 + D6b#3:
        // - `items[]` is intentionally SHUFFLED relative to `rank` (array order: 3, 1, 2).
        // - `value` and `effort` carry free-text strings ("high", "1d", "medium", "2d", "low", "3d")
        //   from BacklogOrderingDocumentType's shipped example (never decimal?).
        var project = await NewProjectAsync();
        var a = await NewItemAsync(project.Id, "A"); // TAM-1
        var b = await NewItemAsync(project.Id, "B"); // TAM-2
        var c = await NewItemAsync(project.Id, "C"); // TAM-3

        var shuffledBody = $$"""
            {
              "items": [
                { "itemId": "{{a.Key}}", "rank": 3, "rationale": "Third overall.", "value": "low", "effort": "3d" },
                { "itemId": "{{c.Key}}", "rank": 1, "rationale": "Unblocks two teams; small effort.", "value": "high", "effort": "1d" },
                { "itemId": "{{b.Key}}", "rank": 2, "rationale": "Customer-visible defect.", "value": "medium", "effort": "2d" }
              ]
            }
            """;

        var doc = await SeedBacklogOrderingDocAsync(shuffledBody, DocumentInstanceStatus.Accepted);
        var (status, json) = await ExecApply(project.Id, doc.Id, ApplyService());

        status.Should().Be(StatusCodes.Status200OK);
        json.GetProperty("appliedCount").GetInt32().Should().Be(3);

        var ordered = await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 10 });
        ordered.Select(w => w.Key).Should().Equal([c.Key, b.Key, a.Key],
            "D6b#3: tracker order MUST follow BacklogItem.Rank (1, 2, 3), NEVER items[] array position");
    }

    [Test]
    public async Task Partial_application_returns_applied_not_found_and_wrong_project_in_one_bulk_update()
    {
        var projectA = await NewProjectAsync("AAA");
        var projectB = await NewProjectAsync("BBB");

        var a1 = await NewItemAsync(projectA.Id, "A1");
        var a2 = await NewItemAsync(projectA.Id, "A2");
        var b1 = await NewItemAsync(projectB.Id, "B1");

        // Rekey a2 so we also confirm PreviousKeys lookup works seamlessly (44-0 AC8).
        var a2OldKey = a2.Key;
        await _workItems.RekeyAsync(a2.Id, "OLD-2");

        var body = $$"""
            {
              "items": [
                { "itemId": "{{a2OldKey}}", "rank": 1, "rationale": "Previously-keyed item first.", "value": "high", "effort": "1d" },
                { "itemId": "GHOST-99",     "rank": 2, "rationale": "Does not exist.",              "value": "low",  "effort": "1d" },
                { "itemId": "{{b1.Key}}",   "rank": 3, "rationale": "Wrong project.",               "value": "med",  "effort": "2d" },
                { "itemId": "{{a1.Key}}",   "rank": 4, "rationale": "Second resolvable.",           "value": "med",  "effort": "2d" }
              ]
            }
            """;
        var doc = await SeedBacklogOrderingDocAsync(body, DocumentInstanceStatus.Accepted);

        _interceptor.Reset();
        var response = await ApplyService().ApplyAsync(projectA.Id, doc.Id, CancellationToken.None);

        response.AppliedCount.Should().Be(2);
        response.NotFoundCount.Should().Be(1);
        response.WrongProjectCount.Should().Be(1);
        response.Outcomes.Select(o => (o.ItemId, o.Outcome)).Should().Equal(
            (a2OldKey, OrderingApplyService.OutcomeApplied),
            ("GHOST-99", OrderingApplyService.OutcomeNotFound),
            (b1.Key, OrderingApplyService.OutcomeWrongProject),
            (a1.Key, OrderingApplyService.OutcomeApplied));

        _interceptor.UpdateCommands.Should().HaveCount(1,
            "AC7: all rank changes must be written in ONE bulk UPDATE inside ONE transaction");

        var ordered = await _workItems.ListAsync(new WorkItemQuery { ProjectId = projectA.Id, Limit = 10 });
        ordered.Select(w => w.Id).Should().Equal(a2.Id, a1.Id);
    }

    [Test]
    public async Task Unreferenced_items_keep_relative_order_after_applied_set_and_second_apply_is_noop()
    {
        var project = await NewProjectAsync();
        var i1 = await NewItemAsync(project.Id, "item-1");
        var i2 = await NewItemAsync(project.Id, "item-2");
        var i3 = await NewItemAsync(project.Id, "item-3");
        var i4 = await NewItemAsync(project.Id, "item-4");
        var i5 = await NewItemAsync(project.Id, "item-5");

        // Document references only i4 (rank 1) and i2 (rank 2).
        // Unreferenced [i1, i3, i5] must be appended AFTER [i4, i2] in their existing relative order.
        var body = $$"""
            {
              "items": [
                { "itemId": "{{i4.Key}}", "rank": 1, "rationale": "First.",  "value": "high", "effort": "1d" },
                { "itemId": "{{i2.Key}}", "rank": 2, "rationale": "Second.", "value": "high", "effort": "2d" }
              ]
            }
            """;
        var doc = await SeedBacklogOrderingDocAsync(body, DocumentInstanceStatus.Accepted);

        await ApplyService().ApplyAsync(project.Id, doc.Id, CancellationToken.None);

        var afterFirst = await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 20 });
        afterFirst.Select(w => w.Id).Should().Equal([i4.Id, i2.Id, i1.Id, i3.Id, i5.Id],
            "AC8/D9: applied set first, unreferenced items appended preserving their relative order");

        // Second apply of the exact same accepted document must be a complete NO-OP (0 UPDATEs, byte-identical rows).
        _interceptor.Reset();
        var secondResponse = await ApplyService().ApplyAsync(project.Id, doc.Id, CancellationToken.None);
        secondResponse.AppliedCount.Should().Be(2);
        _interceptor.UpdateCommands.Should().BeEmpty(
            "AC8/D10: re-applying the same accepted document must perform zero writes");

        var afterSecond = await _workItems.ListAsync(new WorkItemQuery { ProjectId = project.Id, Limit = 20 });
        afterSecond.Select(w => (w.Id, w.Rank, w.Version, w.UpdatedAt))
            .Should().Equal(afterFirst.Select(w => (w.Id, w.Rank, w.Version, w.UpdatedAt)));
    }

    [Test]
    public async Task Apply_emits_no_document_events_and_does_not_mutate_document_row()
    {
        // D11: apply is a tracker operation that READS a document — never mutates
        // document_instances and never emits a DOCUMENT.* event.
        var project = await NewProjectAsync();
        var i1 = await NewItemAsync(project.Id, "item-1");
        var body = $$"""
            {
              "items": [
                { "itemId": "{{i1.Key}}", "rank": 1, "rationale": "Only item.", "value": "high", "effort": "1d" }
              ]
            }
            """;
        var docBefore = await SeedBacklogOrderingDocAsync(body, DocumentInstanceStatus.Accepted);

        await ApplyService().ApplyAsync(project.Id, docBefore.Id, CancellationToken.None);

        var docAfter = await _documents.GetByIdAsync(_tenantId, docBefore.Id, CancellationToken.None);
        docAfter.Should().NotBeNull();
        docAfter!.Status.Should().Be(docBefore.Status);
        docAfter.Revision.Should().Be(docBefore.Revision);
        docAfter.UpdatedAt.Should().Be(docBefore.UpdatedAt);
        DocumentTestData.SameJson(docAfter.BodyJson, docBefore.BodyJson).Should().BeTrue();

        await using var conn = new NpgsqlConnection(CsFor(_schema));
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            $"""SELECT COUNT(*) FROM {_schema}.domain_events WHERE "Type" LIKE 'DOCUMENT.%'""", conn);
        var docEventCount = Convert.ToInt32(await cmd.ExecuteScalarAsync());
        docEventCount.Should().Be(0, "D11: apply seam emits NO DOCUMENT.* events");
    }

    [Test]
    public void No_parallel_BacklogItem_entry_record_exists_in_Tracker_services()
    {
        // AC9 (Amendment A2): no type in Tamma.Api.Services.Tracker may redeclare
        // BacklogItem's shape (itemId / rank / rationale / value / effort). The
        // seam MUST reuse the shipped Tamma.Core.Documents.Types.BacklogItem directly.
        var trackerServiceTypes = typeof(OrderingApplyService).Assembly
            .GetTypes()
            .Where(t => string.Equals(t.Namespace, "Tamma.Api.Services.Tracker", StringComparison.Ordinal))
            .ToList();

        trackerServiceTypes.Should().NotBeEmpty();

        var forbiddenShape = new[] { "ItemId", "Rank", "Rationale", "Value", "Effort" };
        var offenders = trackerServiceTypes
            .Where(t =>
            {
                var propNames = t.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                    .Select(p => p.Name)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                return forbiddenShape.Count(f => propNames.Contains(f)) >= 3;
            })
            .Select(t => t.FullName)
            .ToList();

        offenders.Should().BeEmpty(
            "AC9: Tamma.Api.Services.Tracker must deserialize the shipped Tamma.Core.Documents.Types.BacklogItem "
            + "and declare NO parallel entry record of its own");

        // Positive confirmation: BacklogOrderingView.Entries carries the shipped BacklogItem.
        typeof(BacklogOrderingView)
            .GetProperty(nameof(BacklogOrderingView.Entries))!
            .PropertyType.Should().Be(typeof(IReadOnlyList<BacklogItem>));
    }
}
