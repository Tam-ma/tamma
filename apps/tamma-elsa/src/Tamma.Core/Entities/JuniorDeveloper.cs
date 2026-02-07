using System.Text.Json;

namespace Tamma.Core.Entities;

/// <summary>
/// Represents a junior developer being mentored by Tamma
/// </summary>
public class JuniorDeveloper
{
    /// <summary>Unique identifier (e.g., employee ID)</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Full name of the developer</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Email address</summary>
    public string? Email { get; set; }

    /// <summary>Slack user ID for notifications</summary>
    public string? SlackId { get; set; }

    /// <summary>GitHub username</summary>
    public string? GitHubUsername { get; set; }

    /// <summary>Current skill level (1-5)</summary>
    public int SkillLevel { get; set; } = 1;

    /// <summary>Developer preferences (JSON)</summary>
    public JsonDocument? Preferences { get; set; }

    /// <summary>Detected learning patterns (JSON array)</summary>
    public JsonDocument? LearningPatterns { get; set; }

    /// <summary>Total number of mentorship sessions</summary>
    public int TotalSessions { get; set; }

    /// <summary>Number of successfully completed sessions</summary>
    public int SuccessfulSessions { get; set; }

    /// <summary>When the developer was first registered</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Last update timestamp</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Computed properties
    /// <summary>Success rate as percentage</summary>
    public double SuccessRate => TotalSessions > 0
        ? (double)SuccessfulSessions / TotalSessions * 100
        : 0;

    // Navigation properties
    public virtual ICollection<MentorshipSession> Sessions { get; set; } = new List<MentorshipSession>();
}

/// <summary>
/// Developer skill areas for tracking
/// </summary>
public static class SkillAreas
{
    public const string Frontend = "frontend";
    public const string Backend = "backend";
    public const string Database = "database";
    public const string DevOps = "devops";
    public const string Testing = "testing";
    public const string Security = "security";
    public const string Architecture = "architecture";
    public const string Documentation = "documentation";
    public const string Communication = "communication";
    public const string ProblemSolving = "problem_solving";
}
