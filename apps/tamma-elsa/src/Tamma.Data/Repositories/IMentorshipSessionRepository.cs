using Tamma.Core.Entities;
using Tamma.Core.Enums;

namespace Tamma.Data.Repositories;

/// <summary>
/// Repository interface for mentorship session data access
/// </summary>
public interface IMentorshipSessionRepository
{
    // Session operations
    Task<MentorshipSession> CreateAsync(MentorshipSession session);
    Task<MentorshipSession?> GetByIdAsync(Guid id);
    Task<MentorshipSession?> GetByWorkflowInstanceIdAsync(string workflowInstanceId);
    Task<List<MentorshipSession>> GetByJuniorIdAsync(string juniorId);
    Task<List<MentorshipSession>> GetByStoryIdAsync(string storyId);
    Task<List<MentorshipSession>> GetActiveSessionsAsync();
    Task<List<MentorshipSession>> GetSessionsByStatusAsync(SessionStatus status);
    Task<(List<MentorshipSession> Items, int TotalCount)> GetPagedAsync(
        int page,
        int pageSize,
        string? juniorId = null,
        string? status = null);
    Task UpdateAsync(MentorshipSession session);
    Task DeleteAsync(Guid id);

    // State management
    Task UpdateStateAsync(Guid sessionId, MentorshipState newState, MentorshipState? previousState = null);
    Task UpdateStatusAsync(Guid sessionId, SessionStatus status);
    Task UpdateWorkflowInstanceIdAsync(Guid sessionId, string workflowInstanceId);

    // Event operations
    Task<MentorshipEvent> LogEventAsync(MentorshipEvent eventRecord);
    Task<List<MentorshipEvent>> GetEventsBySessionIdAsync(Guid sessionId);
    Task<List<MentorshipEvent>> GetRecentEventsAsync(Guid sessionId, int count = 10);

    // Junior developer operations
    Task<JuniorDeveloper?> GetJuniorByIdAsync(string id);
    Task<JuniorDeveloper> CreateJuniorAsync(JuniorDeveloper junior);
    Task UpdateJuniorAsync(JuniorDeveloper junior);
    Task<List<JuniorDeveloper>> GetAllJuniorsAsync();

    // Story operations
    Task<Story?> GetStoryByIdAsync(string id);
    Task<Story> CreateStoryAsync(Story story);
    Task UpdateStoryAsync(Story story);
    Task<List<Story>> GetAllStoriesAsync();

    // Analytics queries
    Task<int> GetActiveSessionCountAsync();
    Task<int> GetCompletedSessionCountAsync(DateTime since);
    Task<double> GetAverageCompletionTimeAsync(DateTime since);
    Task<Dictionary<MentorshipState, int>> GetSessionCountByStateAsync();
}
