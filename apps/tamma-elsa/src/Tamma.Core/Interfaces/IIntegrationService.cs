namespace Tamma.Core.Interfaces;

/// <summary>
/// Service for external integrations (GitHub, Slack, etc.)
/// </summary>
public interface IIntegrationService
{
    /// <summary>Send a message via Slack</summary>
    Task SendSlackMessageAsync(string channel, string message);

    /// <summary>Send a direct message to a user via Slack</summary>
    Task SendSlackDirectMessageAsync(string userId, string message);

    /// <summary>Send an email notification</summary>
    Task SendEmailAsync(string to, string subject, string body);

    /// <summary>Create a GitHub branch</summary>
    Task<GitHubBranchResult> CreateGitHubBranchAsync(string repository, string branchName);

    /// <summary>Get recent commits from a branch</summary>
    Task<List<GitHubCommit>> GetGitHubCommitsAsync(string repository, string branch, DateTime? since = null);

    /// <summary>Create a pull request</summary>
    Task<GitHubPullRequestResult> CreateGitHubPullRequestAsync(string repository, CreatePullRequestRequest request);

    /// <summary>Merge a pull request</summary>
    Task<GitHubMergeResult> MergeGitHubPullRequestAsync(string repository, int pullRequestNumber);

    /// <summary>Get file changes from a branch</summary>
    Task<List<GitHubFileChange>> GetGitHubFileChangesAsync(string repository, string branch);

    /// <summary>Trigger CI/CD tests</summary>
    Task<TestRunResult> TriggerTestsAsync(string repository, string branch);

    /// <summary>Get build status</summary>
    Task<BuildStatus> GetBuildStatusAsync(string repository, string branch);

    /// <summary>Create or update a JIRA ticket</summary>
    Task<JiraTicketResult> UpdateJiraTicketAsync(string ticketId, JiraTicketUpdate update);

    /// <summary>Get JIRA ticket details</summary>
    Task<JiraTicket?> GetJiraTicketAsync(string ticketId);
}

// ============================================
// GitHub Integration Models
// ============================================

public class GitHubBranchResult
{
    public bool Success { get; set; }
    public string? BranchName { get; set; }
    public string? BranchUrl { get; set; }
    public string? Error { get; set; }
}

public class GitHubCommit
{
    public string Sha { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
    public int Additions { get; set; }
    public int Deletions { get; set; }
    public List<string> Files { get; set; } = new();
}

public class CreatePullRequestRequest
{
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string Head { get; set; } = string.Empty;
    public string Base { get; set; } = "main";
    public List<string> Reviewers { get; set; } = new();
    public List<string> Labels { get; set; } = new();
}

public class GitHubPullRequestResult
{
    public bool Success { get; set; }
    public int? Number { get; set; }
    public string? Url { get; set; }
    public string? Error { get; set; }
}

public class GitHubMergeResult
{
    public bool Success { get; set; }
    public string? MergeSha { get; set; }
    public string? Error { get; set; }
}

public class GitHubFileChange
{
    public string FilePath { get; set; } = string.Empty;
    public string ChangeType { get; set; } = string.Empty;
    public int Additions { get; set; }
    public int Deletions { get; set; }
}

// ============================================
// CI/CD Integration Models
// ============================================

public class TestRunResult
{
    public string RunId { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public int TotalTests { get; set; }
    public int PassedTests { get; set; }
    public int FailedTests { get; set; }
    public int SkippedTests { get; set; }
    public double? CoveragePercentage { get; set; }
    public List<TestResult> FailedTestDetails { get; set; } = new();
}

public class TestResult
{
    public string TestName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public string? StackTrace { get; set; }
    public TimeSpan Duration { get; set; }
}

public class BuildStatus
{
    public string Status { get; set; } = string.Empty;
    public string? BuildUrl { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? Error { get; set; }
}

// ============================================
// JIRA Integration Models
// ============================================

public class JiraTicket
{
    public string Id { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? Assignee { get; set; }
    public string? Priority { get; set; }
    public List<string> Labels { get; set; } = new();
}

public class JiraTicketUpdate
{
    public string? Status { get; set; }
    public string? Comment { get; set; }
    public Dictionary<string, object>? CustomFields { get; set; }
}

public class JiraTicketResult
{
    public bool Success { get; set; }
    public string? TicketKey { get; set; }
    public string? Error { get; set; }
}
