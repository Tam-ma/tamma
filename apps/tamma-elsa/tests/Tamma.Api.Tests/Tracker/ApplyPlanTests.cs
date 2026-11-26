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
/// Story 44-4 AC9 &amp; AC10a (D7–D10, Amendments A2/A4) — the <c>SprintPlan</c>
/// apply seam:
/// - Rejects non-accepted (<c>409 DOCUMENT_NOT_ACCEPTED</c>), wrong type
///   (<c>409 DOCUMENT_NOT_SPRINT_PLAN</c>), and missing (<c>404</c>) documents
/// - Commits all resolvable <c>SprintPlan.Committed</c> entries in ONE bulk UPDATE
/// - Reports <c>already-committed-elsewhere</c> distinctly (moving the item while
///   surfacing <c>previousIterationId</c>)
/// - Idempotent no-op (0 UPDATEs) on second apply
/// - AC10a: writes ZERO <c>domain_events</c> (delta == 0)
/// - AC9 / A4: <c>SprintPlan.CarryOver</c> entries are NEVER committed
///
/// <para><b>Cross-Story Contract note (recorded deliberately per AC9):</b>
/// <see cref="SprintCommittedItem.IssueId"/> is unconstrained by 41-1b's validator;
/// Story 41-6 is still drafted and has not yet pinned whether <c>issueId</c> carries
/// work-item keys. Until 41-6 fixes that contract, the happy-path key resolution below
/// is verified against fixtures authored by this story using work-item keys.</para>
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class ApplyPlanTests
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
    private DocumentInstanceRepository _documents = null!;
    private EventRepository _eventRepo = null!;
    private TrackerEventsService _trackerEvents = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_apply_plan_test")
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
        _documents = new DocumentInstanceRepository(_factory, _tenantContext);
        _eventRepo = new EventRepository(_factory, _tenantContext);
        _trackerEvents = new TrackerEventsService(_eventRepo, _tenantContext);
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

    private SprintPlanApplyService ApplyService() => new(
        _iterations,
        _workItems,
        new DocumentSprintPlanReader(_documents),
        _tenantContext,
        _trackerEvents,
        _projects);

    private Task<ProjectEntity> NewProjectAsync(string key = "TAM") =>
        _projects.CreateAsync(new ProjectEntity { Key = key, Name = key, EstimateScale = "fibonacci" });

    private Task<IterationEntity> NewIterationAsync(Guid projectId, string name, string status = "planned") =>
        _iterations.CreateAsync(new IterationEntity
        {
            ProjectId = projectId,
            Name = name,
            Status = status,
        });

    private Task<WorkItemEntity> NewItemAsync(Guid projectId, string title, Guid? iterationId = null) =>
        _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = projectId,
            Kind = "task",
            Status = "ready",
            Title = title,
            IterationId = iterationId,
        });

    private async Task<DocumentInstance> SeedSprintPlanDocAsync(
        string bodyJson, DocumentInstanceStatus status = DocumentInstanceStatus.Accepted)
    {
        var draft = DocumentEnvelope.CreateDraft(
            DocumentTypeKey.SprintPlan,
            1,
            "sprint:tam:2026-08-A",
            "corr-sprint-apply-test",
            DocumentProducer.Create("scrum_master", "plan-sprint", "sprint-planning"),
            DocumentTestData.Payload(bodyJson));

        var inserted = await _documents.InsertAsync(_tenantId, draft, correlatingEventId: null, CancellationToken.None);
        if (status != DocumentInstanceStatus.Draft)
            inserted = await _documents.SetStatusAsync(_tenantId, inserted.Id, status, correlatingEventId: null, CancellationToken.None);
        return inserted;
    }

    private static async Task<(int Status, JsonElement Body)> ExecApply(
        Guid iterationId, Guid documentId, SprintPlanApplyService service)
    {
        var http = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        var result = await TrackerEndpoints.ApplySprintPlan(
            iterationId, new ApplySprintPlanRequest(documentId), service, CancellationToken.None);
        await result.ExecuteAsync(http);
        http.Response.Body.Position = 0;
        var raw = await new StreamReader(http.Response.Body).ReadToEndAsync();
        return (http.Response.StatusCode, JsonDocument.Parse(raw).RootElement.Clone());
    }

    [Test]
    public async Task Rejects_non_accepted_and_wrong_type()
    {
        var project = await NewProjectAsync();
        var iter = await NewIterationAsync(project.Id, "Iter 1");
        var item = await NewItemAsync(project.Id, "item 1");

        var body = $$"""
            {
              "sprintId": "sprint-2026-08-A",
              "capacity": 10,
              "committed": [
                { "issueId": "{{item.Key}}", "ownerRole": "developer", "estimate": 5 }
              ],
              "carryOver": []
            }
            """;

        // Non-accepted status -> 409 DOCUMENT_NOT_ACCEPTED.
        var draftDoc = await SeedSprintPlanDocAsync(body, DocumentInstanceStatus.Draft);
        var (draftStatus, draftJson) = await ExecApply(iter.Id, draftDoc.Id, ApplyService());
        draftStatus.Should().Be(StatusCodes.Status409Conflict);
        draftJson.GetProperty("code").GetString().Should().Be("DOCUMENT_NOT_ACCEPTED");

        // Wrong document type (accepted decomposition) -> 409 DOCUMENT_NOT_SPRINT_PLAN.
        var decomp = await _documents.InsertAsync(_tenantId, DocumentTestData.DecompositionEnvelope("TAM-1"), null, CancellationToken.None);
        await _documents.SetStatusAsync(_tenantId, decomp.Id, DocumentInstanceStatus.Accepted, null, CancellationToken.None);

        var (wrongStatus, wrongJson) = await ExecApply(iter.Id, decomp.Id, ApplyService());
        wrongStatus.Should().Be(StatusCodes.Status409Conflict);
        wrongJson.GetProperty("code").GetString().Should().Be("DOCUMENT_NOT_SPRINT_PLAN");
    }

    [Test]
    public async Task Rejects_when_no_document_exists()
    {
        var project = await NewProjectAsync();
        var iter = await NewIterationAsync(project.Id, "Iter 1");

        var (status, json) = await ExecApply(iter.Id, Guid.NewGuid(), ApplyService());
        status.Should().Be(StatusCodes.Status404NotFound);
        json.GetProperty("code").GetString().Should().Be("TRACKER.DOCUMENT_NOT_FOUND");
    }

    [Test]
    public async Task Commits_the_documents_entries()
    {
        var projectA = await NewProjectAsync("AAA");
        var projectB = await NewProjectAsync("BBB");
        var iterA = await NewIterationAsync(projectA.Id, "Iter A");

        var a1 = await NewItemAsync(projectA.Id, "A1");
        var a2 = await NewItemAsync(projectA.Id, "A2");
        var b1 = await NewItemAsync(projectB.Id, "B1");

        var body = $$"""
            {
              "sprintId": "sprint-2026-08-A",
              "capacity": 20,
              "committed": [
                { "issueId": "{{a1.Key}}", "ownerRole": "developer", "estimate": 5 },
                { "issueId": "MISSING-9",  "ownerRole": "tester",    "estimate": 3 },
                { "issueId": "{{b1.Key}}", "ownerRole": "developer", "estimate": 2 },
                { "issueId": "{{a2.Key}}", "ownerRole": "tester",    "estimate": 5 }
              ],
              "carryOver": []
            }
            """;
        var doc = await SeedSprintPlanDocAsync(body, DocumentInstanceStatus.Accepted);

        _interceptor.Reset();
        var response = await ApplyService().ApplyAsync(iterA.Id, doc.Id, CancellationToken.None);

        response.AppliedCount.Should().Be(2);
        response.NotFoundCount.Should().Be(1);
        response.WrongProjectCount.Should().Be(1);
        response.AlreadyCommittedElsewhereCount.Should().Be(0);
        response.Outcomes.Select(o => (o.ItemId, o.Outcome)).Should().Equal(
            (a1.Key, ApplyOutcomeCodes.Applied),
            ("MISSING-9", ApplyOutcomeCodes.NotFound),
            (b1.Key, ApplyOutcomeCodes.WrongProject),
            (a2.Key, ApplyOutcomeCodes.Applied));

        _interceptor.UpdateCommands.Should().HaveCount(1, "all commitments written in ONE bulk UPDATE");
        (await _workItems.GetAsync(a1.Id))!.IterationId.Should().Be(iterA.Id);
        (await _workItems.GetAsync(a2.Id))!.IterationId.Should().Be(iterA.Id);
        (await _workItems.GetAsync(b1.Id))!.IterationId.Should().BeNull();
    }

    [Test]
    public async Task Reports_already_committed_elsewhere_distinctly()
    {
        // D8: an item already committed to a DIFFERENT iteration is moved into this
        // iteration, but reported distinctly as `already-committed-elsewhere` with previousIterationId.
        var project = await NewProjectAsync();
        var activeIter = await NewIterationAsync(project.Id, "Iter Active", "active");
        var nextIter = await NewIterationAsync(project.Id, "Iter Next", "planned");

        var fresh = await NewItemAsync(project.Id, "fresh");
        var stolen = await NewItemAsync(project.Id, "already in active", iterationId: activeIter.Id);

        var body = $$"""
            {
              "sprintId": "sprint-2026-08-B",
              "capacity": 10,
              "committed": [
                { "issueId": "{{fresh.Key}}",  "ownerRole": "developer", "estimate": 3 },
                { "issueId": "{{stolen.Key}}", "ownerRole": "developer", "estimate": 5 }
              ],
              "carryOver": []
            }
            """;
        var doc = await SeedSprintPlanDocAsync(body, DocumentInstanceStatus.Accepted);

        var response = await ApplyService().ApplyAsync(nextIter.Id, doc.Id, CancellationToken.None);

        response.AppliedCount.Should().Be(1);
        response.AlreadyCommittedElsewhereCount.Should().Be(1);
        var stolenOutcome = response.Outcomes.Single(o => o.ItemId == stolen.Key);
        stolenOutcome.Outcome.Should().Be(ApplyOutcomeCodes.AlreadyCommittedElsewhere);
        stolenOutcome.PreviousIterationId.Should().Be(activeIter.Id);

        (await _workItems.GetAsync(fresh.Id))!.IterationId.Should().Be(nextIter.Id);
        (await _workItems.GetAsync(stolen.Id))!.IterationId.Should().Be(nextIter.Id);
    }

    [Test]
    public async Task Second_apply_is_a_no_op()
    {
        var project = await NewProjectAsync();
        var iter = await NewIterationAsync(project.Id, "Iter 1");
        var item = await NewItemAsync(project.Id, "item 1");

        var body = $$"""
            {
              "sprintId": "sprint-2026-08-A",
              "capacity": 10,
              "committed": [
                { "issueId": "{{item.Key}}", "ownerRole": "developer", "estimate": 5 }
              ],
              "carryOver": []
            }
            """;
        var doc = await SeedSprintPlanDocAsync(body, DocumentInstanceStatus.Accepted);

        await ApplyService().ApplyAsync(iter.Id, doc.Id, CancellationToken.None);
        var afterFirst = (await _workItems.GetAsync(item.Id))!;

        _interceptor.Reset();
        var second = await ApplyService().ApplyAsync(iter.Id, doc.Id, CancellationToken.None);
        second.AppliedCount.Should().Be(1);
        _interceptor.UpdateCommands.Should().BeEmpty(
            "AC9/D7: second apply of the same accepted SprintPlan must execute 0 UPDATEs");

        var afterSecond = (await _workItems.GetAsync(item.Id))!;
        afterSecond.Version.Should().Be(afterFirst.Version);
        afterSecond.IterationId.Should().Be(iter.Id);
    }

    [Test]
    public async Task Apply_emits_only_iteration_plan_applied_and_no_document_or_task_event()
    {
        // Story 44-4 AC10 / A2 handoff -> Story 44-5:
        // Replaces the temporary 44-4 zero-emission pin with the real behavioural
        // assertion: a successful apply-plan emits ITERATION.PLAN_APPLIED.SUCCESS
        // and NOTHING beginning with ordinal prefix "DOCUMENT." or "TASK."
        // (matching by ordinal prefix, never Contains, so unrelated AGENT.TASK.* is unaffected).
        var project = await NewProjectAsync();
        var iter = await NewIterationAsync(project.Id, "Iter 1");
        var item = await NewItemAsync(project.Id, "item 1");

        var body = $$"""
            {
              "sprintId": "sprint-2026-08-A",
              "capacity": 10,
              "committed": [
                { "issueId": "{{item.Key}}", "ownerRole": "developer", "estimate": 5 }
              ],
              "carryOver": []
            }
            """;
        var doc = await SeedSprintPlanDocAsync(body, DocumentInstanceStatus.Accepted);

        await ApplyService().ApplyAsync(iter.Id, doc.Id, CancellationToken.None);

        var emitted = await _eventRepo.QueryAsync(_tenantId, type: null, issueNumber: null, limit: 100);
        emitted.Select(e => e.Type).Should().Equal([IterationEvents.PlanApplied]);
        emitted.Should().NotContain(e => e.Type.StartsWith("DOCUMENT.", StringComparison.Ordinal),
            "44-4 D9: apply-plan is a tracker mutation, never a document-lifecycle write");
        emitted.Should().NotContain(e => e.Type.StartsWith("TASK.", StringComparison.Ordinal),
            "44-4 D9 / 41-6 AC3 correction: sprint commitment never raises a Task-View event");
    }

    [Test]
    public async Task CarryOver_entries_are_not_committed()
    {
        // AC9 / A4 / Test 20b: SprintPlan.Committed and SprintPlan.CarryOver are TWO
        // separate lists. Only Committed acquires IterationId — CarryOver items MUST NOT
        // be committed to the iteration.
        var project = await NewProjectAsync();
        var iter = await NewIterationAsync(project.Id, "Iter 2");

        var committedItem = await NewItemAsync(project.Id, "committed work");
        var carryOverItem = await NewItemAsync(project.Id, "carry-over work");

        var body = $$"""
            {
              "sprintId": "sprint-2026-08-B",
              "capacity": 10,
              "committed": [
                { "issueId": "{{committedItem.Key}}", "ownerRole": "developer", "estimate": 5 }
              ],
              "carryOver": [
                { "issueId": "{{carryOverItem.Key}}", "reason": "Blocked on external vendor." }
              ]
            }
            """;
        var doc = await SeedSprintPlanDocAsync(body, DocumentInstanceStatus.Accepted);

        var response = await ApplyService().ApplyAsync(iter.Id, doc.Id, CancellationToken.None);

        response.AppliedCount.Should().Be(1);
        response.CarryOverCount.Should().Be(1);
        (await _workItems.GetAsync(committedItem.Id))!.IterationId.Should().Be(iter.Id);
        (await _workItems.GetAsync(carryOverItem.Id))!.IterationId.Should().BeNull(
            "AC9/A4: CarryOver entries name unfinished work with reasons and MUST NOT be committed");
    }
}
