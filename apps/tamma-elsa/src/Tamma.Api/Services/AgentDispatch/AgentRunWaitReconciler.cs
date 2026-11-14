using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using Tamma.Activities.AgentDispatch;
using Tamma.Api.Services.PromptStore;
using Tamma.Core.Logging;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.AgentDispatch;

/// <summary>Story 40-3b — reconciler settings (<c>AgentRuns:Reconciler</c>).</summary>
public sealed class AgentRunWaitReconcilerOptions
{
    public const string Section = "AgentRuns:Reconciler";

    public bool Enabled { get; set; } = true;

    /// <summary>How often a sweep runs.</summary>
    public int IntervalSeconds { get; set; } = 120;

    /// <summary>A wait is only polled once it is this old — the webhook normally arrives sooner.</summary>
    public int StaleAfterMinutes { get; set; } = 10;

    /// <summary>
    /// A wait still pending this long after dispatch is marked <c>timed_out</c>. Must exceed the
    /// engine's own deadline (<c>WaitForAgentRunActivity.EffectiveWaitTimeoutMinutes</c>, 35 by
    /// default), which has already escalated the cycle by then.
    /// </summary>
    public int TimeOutAfterMinutes { get; set; } = 60;

    /// <summary>Upper bound on waits handled per principal per sweep.</summary>
    public int BatchPerPrincipal { get; set; } = 50;
}

/// <summary>What the reconciler does with one stale wait.</summary>
public enum AgentRunWaitSweepAction
{
    /// <summary>The run has not finished and the wait is not past its limit.</summary>
    Wait,
    /// <summary>The run finished: resume the wait the way the webhook would.</summary>
    Resume,
    /// <summary>No completion before the limit: mark the row <c>timed_out</c>.</summary>
    TimeOut,
}

/// <summary>
/// Story 40-3b — a lock held while one principal's waits are swept, so two Tamma.Api pods never
/// sweep the same principal at once, while different principals sweep concurrently.
/// </summary>
public interface IAgentRunSweepLock
{
    /// <summary>The held lock, or <c>null</c> when another sweeper holds this principal.</summary>
    Task<IAsyncDisposable?> TryAcquireAsync(string principalKey, CancellationToken ct);
}

/// <summary>
/// Postgres session advisory lock on the control-plane database. The key folds the principal
/// (unlike <c>HourlyAnalyticsRollupScheduler</c>'s time-only key), so one tenant's sweep never
/// blocks another's.
/// </summary>
public sealed class PostgresAgentRunSweepLock(string connectionString) : IAgentRunSweepLock
{
    public static long KeyFor(string principalKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes("tamma:agent-run-sweep:" + principalKey));
        return BitConverter.ToInt64(hash, 0);
    }

    public async Task<IAsyncDisposable?> TryAcquireAsync(string principalKey, CancellationToken ct)
    {
        var key = KeyFor(principalKey);
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(ct).ConfigureAwait(false);
            await using var cmd = new NpgsqlCommand("SELECT pg_try_advisory_lock(@k)", connection);
            cmd.Parameters.AddWithValue("k", key);
            if (await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false) is true)
                return new Held(connection, key);
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
        await connection.DisposeAsync().ConfigureAwait(false);
        return null;
    }

    private sealed class Held(NpgsqlConnection connection, long key) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                await using var cmd = new NpgsqlCommand("SELECT pg_advisory_unlock(@k)", connection);
                cmd.Parameters.AddWithValue("k", key);
                await cmd.ExecuteScalarAsync().ConfigureAwait(false);
            }
            finally
            {
                // Closing the session releases the lock even if the unlock failed.
                await connection.DisposeAsync().ConfigureAwait(false);
            }
        }
    }
}

/// <summary>
/// Story 40-3b (the 40-3 AC4 split) — recovers agent-run waits whose <c>workflow_run.completed</c>
/// webhook never arrived. Every <see cref="AgentRunWaitReconcilerOptions.IntervalSeconds"/>, for
/// each principal with pending <c>agent_run_waits</c> rows older than
/// <see cref="AgentRunWaitReconcilerOptions.StaleAfterMinutes"/>, under that principal's
/// <see cref="IAgentRunSweepLock"/>:
/// <list type="bullet">
///   <item>looks the run up through the mediated discover call (the tenant's own driver);</item>
///   <item>finished ⇒ resumes the wait through <see cref="IAgentRunResumer"/> — the same path,
///     drift guard and exactly-once claim as the webhook — with wake path <c>poll</c>;</item>
///   <item>still pending past <see cref="AgentRunWaitReconcilerOptions.TimeOutAfterMinutes"/> ⇒
///     marks the row <c>timed_out</c> and records <c>AGENT_RUN.RESUME_UNRESOLVED</c> (the engine
///     wait itself already took its <c>Timeout</c> edge);</item>
///   <item>otherwise leaves it for the next sweep.</item>
/// </list>
/// <para>Hosted in Tamma.Api only — the host that owns the rows, the mediated GitHub reads and the
/// resumer, in both modes (single-user sweeps the control-plane user plane; SaaS sweeps every
/// tenant schema). Fail-soft: one bad wait or tenant never stops the sweep.</para>
/// </summary>
public sealed class AgentRunWaitReconciler : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IAgentRunSweepLock _lock;
    private readonly AgentRunWaitReconcilerOptions _options;
    private readonly ILogger<AgentRunWaitReconciler> _logger;
    private readonly Func<DateTime> _now;

    public AgentRunWaitReconciler(
        IServiceScopeFactory scopes,
        IAgentRunSweepLock sweepLock,
        Microsoft.Extensions.Options.IOptions<AgentRunWaitReconcilerOptions> options,
        ILogger<AgentRunWaitReconciler> logger)
        : this(scopes, sweepLock, options.Value, logger, () => DateTime.UtcNow) { }

    internal AgentRunWaitReconciler(
        IServiceScopeFactory scopes,
        IAgentRunSweepLock sweepLock,
        AgentRunWaitReconcilerOptions options,
        ILogger<AgentRunWaitReconciler> logger,
        Func<DateTime> now)
    {
        _scopes = scopes ?? throw new ArgumentNullException(nameof(scopes));
        _lock = sweepLock ?? throw new ArgumentNullException(nameof(sweepLock));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _now = now;
    }

    /// <summary>Pure: what to do with one stale wait given what the platform says about its run.</summary>
    public static AgentRunWaitSweepAction Decide(
        AgentRunWait wait, AgentRunStatusResult? run, DateTime now, AgentRunWaitReconcilerOptions options)
    {
        if (run is { Success: true, Found: true, RunId: > 0 }
            && string.Equals(run.Status, "completed", StringComparison.OrdinalIgnoreCase))
            return AgentRunWaitSweepAction.Resume;
        return now - wait.DispatchedAt >= TimeSpan.FromMinutes(options.TimeOutAfterMinutes)
            ? AgentRunWaitSweepAction.TimeOut
            : AgentRunWaitSweepAction.Wait;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Agent-run wait reconciler disabled ({Section}:Enabled=false)", AgentRunWaitReconcilerOptions.Section);
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(10, _options.IntervalSeconds)));
        do
        {
            try
            {
                await SweepOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Agent-run wait sweep failed; retrying next interval");
            }
        }
        while (await WaitTickAsync(timer, stoppingToken).ConfigureAwait(false));
    }

    private static async Task<bool> WaitTickAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try { return await timer.WaitForNextTickAsync(ct).ConfigureAwait(false); }
        catch (OperationCanceledException) { return false; }
    }

    /// <summary>One sweep. Returns what it did (test seam).</summary>
    public async Task<SweepResult> SweepOnceAsync(CancellationToken ct)
    {
        var result = new SweepResult();
        using var scope = _scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var waits = sp.GetRequiredService<IAgentRunWaitRepository>();
        var mode = sp.GetRequiredService<ITammaModeProvider>().Mode;
        var staleBefore = _now() - TimeSpan.FromMinutes(_options.StaleAfterMinutes);

        if (mode == TammaMode.SingleUser)
        {
            // This first read only finds which users have stale waits. Each user's rows are
            // read again under that user's lock, as in SaaS.
            var found = await waits.ListStalePendingByUserAsync(staleBefore, _options.BatchPerPrincipal, ct).ConfigureAwait(false);
            foreach (var userId in found.Select(r => r.UserId!.Value).Distinct())
            {
                if (ct.IsCancellationRequested) break;
                await SweepPrincipalAsync(sp, $"user:{userId:D}", async () =>
                {
                    var rows = await waits.ListStalePendingByUserAsync(staleBefore, _options.BatchPerPrincipal, ct).ConfigureAwait(false);
                    return rows.Where(r => r.UserId == userId).ToList();
                }, result, ct).ConfigureAwait(false);
            }
            return result;
        }

        foreach (var tenantId in await waits.ListTenantsWithStalePendingAsync(staleBefore, ct).ConfigureAwait(false))
        {
            if (ct.IsCancellationRequested) break;
            await SweepPrincipalAsync(sp, $"tenant:{tenantId:D}",
                () => waits.ListStalePendingByTenantAsync(tenantId, staleBefore, _options.BatchPerPrincipal, ct), result, ct)
                .ConfigureAwait(false);
        }
        return result;
    }

    private async Task SweepPrincipalAsync(
        IServiceProvider sp, string principalKey, Func<Task<IReadOnlyList<AgentRunWait>>> load, SweepResult result, CancellationToken ct)
    {
        IAsyncDisposable? held;
        try
        {
            held = await _lock.TryAcquireAsync(principalKey, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Agent-run sweep lock for {Principal} unavailable; skipping", principalKey);
            return;
        }
        if (held is null)
        {
            result.SkippedLocked++;
            return;
        }

        await using (held)
        {
            IReadOnlyList<AgentRunWait> rows;
            try
            {
                // Re-read under the lock: another pod may have just handled these.
                rows = await load().ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Agent-run sweep could not list waits for {Principal}", principalKey);
                return;
            }

            foreach (var wait in rows)
            {
                if (ct.IsCancellationRequested) return;
                try
                {
                    await HandleAsync(sp, wait, result, ct).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Agent-run sweep failed for wait {WaitId}", wait.Id);
                }
            }
        }
    }

    private async Task HandleAsync(IServiceProvider sp, AgentRunWait wait, SweepResult result, CancellationToken ct)
    {
        var mediation = sp.GetRequiredService<IAgentDispatchMediationService>();
        var run = await mediation.DiscoverRunAsync(
            wait.TenantId, wait.Repository, wait.BranchName, wait.DispatchedAt.AddMinutes(-2), wait.SessionId,
            string.IsNullOrWhiteSpace(wait.WorkflowFile) ? AgentRunResumer.DefaultWorkflowFile : wait.WorkflowFile, ct)
            .ConfigureAwait(false);

        switch (Decide(wait, run, _now(), _options))
        {
            case AgentRunWaitSweepAction.Resume:
            {
                var outcome = await sp.GetRequiredService<IAgentRunResumer>().ResumeFromWorkflowRunAsync(new AgentRunCompletion(
                    wait.InstallationId, wait.Repository, wait.BranchName, run!.RunId!.Value,
                    run.Status ?? "completed", run.Conclusion ?? "", run.WorkflowRunUrl ?? "", run.ArtifactsUrl ?? "",
                    // No CreatedAt ⇒ MinValue, which fails the resumer's dispatch-time guard.
                    run.CreatedAt ?? DateTime.MinValue, run.UpdatedAt ?? _now(),
                    AgentRunWaitEventTypes.WakePaths.Poll,
                    // The run's own identity; the resumer refuses when either is missing.
                    WorkflowPath: run.WorkflowPath, Event: run.Event), ct).ConfigureAwait(false);
                result.Resumed.Add((wait.Id, outcome));
                _logger.LogInformation("Agent-run wait {WaitId} ({Repo}@{Branch}) recovered by poll: {Outcome}",
                    wait.Id, LogSanitizer.Clean(wait.Repository), LogSanitizer.Clean(wait.BranchName), outcome);
                break;
            }
            case AgentRunWaitSweepAction.TimeOut:
            {
                var waits = sp.GetRequiredService<IAgentRunWaitRepository>();
                var marked = wait.TenantId is Guid tid
                    ? await waits.TryMarkTimedOutByTenantAsync(tid, wait.Id, ct).ConfigureAwait(false)
                    : await waits.TryMarkTimedOutByUserAsync(wait.UserId!.Value, wait.Id, ct).ConfigureAwait(false);
                if (!marked) return;
                result.TimedOut.Add(wait.Id);
                await EmitUnresolvedAsync(sp.GetRequiredService<IEventRepository>(), wait).ConfigureAwait(false);
                _logger.LogWarning("Agent-run wait {WaitId} ({Repo}@{Branch}) had no completion after {Minutes}min — marked timed_out",
                    wait.Id, LogSanitizer.Clean(wait.Repository), LogSanitizer.Clean(wait.BranchName), _options.TimeOutAfterMinutes);
                break;
            }
            default:
                result.StillWaiting++;
                break;
        }
    }

    private async Task EmitUnresolvedAsync(IEventRepository events, AgentRunWait wait)
    {
        int? issueNumber = null, taskIndex = null;
        if (TaskSessionId.TryParse(wait.SessionId, out var issue, out var index))
        {
            issueNumber = issue;
            taskIndex = index;
        }
        try
        {
            await events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = AgentRunWaitEventTypes.ResumeUnresolved,
                TenantId = wait.TenantId,
                IssueNumber = issueNumber,
                Tags = JsonSerializer.Serialize(new
                {
                    tenantId = wait.TenantId?.ToString(),
                    userId = wait.UserId?.ToString(),
                    correlationId = wait.SessionId,
                    issueNumber = issueNumber?.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    repository = wait.Repository,
                    branchName = wait.BranchName,
                }),
                Metadata = JsonSerializer.Serialize(new { workflowVersion = "1.0.0", eventSource = "system" }),
                Data = JsonSerializer.Serialize(new
                {
                    issueNumber,
                    sessionId = wait.SessionId,
                    taskIndex,
                    taskId = (string?)null,
                    waitId = wait.Id,
                    bookmarkName = wait.BookmarkName,
                    workflowInstanceId = wait.WorkflowInstanceId,
                    wakePath = AgentRunWaitEventTypes.WakePaths.Poll,
                    detail = "no_completion_before_deadline",
                }),
                CreatedAt = _now(),
            }).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "{EventType} append failed for wait {WaitId}", AgentRunWaitEventTypes.ResumeUnresolved, wait.Id);
        }
    }

    /// <summary>What one sweep did.</summary>
    public sealed class SweepResult
    {
        public List<(Guid WaitId, AgentRunResumeOutcome Outcome)> Resumed { get; } = new();
        public List<Guid> TimedOut { get; } = new();
        public int StillWaiting { get; set; }
        public int SkippedLocked { get; set; }
    }
}
