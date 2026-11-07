using Tamma.Activities.AgentDispatch;
using Tamma.Core;
using Tamma.Core.AgentDispatch.Resume;
using Tamma.Data;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 40-4 — <c>GET /api/engine/issues/{issueNumber}/task-resume?repository=&amp;branch=</c>.
/// The engine's <see cref="HttpTaskLoopReEntryService"/> calls this to learn where a restarted
/// cycle's task loop should begin. Read-only (no write, no external effect); inherits the
/// engine group's <c>WorkflowsView</c> and is scoped to the caller's tenant.
/// <list type="bullet">
///   <item>200 — a <see cref="TaskLoopResumePosition"/>.</item>
///   <item>409 — git and the event trail disagree (<see cref="HttpTaskLoopReEntryService.InconsistencyBody"/>).</item>
///   <item>400 — repository or branch missing.</item>
/// </list>
/// </summary>
public static class TaskResumeEndpoints
{
    public static async Task<IResult> GetTaskResume(
        int issueNumber,
        string? repository,
        string? branch,
        ITaskLoopReEntryService reEntry,
        ITenantContext tenant,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(repository) || string.IsNullOrWhiteSpace(branch) || issueNumber <= 0)
            return Results.BadRequest(new { error = "issueNumber, repository and branch are required" });

        try
        {
            var position = await reEntry.ReconstructAsync(tenant.TenantId, repository, branch, issueNumber, ct)
                .ConfigureAwait(false);
            return Results.Ok(position);
        }
        catch (TammaError ex) when (ex.Code == TaskLoopResumeCalculator.InconsistentStateCode)
        {
            return Results.Conflict(new HttpTaskLoopReEntryService.InconsistencyBody(ex.Code, ex.Message));
        }
    }
}
