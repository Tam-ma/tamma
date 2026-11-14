namespace Tamma.Platforms.Abstractions.Models;

/// <summary>
/// The workflow-file + event filter of <see cref="ListWorkflowRunsRequest"/>, applied to one run.
/// Drivers that filter on the server still apply it to what comes back; drivers whose API cannot
/// filter apply only this. A run that does not report its path or event never matches an active
/// filter — an unidentified run is never assumed to be the requested one.
/// </summary>
public static class WorkflowRunFilter
{
    /// <summary>True when the request asks for a workflow file and/or event.</summary>
    public static bool IsActive(ListWorkflowRunsRequest request)
        => !string.IsNullOrWhiteSpace(request.WorkflowFileName) || !string.IsNullOrWhiteSpace(request.Event);

    /// <summary>Whether a run with this path and event passes the request's filter.</summary>
    public static bool Matches(ListWorkflowRunsRequest request, string? workflowPath, string? runEvent)
    {
        if (!string.IsNullOrWhiteSpace(request.WorkflowFileName)
            && (workflowPath is null
                || !string.Equals(FileName(workflowPath), request.WorkflowFileName, StringComparison.Ordinal)))
            return false;
        if (!string.IsNullOrWhiteSpace(request.Event)
            && !string.Equals(runEvent, request.Event, StringComparison.Ordinal))
            return false;
        return true;
    }

    /// <summary>
    /// The file name of a run's workflow path: <c>.github/workflows/x.yml</c> → <c>x.yml</c>;
    /// a Gitea-style <c>x.yml@refs/heads/main</c> → <c>x.yml</c>.
    /// </summary>
    public static string FileName(string workflowPath)
    {
        var at = workflowPath.IndexOf('@');
        var trimmed = at >= 0 ? workflowPath[..at] : workflowPath;
        var slash = trimmed.LastIndexOf('/');
        return slash >= 0 ? trimmed[(slash + 1)..] : trimmed;
    }
}
