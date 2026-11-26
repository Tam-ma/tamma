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
using Tamma.Core;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-3 AC1, AC2, AC4, Amendment A6 — hierarchy invariants enforced
/// transactionally against real Postgres:
/// - All 16 <c>(parent, child)</c> kind pairs via <see cref="TrackerHierarchy.CanParent"/>
/// - <c>Task</c> under <c>Epic</c> explicitly permitted (no reinstated parenting matrix)
/// - <c>MAX_DEPTH_EXCEEDED</c> referencing <see cref="TrackerHierarchy.MaxDepth"/>
/// - <c>WOULD_CREATE_CYCLE</c> for self, direct child, and deeper descendant
/// - <c>CROSS_PROJECT_PARENT</c>
/// - AC2 concurrency: two parallel reparents that would jointly cycle → exactly one commits
/// - AC4 kind change: re-validates BOTH parent AND all direct children, listing every violating edge
/// - Amendment A6: cross-project relation edges rejected (<c>TRACKER.CROSS_PROJECT_RELATION</c>)
///
/// <para>REQUIRES DOCKER.</para>
/// </summary>
[TestFixture]
[Category("Docker")]
public class HierarchyTests
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

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("tracker_hierarchy_test")
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

    private TrackerHierarchyService Hierarchy() => new(_workItems, _tenantContext);

    private TrackerService Service() => new(
        _projects, _workItems, _preferences,
        new InitiatorOnlyTaskAudienceResolver(),
        new StubModeProvider(), _tenantContext);

    private sealed class StubModeProvider : ITammaModeProvider
    {
        public TammaMode Mode => TammaMode.SingleUser;
    }

    private static DefaultHttpContext Context(string? ifMatch = null)
    {
        var ctx = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddOptions().BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
        };
        if (ifMatch is not null)
            ctx.Request.Headers["If-Match"] = ifMatch;
        return ctx;
    }

    private static async Task<(int Status, JsonElement Body, string? ETag)> Exec(
        IResult result, DefaultHttpContext ctx)
    {
        await result.ExecuteAsync(ctx);
        ctx.Response.Body.Position = 0;
        var raw = await new StreamReader(ctx.Response.Body).ReadToEndAsync();
        var body = string.IsNullOrWhiteSpace(raw)
            ? default
            : JsonDocument.Parse(raw).RootElement.Clone();
        var etag = ctx.Response.Headers.ETag.ToString();
        return (ctx.Response.StatusCode, body, string.IsNullOrEmpty(etag) ? null : etag);
    }

    private Task<ProjectEntity> NewProjectAsync(string key = "TAM") =>
        _projects.CreateAsync(new ProjectEntity
        {
            Key = key,
            Name = $"{key} project",
            EstimateScale = "not_used",
        });

    private Task<WorkItemEntity> NewItemAsync(Guid projectId, string kind, string title = "item") =>
        _workItems.CreateAsync(new WorkItemEntity
        {
            ProjectId = projectId,
            Kind = kind,
            Status = "backlog",
            Title = title,
        });

    [Test]
    public async Task Epic_may_not_be_a_child_of_a_non_epic()
    {
        var project = await NewProjectAsync();
        var allKinds = Enum.GetValues<WorkItemKind>();

        foreach (var parentKind in allKinds)
        {
            foreach (var childKind in allKinds)
            {
                var parent = await NewItemAsync(project.Id, parentKind.ToWire(), $"p-{parentKind}");
                var child = await NewItemAsync(project.Id, childKind.ToWire(), $"c-{childKind}");
                var expectedAllowed = TrackerHierarchy.CanParent(parentKind, childKind);

                var http = Context();
                var (status, body, _) = await Exec(
                    await TrackerEndpoints.SetParent(
                        child.Id,
                        JsonSerializer.Deserialize<SetParentRequest>(
                            $$"""{"parentId":"{{parent.Id}}"}""", Json)!,
                        Hierarchy(), http),
                    http);

                if (expectedAllowed)
                {
                    status.Should().Be(StatusCodes.Status200OK,
                        $"({parentKind}, {childKind}) is permitted by TrackerHierarchy.CanParent");
                    body.GetProperty("parentId").GetGuid().Should().Be(parent.Id);
                }
                else
                {
                    status.Should().Be(StatusCodes.Status400BadRequest,
                        $"({parentKind}, {childKind}) violates the single Epic kind rule");
                    body.GetProperty("code").GetString().Should().Be("KIND_NOT_PERMITTED");
                }
            }
        }
    }

    [Test]
    public async Task Task_under_epic_is_permitted()
    {
        var project = await NewProjectAsync();
        var epic = await NewItemAsync(project.Id, "epic", "root epic");
        var task = await NewItemAsync(project.Id, "task", "direct task under epic");

        var updated = await Hierarchy().ReparentAsync(task.Id, epic.Id, ifMatchVersion: null);
        updated.Should().NotBeNull();
        updated!.ParentId.Should().Be(epic.Id,
            "44-0 deleted the old parenting matrix — Task directly under Epic MUST stay permitted");
    }

    [Test]
    public async Task Exceeding_max_depth_is_rejected()
    {
        var project = await NewProjectAsync();
        // Build a valid chain of exact length TrackerHierarchy.MaxDepth (6): n[0] (depth 1) -> ... -> n[5] (depth 6).
        var chain = new List<WorkItemEntity>();
        for (var i = 0; i < TrackerHierarchy.MaxDepth; i++)
        {
            var node = await NewItemAsync(project.Id, "task", $"level-{i + 1}");
            if (i > 0)
                await Hierarchy().ReparentAsync(node.Id, chain[i - 1].Id, null);
            chain.Add(node);
        }

        // Attaching a leaf under level MaxDepth would reach depth MaxDepth + 1 -> rejected.
        var tooDeep = await NewItemAsync(project.Id, "task", "too-deep");
        var http = Context();
        var (status, body, _) = await Exec(
            await TrackerEndpoints.SetParent(
                tooDeep.Id,
                JsonSerializer.Deserialize<SetParentRequest>(
                    $$"""{"parentId":"{{chain[^1].Id}}"}""", Json)!,
                Hierarchy(), http),
            http);

        status.Should().Be(StatusCodes.Status400BadRequest);
        body.GetProperty("code").GetString().Should().Be("MAX_DEPTH_EXCEEDED");

        // Attaching a 2-node subtree under depth (MaxDepth - 1) would also reach MaxDepth + 1 -> rejected.
        var subRoot = await NewItemAsync(project.Id, "task", "sub-root");
        var subLeaf = await NewItemAsync(project.Id, "task", "sub-leaf");
        await Hierarchy().ReparentAsync(subLeaf.Id, subRoot.Id, null);

        var act = () => Hierarchy().ReparentAsync(subRoot.Id, chain[^2].Id, null);
        (await act.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("MAX_DEPTH_EXCEEDED");
    }

    [Test]
    public async Task Self_and_descendant_parents_are_rejected()
    {
        var project = await NewProjectAsync();
        var a = await NewItemAsync(project.Id, "task", "A");
        var b = await NewItemAsync(project.Id, "task", "B");
        var c = await NewItemAsync(project.Id, "task", "C");
        await Hierarchy().ReparentAsync(b.Id, a.Id, null);
        await Hierarchy().ReparentAsync(c.Id, b.Id, null);

        // Self-parent
        var selfAct = () => Hierarchy().ReparentAsync(a.Id, a.Id, null);
        (await selfAct.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("WOULD_CREATE_CYCLE");

        // Direct child as parent
        var childAct = () => Hierarchy().ReparentAsync(a.Id, b.Id, null);
        (await childAct.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("WOULD_CREATE_CYCLE");

        // Grandchild as parent
        var grandAct = () => Hierarchy().ReparentAsync(a.Id, c.Id, null);
        (await grandAct.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("WOULD_CREATE_CYCLE");

        // Detaching to top-level (null) succeeds.
        var detached = await Hierarchy().ReparentAsync(c.Id, null, null);
        detached!.ParentId.Should().BeNull();
    }

    [Test]
    public async Task Cross_project_parent_is_rejected()
    {
        var projectA = await NewProjectAsync("AAA");
        var projectB = await NewProjectAsync("BBB");
        var parentInA = await NewItemAsync(projectA.Id, "epic", "parent in A");
        var childInB = await NewItemAsync(projectB.Id, "task", "child in B");

        var http = Context();
        var (status, body, _) = await Exec(
            await TrackerEndpoints.SetParent(
                childInB.Id,
                JsonSerializer.Deserialize<SetParentRequest>(
                    $$"""{"parentId":"{{parentInA.Id}}"}""", Json)!,
                Hierarchy(), http),
            http);

        status.Should().Be(StatusCodes.Status400BadRequest);
        body.GetProperty("code").GetString().Should().Be("CROSS_PROJECT_PARENT");
    }

    [Test]
    public async Task Concurrent_reparents_cannot_jointly_cycle()
    {
        // AC2: drive two simultaneous reparents A->B and B->A across two concurrent
        // transactions and assert that EXACTLY ONE succeeds, the other fails with
        // WOULD_CREATE_CYCLE, and the database contains no cycle.
        var project = await NewProjectAsync();
        var a = await NewItemAsync(project.Id, "task", "A");
        var b = await NewItemAsync(project.Id, "task", "B");

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<(bool Succeeded, string? ErrorCode)> TryReparent(Guid childId, Guid parentId)
        {
            await gate.Task;
            try
            {
                await Hierarchy().ReparentAsync(childId, parentId, null);
                return (true, null);
            }
            catch (TammaError te)
            {
                return (false, te.Code);
            }
        }

        var t1 = Task.Run(() => TryReparent(a.Id, b.Id));
        var t2 = Task.Run(() => TryReparent(b.Id, a.Id));
        gate.SetResult();

        var results = await Task.WhenAll(t1, t2);
        results.Count(r => r.Succeeded).Should().Be(1,
            "exactly one of two mutually-cyclic concurrent reparents may commit (AC2)");
        results.Single(r => !r.Succeeded).ErrorCode.Should().Be("WOULD_CREATE_CYCLE");

        // Verify persisted state has NO cycle.
        var aAfter = await _workItems.GetAsync(a.Id);
        var bAfter = await _workItems.GetAsync(b.Id);
        (aAfter!.ParentId == b.Id && bAfter!.ParentId == a.Id).Should().BeFalse(
            "the persisted parent pointers must never contain a cycle");
    }

    [Test]
    public async Task Kind_change_validates_parent_and_children()
    {
        // AC4 / D4: PATCH changing `kind` re-validates BOTH current parent AND all
        // direct children via TrackerHierarchy.CanParent, returning 400 KIND_NOT_PERMITTED
        // with EVERY violating relationship listed.
        var project = await NewProjectAsync();

        // Direction 1 (children): Epic with TWO sub-epic children cannot become a Task.
        var rootEpic = await NewItemAsync(project.Id, "epic", "root epic");
        var subEpic1 = await NewItemAsync(project.Id, "epic", "sub-epic 1");
        var subEpic2 = await NewItemAsync(project.Id, "epic", "sub-epic 2");
        await Hierarchy().ReparentAsync(subEpic1.Id, rootEpic.Id, null);
        await Hierarchy().ReparentAsync(subEpic2.Id, rootEpic.Id, null);

        var httpChildren = Context();
        var (childStatus, childBody, _) = await Exec(
            await TrackerEndpoints.PatchWorkItem(
                rootEpic.Id,
                JsonSerializer.Deserialize<PatchWorkItemRequest>("""{"kind":"task"}""", Json)!,
                Service(), httpChildren),
            httpChildren);

        childStatus.Should().Be(StatusCodes.Status400BadRequest);
        childBody.GetProperty("code").GetString().Should().Be("KIND_NOT_PERMITTED");
        var childViolations = childBody.GetProperty("violations").EnumerateArray().ToList();
        childViolations.Should().HaveCount(2, "every violating child edge must be listed, not just the first");
        childViolations.Select(v => v.GetProperty("relatedItemId").GetGuid())
            .Should().BeEquivalentTo([subEpic1.Id, subEpic2.Id]);
        childViolations.Should().OnlyContain(v => v.GetProperty("direction").GetString() == "child");

        // Direction 2 (parent): Task under a Story cannot become an Epic.
        var story = await NewItemAsync(project.Id, "story", "parent story");
        var task = await NewItemAsync(project.Id, "task", "child task");
        await Hierarchy().ReparentAsync(task.Id, story.Id, null);

        var httpParent = Context();
        var (parentStatus, parentBody, _) = await Exec(
            await TrackerEndpoints.PatchWorkItem(
                task.Id,
                JsonSerializer.Deserialize<PatchWorkItemRequest>("""{"kind":"epic"}""", Json)!,
                Service(), httpParent),
            httpParent);

        parentStatus.Should().Be(StatusCodes.Status400BadRequest);
        parentBody.GetProperty("code").GetString().Should().Be("KIND_NOT_PERMITTED");
        var parentViolations = parentBody.GetProperty("violations").EnumerateArray().ToList();
        parentViolations.Should().ContainSingle();
        parentViolations[0].GetProperty("direction").GetString().Should().Be("parent");
        parentViolations[0].GetProperty("relatedItemId").GetGuid().Should().Be(story.Id);

        // Positive confirmation of 44-0's deleted matrix: Story with Task child → task IS permitted.
        var httpAllowed = Context();
        var (allowedStatus, _, _) = await Exec(
            await TrackerEndpoints.PatchWorkItem(
                story.Id,
                JsonSerializer.Deserialize<PatchWorkItemRequest>("""{"kind":"task"}""", Json)!,
                Service(), httpAllowed),
            httpAllowed);
        allowedStatus.Should().Be(StatusCodes.Status200OK,
            "TrackerHierarchy.CanParent(Task, Task) is true under 44-0's single Epic rule");
    }

    [Test]
    public async Task Cross_project_relation_is_rejected()
    {
        // Amendment A6: AddRelationAsync rejects cross-project edges with
        // TRACKER.CROSS_PROJECT_RELATION while permitting same-project edges.
        var projectA = await NewProjectAsync("AAA");
        var projectB = await NewProjectAsync("BBB");
        var a1 = await NewItemAsync(projectA.Id, "task", "A1");
        var a2 = await NewItemAsync(projectA.Id, "task", "A2");
        var b1 = await NewItemAsync(projectB.Id, "task", "B1");

        var crossAct = () => _workItems.AddRelationAsync(a1.Id, b1.Id, WorkItemRelationKind.Blocks);
        (await crossAct.Should().ThrowAsync<TammaError>())
            .Which.Code.Should().Be("TRACKER.CROSS_PROJECT_RELATION");

        var same = await _workItems.AddRelationAsync(a1.Id, a2.Id, WorkItemRelationKind.Blocks);
        same.Should().NotBeNull();
    }
}
