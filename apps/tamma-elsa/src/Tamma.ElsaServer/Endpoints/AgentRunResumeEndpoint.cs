using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Filters;
using Elsa.Workflows.Runtime.Messages;
using Microsoft.AspNetCore.Mvc;
using Tamma.Activities.AgentDispatch;
using Tamma.Activities.AgentDispatch.Models;
using Tamma.Activities.Documents;

namespace Tamma.ElsaServer.Endpoints;

/// <summary>
/// Story 40-3 (AC3) — the engine-side resume seam for <see cref="WaitForAgentRunActivity"/>.
/// Before this endpoint nothing resumed the <c>agent-run</c> bookmark: every GitHub Actions
/// run took the 40-2 <c>Timeout</c> edge.
///
/// <para>Callers: Tamma.Api's <c>AgentRunResumer</c> (driven by the
/// <c>workflow_run.completed</c> webhook) over the internal Tamma.Api→engine hop, and an
/// operator retry. Mirrors <see cref="PrMergedResumeEndpoint"/> and
/// <see cref="DocumentDecisionResumeEndpoint"/>: Elsa admin auth
/// (<c>RequireAuthorization()</c>), bookmark name RECOMPUTED from the request via
/// <see cref="LifecycleBookmarks.ForAgentRun"/> (a caller stating tenant A can only ever
/// resolve tenant A's wait), 409 on ambiguity / drift, atomic claim before running.</para>
///
/// <list type="bullet">
///   <item><b>Drift guard</b> — when the caller sends the stored bookmark name, it must equal
///     the recomputed one, or the call is refused (409) and nothing is resumed.</item>
///   <item><b>Bookmark miss → 202 buffered</b> — the wait may not have committed its bookmark
///     yet; the completion is recorded in <see cref="PendingAgentRunCompletionBuffer"/> and
///     consumed by the activity's reconcile reads or by
///     <c>ReconcileBufferedAgentRunHandler</c> once the bookmark is persisted.</item>
///   <item><b>Lost claim → 404</b> — the bookmark was found but deleting it (the atomic claim)
///     removed nothing, because a concurrent resume (e.g. a GitHub redelivery) claimed it between
///     the lookup and the delete; a benign no-op, never a double-advance. A bookmark that is
///     already gone before the lookup is NOT a 404 — that is the bookmark-miss case above (202,
///     buffered).</item>
///   <item><b>Never mutates a caller dictionary</b> — the resume input is built fresh.</item>
/// </list>
/// </summary>
public static class AgentRunResumeEndpoint
{
    public sealed record ResumeRequest(
        // The tenant segment the wait folded into its bookmark name (empty/null ⇒ "none").
        // Supplied by the receiver-resolved Tamma.Api side, never from the webhook body.
        string? TenantId,
        string? Repository,
        string? BranchName,
        string? SessionId,
        // Optional guards: the stored row's name + instance.
        string? BookmarkName,
        string? WorkflowInstanceId,
        long WorkflowRunId,
        string? Status,
        string? Conclusion,
        string? WorkflowRunUrl,
        string? ArtifactsUrl,
        int DurationSeconds,
        // Story 40-6 — how the completion was observed (webhook | poll). Absent ⇒ webhook.
        string? WakePath = null,
        // The GitHub run's created_at. Carried into a buffered completion so it can only
        // satisfy the dispatch it belongs to.
        DateTime? RunCreatedAt = null);

    public static async Task<IResult> Resume(
        [FromBody] ResumeRequest request,
        [FromServices] IBookmarkStore bookmarkStore,
        [FromServices] IWorkflowRuntime workflowRuntime,
        [FromServices] PendingAgentRunCompletionBuffer pending,
        [FromServices] ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("Tamma.ElsaServer.AgentRunResume");

        if (string.IsNullOrWhiteSpace(request.Repository)
            || string.IsNullOrWhiteSpace(request.BranchName)
            || string.IsNullOrWhiteSpace(request.SessionId))
            return Results.BadRequest(new { error = "repository, branchName and sessionId are required" });
        if (request.WorkflowRunId <= 0)
            return Results.BadRequest(new { error = "workflowRunId must be positive" });

        var name = LifecycleBookmarks.ForAgentRun(
            request.TenantId, request.Repository, request.BranchName, request.SessionId);

        if (!string.IsNullOrEmpty(request.BookmarkName)
            && !string.Equals(request.BookmarkName, name, StringComparison.Ordinal))
        {
            logger.LogError(
                "agent-run resume refused: stored bookmark {Stored} does not match recomputed {Recomputed}",
                request.BookmarkName, name);
            return Results.Conflict(new
            {
                error = "bookmark_name_drift",
                bookmark = name,
                detail = "The stored bookmark name does not match the name recomputed from tenant/repo/branch/session.",
            });
        }

        var input = AgentRunCompletionSignal.ToInput(new AgentMonitorResult(
            WorkflowRunId: request.WorkflowRunId,
            Status: string.IsNullOrWhiteSpace(request.Status) ? "completed" : request.Status,
            Conclusion: request.Conclusion ?? string.Empty,
            WorkflowRunUrl: request.WorkflowRunUrl ?? string.Empty,
            DurationSeconds: Math.Max(0, request.DurationSeconds),
            ArtifactsUrl: request.ArtifactsUrl ?? string.Empty),
            AgentRunCompletionSignal.NormalizeWakePath(request.WakePath),
            request.RunCreatedAt);

        var bookmarks = (await bookmarkStore
            .FindManyAsync(new BookmarkFilter { Name = name }, ct)
            .ConfigureAwait(false)).ToList();

        if (bookmarks.Count == 0)
        {
            pending.Record(name, input);
            logger.LogInformation(
                "No suspended agent-run bookmark {Bookmark} — buffered for reconcile-after-persist", name);
            return Results.Accepted(value: new { buffered = true, bookmark = name });
        }

        if (bookmarks.Count > 1)
        {
            logger.LogError(
                "Ambiguous agent-run bookmark {Bookmark}: {Count} live instances — refusing", name, bookmarks.Count);
            return Results.Conflict(new { error = "ambiguous_bookmark", bookmark = name, count = bookmarks.Count });
        }

        var bookmark = bookmarks[0];
        if (!string.IsNullOrEmpty(request.WorkflowInstanceId)
            && !string.Equals(bookmark.WorkflowInstanceId, request.WorkflowInstanceId, StringComparison.Ordinal))
        {
            logger.LogError(
                "agent-run bookmark {Bookmark} belongs to instance {Actual}, not {Expected} — refusing",
                name, bookmark.WorkflowInstanceId, request.WorkflowInstanceId);
            return Results.Conflict(new { error = "instance_mismatch", bookmark = name });
        }

        var claimed = (await bookmarkStore
            .DeleteAsync(new BookmarkFilter { BookmarkId = bookmark.Id }, ct)
            .ConfigureAwait(false)) > 0;
        if (!claimed)
        {
            logger.LogInformation(
                "agent-run bookmark {Bookmark} claimed by a concurrent resume — benign no-op", name);
            return Results.NotFound(new { error = "bookmark_not_found", bookmark = name });
        }

        var client = await workflowRuntime.CreateClientAsync(bookmark.WorkflowInstanceId, ct).ConfigureAwait(false);
        try
        {
            await client.RunInstanceAsync(
                new RunWorkflowInstanceRequest { BookmarkId = bookmark.Id, Input = input },
                ct).ConfigureAwait(false);
        }
        catch
        {
            // Claimed but the continuation never committed — restore the row so the wait
            // keeps its deadline and a redelivery can retry.
            await bookmarkStore.SaveAsync(bookmark, CancellationToken.None).ConfigureAwait(false);
            throw;
        }

        logger.LogInformation(
            "Resumed agent-run wait {Bookmark} (instance {InstanceId}) with run {RunId} conclusion {Conclusion}",
            name, bookmark.WorkflowInstanceId, request.WorkflowRunId, request.Conclusion ?? "<none>");

        return Results.Ok(new
        {
            resumed = true,
            bookmark = name,
            workflowInstanceId = bookmark.WorkflowInstanceId,
            workflowRunId = request.WorkflowRunId,
        });
    }
}
