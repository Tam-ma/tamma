using System.Text.Json;

namespace Tamma.Core.Entities;

/// <summary>
/// Represents a story or task to be completed during mentorship
/// </summary>
public class Story
{
    /// <summary>Unique identifier (e.g., JIRA ticket ID)</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Story title</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Detailed description</summary>
    public string? Description { get; set; }

    /// <summary>Acceptance criteria (JSON array)</summary>
    public JsonDocument? AcceptanceCriteria { get; set; }

    /// <summary>Technical requirements (JSON object)</summary>
    public JsonDocument? TechnicalRequirements { get; set; }

    /// <summary>Priority level (1-5, 1 being highest)</summary>
    public int Priority { get; set; } = 3;

    /// <summary>Complexity level (1-5, 5 being most complex)</summary>
    public int Complexity { get; set; } = 3;

    /// <summary>Estimated hours to complete</summary>
    public int? EstimatedHours { get; set; }

    /// <summary>Tags for categorization</summary>
    public string[] Tags { get; set; } = Array.Empty<string>();

    /// <summary>Repository URL for the code</summary>
    public string? RepositoryUrl { get; set; }

    /// <summary>JIRA ticket ID (if applicable)</summary>
    public string? JiraTicketId { get; set; }

    /// <summary>When the story was created</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Last update timestamp</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public virtual ICollection<MentorshipSession> Sessions { get; set; } = new List<MentorshipSession>();
}

/// <summary>
/// Complexity levels for stories
/// </summary>
public static class ComplexityLevels
{
    public const int Trivial = 1;
    public const int Simple = 2;
    public const int Medium = 3;
    public const int Complex = 4;
    public const int VeryComplex = 5;

    public static string GetDescription(int level) => level switch
    {
        1 => "Trivial - Can be done in minutes",
        2 => "Simple - Straightforward implementation",
        3 => "Medium - Some complexity involved",
        4 => "Complex - Requires significant thought",
        5 => "Very Complex - Major undertaking",
        _ => "Unknown"
    };
}
