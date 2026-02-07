using System.ComponentModel.DataAnnotations;

namespace Tamma.Api.Models;

/// <summary>
/// Request to start a new mentorship session
/// </summary>
public class StartMentorshipRequest
{
    /// <summary>ID of the story/task to work on</summary>
    [Required]
    [MaxLength(100)]
    public string StoryId { get; set; } = string.Empty;

    /// <summary>ID of the junior developer</summary>
    [Required]
    [MaxLength(100)]
    public string JuniorId { get; set; } = string.Empty;

    /// <summary>Optional configuration for the session</summary>
    public SessionConfiguration? Configuration { get; set; }
}

/// <summary>
/// Configuration options for a mentorship session
/// </summary>
public class SessionConfiguration
{
    /// <summary>Maximum session duration in hours</summary>
    public int? MaxDurationHours { get; set; }

    /// <summary>Minimum code coverage percentage required</summary>
    public int? MinCodeCoverage { get; set; }

    /// <summary>Whether to auto-escalate blockers</summary>
    public bool AutoEscalate { get; set; } = true;

    /// <summary>Notification channels to use</summary>
    public List<string> NotificationChannels { get; set; } = new() { "slack" };
}

/// <summary>
/// Response when starting a mentorship session
/// </summary>
public class MentorshipStartResponse
{
    /// <summary>ID of the created session</summary>
    public Guid SessionId { get; set; }

    /// <summary>ID of the ELSA workflow instance</summary>
    public string WorkflowInstanceId { get; set; } = string.Empty;

    /// <summary>Current status of the session</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Current state in the mentorship workflow</summary>
    public string CurrentState { get; set; } = string.Empty;
}

/// <summary>
/// Request to submit junior's response
/// </summary>
public class JuniorResponseRequest
{
    /// <summary>Session ID</summary>
    [Required]
    public Guid SessionId { get; set; }

    /// <summary>Type of response (assessment, progress_update, etc.)</summary>
    [Required]
    [MaxLength(100)]
    public string ResponseType { get; set; } = string.Empty;

    /// <summary>Response content</summary>
    public Dictionary<string, object> Content { get; set; } = new();
}

/// <summary>
/// Webhook payload for external events
/// </summary>
public class WebhookPayload
{
    /// <summary>Type of webhook event</summary>
    [Required]
    [MaxLength(100)]
    public string EventType { get; set; } = string.Empty;

    /// <summary>Source of the webhook (github, slack, etc.)</summary>
    [Required]
    [MaxLength(100)]
    public string Source { get; set; } = string.Empty;

    /// <summary>Event payload data</summary>
    public Dictionary<string, object> Data { get; set; } = new();

    /// <summary>Timestamp of the event</summary>
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
