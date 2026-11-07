using FluentAssertions;
using NUnit.Framework;
using Tamma.Core;
using Tamma.Core.AgentDispatch.Resume;

namespace Tamma.Core.Tests.AgentDispatch;

/// <summary>
/// Story 40-4 (AC1, AC2, AC4, AC9) — the pure resume rule. Three tasks, each owning one file,
/// unless a case says otherwise.
/// </summary>
[TestFixture]
public class TaskLoopResumeCalculatorTests
{
    private static readonly IReadOnlyList<TaskListEntry> Tasks = new[]
    {
        new TaskListEntry("T1", new[] { "src/a.cs" }),
        new TaskListEntry("T2", new[] { "src/b.cs" }),
        new TaskListEntry("T3", new[] { "src/c.cs" }),
    };

    private const string TasksJson = "[{\"id\":\"T1\"},{\"id\":\"T2\"},{\"id\":\"T3\"}]";

    private static TaskRunRecord Ok(int i, params string[] files) => new(i, Tasks[i].Id, true, files);
    private static TaskRunRecord Failed(int i) => new(i, Tasks[i].Id, false, []);
    private static TaskRunRecord Suspended(int i) => new(i, Tasks[i].Id, null, []);
    private static HashSet<string> Branch(params string[] files) => new(files, StringComparer.Ordinal);

    private static TaskLoopResumePosition Run(IReadOnlyList<TaskRunRecord> runs, IReadOnlySet<string>? branch,
        IReadOnlyList<TaskListEntry>? tasks = null)
        => TaskLoopResumeCalculator.Compute(tasks ?? Tasks, runs, branch, TasksJson);

    // ── Start at 0 ────────────────────────────────────────────────────────

    [Test]
    public void No_runs_starts_at_zero()
    {
        var p = Run([], Branch());
        p.ResumeIndex.Should().Be(0);
        p.BasisCode.Should().Be(TaskResumeBasis.NoRuns);
        p.IsReEntry.Should().BeFalse();
        p.TasksJson.Should().BeNull("a start at 0 runs whatever list the cycle just produced");
    }

    [Test]
    public void Runs_but_no_stored_list_starts_at_zero()
        => Run([Ok(0, "src/a.cs")], Branch("src/a.cs"), tasks: []).BasisCode.Should().Be(TaskResumeBasis.NoTaskList);

    [Test]
    public void Unreadable_git_starts_at_zero()
        => Run([Ok(0, "src/a.cs")], branch: null).BasisCode.Should().Be(TaskResumeBasis.GitUnreadable);

    [Test]
    public void Task_zero_failed_starts_at_zero()
    {
        var p = Run([Failed(0)], Branch("src/a.cs"));
        p.ResumeIndex.Should().Be(0);
        p.BasisCode.Should().Be(TaskResumeBasis.NothingLanded,
            "a failed run explains partial commits; re-running the task on top of them is correct");
    }

    // ── Skip landed tasks ─────────────────────────────────────────────────

    [Test]
    public void Landed_prefix_resumes_at_the_next_task()
    {
        var p = Run([Ok(0, "src/a.cs"), Ok(1, "src/b.cs")], Branch("src/a.cs", "src/b.cs"));

        p.ResumeIndex.Should().Be(2);
        p.LandedIndices.Should().Equal(0, 1);
        p.BasisCode.Should().Be(TaskResumeBasis.Resumed);
        p.TasksJson.Should().Be(TasksJson, "a re-entry must run the stored list its indices refer to");
    }

    [Test]
    public void All_landed_resumes_past_the_end()
    {
        var p = Run([Ok(0, "src/a.cs"), Ok(1, "src/b.cs"), Ok(2, "src/c.cs")], Branch("src/a.cs", "src/b.cs", "src/c.cs"));
        p.ResumeIndex.Should().Be(3);
        p.BasisCode.Should().Be(TaskResumeBasis.AllLanded);
    }

    [Test]
    public void In_flight_task_with_no_result_is_where_we_resume()
        => Run([Ok(0, "src/a.cs"), Suspended(1)], Branch("src/a.cs")).ResumeIndex.Should().Be(1);

    [Test]
    public void Task_finished_through_debug_retry_counts_as_finished_because_a_later_task_ran()
    {
        // Task 0's agent run failed, the debug-retry leg fixed it (no AGENT_RUN row of its
        // own), and the loop moved on to task 1 — which it only does after task 0 passed.
        var p = Run([Failed(0), Suspended(1)], Branch("src/a.cs"));
        p.ResumeIndex.Should().Be(1);
        p.LandedIndices.Should().Equal(0);
    }

    [Test]
    public void Without_reported_files_the_task_list_files_are_checked()
        => Run([Ok(0)], Branch("src/a.cs")).ResumeIndex.Should().Be(1);

    [Test]
    public void A_task_with_no_files_at_all_lands_on_its_run_alone()
    {
        var tasks = new[] { new TaskListEntry("T1", []), Tasks[1], Tasks[2] };
        Run([Ok(0)], Branch(), tasks).ResumeIndex.Should().Be(1);
    }

    [Test]
    public void Paths_compare_without_leading_dot_slash()
        => Run([Ok(0, "./src/a.cs")], Branch("/src/a.cs")).ResumeIndex.Should().Be(1);

    [Test]
    public void Same_inputs_same_answer() // AC2: re-entering twice decides the same way
    {
        var runs = new[] { Ok(0, "src/a.cs"), Suspended(1) };
        Run(runs, Branch("src/a.cs")).Should().BeEquivalentTo(Run(runs, Branch("src/a.cs")));
    }

    // ── AC9: the stored list must match what the runs recorded ───────────

    [Test]
    public void Reordered_stored_list_restarts_at_zero_not_k_plus_one()
    {
        var reordered = new[] { Tasks[1], Tasks[0], Tasks[2] };

        var p = Run([Ok(0, "src/a.cs"), Ok(1, "src/b.cs")], Branch("src/a.cs", "src/b.cs"), reordered);

        p.ResumeIndex.Should().Be(0);
        p.BasisCode.Should().Be(TaskResumeBasis.TaskListMismatch);
    }

    [Test]
    public void A_run_without_a_recorded_task_id_restarts_at_zero()
        => Run([new TaskRunRecord(0, null, true, ["src/a.cs"])], Branch("src/a.cs"))
            .BasisCode.Should().Be(TaskResumeBasis.TaskListMismatch);

    [Test]
    public void A_stored_task_without_an_id_restarts_at_zero()
    {
        var tasks = new[] { new TaskListEntry(null, ["src/a.cs"]), Tasks[1] };
        Run([new TaskRunRecord(0, null, true, ["src/a.cs"])], Branch("src/a.cs"), tasks)
            .BasisCode.Should().Be(TaskResumeBasis.TaskListMismatch);
    }

    [Test]
    public void A_run_beyond_the_stored_list_restarts_at_zero()
        => Run([new TaskRunRecord(5, "T6", true, [])], Branch())
            .BasisCode.Should().Be(TaskResumeBasis.TaskListMismatch);

    // ── AC4: disagreement fails loud ──────────────────────────────────────

    [Test]
    public void Done_but_files_missing_from_the_branch_is_inconsistent()
    {
        var act = () => Run([Ok(0, "src/a.cs"), Suspended(1)], Branch());

        act.Should().Throw<TammaError>()
            .Where(e => e.Code == TaskLoopResumeCalculator.InconsistentStateCode)
            .WithMessage("*task 0 is recorded as done*src/a.cs*replay*");
    }

    [Test]
    public void Files_on_the_branch_with_no_finished_run_is_inconsistent()
    {
        // Task 1 was dispatched (suspended row), the engine died, and its file is on the
        // branch: the agent may have finished. Re-running or skipping would both be guesses.
        var act = () => Run([Ok(0, "src/a.cs"), Suspended(1)], Branch("src/a.cs", "src/b.cs"));

        act.Should().Throw<TammaError>()
            .Where(e => e.Code == TaskLoopResumeCalculator.InconsistentStateCode)
            .WithMessage("*task 1's files*no finished run*");
    }

    [Test]
    public void Shared_files_with_an_earlier_task_do_not_trigger_the_no_run_check()
    {
        // Task 1 only edits a file task 0 already changed: its presence proves nothing.
        var tasks = new[] { Tasks[0], new TaskListEntry("T2", ["src/a.cs"]), Tasks[2] };
        Run([Ok(0, "src/a.cs"), Suspended(1)], Branch("src/a.cs"), tasks).ResumeIndex.Should().Be(1);
    }

    [Test]
    public void Duplicate_run_records_are_a_caller_bug()
    {
        var act = () => Run([Ok(0), Ok(0)], Branch("src/a.cs"));
        act.Should().Throw<ArgumentException>();
    }
}
