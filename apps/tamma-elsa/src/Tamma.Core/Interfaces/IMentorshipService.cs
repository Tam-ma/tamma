using Tamma.Core.Entities;
using Tamma.Core.Enums;

namespace Tamma.Core.Interfaces;

/// <summary>
/// Service for managing mentorship sessions
/// </summary>
public interface IMentorshipService
{
    /// <summary>Create a new mentorship session</summary>
    Task<MentorshipSession> CreateSessionAsync(string storyId, string juniorId);

    /// <summary>Get session by ID</summary>
    Task<MentorshipSession?> GetSessionAsync(Guid sessionId);

    /// <summary>Get session with all related details</summary>
    Task<MentorshipSessionDetails?> GetSessionWithDetailsAsync(Guid sessionId);

    /// <summary>Get paginated list of sessions</summary>
    Task<PagedResult<MentorshipSessionSummary>> GetSessionsAsync(
        int page = 1,
        int pageSize = 20,
        string? juniorId = null,
        string? status = null);

    /// <summary>Update session state</summary>
    Task UpdateSessionStateAsync(Guid sessionId, MentorshipState newState, string? reason = null);

    /// <summary>Update session with workflow instance ID</summary>
    Task UpdateSessionWorkflowAsync(Guid sessionId, string workflowInstanceId);

    /// <summary>Update session context</summary>
    Task UpdateSessionContextAsync(Guid sessionId, object contextUpdate);

    /// <summary>Pause a session</summary>
    Task PauseSessionAsync(Guid sessionId);

    /// <summary>Resume a paused session</summary>
    Task ResumeSessionAsync(Guid sessionId);

    /// <summary>Cancel a session</summary>
    Task CancelSessionAsync(Guid sessionId);

    /// <summary>Complete a session</summary>
    Task CompleteSessionAsync(Guid sessionId);

    /// <summary>Mark session as failed</summary>
    Task FailSessionAsync(Guid sessionId, string reason);

    /// <summary>Get events for a session</summary>
    Task<List<MentorshipEvent>> GetSessionEventsAsync(Guid sessionId);

    /// <summary>Log an event to a session</summary>
    Task LogEventAsync(Guid sessionId, string eventType, object? eventData = null);

    /// <summary>Get dashboard analytics</summary>
    Task<DashboardAnalytics> GetDashboardAnalyticsAsync();
}

/// <summary>
/// Extended session details including related entities
/// </summary>
public class MentorshipSessionDetails
{
    public Guid Id { get; set; }
    public string StoryId { get; set; } = string.Empty;
    public string JuniorId { get; set; } = string.Empty;
    public string? JuniorName { get; set; }
    public string? StoryTitle { get; set; }
    public MentorshipState CurrentState { get; set; }
    public MentorshipState? PreviousState { get; set; }
    public SessionStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? WorkflowInstanceId { get; set; }
    public Dictionary<string, object>? Context { get; set; }
    public List<MentorshipEvent> RecentEvents { get; set; } = new();
}

/// <summary>
/// Summary view of a mentorship session
/// </summary>
public class MentorshipSessionSummary
{
    public Guid Id { get; set; }
    public string StoryId { get; set; } = string.Empty;
    public string JuniorId { get; set; } = string.Empty;
    public string? JuniorName { get; set; }
    public string? StoryTitle { get; set; }
    public MentorshipState CurrentState { get; set; }
    public SessionStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public double HoursElapsed { get; set; }
    public int EventCount { get; set; }
}

/// <summary>
/// Paginated result container
/// </summary>
public class PagedResult<T>
{
    public List<T> Items { get; set; } = new();
    public int TotalItems { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalPages => (int)Math.Ceiling((double)TotalItems / PageSize);
    public bool HasPrevious => Page > 1;
    public bool HasNext => Page < TotalPages;
}

/// <summary>
/// Dashboard analytics data
/// </summary>
public class DashboardAnalytics
{
    public int ActiveSessions { get; set; }
    public int CompletedToday { get; set; }
    public int CompletedThisWeek { get; set; }
    public double AverageCompletionHours { get; set; }
    public double SuccessRate { get; set; }
    public Dictionary<MentorshipState, int> SessionsByState { get; set; } = new();
    public Dictionary<string, int> TopBlockerTypes { get; set; } = new();
    public List<JuniorProgressSummary> TopPerformers { get; set; } = new();
}

/// <summary>
/// Junior developer progress summary
/// </summary>
public class JuniorProgressSummary
{
    public string JuniorId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int TotalSessions { get; set; }
    public int SuccessfulSessions { get; set; }
    public double SuccessRate { get; set; }
    public int SkillLevel { get; set; }
}
