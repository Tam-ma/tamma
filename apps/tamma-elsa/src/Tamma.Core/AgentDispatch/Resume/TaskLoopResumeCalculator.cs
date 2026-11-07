namespace Tamma.Core.AgentDispatch.Resume;

/// <summary>One task in the stored (accepted) task list: its <c>PlanTask.id</c> and files.</summary>
public sealed record TaskListEntry(string? Id, IReadOnlyList<string> Files);

/// <summary>
/// What the event stream says about one task's agent runs (Story 40-6 rows, joined by
/// <c>adl-{issue}-task-{index}</c>).
/// </summary>
/// <param name="TaskIndex">Position in the task list the run was for.</param>
/// <param name="TaskId">The <c>PlanTask.id</c> recorded on the run's events; null if none was.</param>
/// <param name="Success">The latest <c>AGENT_RUN.RECEIVED</c>'s result; null when no run finished.</param>
/// <param name="ReportedFiles">Files the latest successful run reported changing.</param>
public sealed record TaskRunRecord(int TaskIndex, string? TaskId, bool? Success, IReadOnlyList<string> ReportedFiles);

/// <summary>Why a resume position was chosen. Stable strings — they appear in events and logs.</summary>
public static class TaskResumeBasis
{
    /// <summary>No agent run is recorded for this issue: a fresh start.</summary>
    public const string NoRuns = "NO_RUNS";
    /// <summary>Some tasks landed; resuming at the first one that did not.</summary>
    public const string Resumed = "RESUMED";
    /// <summary>Runs exist but none landed; resuming at 0.</summary>
    public const string NothingLanded = "NOTHING_LANDED";
    /// <summary>Every task landed; the loop has nothing left to run.</summary>
    public const string AllLanded = "ALL_LANDED";
    /// <summary>Runs exist but no accepted task list could be read; restarting at 0.</summary>
    public const string NoTaskList = "NO_TASK_LIST";
    /// <summary>The stored task list does not match the ids the runs recorded; restarting at 0.</summary>
    public const string TaskListMismatch = "TASK_LIST_MISMATCH";
    /// <summary>The branch's changed files could not be read; restarting at 0.</summary>
    public const string GitUnreadable = "GIT_UNREADABLE";
    /// <summary>Re-entry is switched off (the Null seam); today's behaviour.</summary>
    public const string Disabled = "DISABLED";
    /// <summary>The re-entry read itself failed; restarting at 0 (today's behaviour).</summary>
    public const string ReadFailed = "READ_FAILED";
}

/// <summary>Where a restarted cycle's task loop should begin.</summary>
public sealed record TaskLoopResumePosition
{
    /// <summary>The <c>CurrentTaskIndex</c> to start at. Equals the task count when all landed.</summary>
    public int ResumeIndex { get; init; }

    /// <summary>Indices proven landed (always <c>0..ResumeIndex-1</c>).</summary>
    public IReadOnlyList<int> LandedIndices { get; init; } = [];

    /// <summary>One of <see cref="TaskResumeBasis"/>.</summary>
    public string BasisCode { get; init; } = TaskResumeBasis.NoRuns;

    /// <summary>Human-readable explanation.</summary>
    public string Basis { get; init; } = "";

    /// <summary>
    /// The stored task list (JSON array) the index refers to. Set only when
    /// <see cref="ResumeIndex"/> &gt; 0 — the loop must then run THIS list, not a regenerated one.
    /// </summary>
    public string? TasksJson { get; init; }

    public bool IsReEntry => ResumeIndex > 0;

    public static TaskLoopResumePosition Start(string code, string basis)
        => new() { ResumeIndex = 0, BasisCode = code, Basis = basis };
}

/// <summary>
/// Story 40-4 (AC1, AC2, AC4, AC9) — pure: given the stored task list, the per-task run
/// records and the files changed on the branch, where should a restarted task loop begin?
///
/// <para><b>Rules, in order.</b></para>
/// <list type="number">
///   <item>No runs ⇒ 0. Runs but no stored list, unreadable git, or a run whose recorded
///     task id does not match the stored list at that index ⇒ 0 with the reason. Restarting
///     at 0 re-implements work (wasteful, safe); skipping a task that did not land is a
///     silent hole, so every doubt resolves to 0.</item>
///   <item>Task <c>i</c> is <b>finished</b> when its latest run succeeded, or when any later
///     task has a run — the loop never dispatches task <c>j</c> until task <c>i</c> passed
///     (directly or through the debug-retry leg, which records no run of its own).</item>
///   <item>A finished task is <b>landed</b> when its files are on the branch: the files its
///     run reported, else the files the task list names. A task with no files at all is
///     taken as landed on its run alone.</item>
///   <item>Finished but its files are missing ⇒ <see cref="InconsistentStateCode"/>
///     (the events say done, git disagrees — e.g. a push that never happened).</item>
///   <item>The first unfinished task is the resume index — unless no run of it ever
///     finished and the files only it touches are already on the branch, which means work
///     happened that the events never recorded ⇒ <see cref="InconsistentStateCode"/>.</item>
/// </list>
/// <para>Deterministic: the same inputs always give the same position.</para>
/// </summary>
public static class TaskLoopResumeCalculator
{
    public const string InconsistentStateCode = "CODE.REENTRY.INCONSISTENT_STATE";

    /// <summary>Where an operator looks next (Story 4-8 replay).</summary>
    public const string ReplayHint =
        "Inspect the run with GET /api/engine/runs/{correlationId}/replay (correlationId = adl-{issue}-task-{index}).";

    public static TaskLoopResumePosition Compute(
        IReadOnlyList<TaskListEntry>? tasks,
        IReadOnlyList<TaskRunRecord> runs,
        IReadOnlySet<string>? branchFiles,
        string? tasksJson = null)
    {
        ArgumentNullException.ThrowIfNull(runs);

        if (runs.Count == 0)
            return TaskLoopResumePosition.Start(TaskResumeBasis.NoRuns, "No agent run is recorded for this issue; starting at task 0.");

        if (tasks is null || tasks.Count == 0)
            return TaskLoopResumePosition.Start(TaskResumeBasis.NoTaskList,
                "Agent runs exist but no accepted task list could be read; restarting at task 0.");

        if (branchFiles is null)
            return TaskLoopResumePosition.Start(TaskResumeBasis.GitUnreadable,
                "The branch's changed files could not be read, so no task can be confirmed; restarting at task 0.");

        var byIndex = new Dictionary<int, TaskRunRecord>();
        foreach (var r in runs)
        {
            if (r.TaskIndex < 0 || r.TaskIndex >= tasks.Count)
                return TaskLoopResumePosition.Start(TaskResumeBasis.TaskListMismatch,
                    $"A run is recorded for task {r.TaskIndex}, but the stored list has {tasks.Count} task(s); restarting at task 0.");
            if (byIndex.ContainsKey(r.TaskIndex))
                throw new ArgumentException($"More than one run record for task {r.TaskIndex}.", nameof(runs));
            byIndex[r.TaskIndex] = r;

            var expectedId = tasks[r.TaskIndex].Id;
            if (string.IsNullOrWhiteSpace(expectedId) || !string.Equals(r.TaskId, expectedId, StringComparison.Ordinal))
                return TaskLoopResumePosition.Start(TaskResumeBasis.TaskListMismatch,
                    $"Task {r.TaskIndex}: the run recorded id '{r.TaskId ?? "(none)"}' but the stored list has " +
                    $"'{(string.IsNullOrWhiteSpace(expectedId) ? "(none)" : expectedId)}'; restarting at task 0.");
        }

        var onBranch = new HashSet<string>(branchFiles.Select(Normalize), StringComparer.Ordinal);
        var lastRun = byIndex.Keys.Max();
        var landed = new List<int>();
        var seenFiles = new HashSet<string>(StringComparer.Ordinal);

        for (var i = 0; i < tasks.Count; i++)
        {
            byIndex.TryGetValue(i, out var run);
            var finished = run?.Success == true || lastRun > i;

            if (!finished)
            {
                if (run?.Success is null)
                {
                    var exclusive = tasks[i].Files.Select(Normalize).Where(f => f.Length > 0 && !seenFiles.Contains(f)).ToList();
                    if (exclusive.Count > 0 && exclusive.All(onBranch.Contains))
                        throw Inconsistent(i,
                            $"task {i}'s files ({string.Join(", ", exclusive)}) are already on the branch, " +
                            "but no finished run of it is recorded");
                }
                return Position(i, landed, tasksJson);
            }

            var files = (run?.Success == true && run.ReportedFiles.Count > 0 ? run.ReportedFiles : tasks[i].Files)
                .Select(Normalize).Where(f => f.Length > 0).ToList();
            var missing = files.Where(f => !onBranch.Contains(f)).ToList();
            if (missing.Count > 0)
                throw Inconsistent(i,
                    $"task {i} is recorded as done, but {missing.Count} of its file(s) are not on the branch " +
                    $"({string.Join(", ", missing.Take(5))})");

            foreach (var f in files) seenFiles.Add(f);
            foreach (var f in tasks[i].Files.Select(Normalize)) seenFiles.Add(f);
            landed.Add(i);
        }

        return new TaskLoopResumePosition
        {
            ResumeIndex = tasks.Count,
            LandedIndices = landed,
            BasisCode = TaskResumeBasis.AllLanded,
            Basis = $"All {tasks.Count} task(s) landed; nothing left to run.",
            TasksJson = tasksJson,
        };
    }

    private static TaskLoopResumePosition Position(int index, List<int> landed, string? tasksJson) => index == 0
        ? TaskLoopResumePosition.Start(TaskResumeBasis.NothingLanded, "Agent runs exist but task 0 did not land; starting at task 0.")
        : new TaskLoopResumePosition
        {
            ResumeIndex = index,
            LandedIndices = landed,
            BasisCode = TaskResumeBasis.Resumed,
            Basis = $"Tasks 0..{index - 1} landed (run recorded and files on the branch); resuming at task {index}.",
            TasksJson = tasksJson,
        };

    private static TammaError Inconsistent(int index, string what) => new(
        InconsistentStateCode,
        $"Cannot re-enter the task loop: {what}. Git and the event trail disagree, so no task is skipped or re-run " +
        $"automatically. {ReplayHint}",
        new Dictionary<string, object?> { ["taskIndex"] = index },
        retryable: false,
        severity: TammaErrorSeverity.High);

    /// <summary>Compare paths without a leading <c>./</c> or <c>/</c>.</summary>
    internal static string Normalize(string? path)
    {
        var p = (path ?? "").Trim().Replace('\\', '/');
        while (p.StartsWith("./", StringComparison.Ordinal)) p = p[2..];
        return p.TrimStart('/');
    }
}
