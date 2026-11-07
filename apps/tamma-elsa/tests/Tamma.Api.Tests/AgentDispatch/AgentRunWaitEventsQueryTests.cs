using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Core;
using Tamma.Api.Dtos.Engine;
using Tamma.Api.Endpoints;
using Tamma.Api.Tests.Infrastructure;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-6 (AC3, AC4) — the engine's <c>AGENT_RUN.*</c> rows, pushed through the real
/// engine-events endpoint into a real Postgres <c>domain_events</c>, come back from the 4-7
/// query by (tenant, type, issue) one row per task, each with its task index and task id.
/// That query is what 40-4's re-entry reads.
/// </summary>
[TestFixture]
public class AgentRunWaitEventsQueryTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-4060-4060-4060-aaaaaaaaaaaa");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-4060-4060-4060-bbbbbbbbbbbb");
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-42";

    private PostgreSqlContainer _postgres = null!;
    private ITenantDbContextFactory _factory = null!;
    private EventRepository _repo = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("agent_run_wait_events")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseNpgsql(_postgres.GetConnectionString())
            .Options;
        await using (var db = new TestTenantDbContext(options, TenantA))
            await db.Database.EnsureCreatedAsync();

        _factory = new TestTenantDbContextFactory(options);
        _repo = new EventRepository(_factory, new TenantContext(), platformEvents: null);
    }

    [OneTimeTearDown]
    public async Task OneTimeTearDown()
    {
        if (_postgres is not null) await _postgres.DisposeAsync();
    }

    [Test]
    public async Task Received_rows_query_back_per_task_with_index_and_id()
    {
        await AppendAsync(TenantA,
            Wait(AgentRunWaitEventTypes.WaitSuspended, TenantA, 42, 0, "T1"),
            Wait(AgentRunWaitEventTypes.Received, TenantA, 42, 0, "T1"),
            Wait(AgentRunWaitEventTypes.WaitSuspended, TenantA, 42, 1, "T2"),
            Wait(AgentRunWaitEventTypes.Received, TenantA, 42, 1, "T2"),
            // Another issue in the same tenant — must not be returned.
            Wait(AgentRunWaitEventTypes.Received, TenantA, 7, 0, "X1"));
        // Same issue number in another tenant — must not leak (AC4).
        await AppendAsync(TenantB, Wait(AgentRunWaitEventTypes.Received, TenantB, 42, 0, "B1"));

        var rows = await _repo.QueryAsync(TenantA, AgentRunWaitEventTypes.Received, 42, 50);

        rows.Should().HaveCount(2);
        rows.Should().OnlyContain(r => r.TenantId == TenantA && r.IssueNumber == 42);
        var tasks = rows
            .Select(r => JsonDocument.Parse(r.Data).RootElement)
            .Select(d => (Index: d.GetProperty("taskIndex").GetInt32(), Id: d.GetProperty("taskId").GetString()))
            .OrderBy(t => t.Index)
            .ToList();
        tasks.Should().Equal((0, "T1"), (1, "T2"));

        var tags = JsonDocument.Parse(rows[0].Tags).RootElement;
        tags.GetProperty("correlationId").GetString().Should().MatchRegex(@"^adl-42-task-\d$");
        tags.GetProperty("tenantId").GetString().Should().Be(TenantA.ToString());
        tags.GetProperty("repository").GetString().Should().Be(Repo);
        tags.GetProperty("branchName").GetString().Should().Be(Branch);
    }

    private static TammaEvent Wait(string type, Guid tenant, int issue, int index, string taskId)
        => WaitForAgentRunActivity.BuildWaitEvent(
            type, TaskSessionId.For(issue, index), issue, Repo, Branch, tenant, index, taskId,
            new Dictionary<string, object?> { ["wakePath"] = AgentRunWaitEventTypes.WakePaths.Webhook, ["success"] = true });

    /// <summary>Send the engine's own wire records through the API's engine-events handler.</summary>
    private async Task AppendAsync(Guid tenant, params TammaEvent[] events)
    {
        var wire = events.Select(EventPersistenceMiddleware.ToWireRecord).ToList();
        var json = JsonSerializer.Serialize(wire);
        var records = JsonSerializer.Deserialize<List<EngineEventRecord>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        var tc = new TenantContext();
        tc.SetTenantId(tenant);
        var repo = new EventRepository(_factory, tc, platformEvents: null);

        var result = await EngineEndpoints.AppendEvents(new AppendEventsRequest(records), repo, tc);
        result.GetType().Name.Should().StartWith("Created", "every event in the batch must persist");
    }
}
