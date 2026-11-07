using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.PromptStore;
using Tamma.Core.Logging;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.AgentDispatch;

/// <summary>Story 40-3 — a terminal <c>workflow_run</c>, as the webhook (or an operator) reports it.</summary>
public sealed record AgentRunCompletion(
    long? InstallationId,
    string Repository,
    string? HeadBranch,
    long WorkflowRunId,
    string Status,
    string Conclusion,
    string WorkflowRunUrl,
    string ArtifactsUrl,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    // Story 40-3b — how the completion was observed: the webhook, or the reconciler's poll.
    string WakePath = AgentRunWaitEventTypes.WakePaths.Webhook,
    // workflow_run.path and workflow_run.event, as the webhook delivered them. The webhook
    // always passes a value ("" when GitHub omitted it, which then matches nothing); null means
    // the caller already identified the run (the reconciler's discovery).
    string? WorkflowPath = null,
    string? Event = null);

/// <summary>Story 40-3 — what one resume attempt did.</summary>
public enum AgentRunResumeOutcome
{
    /// <summary>No pending row for this principal + key (not a Tamma run, or already received).</summary>
    NoMatch,
    /// <summary>More than one pending row and no unique latest-before-run pick — skipped, never a wrong resume.</summary>
    Ambiguous,
    /// <summary>The engine resumed the bookmark; the row is received.</summary>
    Resumed,
    /// <summary>The engine had no committed bookmark yet and buffered the completion; the row is received.</summary>
    Buffered,
    /// <summary>The bookmark was already burned (redelivery / timeout) or the row CAS was lost.</summary>
    AlreadyResumed,
    /// <summary>Drift or ambiguity refusal (stored name ≠ recomputed, engine 409). Row stays pending; loud.</summary>
    Refused,
    /// <summary>The engine could not be reached or failed. Row stays pending.</summary>
    EngineError,
}

/// <summary>Story 40-3 — resumes a suspended <c>WaitForAgentRunActivity</c> from a run completion.</summary>
public interface IAgentRunResumer
{
    Task<AgentRunResumeOutcome> ResumeFromWorkflowRunAsync(AgentRunCompletion completion, CancellationToken ct = default);
}

/// <summary>
/// Story 40-3 (AC2, AC7, AC8) — the durable resume path. Any Tamma.Api pod can run it: it
/// reads the <c>agent_run_waits</c> row (shared DB) and resumes the persisted Elsa bookmark
/// through the engine's <c>AgentRunResumeEndpoint</c> — Elsa's bookmark store is the
/// cross-pod backplane, no in-memory registry is consulted.
///
/// <para><b>Principal from the installation, never from ambient state.</b>
/// <c>/api/github/webhooks</c> is tenant-free. SaaS: the installation row's tenant (an
/// unknown installation, or none on the payload, resolves nothing). single-user: the sole
/// user. The row lookup then also matches the installation id (review-finding-5).</para>
///
/// <para><b>Exactly once.</b> The engine claims the bookmark atomically; the row moves
/// <c>pending → received</c> by CAS. A redelivery finds no pending row (no-op).</para>
/// </summary>
public sealed class AgentRunResumer : IAgentRunResumer
{
    internal const string ElsaClientName = Ci.CiCompletionPollerService.ElsaClientName;
    internal const string ResumePath = "/elsa/api/agent-runs/resume";

    // Story 40-6: this side records only AGENT_RUN.RESUME_UNRESOLVED. AGENT_RUN.RECEIVED is
    // recorded once, by the engine's WaitForAgentRunActivity when the wait actually wakes —
    // it knows the task index/id and the collected result; this side does not.
    private const string ResumeUnresolvedEventType = AgentRunWaitEventTypes.ResumeUnresolved;

    private readonly IAgentRunWaitRepository _waits;
    private readonly IInstallationRepository _installations;
    private readonly ITammaModeProvider _mode;
    private readonly ISoleUserProvider? _soleUser;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IEventRepository _events;
    private readonly ILogger<AgentRunResumer> _logger;

    public AgentRunResumer(
        IAgentRunWaitRepository waits,
        IInstallationRepository installations,
        ITammaModeProvider mode,
        ISoleUserProvider? soleUser,
        IHttpClientFactory httpClientFactory,
        IEventRepository events,
        ILogger<AgentRunResumer> logger)
    {
        _waits = waits ?? throw new ArgumentNullException(nameof(waits));
        _installations = installations ?? throw new ArgumentNullException(nameof(installations));
        _mode = mode ?? throw new ArgumentNullException(nameof(mode));
        _soleUser = soleUser;
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<AgentRunResumeOutcome> ResumeFromWorkflowRunAsync(
        AgentRunCompletion completion, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(completion);
        if (string.IsNullOrWhiteSpace(completion.HeadBranch) || string.IsNullOrWhiteSpace(completion.Repository))
            return AgentRunResumeOutcome.NoMatch;

        var principal = await ResolvePrincipalAsync(completion.InstallationId, ct).ConfigureAwait(false);
        if (principal is null) return AgentRunResumeOutcome.NoMatch;

        var rows = principal.TenantId is { } tid
            ? await _waits.ListPendingByTenantAsync(tid, completion.InstallationId, completion.Repository, completion.HeadBranch, ct).ConfigureAwait(false)
            : await _waits.ListPendingByUserAsync(principal.UserId!.Value, completion.InstallationId, completion.Repository, completion.HeadBranch, ct).ConfigureAwait(false);

        if (rows.Count == 0) return AgentRunResumeOutcome.NoMatch;

        // Only the agent's own run may resume the wait: a run of the dispatched workflow file,
        // started by a dispatch, created no earlier than the dispatch. The repo's normal CI
        // (triggered by the agent's push to the same branch) never qualifies.
        var candidates = rows.Where(r => IsAgentRunFor(r, completion)).ToList();
        if (candidates.Count == 0)
        {
            _logger.LogInformation(
                "workflow_run {RunId} on {Repo}@{Branch} is not the agent run for any of {Count} pending wait(s) — ignored",
                completion.WorkflowRunId, LogSanitizer.Clean(completion.Repository),
                LogSanitizer.Clean(completion.HeadBranch), rows.Count);
            return AgentRunResumeOutcome.NoMatch;
        }

        var row = Pick(candidates, completion.CreatedAt);
        if (row is null)
        {
            _logger.LogError(
                "workflow_run {RunId} on {Repo}@{Branch} matches {Count} pending agent-run waits with no unique pick — skipping",
                completion.WorkflowRunId, LogSanitizer.Clean(completion.Repository),
                LogSanitizer.Clean(completion.HeadBranch), rows.Count);
            return AgentRunResumeOutcome.Ambiguous;
        }

        // Drift + principal guard: the stored name must be the one recomputed from the
        // row's own durable fields, and (SaaS) folded with THIS tenant.
        var recomputed = LifecycleBookmarks.ForAgentRun(
            row.BookmarkTenantId?.ToString(), row.Repository, row.BranchName, row.SessionId);
        var foreignTenant = principal.TenantId is { } t && row.BookmarkTenantId != t;
        if (foreignTenant || !string.Equals(recomputed, row.BookmarkName, StringComparison.Ordinal))
        {
            _logger.LogError(
                "agent-run wait {WaitId} refused: stored bookmark does not match the recomputed {Recomputed} for this principal",
                row.Id, recomputed);
            await EmitAsync(ResumeUnresolvedEventType, principal, row, completion, "bookmark_name_drift", ct).ConfigureAwait(false);
            return AgentRunResumeOutcome.Refused;
        }

        HttpStatusCode status;
        try
        {
            var engine = _httpClientFactory.CreateClient(ElsaClientName);
            using var response = await engine.PostAsJsonAsync(ResumePath, new
            {
                tenantId = row.BookmarkTenantId?.ToString(),
                repository = row.Repository,
                branchName = row.BranchName,
                sessionId = row.SessionId,
                bookmarkName = row.BookmarkName,
                workflowInstanceId = row.WorkflowInstanceId,
                workflowRunId = completion.WorkflowRunId,
                status = completion.Status,
                conclusion = completion.Conclusion,
                workflowRunUrl = completion.WorkflowRunUrl,
                artifactsUrl = completion.ArtifactsUrl,
                durationSeconds = Math.Max(0, (int)(completion.UpdatedAt - completion.CreatedAt).TotalSeconds),
                // Lets the engine match a buffered completion to the dispatch it belongs to.
                runCreatedAt = DateTime.SpecifyKind(completion.CreatedAt, DateTimeKind.Utc),
                wakePath = AgentRunCompletionSignal.NormalizeWakePath(completion.WakePath),
            }, Json, ct).ConfigureAwait(false);
            status = response.StatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "agent-run resume for wait {WaitId} could not reach the engine — row stays pending", row.Id);
            return AgentRunResumeOutcome.EngineError;
        }

        switch (status)
        {
            case HttpStatusCode.OK:
            case HttpStatusCode.Accepted:
            case HttpStatusCode.NotFound:
            {
                var won = await MarkReceivedAsync(principal, row, completion.WorkflowRunId, ct).ConfigureAwait(false);
                if (status == HttpStatusCode.NotFound || !won)
                {
                    _logger.LogInformation(
                        "agent-run wait {WaitId} was already resumed (engine {Status}) — no-op", row.Id, (int)status);
                    return AgentRunResumeOutcome.AlreadyResumed;
                }
                _logger.LogInformation(
                    "agent-run wait {WaitId} ({Bookmark}) {Action} by workflow_run {RunId} ({Conclusion})",
                    row.Id, row.BookmarkName, status == HttpStatusCode.OK ? "resumed" : "buffered",
                    completion.WorkflowRunId, LogSanitizer.Clean(completion.Conclusion));
                return status == HttpStatusCode.OK ? AgentRunResumeOutcome.Resumed : AgentRunResumeOutcome.Buffered;
            }

            case HttpStatusCode.Conflict:
                _logger.LogError("Engine refused agent-run resume for wait {WaitId} (409) — row stays pending", row.Id);
                await EmitAsync(ResumeUnresolvedEventType, principal, row, completion, "engine_conflict", ct).ConfigureAwait(false);
                return AgentRunResumeOutcome.Refused;

            default:
                _logger.LogWarning(
                    "agent-run resume for wait {WaitId} returned {Status} — row stays pending", row.Id, (int)status);
                return AgentRunResumeOutcome.EngineError;
        }
    }

    /// <summary>The runner file a row dispatched when it predates <see cref="AgentRunWait.WorkflowFile"/>.</summary>
    internal const string DefaultWorkflowFile = AgentDispatchMediationService.DefaultWorkflowFile;

    /// <summary>
    /// Allowance between Tamma.Api's clock (<see cref="AgentRunWait.DispatchedAt"/>, taken just
    /// before the dispatch call) and GitHub's (<c>created_at</c>). Matches the 60s window the
    /// mediated run discovery uses.
    /// </summary>
    internal static readonly TimeSpan DispatchClockSkew = TimeSpan.FromSeconds(60);

    /// <summary>
    /// True when <paramref name="completion"/> can be the run <paramref name="row"/> dispatched:
    /// created no earlier than the dispatch (less <see cref="DispatchClockSkew"/>) and — when the
    /// caller reports the workflow (the webhook always does) — a <c>workflow_dispatch</c> run of
    /// the row's workflow file.
    /// </summary>
    internal static bool IsAgentRunFor(AgentRunWait row, AgentRunCompletion completion)
    {
        if (completion.CreatedAt + DispatchClockSkew < row.DispatchedAt) return false;

        if (completion.Event is not null
            && !string.Equals(completion.Event, "workflow_dispatch", StringComparison.Ordinal))
            return false;

        if (completion.WorkflowPath is not null)
        {
            var expected = string.IsNullOrWhiteSpace(row.WorkflowFile) ? DefaultWorkflowFile : row.WorkflowFile;
            if (!string.Equals(WorkflowFileName(completion.WorkflowPath), expected, StringComparison.Ordinal))
                return false;
        }
        return true;
    }

    /// <summary><c>.github/workflows/{file}</c> (optionally <c>@ref</c>-suffixed) → <c>{file}</c>.</summary>
    private static string WorkflowFileName(string path)
    {
        var at = path.IndexOf('@');
        var trimmed = at >= 0 ? path[..at] : path;
        var slash = trimmed.LastIndexOf('/');
        return slash >= 0 ? trimmed[(slash + 1)..] : trimmed;
    }

    /// <summary>
    /// D2 — normally one row. Otherwise the latest dispatched at or before the run's
    /// creation (within <see cref="DispatchClockSkew"/>); a tie (or nothing before it) is
    /// genuine ambiguity. Callers pass only rows that passed <see cref="IsAgentRunFor"/>, so
    /// even a single row has already been held to the dispatch-time guard.
    /// </summary>
    internal static AgentRunWait? Pick(IReadOnlyList<AgentRunWait> rows, DateTime runCreatedAt)
    {
        var before = rows.Where(r => r.DispatchedAt <= runCreatedAt + DispatchClockSkew)
            .OrderByDescending(r => r.DispatchedAt).ToList();
        if (before.Count == 0) return null;
        if (before.Count > 1 && before[0].DispatchedAt == before[1].DispatchedAt) return null;
        return before[0];
    }

    private sealed record Principal(Guid? TenantId, Guid? UserId);

    private async Task<Principal?> ResolvePrincipalAsync(long? installationId, CancellationToken ct)
    {
        if (_mode.Mode == TammaMode.SingleUser)
        {
            if (_soleUser is null) return null;
            try
            {
                return new Principal(null, await _soleUser.GetSoleUserIdAsync(ct).ConfigureAwait(false));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "workflow_run resume: no sole user resolvable (pre-setup deployment) — skipping");
                return null;
            }
        }

        if (installationId is not { } iid) return null;
        var install = await _installations.GetByInstallationIdAsync(iid).ConfigureAwait(false);
        return install?.TenantId is { } tid && tid != Guid.Empty ? new Principal(tid, null) : null;
    }

    private Task<bool> MarkReceivedAsync(Principal principal, AgentRunWait row, long runId, CancellationToken ct)
        => principal.TenantId is { } tid
            ? _waits.TryMarkReceivedByTenantAsync(tid, row.Id, runId, ct)
            : _waits.TryMarkReceivedByUserAsync(principal.UserId!.Value, row.Id, runId, ct);

    private async Task EmitAsync(
        string type, Principal principal, AgentRunWait row, AgentRunCompletion completion, string detail, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try
        {
            // Same tags as the engine's AGENT_RUN.* rows (Story 40-6 AC3). The row does not
            // store the task id; the issue number and index come from the session id.
            int? issueNumber = null, taskIndex = null;
            if (TaskSessionId.TryParse(row.SessionId, out var issue, out var index))
            {
                issueNumber = issue;
                taskIndex = index;
            }
            await _events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = type,
                TenantId = principal.TenantId,
                IssueNumber = issueNumber,
                Tags = JsonSerializer.Serialize(new
                {
                    tenantId = principal.TenantId?.ToString(),
                    userId = principal.UserId?.ToString(),
                    correlationId = row.SessionId,
                    issueNumber = issueNumber?.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    repository = row.Repository,
                    branchName = row.BranchName,
                }),
                Metadata = JsonSerializer.Serialize(new { workflowVersion = "1.0.0", eventSource = "system" }),
                Data = JsonSerializer.Serialize(new
                {
                    issueNumber,
                    sessionId = row.SessionId,
                    taskIndex,
                    taskId = (string?)null,
                    waitId = row.Id,
                    bookmarkName = row.BookmarkName,
                    workflowInstanceId = row.WorkflowInstanceId,
                    workflowRunId = completion.WorkflowRunId,
                    conclusion = completion.Conclusion,
                    detail,
                }),
                CreatedAt = DateTime.UtcNow,
            }).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "{EventType} append failed for wait {WaitId}", type, row.Id);
        }
    }

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
}
