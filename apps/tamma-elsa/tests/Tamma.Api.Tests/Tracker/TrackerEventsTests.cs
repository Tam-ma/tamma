using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.PromptStore;
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
/// Story 44-5 AC1–AC6 (D1–D6) — tracker DCB event emission tests:
/// - Test 1: Every tracker mutation emits exactly one terminal event (all 23 paths)
/// - Test 2: Tags are uniform (<c>issueId</c>/<c>projectKey</c>, <c>tenantId</c>,
///   <c>projectId</c>, <c>userId</c>, <c>correlationId</c>)
/// - Test 3: <c>DomainEvent.IssueNumber</c> is ALWAYS <c>null</c>
/// - Test 4: Transition events (<c>STATUS_CHANGED</c>, <c>REPARENTED</c>,
///   <c>ASSIGNED</c>, <c>MOVED</c>) carry both <c>from</c> and <c>to</c>
/// - Test 5: Transactional failure rolls the Postgres write back atomically
/// - Test 6: Best-effort failure logs a warning and lets the write succeed
/// - Test 7: Every constant in the 3 catalogues has exactly one failure policy
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class TrackerEventsTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _baseConnectionString = null!;
    private Guid _tenantId;
    private string _schema = null!;
    private Guid _actorUserId;
    private string _correlationId = null!;

    private RankMoveTests.CountingTenantDbContextFactory _factory = null!;
    private DocumentTestData.FakeTenantContext _tenantContext = null!;
    private ProjectRepository _projects = null!;
    private IterationRepository _iterations = null!;
    private WorkItemRepository _workItems = null!;
    private TrackerPreferenceRepository _preferences = null!;
    private DocumentInstanceRepository _documents = null!;
    private EventRepository _eventRepo = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_events_test")
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
        _iterations = new IterationRepository(_factory, _tenantContext);
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
        _actorUserId = Guid.NewGuid();
        _correlationId = $"corr-{Guid.NewGuid():N}";
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

    private IHttpContextAccessor MakeHttpContextAccessor()
    {
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim("sub", _actorUserId.ToString())], "test")),
        };
        http.Request.Headers["X-Correlation-Id"] = _correlationId;
        return new HttpContextAccessor { HttpContext = http };
    }

    private TrackerEventsService EventsService(
        IEventRepository? repo = null, ILogger<TrackerEventsService>? logger = null) =>
        new(repo ?? _eventRepo, _tenantContext, MakeHttpContextAccessor(), logger);

    private TrackerService MakeTracker(ITrackerEventsService events) => new(
        _projects,
        _workItems,
        _preferences,
        new InitiatorOnlyTaskAudienceResolver(),
        new FixedModeProvider(TammaMode.SingleUser),
        _tenantContext,
        events);

    private TrackerHierarchyService MakeHierarchy(ITrackerEventsService events) =>
        new(_workItems, _tenantContext, events);

    private OrderingApplyService MakeOrderingApply(ITrackerEventsService events) =>
        new(_projects, _workItems, new DocumentBacklogOrderingReader(_documents), _tenantContext, events);

    private IterationService MakeIterations(ITrackerEventsService events) =>
        new(_projects, _iterations, _workItems, _tenantContext, events);

    private SprintPlanApplyService MakePlanApply(ITrackerEventsService events) =>
        new(_iterations, _workItems, new DocumentSprintPlanReader(_documents), _tenantContext, events, _projects);

    private async Task<List<DomainEvent>> AllEventsAsync()
    {
        var rows = await _eventRepo.QueryAsync(_tenantId, type: null, issueNumber: null, limit: 500);
        return rows.OrderBy(e => e.SequenceNumber).ToList();
    }

    private async Task<DomainEvent> AssertExactlyOneNewEventAsync(int countBefore, string expectedType)
    {
        var all = await AllEventsAsync();
        var added = all.Skip(countBefore).ToList();
        added.Should().HaveCount(1, $"mutation should emit exactly one '{expectedType}' event");
        added[0].Type.Should().Be(expectedType);
        return added[0];
    }

    [Test]
    public async Task Every_mutation_emits_exactly_one_event()
    {
        var events = EventsService();
        var tracker = MakeTracker(events);
        var hierarchy = MakeHierarchy(events);
        var orderingApply = MakeOrderingApply(events);
        var iterations = MakeIterations(events);
        var planApply = MakePlanApply(events);

        var count = 0;

        // 1. PROJECT.CREATED.SUCCESS
        var project = await tracker.CreateProjectAsync(
            new CreateProjectRequest("TAM", "Tamma", null, null, "fibonacci"), _actorUserId);
        await AssertExactlyOneNewEventAsync(count++, ProjectEvents.Created);

        // 2. PROJECT.UPDATED.SUCCESS
        await tracker.PatchProjectAsync(project.Id, new PatchProjectRequest
        {
            Name = Optional<string>.Set("Tamma Renamed"),
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, ProjectEvents.Updated);

        // 3. PROJECT.ARCHIVED.SUCCESS
        await tracker.PatchProjectAsync(project.Id, new PatchProjectRequest
        {
            Archived = Optional<bool?>.Set(true),
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, ProjectEvents.Archived);

        // 4. PROJECT.DELETED.SUCCESS (use a throwaway empty project)
        var disposableProject = await tracker.CreateProjectAsync(
            new CreateProjectRequest("DEL", "Disposable", null, null, null), _actorUserId);
        await AssertExactlyOneNewEventAsync(count++, ProjectEvents.Created);
        await tracker.DeleteProjectAsync(disposableProject.Id, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, ProjectEvents.Deleted);

        // 5. WORKITEM.CREATED.SUCCESS
        var epic = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Epic 1", "epic"), _actorUserId);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Created);

        var item = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Task 1", "task", estimate: 3m), _actorUserId);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Created);

        // 6. WORKITEM.UPDATED.SUCCESS
        await tracker.PatchWorkItemAsync(item.Id, new PatchWorkItemRequest
        {
            Title = Optional<string>.Set("Task 1 Updated"),
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Updated);

        // 7. WORKITEM.LINKED.SUCCESS
        using var extDoc = JsonDocument.Parse("""{"platform":"github","repoFullName":"Tam-ma/tamma","number":42}""");
        await tracker.PatchWorkItemAsync(item.Id, new PatchWorkItemRequest
        {
            ExternalRef = Optional<JsonElement?>.Set(extDoc.RootElement.Clone()),
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Linked);

        // 8. WORKITEM.STATUS_CHANGED.SUCCESS
        await tracker.SetWorkItemStatusAsync(item.Id, "in_progress", ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.StatusChanged);

        // 9. WORKITEM.ASSIGNED.SUCCESS
        await tracker.AssignWorkItemAsync(item.Id, Guid.NewGuid(), ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Assigned);

        // 10. WORKITEM.REPARENTED.SUCCESS
        await hierarchy.ReparentAsync(item.Id, epic.Id, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Reparented);

        // 11. WORKITEM.MOVED.SUCCESS
        await hierarchy.MoveAsync(item.Id, afterId: null, beforeId: epic.Id, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Moved);

        // 12. ITERATION.CREATED.SUCCESS
        var iter = await iterations.CreateAsync(
            project.Id, new CreateIterationRequest("Sprint 1", null, null, "planned", 20m));
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.Created);

        // 13. ITERATION.UPDATED.SUCCESS (metadata only)
        await iterations.PatchAsync(iter.Id, new PatchIterationRequest
        {
            Name = Optional<string>.Set("Sprint 1 Renamed"),
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.Updated);

        // 14. ITERATION.STARTED.SUCCESS
        await iterations.PatchAsync(iter.Id, new PatchIterationRequest
        {
            Status = Optional<string>.Set("active"),
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.Started);

        // 15. WORKITEM.COMMITTED.SUCCESS
        await iterations.CommitItemsAsync(iter.Id, [item.Id]);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Committed);

        // 16. WORKITEM.UNCOMMITTED.SUCCESS
        await iterations.UncommitItemAsync(iter.Id, item.Id);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Uncommitted);

        // 17. WORKITEM.ORDERING_APPLIED.FAILED (draft document rejected)
        var orderingJson = $$"""
            {
              "orderingScope": "project:TAM",
              "items": [{ "itemId": "{{item.Key}}", "rank": 1, "value": "high", "effort": "1d", "rationale": "top" }]
            }
            """;
        var draftOrdering = await _documents.InsertAsync(
            _tenantId,
            DocumentEnvelope.CreateDraft(
                DocumentTypeKey.BacklogOrdering, 1, "backlog:TAM", "corr-ord",
                DocumentProducer.Create("product_owner", "prioritize-backlog", "backlog-prioritization"),
                DocumentTestData.Payload(orderingJson)),
            null, CancellationToken.None);
        var failedOrdering = () => orderingApply.ApplyAsync(project.Id, draftOrdering.Id, CancellationToken.None);
        await failedOrdering.Should().ThrowAsync<TammaError>();
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.OrderingApplyFailed);

        // 18. WORKITEM.ORDERING_APPLIED.SUCCESS
        await _documents.SetStatusAsync(_tenantId, draftOrdering.Id, DocumentInstanceStatus.Accepted, null, CancellationToken.None);
        await orderingApply.ApplyAsync(project.Id, draftOrdering.Id, CancellationToken.None);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.OrderingApplied);

        // 19. ITERATION.PLAN_APPLIED.FAILED (draft document rejected)
        var planJson = $$"""
            {
              "sprintId": "sprint-1",
              "capacity": 20,
              "committed": [{ "issueId": "{{item.Key}}", "ownerRole": "developer", "estimate": 3 }],
              "carryOver": []
            }
            """;
        var draftPlan = await _documents.InsertAsync(
            _tenantId,
            DocumentEnvelope.CreateDraft(
                DocumentTypeKey.SprintPlan, 1, "sprint:TAM:1", "corr-plan",
                DocumentProducer.Create("scrum_master", "plan-sprint", "sprint-planning"),
                DocumentTestData.Payload(planJson)),
            null, CancellationToken.None);
        var failedPlan = () => planApply.ApplyAsync(iter.Id, draftPlan.Id, CancellationToken.None);
        await failedPlan.Should().ThrowAsync<TammaError>();
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.PlanApplyFailed);

        // 20. ITERATION.PLAN_APPLIED.SUCCESS
        await _documents.SetStatusAsync(_tenantId, draftPlan.Id, DocumentInstanceStatus.Accepted, null, CancellationToken.None);
        await planApply.ApplyAsync(iter.Id, draftPlan.Id, CancellationToken.None);
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.PlanApplied);

        // 21. ITERATION.CLOSED.SUCCESS
        await iterations.PatchAsync(iter.Id, new PatchIterationRequest
        {
            Status = Optional<string>.Set("closed"),
            CarryOver = "to-backlog",
        }, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.Closed);

        // 22. ITERATION.DELETED.SUCCESS
        await iterations.DeleteAsync(iter.Id, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, IterationEvents.Deleted);

        // 23. WORKITEM.DELETED.SUCCESS
        await tracker.DeleteWorkItemAsync(item.Id, ifMatchVersion: null);
        await AssertExactlyOneNewEventAsync(count++, WorkItemEvents.Deleted);

        // Verify ALL 23 distinct constants across ProjectEvents, WorkItemEvents, and IterationEvents were emitted!
        var emittedTypes = (await AllEventsAsync()).Select(e => e.Type).ToHashSet(StringComparer.Ordinal);
        var allCatalogueConstants = CollectAllCatalogueConstants();
        emittedTypes.Should().BeEquivalentTo(allCatalogueConstants,
            "every single constant across ProjectEvents, WorkItemEvents, and IterationEvents was driven end-to-end");
    }

    [Test]
    public async Task Tags_are_uniform()
    {
        var events = EventsService();
        var tracker = MakeTracker(events);
        var iterations = MakeIterations(events);

        var project = await tracker.CreateProjectAsync(
            new CreateProjectRequest("TAM", "Tamma", null, null, null), _actorUserId);
        var item = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Card 1", "task"), _actorUserId);
        var iter = await iterations.CreateAsync(
            project.Id, new CreateIterationRequest("Sprint 1", null, null, "planned", null));

        var all = await AllEventsAsync();
        all.Should().HaveCount(3);

        // Project event tags
        var projTags = JsonDocument.Parse(all[0].Tags).RootElement;
        projTags.GetProperty("projectKey").GetString().Should().Be("TAM");
        projTags.GetProperty("projectId").GetString().Should().Be(project.Id.ToString());
        projTags.GetProperty("tenantId").GetString().Should().Be(_tenantId.ToString());
        projTags.GetProperty("userId").GetString().Should().Be(_actorUserId.ToString());
        projTags.GetProperty("correlationId").GetString().Should().Be(_correlationId);

        // WorkItem event tags
        var itemTags = JsonDocument.Parse(all[1].Tags).RootElement;
        itemTags.GetProperty("issueId").GetString().Should().Be(item.Key);
        itemTags.GetProperty("projectKey").GetString().Should().Be("TAM");
        itemTags.GetProperty("projectId").GetString().Should().Be(project.Id.ToString());
        itemTags.GetProperty("tenantId").GetString().Should().Be(_tenantId.ToString());
        itemTags.GetProperty("userId").GetString().Should().Be(_actorUserId.ToString());
        itemTags.GetProperty("correlationId").GetString().Should().Be(_correlationId);

        // Iteration event tags
        var iterTags = JsonDocument.Parse(all[2].Tags).RootElement;
        iterTags.GetProperty("projectKey").GetString().Should().Be("TAM");
        iterTags.GetProperty("projectId").GetString().Should().Be(project.Id.ToString());
        iterTags.GetProperty("iterationId").GetString().Should().Be(iter.Id.ToString());
        iterTags.GetProperty("tenantId").GetString().Should().Be(_tenantId.ToString());
        iterTags.GetProperty("userId").GetString().Should().Be(_actorUserId.ToString());
        iterTags.GetProperty("correlationId").GetString().Should().Be(_correlationId);
    }

    [Test]
    public async Task IssueNumber_is_always_null()
    {
        var events = EventsService();
        var tracker = MakeTracker(events);
        var hierarchy = MakeHierarchy(events);

        var project = await tracker.CreateProjectAsync(
            new CreateProjectRequest("TAM", "Tamma", null, null, null), _actorUserId);
        var item = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Card 1", "task"), _actorUserId);
        await tracker.SetWorkItemStatusAsync(item.Id, "in_progress", null);
        await tracker.AssignWorkItemAsync(item.Id, _actorUserId, null);
        await hierarchy.MoveAsync(item.Id, null, null, null);

        var all = await AllEventsAsync();
        all.Should().HaveCount(5);
        all.Should().OnlyContain(e => e.IssueNumber == null,
            "AC3 / D4: native work-item keys (TAM-1) are not integers — IssueNumber must stay NULL");
    }

    [Test]
    public async Task Transitions_carry_from_and_to()
    {
        var events = EventsService();
        var tracker = MakeTracker(events);
        var hierarchy = MakeHierarchy(events);

        var project = await tracker.CreateProjectAsync(
            new CreateProjectRequest("TAM", "Tamma", null, null, null), _actorUserId);
        var epic = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Epic", "epic"), _actorUserId);
        var item = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Task", "task", status: "backlog"), _actorUserId);
        var originalRank = item.Rank;

        // 1. STATUS_CHANGED: backlog -> in_progress
        await tracker.SetWorkItemStatusAsync(item.Id, "in_progress", null);

        // 2. ASSIGNED: null -> assigneeA
        var assigneeA = Guid.NewGuid();
        await tracker.AssignWorkItemAsync(item.Id, assigneeA, null);

        // 3. REPARENTED: null -> epic.Id
        await hierarchy.ReparentAsync(item.Id, epic.Id, null);

        // 4. MOVED: originalRank -> newRank (before epic)
        var moved = (await hierarchy.MoveAsync(item.Id, afterId: null, beforeId: epic.Id, null))!;

        var all = await AllEventsAsync();

        var statusEvt = all.Single(e => e.Type == WorkItemEvents.StatusChanged);
        var statusData = JsonDocument.Parse(statusEvt.Data).RootElement;
        statusData.GetProperty("from").GetString().Should().Be("backlog");
        statusData.GetProperty("to").GetString().Should().Be("in_progress");

        var assignEvt = all.Single(e => e.Type == WorkItemEvents.Assigned);
        var assignData = JsonDocument.Parse(assignEvt.Data).RootElement;
        assignData.GetProperty("fromAssignee").ValueKind.Should().Be(JsonValueKind.Null);
        assignData.GetProperty("toAssignee").GetGuid().Should().Be(assigneeA);

        var reparentEvt = all.Single(e => e.Type == WorkItemEvents.Reparented);
        var reparentData = JsonDocument.Parse(reparentEvt.Data).RootElement;
        reparentData.GetProperty("fromParentId").ValueKind.Should().Be(JsonValueKind.Null);
        reparentData.GetProperty("toParentId").GetGuid().Should().Be(epic.Id);

        var moveEvt = all.Single(e => e.Type == WorkItemEvents.Moved);
        var moveData = JsonDocument.Parse(moveEvt.Data).RootElement;
        moveData.GetProperty("fromRank").GetString().Should().Be(originalRank);
        moveData.GetProperty("toRank").GetString().Should().Be(moved.Rank);
    }

    [Test]
    public async Task Transactional_failure_rolls_the_write_back()
    {
        // Seed project & item with real repo first.
        var project = await _projects.CreateAsync(new ProjectEntity { Key = "TAM", Name = "Tamma" });
        var item = await _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = project.Id,
            Kind = "task",
            Status = "backlog",
            Title = "Must not mutate on audit failure",
        });
        var originalVersion = item.Version;
        var failingRepo = new FailingEventRepository();
        var failingEvents = EventsService(failingRepo);
        var tracker = MakeTracker(failingEvents);
        var iterations = MakeIterations(failingEvents);

        // 1. ASSIGNED fails -> AssigneeUserId and Version MUST be rolled back!
        var assignee = Guid.NewGuid();
        var assignAct = () => tracker.AssignWorkItemAsync(item.Id, assignee, null);
        await assignAct.Should().ThrowAsync<InvalidOperationException>();

        var afterAssign = (await _workItems.GetAsync(item.Id))!;
        afterAssign.AssigneeUserId.Should().BeNull("AC6: transactional ASSIGNED failure must roll back the work_items write");
        afterAssign.Version.Should().Be(originalVersion);

        // 2. STATUS_CHANGED fails -> Status MUST be rolled back!
        var statusAct = () => tracker.SetWorkItemStatusAsync(item.Id, "in_progress", null);
        await statusAct.Should().ThrowAsync<InvalidOperationException>();

        var afterStatus = (await _workItems.GetAsync(item.Id))!;
        afterStatus.Status.Should().Be("backlog", "AC6: transactional STATUS_CHANGED failure must roll back the status write");
        afterStatus.Version.Should().Be(originalVersion);

        // 3. DELETED fails -> item MUST still exist!
        var deleteAct = () => tracker.DeleteWorkItemAsync(item.Id, null);
        await deleteAct.Should().ThrowAsync<InvalidOperationException>();

        (await _workItems.GetAsync(item.Id)).Should().NotBeNull(
            "AC6: transactional DELETED failure must roll back the delete");

        // 4. ITERATION.CLOSED fails -> iteration MUST remain active and item stays committed!
        var iter = await _iterations.CreateAsync(new IterationEntity
        {
            ProjectId = project.Id,
            Name = "Sprint 1",
            Status = "active",
        });
        await _workItems.BulkSetIterationAsync(project.Id, [item.Id], iter.Id);

        var closeAct = () => iterations.PatchAsync(iter.Id, new PatchIterationRequest
        {
            Status = Optional<string>.Set("closed"),
            CarryOver = "to-backlog",
        }, null);
        await closeAct.Should().ThrowAsync<InvalidOperationException>();

        (await _iterations.GetAsync(iter.Id))!.Status.Should().Be("active",
            "AC6/D6: transactional ITERATION.CLOSED failure must roll back close and carry-over");
        (await _workItems.GetAsync(item.Id))!.IterationId.Should().Be(iter.Id,
            "AC6/D6: carry-over UPDATE must roll back with the close transaction");
    }

    [Test]
    public async Task Best_effort_failure_warns_and_proceeds()
    {
        var project = await _projects.CreateAsync(new ProjectEntity { Key = "TAM", Name = "Tamma" });
        var failingRepo = new FailingEventRepository();
        var logger = new CapturingLogger<TrackerEventsService>();
        var tracker = MakeTracker(EventsService(failingRepo, logger));

        var created = await tracker.CreateWorkItemAsync(
            NewWorkItemReq(project.Id, "Created despite event-store blip", "task"), _actorUserId);

        (await _workItems.GetAsync(created.Id)).Should().NotBeNull(
            "AC6 / D6: best-effort CREATED emission failure must NOT block the mutation");
        logger.Warnings.Should().ContainSingle(w => w.Contains(WorkItemEvents.Created, StringComparison.Ordinal),
            "AC6 / D6: best-effort failure must log a warning naming the event type");
    }

    [Test]
    public void Every_constant_has_exactly_one_failure_policy()
    {
        var allConstants = CollectAllCatalogueConstants();
        allConstants.Should().NotBeEmpty();

        // Disjoint: no constant in both sets.
        var overlap = TrackerEventsService.Transactional
            .Intersect(TrackerEventsService.BestEffort, StringComparer.Ordinal)
            .ToList();
        overlap.Should().BeEmpty("D6: a constant cannot be both transactional and best-effort");

        // Total: every constant in ProjectEvents / WorkItemEvents / IterationEvents is classified.
        var classified = TrackerEventsService.Transactional
            .Union(TrackerEventsService.BestEffort, StringComparer.Ordinal)
            .ToHashSet(StringComparer.Ordinal);

        classified.Should().BeEquivalentTo(allConstants,
            "D6: every constant across ProjectEvents, WorkItemEvents, and IterationEvents must appear in "
            + "either TrackerEventsService.Transactional or TrackerEventsService.BestEffort");
    }

    private static CreateWorkItemRequest NewWorkItemReq(
        Guid projectId, string title, string kind, string? status = null, decimal? estimate = null) =>
        new(
            ProjectId: projectId,
            Title: title,
            Kind: kind,
            Status: status,
            Priority: null,
            IssueType: null,
            Description: null,
            ParentId: null,
            IterationId: null,
            AssigneeUserId: null,
            Estimate: estimate,
            ExternalRef: null);

    private static HashSet<string> CollectAllCatalogueConstants()
    {
        var types = new[] { typeof(ProjectEvents), typeof(WorkItemEvents), typeof(IterationEvents) };
        return types
            .SelectMany(t => t.GetFields(BindingFlags.Public | BindingFlags.Static))
            .Where(f => f.IsLiteral && !f.IsInitOnly && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToHashSet(StringComparer.Ordinal);
    }

    private sealed class FixedModeProvider(TammaMode mode) : ITammaModeProvider
    {
        public TammaMode Mode { get; } = mode;
    }

    private sealed class FailingEventRepository : IEventRepository
    {
        public Task<DomainEvent> AppendAsync(DomainEvent evt) =>
            throw new InvalidOperationException($"Simulated event store failure for {evt.Type}");

        public Task<DomainEvent?> GetByIdAsync(Guid id) => Task.FromResult<DomainEvent?>(null);
        public Task<List<DomainEvent>> QueryAsync(Guid? tenantId, string? type, int? issueNumber, int limit) => Task.FromResult(new List<DomainEvent>());
        public Task<DomainEvent?> GetLastByTypeAsync(Guid tenantId, string type) => Task.FromResult<DomainEvent?>(null);
        public Task ClearAsync(Guid tenantId) => Task.CompletedTask;
        public Task<(IReadOnlyList<DomainEvent> Events, int Total)> QueryWithPaginationAsync(Guid? tenantId, string? type, int? issueNumber, int limit, int offset) =>
            Task.FromResult<(IReadOnlyList<DomainEvent>, int)>(([], 0));
        public Task<(IReadOnlyList<DomainEvent> Events, int Total)> ListByTenantAsync(Guid tenantId, string? typePrefix, int limit, int offset) =>
            Task.FromResult<(IReadOnlyList<DomainEvent>, int)>(([], 0));
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<string> Warnings { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Warning)
                Warnings.Add(formatter(state, exception));
        }
    }
}
