using Microsoft.EntityFrameworkCore;
using Tamma.Core.Entities;
using Tamma.Core.Enums;

namespace Tamma.Data.Repositories;

/// <summary>
/// Repository implementation for mentorship session data access
/// </summary>
public class MentorshipSessionRepository : IMentorshipSessionRepository
{
    private readonly TammaDbContext _context;

    public MentorshipSessionRepository(TammaDbContext context)
    {
        _context = context;
    }

    // ============================================
    // Session Operations
    // ============================================

    public async Task<MentorshipSession> CreateAsync(MentorshipSession session)
    {
        _context.MentorshipSessions.Add(session);
        await _context.SaveChangesAsync();
        return session;
    }

    public async Task<MentorshipSession?> GetByIdAsync(Guid id)
    {
        return await _context.MentorshipSessions
            .Include(s => s.Junior)
            .Include(s => s.Story)
            .FirstOrDefaultAsync(s => s.Id == id);
    }

    public async Task<MentorshipSession?> GetByWorkflowInstanceIdAsync(string workflowInstanceId)
    {
        return await _context.MentorshipSessions
            .Include(s => s.Junior)
            .Include(s => s.Story)
            .FirstOrDefaultAsync(s => s.WorkflowInstanceId == workflowInstanceId);
    }

    public async Task<List<MentorshipSession>> GetByJuniorIdAsync(string juniorId)
    {
        return await _context.MentorshipSessions
            .Include(s => s.Story)
            .Where(s => s.JuniorId == juniorId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    public async Task<List<MentorshipSession>> GetByStoryIdAsync(string storyId)
    {
        return await _context.MentorshipSessions
            .Include(s => s.Junior)
            .Where(s => s.StoryId == storyId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    public async Task<List<MentorshipSession>> GetActiveSessionsAsync()
    {
        return await _context.MentorshipSessions
            .Include(s => s.Junior)
            .Include(s => s.Story)
            .Where(s => s.Status == SessionStatus.Active)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    public async Task<List<MentorshipSession>> GetSessionsByStatusAsync(SessionStatus status)
    {
        return await _context.MentorshipSessions
            .Include(s => s.Junior)
            .Include(s => s.Story)
            .Where(s => s.Status == status)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    public async Task<(List<MentorshipSession> Items, int TotalCount)> GetPagedAsync(
        int page,
        int pageSize,
        string? juniorId = null,
        string? status = null)
    {
        var query = _context.MentorshipSessions
            .Include(s => s.Junior)
            .Include(s => s.Story)
            .AsQueryable();

        if (!string.IsNullOrEmpty(juniorId))
        {
            query = query.Where(s => s.JuniorId == juniorId);
        }

        if (!string.IsNullOrEmpty(status) && Enum.TryParse<SessionStatus>(status, true, out var sessionStatus))
        {
            query = query.Where(s => s.Status == sessionStatus);
        }

        var totalCount = await query.CountAsync();

        var items = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return (items, totalCount);
    }

    public async Task UpdateAsync(MentorshipSession session)
    {
        session.UpdatedAt = DateTime.UtcNow;
        _context.MentorshipSessions.Update(session);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(Guid id)
    {
        var session = await _context.MentorshipSessions.FindAsync(id)
            ?? throw new KeyNotFoundException($"Session {id} not found");
        _context.MentorshipSessions.Remove(session);
        await _context.SaveChangesAsync();
    }

    // ============================================
    // State Management
    // ============================================

    public async Task UpdateStateAsync(Guid sessionId, MentorshipState newState, MentorshipState? previousState = null)
    {
        var session = await _context.MentorshipSessions.FindAsync(sessionId)
            ?? throw new KeyNotFoundException($"Session {sessionId} not found");
        session.PreviousState = previousState ?? session.CurrentState;
        session.CurrentState = newState;
        session.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
    }

    public async Task UpdateStatusAsync(Guid sessionId, SessionStatus status)
    {
        var session = await _context.MentorshipSessions.FindAsync(sessionId)
            ?? throw new KeyNotFoundException($"Session {sessionId} not found");
        session.Status = status;
        session.UpdatedAt = DateTime.UtcNow;

        if (status == SessionStatus.Completed)
        {
            session.CompletedAt = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync();
    }

    public async Task UpdateWorkflowInstanceIdAsync(Guid sessionId, string workflowInstanceId)
    {
        var session = await _context.MentorshipSessions.FindAsync(sessionId)
            ?? throw new KeyNotFoundException($"Session {sessionId} not found");
        session.WorkflowInstanceId = workflowInstanceId;
        session.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
    }

    // ============================================
    // Event Operations
    // ============================================

    public async Task<MentorshipEvent> LogEventAsync(MentorshipEvent eventRecord)
    {
        _context.MentorshipEvents.Add(eventRecord);
        await _context.SaveChangesAsync();
        return eventRecord;
    }

    public async Task<List<MentorshipEvent>> GetEventsBySessionIdAsync(Guid sessionId)
    {
        return await _context.MentorshipEvents
            .Where(e => e.SessionId == sessionId)
            .OrderBy(e => e.CreatedAt)
            .ToListAsync();
    }

    public async Task<List<MentorshipEvent>> GetRecentEventsAsync(Guid sessionId, int count = 10)
    {
        return await _context.MentorshipEvents
            .Where(e => e.SessionId == sessionId)
            .OrderByDescending(e => e.CreatedAt)
            .Take(count)
            .ToListAsync();
    }

    // ============================================
    // Junior Developer Operations
    // ============================================

    public async Task<JuniorDeveloper?> GetJuniorByIdAsync(string id)
    {
        return await _context.JuniorDevelopers.FindAsync(id);
    }

    public async Task<JuniorDeveloper> CreateJuniorAsync(JuniorDeveloper junior)
    {
        _context.JuniorDevelopers.Add(junior);
        await _context.SaveChangesAsync();
        return junior;
    }

    public async Task UpdateJuniorAsync(JuniorDeveloper junior)
    {
        junior.UpdatedAt = DateTime.UtcNow;
        _context.JuniorDevelopers.Update(junior);
        await _context.SaveChangesAsync();
    }

    public async Task<List<JuniorDeveloper>> GetAllJuniorsAsync()
    {
        return await _context.JuniorDevelopers
            .OrderBy(j => j.Name)
            .ToListAsync();
    }

    // ============================================
    // Story Operations
    // ============================================

    public async Task<Story?> GetStoryByIdAsync(string id)
    {
        return await _context.Stories.FindAsync(id);
    }

    public async Task<Story> CreateStoryAsync(Story story)
    {
        _context.Stories.Add(story);
        await _context.SaveChangesAsync();
        return story;
    }

    public async Task UpdateStoryAsync(Story story)
    {
        story.UpdatedAt = DateTime.UtcNow;
        _context.Stories.Update(story);
        await _context.SaveChangesAsync();
    }

    public async Task<List<Story>> GetAllStoriesAsync()
    {
        return await _context.Stories
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    // ============================================
    // Analytics Queries
    // ============================================

    public async Task<int> GetActiveSessionCountAsync()
    {
        return await _context.MentorshipSessions
            .CountAsync(s => s.Status == SessionStatus.Active);
    }

    public async Task<int> GetCompletedSessionCountAsync(DateTime since)
    {
        return await _context.MentorshipSessions
            .CountAsync(s => s.Status == SessionStatus.Completed && s.CompletedAt >= since);
    }

    public async Task<double> GetAverageCompletionTimeAsync(DateTime since)
    {
        var completedSessions = await _context.MentorshipSessions
            .Where(s => s.Status == SessionStatus.Completed &&
                        s.CompletedAt >= since &&
                        s.CompletedAt != null)
            .Select(s => new { s.CreatedAt, s.CompletedAt })
            .ToListAsync();

        if (!completedSessions.Any())
            return 0;

        return completedSessions
            .Average(s => (s.CompletedAt!.Value - s.CreatedAt).TotalHours);
    }

    public async Task<Dictionary<MentorshipState, int>> GetSessionCountByStateAsync()
    {
        return await _context.MentorshipSessions
            .Where(s => s.Status == SessionStatus.Active)
            .GroupBy(s => s.CurrentState)
            .ToDictionaryAsync(g => g.Key, g => g.Count());
    }
}
