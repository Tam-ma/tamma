namespace Tamma.Api.Services;

/// <summary>
/// Service for interacting with ELSA workflows
/// </summary>
public interface IElsaWorkflowService
{
    /// <summary>Start a workflow by name</summary>
    Task<string> StartWorkflowAsync(string workflowName, Dictionary<string, object> input);

    /// <summary>Pause a running workflow</summary>
    Task PauseWorkflowAsync(string instanceId);

    /// <summary>Resume a paused workflow</summary>
    Task ResumeWorkflowAsync(string instanceId);

    /// <summary>Cancel a running workflow</summary>
    Task CancelWorkflowAsync(string instanceId);

    /// <summary>Get workflow status</summary>
    Task<WorkflowStatus> GetWorkflowStatusAsync(string instanceId);

    /// <summary>Send a signal to a workflow</summary>
    Task SendSignalAsync(string instanceId, string signalName, object? payload = null);
}

/// <summary>
/// Workflow status information
/// </summary>
public class WorkflowStatus
{
    public string InstanceId { get; set; } = string.Empty;
    public string WorkflowName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? CurrentActivity { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Dictionary<string, object> Variables { get; set; } = new();
}
