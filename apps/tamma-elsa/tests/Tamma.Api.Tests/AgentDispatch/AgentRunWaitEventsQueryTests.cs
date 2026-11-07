using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
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

    /// <summary>
    /// Story 40-6 AC6 / 40-4 — the feed is usable, not just audit: a suspend→received sequence
    /// for task 0 and a suspend for task 1, saved through the real handler into real Postgres,
    /// is read back by the real <see cref="TaskLoopReEntryService"/> as "task 0 landed, resume
    /// at task 1" (git and the stored task list faked).
    /// </summary>
    [Test]
    public async Task ReEntry_reads_the_saved_feed_and_resumes_after_the_landed_task()
    {
        var tenant = Guid.Parse("cccccccc-4060-4060-4060-cccccccccccc");
        const int issue = 77;
        await AppendAsync(tenant,
            Wait(AgentRunWaitEventTypes.WaitSuspended, tenant, issue, 0, "T1"),
            Wait(AgentRunWaitEventTypes.Received, tenant, issue, 0, "T1", "src/a.cs"),
            Wait(AgentRunWaitEventTypes.WaitSuspended, tenant, issue, 1, "T2"));

        var documents = new Mock<IDocumentInstanceRepository>();
        documents.Setup(d => d.GetLatestAcceptedAsync(tenant, $"{Repo}#{issue}#task-creation", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[]
            {
                new Tamma.Data.Entities.DocumentInstance
                {
                    DocumentType = "plan",
                    BodyJson = "{\"tasks\":[{\"id\":\"T1\",\"files\":[\"src/a.cs\"]},{\"id\":\"T2\",\"files\":[\"src/b.cs\"]}]}",
                },
            });
        var git = new Mock<Tamma.Api.Services.AgentDispatch.IAgentDispatchMediationService>();
        git.Setup(g => g.ListBranchChangedFilesAsync(tenant, Repo, Branch, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { "src/a.cs" });

        var tc = new TenantContext();
        tc.SetTenantId(tenant);
        var service = new Tamma.Api.Services.AgentDispatch.TaskLoopReEntryService(
            new EventRepository(_factory, tc, platformEvents: null), documents.Object, git.Object,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<Tamma.Api.Services.AgentDispatch.TaskLoopReEntryService>.Instance);

        var position = await service.ReconstructAsync(tenant, Repo, Branch, issue, CancellationToken.None);

        position.ResumeIndex.Should().Be(1);
        position.LandedIndices.Should().Equal(0);
    }

    private static TammaEvent Wait(string type, Guid tenant, int issue, int index, string taskId, string? file = null)
        => WaitForAgentRunActivity.BuildWaitEvent(
            type, TaskSessionId.For(issue, index), issue, Repo, Branch, tenant, index, taskId,
            new Dictionary<string, object?>
            {
                ["wakePath"] = AgentRunWaitEventTypes.WakePaths.Webhook,
                ["success"] = true,
                ["filesChanged"] = file is null ? Array.Empty<string>() : new[] { file },
            });

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
