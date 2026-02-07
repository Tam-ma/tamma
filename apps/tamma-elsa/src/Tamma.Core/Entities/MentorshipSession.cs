using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Tamma.Core.Enums;

namespace Tamma.Core.Entities;

/// <summary>
/// Represents a mentorship session between Tamma and a junior developer
/// </summary>
public class MentorshipSession
{
    /// <summary>Unique identifier for the session</summary>
    public Guid Id { get; set; }

    /// <summary>ID of the story/task being worked on</summary>
    public string StoryId { get; set; } = string.Empty;

    /// <summary>ID of the junior developer being mentored</summary>
    public string JuniorId { get; set; } = string.Empty;

    /// <summary>Current state in the mentorship workflow</summary>
    public MentorshipState CurrentState { get; set; } = MentorshipState.INIT_STORY_PROCESSING;

    /// <summary>Previous state (for tracking transitions)</summary>
    public MentorshipState? PreviousState { get; set; }

    /// <summary>Session context data (JSON)</summary>
    public JsonDocument? Context { get; set; }

    /// <summary>Workflow variables (JSON)</summary>
    public JsonDocument? Variables { get; set; }

    /// <summary>ELSA workflow instance ID</summary>
    public string? WorkflowInstanceId { get; set; }

    /// <summary>When the session was created</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Last update timestamp</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When the session was completed (if applicable)</summary>
    public DateTime? CompletedAt { get; set; }

    /// <summary>Current status of the session</summary>
    public SessionStatus Status { get; set; } = SessionStatus.Active;

    /// <summary>Concurrency token for optimistic concurrency control</summary>
    [Timestamp]
    public byte[] RowVersion { get; set; } = Array.Empty<byte>();

    // Navigation properties
    public virtual JuniorDeveloper? Junior { get; set; }
    public virtual Story? Story { get; set; }
    public virtual ICollection<MentorshipEvent> Events { get; set; } = new List<MentorshipEvent>();
}

/// <summary>
/// Status of a mentorship session
/// </summary>
public enum SessionStatus
{
    Active,
    Completed,
    Failed,
    Paused,
    Cancelled
}
