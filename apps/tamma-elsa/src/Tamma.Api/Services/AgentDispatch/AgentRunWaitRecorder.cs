using Tamma.Activities.Documents;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.PromptStore;
using Tamma.Core.Logging;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.AgentDispatch;

/// <summary>Story 40-3 — writes the pending <c>agent_run_waits</c> row for a successful dispatch.</summary>
public interface IAgentRunWaitRecorder
{
    /// <summary>
    /// Write (or re-arm) the pending row. Returns false when no row was written — no
    /// bookmark on the request, a refused name, or a store failure. Never throws: the
    /// dispatch has already succeeded, and a missing row degrades to the wait's
    /// <c>Timeout</c> edge, not to a failed dispatch.
    /// </summary>
    Task<bool> RecordAsync(
        Guid? tenantId, string repo, DispatchAgentRunRequest body, DateTime dispatchedAt, CancellationToken ct = default);
}

/// <summary>
/// Story 40-3 (AC1, D7) — the API-side writer. The engine host has no tenant DB, so the
/// engine sends only what the API cannot derive (<c>bookmarkName</c>,
/// <c>workflowInstanceId</c>, the raw tenant segment); everything else — principal, repo,
/// ref, session, installation — is already here.
///
/// <para><b>Principal per mode.</b> SaaS: the auth-derived tenant; the row lands in that
/// tenant's schema. single-user: the sole user; the row lands on the control plane — no
/// tenant id is required.</para>
///
/// <para><b>Name guard.</b> The stored name must be exactly
/// <see cref="LifecycleBookmarks.ForAgentRun"/> of the request's own fields, and in SaaS its
/// tenant segment must be the dispatching tenant. A tenant-A dispatch can never register
/// a row that would resume tenant B's wait.</para>
/// </summary>
public sealed class AgentRunWaitRecorder(
    IAgentRunWaitRepository waits,
    IInstallationRepository installations,
    ITammaModeProvider mode,
    ISoleUserProvider? soleUser,
    ILogger<AgentRunWaitRecorder> logger) : IAgentRunWaitRecorder
{
    public async Task<bool> RecordAsync(
        Guid? tenantId, string repo, DispatchAgentRunRequest body, DateTime dispatchedAt, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (string.IsNullOrWhiteSpace(body.BookmarkName) || string.IsNullOrWhiteSpace(body.WorkflowInstanceId))
            return false;

        try
        {
            if (string.IsNullOrWhiteSpace(body.Ref) || string.IsNullOrWhiteSpace(body.CorrelationId))
                return Refuse(repo, "ref and correlation id are required");

            var expected = LifecycleBookmarks.ForAgentRun(body.BookmarkTenantId, repo, body.Ref, body.CorrelationId);
            if (!string.Equals(expected, body.BookmarkName, StringComparison.Ordinal))
                return Refuse(repo, "bookmark name is not the ForAgentRun name of the request");

            Guid? bookmarkTenant = null;
            if (!string.IsNullOrWhiteSpace(body.BookmarkTenantId))
            {
                if (!Guid.TryParse(body.BookmarkTenantId, out var parsed))
                    return Refuse(repo, "bookmark tenant segment is not a tenant id");
                bookmarkTenant = parsed == Guid.Empty ? null : parsed;
            }

            var install = await installations.GetByRepoFullNameAsync(repo).ConfigureAwait(false);

            if (mode.Mode == TammaMode.SingleUser)
            {
                if (soleUser is null) return Refuse(repo, "no sole-user provider registered");
                var userId = await soleUser.GetSoleUserIdAsync(ct).ConfigureAwait(false);
                await waits.UpsertPendingByUserAsync(userId,
                    Registration(repo, body, install?.InstallationId, bookmarkTenant, dispatchedAt), ct).ConfigureAwait(false);
                return true;
            }

            if (tenantId is not { } tid || tid == Guid.Empty)
                return Refuse(repo, "SaaS dispatch carried no tenant");
            if (bookmarkTenant != tid)
                return Refuse(repo, "bookmark is folded with a different tenant than the dispatching one");

            var installationId = install?.TenantId == tid ? install.InstallationId : (long?)null;
            await waits.UpsertPendingByTenantAsync(tid,
                Registration(repo, body, installationId, bookmarkTenant, dispatchedAt), ct).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex,
                "agent_run_waits row write failed for {Repo} (session {Session}) — the wait will fall back to its Timeout edge",
                LogSanitizer.Clean(repo), LogSanitizer.Clean(body.CorrelationId));
            return false;
        }
    }

    private static AgentRunWaitRegistration Registration(
        string repo, DispatchAgentRunRequest body, long? installationId, Guid? bookmarkTenant, DateTime dispatchedAt)
        => new(repo, body.Ref, body.CorrelationId, installationId, body.WorkflowInstanceId!, body.BookmarkName!,
            bookmarkTenant, dispatchedAt);

    private bool Refuse(string repo, string reason)
    {
        logger.LogError(
            "agent_run_waits row refused for {Repo}: {Reason} — the wait will fall back to its Timeout edge",
            LogSanitizer.Clean(repo), reason);
        return false;
    }
}
