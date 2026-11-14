namespace Tamma.Platforms.Abstractions.Models;

/// <summary>
/// Epic 31 P3 — input shape for
/// <see cref="IGitPlatformActionsClient.ListRunsAsync"/>: the
/// newest-first run/pipeline listing the CI mediation plane's
/// build-status read (latest run on a branch) and the CI completion
/// poller ride on.
/// </summary>
/// <param name="Branch">
/// Branch / ref to filter on. Null lists the repo's runs across refs
/// (platform default ordering, newest first).
/// </param>
/// <param name="PerPage">
/// Maximum number of runs to return (drivers clamp to a sane
/// platform-side page size). The mediation build-status read asks
/// for 1 (the latest run).
/// </param>
/// <param name="WorkflowFileName">
/// Only runs of this workflow file (e.g. the agent runner's file). Null = any workflow.
/// </param>
/// <param name="Event">
/// Only runs started by this event (e.g. <c>workflow_dispatch</c>). Null = any event.
/// </param>
/// <remarks>
/// A driver must honour <see cref="WorkflowFileName"/> / <see cref="Event"/> (server-side and/or
/// via <see cref="WorkflowRunFilter"/>) or return <c>capability_unsupported</c> — never ignore
/// them and return unfiltered runs.
/// </remarks>
public sealed record ListWorkflowRunsRequest(
    string? Branch = null,
    int PerPage = 5,
    string? WorkflowFileName = null,
    string? Event = null);
