using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Core;
using Tamma.Api.Dtos.Engine;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Core;
using Tamma.Core.AgentDispatch.Resume;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-4 (AC1, AC5, AC8, AC9) — the real re-entry read, with the event store, document
/// store and git read faked. The event rows are produced by the engine's own builder and the
/// API's own engine-events handler, so the service reads exactly what production writes.
/// </summary>
[TestFixture]
public class TaskLoopReEntryServiceTests
{
    private static readonly Guid Tenant = Guid.Parse("aaaaaaaa-4040-4040-4040-aaaaaaaaaaaa");
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-42";
    private const int Issue = 42;

    private const string PlanBody =
        "{\"tasks\":[" +
        "{\"id\":\"T1\",\"description\":\"a\",\"files\":[\"src/a.cs\"],\"dependsOn\":[],\"testing\":\"t\"}," +
        "{\"id\":\"T2\",\"description\":\"b\",\"files\":[\"src/b.cs\"],\"dependsOn\":[\"T1\"],\"testing\":\"t\"}," +
        "{\"id\":\"T3\",\"description\":\"c\",\"files\":[\"src/c.cs\"],\"dependsOn\":[\"T2\"],\"testing\":\"t\"}]}";

    private List<DomainEvent> _stored = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<IDocumentInstanceRepository> _documents = null!;
    private Mock<IAgentDispatchMediationService> _git = null!;

    [SetUp]
    public void SetUp()
    {
        _stored = new List<DomainEvent>();
        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent e) => { e.SequenceNumber = _stored.Count + 1; _stored.Add(e); return e; });
        _events.Setup(e => e.QueryAsync(It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<int?>(), It.IsAny<int>()))
            .ReturnsAsync((Guid? t, string? type, int? issue, int limit) => _stored
                .Where(e => e.TenantId == t && e.Type == type && e.IssueNumber == issue)
                .OrderByDescending(e => e.SequenceNumber).Take(limit).ToList());

        _documents = new Mock<IDocumentInstanceRepository>();
        StoredPlan(PlanBody);

        _git = new Mock<IAgentDispatchMediationService>();
        BranchFiles("src/a.cs", "src/b.cs");
    }

    [Test]
    public async Task Resumes_after_the_landed_tasks_and_returns_the_stored_list()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        await RecordAsync(1, "T2", success: true, "src/b.cs");
        await RecordAsync(2, "T3", success: null);

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(2);
        p.LandedIndices.Should().Equal(0, 1);
        JsonDocument.Parse(p.TasksJson!).RootElement.GetArrayLength().Should().Be(3);
        _documents.Verify(d => d.GetLatestAcceptedAsync(Tenant, $"{Repo}#{Issue}#task-creation", It.IsAny<CancellationToken>()));
        _git.Verify(g => g.ListBranchChangedFilesAsync(Tenant, Repo, Branch, It.IsAny<CancellationToken>()));
    }

    [Test]
    public async Task No_runs_is_a_fresh_start_without_reading_git_or_documents()
    {
        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.BasisCode.Should().Be(TaskResumeBasis.NoRuns);
        _git.VerifyNoOtherCalls();
        _documents.VerifyNoOtherCalls();
    }

    [Test]
    public async Task Only_this_repo_and_branch_count()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", repo: "acme/other");
        await RecordAsync(0, "T1", success: true, "src/a.cs", branch: "tamma/issue-42-old");

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.BasisCode.Should().Be(TaskResumeBasis.NoRuns);
    }

    [Test]
    public async Task The_latest_result_for_a_task_wins()
    {
        await RecordAsync(0, "T1", success: false);
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        BranchFiles("src/a.cs");

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(1);
    }

    [Test]
    public async Task A_reordered_stored_list_restarts_at_zero() // AC9 falsifier
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        await RecordAsync(1, "T2", success: true, "src/b.cs");
        StoredPlan(PlanBody.Replace("\"id\":\"T1\"", "\"id\":\"TMP\"").Replace("\"id\":\"T2\"", "\"id\":\"T1\"").Replace("\"id\":\"TMP\"", "\"id\":\"T2\""));

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(0);
        p.BasisCode.Should().Be(TaskResumeBasis.TaskListMismatch);
    }

    [Test]
    public async Task No_accepted_task_list_restarts_at_zero()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        _documents.Setup(d => d.GetLatestAcceptedAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<DocumentInstance>());

        (await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None))
            .BasisCode.Should().Be(TaskResumeBasis.NoTaskList);
    }

    [Test]
    public async Task Unreadable_git_restarts_at_zero()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        _git.Setup(g => g.ListBranchChangedFilesAsync(It.IsAny<Guid?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyList<string>?)null);

        (await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None))
            .BasisCode.Should().Be(TaskResumeBasis.GitUnreadable);
    }

    [Test]
    public async Task Done_but_not_on_the_branch_throws_the_inconsistency()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        BranchFiles();

        var act = () => Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        (await act.Should().ThrowAsync<TammaError>()).Which.Code.Should().Be(TaskLoopResumeCalculator.InconsistentStateCode);
    }

    [Test]
    public async Task No_tenant_is_a_fresh_start()
        => (await Service().ReconstructAsync(null, Repo, Branch, Issue, CancellationToken.None))
            .BasisCode.Should().Be(TaskResumeBasis.NoRuns);

    // ── Attempt scope: only the attempt that crashed counts (2026-11-07 audit) ──

    [Test]
    public async Task A_previous_attempt_that_ended_is_not_read_even_when_its_files_are_gone() // scenario A
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1");
        await EndAsync("wf-1", CycleEvents.StepFailed);
        BranchFiles(); // the new attempt works on a fresh branch

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(0);
        p.BasisCode.Should().Be(TaskResumeBasis.NoRuns);
    }

    [Test]
    public async Task A_previous_attempt_that_ended_does_not_skip_tasks_even_when_its_files_remain() // scenario B
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1");
        await RecordAsync(1, "T2", success: true, "src/b.cs", instance: "wf-1");
        await EndAsync("wf-1");

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(0);
        p.BasisCode.Should().Be(TaskResumeBasis.NoRuns);
    }

    [Test]
    public async Task A_loud_reentry_failure_ends_the_attempt_so_the_next_one_starts_clean()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1"); // crashed: no end
        await EndAsync("wf-2", CycleEvents.StepFailed);                          // refused re-entry, failed loud
        BranchFiles();

        (await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None))
            .BasisCode.Should().Be(TaskResumeBasis.NoRuns, "wf-3 must not inherit wf-1's records forever");
    }

    [Test]
    public async Task A_crash_after_an_ended_attempt_reads_only_the_crashed_attempt()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1");
        await RecordAsync(1, "T2", success: true, "src/b.cs", instance: "wf-1");
        await EndAsync("wf-1");
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-2"); // crashed during T2
        BranchFiles("src/a.cs"); // wf-2 started from a fresh branch

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(1);
        p.LandedIndices.Should().Equal(0);
    }

    [Test]
    public async Task Back_to_back_crashes_are_one_attempt()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1"); // crashed
        await RecordAsync(1, "T2", success: true, "src/b.cs", instance: "wf-2"); // re-entered at 1, crashed

        var p = await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None);

        p.ResumeIndex.Should().Be(2);
        p.LandedIndices.Should().Equal(0, 1);
    }

    [Test]
    public async Task An_end_in_another_repository_does_not_close_this_attempt()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1");
        await EndAsync("wf-x", repo: "acme/other");
        BranchFiles("src/a.cs");

        (await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None))
            .ResumeIndex.Should().Be(1);
    }

    [Test]
    public async Task An_ended_instances_rows_never_count_even_if_stored_after_a_later_end()
    {
        await EndAsync("wf-2");                                                  // a later instance ended first in the store
        await RecordAsync(0, "T1", success: true, "src/a.cs", instance: "wf-1");
        await EndAsync("wf-1");
        BranchFiles("src/a.cs");

        (await Service().ReconstructAsync(Tenant, Repo, Branch, Issue, CancellationToken.None))
            .BasisCode.Should().Be(TaskResumeBasis.NoRuns);
    }

    // ── The endpoint the engine calls ─────────────────────────────────────

    [Test]
    public async Task Endpoint_returns_the_position()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        BranchFiles("src/a.cs");
        var result = await TaskResumeEndpoints.GetTaskResume(Issue, Repo, Branch, Service(), TenantScope(), CancellationToken.None);

        result.Should().BeOfType<Microsoft.AspNetCore.Http.HttpResults.Ok<TaskLoopResumePosition>>()
            .Which.Value!.ResumeIndex.Should().Be(1);
    }

    [Test]
    public async Task Endpoint_maps_an_inconsistency_to_409()
    {
        await RecordAsync(0, "T1", success: true, "src/a.cs");
        BranchFiles();
        var result = await TaskResumeEndpoints.GetTaskResume(Issue, Repo, Branch, Service(), TenantScope(), CancellationToken.None);

        var conflict = result.Should().BeOfType<Microsoft.AspNetCore.Http.HttpResults.Conflict<HttpTaskLoopReEntryService.InconsistencyBody>>().Subject;
        conflict.Value!.Code.Should().Be(TaskLoopResumeCalculator.InconsistentStateCode);
    }

    [TestCase(null, Branch)]
    [TestCase(Repo, null)]
    [TestCase(Repo, " ")]
    public async Task Endpoint_requires_repository_and_branch(string? repo, string? branch)
    {
        var result = await TaskResumeEndpoints.GetTaskResume(Issue, repo, branch, Service(), TenantScope(), CancellationToken.None);
        result.GetType().Name.Should().StartWith("BadRequest");
    }

    // ── Harness ───────────────────────────────────────────────────────────

    private TaskLoopReEntryService Service()
        => new(_events.Object, _documents.Object, _git.Object, NullLogger<TaskLoopReEntryService>.Instance);

    private static TenantContext TenantScope()
    {
        var tc = new TenantContext();
        tc.SetTenantId(Tenant);
        return tc;
    }

    private void StoredPlan(string body)
        => _documents.Setup(d => d.GetLatestAcceptedAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[]
            {
                new DocumentInstance { Id = Guid.NewGuid(), DocumentType = "plan", IssueId = $"{Repo}#{Issue}#task-creation", BodyJson = body },
            });

    private void BranchFiles(params string[] files)
        => _git.Setup(g => g.ListBranchChangedFilesAsync(It.IsAny<Guid?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(files);

    /// <summary>
    /// Record a task's run the way production does: the wait's own event builder, through the
    /// API's engine-events handler. <paramref name="success"/> null = suspended, no result yet.
    /// </summary>
    private async Task RecordAsync(int index, string taskId, bool? success, string? file = null,
        string repo = Repo, string branch = Branch, string instance = "wf-1")
    {
        var events = new List<TammaEvent>
        {
            WaitForAgentRunActivity.BuildWaitEvent(AgentRunWaitEventTypes.WaitSuspended,
                TaskSessionId.For(Issue, index), Issue, repo, branch, Tenant, index, taskId),
        };
        if (success is bool ok)
            events.Add(WaitForAgentRunActivity.BuildWaitEvent(AgentRunWaitEventTypes.Received,
                TaskSessionId.For(Issue, index), Issue, repo, branch, Tenant, index, taskId,
                new Dictionary<string, object?>
                {
                    ["wakePath"] = "webhook",
                    ["success"] = ok,
                    ["filesChanged"] = file is null ? Array.Empty<string>() : new[] { file },
                }));

        await PersistAsync(events, instance);
    }

    /// <summary>
    /// The end of a cycle instance, as the cycle writes it (<see cref="EmitCycleEventActivity.BuildTammaEvent"/>).
    /// </summary>
    private Task EndAsync(string instance, string type = CycleEvents.Ended, string repo = Repo)
        => PersistAsync(new List<TammaEvent> { EmitCycleEventActivity.BuildTammaEvent(type, Issue, repo, Tenant, null, null) }, instance);

    /// <summary>Through the API's engine-events handler, stamped with the emitting instance (as the emitter does).</summary>
    private async Task PersistAsync(List<TammaEvent> events, string instance)
    {
        foreach (var e in events) e.WorkflowInstanceId = instance;
        var json = JsonSerializer.Serialize(events.Select(EventPersistenceMiddleware.ToWireRecord).ToList());
        var records = JsonSerializer.Deserialize<List<EngineEventRecord>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var result = await EngineEndpoints.AppendEvents(new AppendEventsRequest(records), _events.Object, TenantScope());
        result.GetType().Name.Should().StartWith("Created");
    }
}
