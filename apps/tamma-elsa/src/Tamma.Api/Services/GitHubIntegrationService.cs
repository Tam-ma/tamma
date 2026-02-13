using System.Net.Http.Json;
using System.Text.Json;
using Tamma.Core.Interfaces;

namespace Tamma.Api.Services;

/// <summary>
/// GitHub integration service — branch, commit, PR, and file-change operations.
/// </summary>
public class GitHubIntegrationService : IGitHubIntegrationService
{
    private readonly ILogger<GitHubIntegrationService> _logger;
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public GitHubIntegrationService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<GitHubIntegrationService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<IntegrationResult<GitHubBranchResult>> CreateGitHubBranchAsync(string repository, string branchName)
    {
        var httpClient = _httpClientFactory.CreateClient("github");
        var token = _configuration["GitHub:Token"];
        if (string.IsNullOrEmpty(token))
        {
            _logger.LogWarning("GitHub token not configured");
            return IntegrationResult<GitHubBranchResult>.Fail("GitHub token not configured");
        }

        try
        {
            _logger.LogInformation("Creating branch {Branch} in {Repo}", branchName, repository);

            // Get default branch SHA
            var refsResponse = await httpClient.GetAsync($"/repos/{repository}/git/refs/heads/main");
            if (!refsResponse.IsSuccessStatusCode)
            {
                refsResponse = await httpClient.GetAsync($"/repos/{repository}/git/refs/heads/master");
            }
            refsResponse.EnsureSuccessStatusCode();

            var refData = await refsResponse.Content.ReadFromJsonAsync<JsonElement>();
            var sha = refData.GetProperty("object").GetProperty("sha").GetString()!;

            // Create the branch
            var createPayload = new
            {
                @ref = $"refs/heads/{branchName}",
                sha
            };
            var createResponse = await httpClient.PostAsJsonAsync($"/repos/{repository}/git/refs", createPayload);
            createResponse.EnsureSuccessStatusCode();

            var result = new GitHubBranchResult
            {
                Success = true,
                BranchName = branchName,
                BranchUrl = $"https://github.com/{repository}/tree/{branchName}"
            };
            return IntegrationResult<GitHubBranchResult>.Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create GitHub branch {Branch}", branchName);
            return IntegrationResult<GitHubBranchResult>.Fail(ex.Message);
        }
    }

    public async Task<IntegrationResult<List<GitHubCommit>>> GetGitHubCommitsAsync(string repository, string branch, DateTime? since = null)
    {
        var httpClient = _httpClientFactory.CreateClient("github");

        try
        {
            var url = $"/repos/{repository}/commits?sha={branch}&per_page=20";
            if (since.HasValue)
            {
                url += $"&since={since.Value:O}";
            }

            var response = await httpClient.GetAsync(url);
            response.EnsureSuccessStatusCode();

            var commits = await response.Content.ReadFromJsonAsync<JsonElement>();
            var results = new List<GitHubCommit>();

            foreach (var commit in commits.EnumerateArray())
            {
                var commitData = commit.GetProperty("commit");
                results.Add(new GitHubCommit
                {
                    Sha = commit.GetProperty("sha").GetString() ?? "",
                    Message = commitData.GetProperty("message").GetString() ?? "",
                    Author = commitData.GetProperty("author").GetProperty("name").GetString() ?? "",
                    Timestamp = commitData.GetProperty("author").GetProperty("date").GetDateTime(),
                    Files = new List<string>()
                });
            }

            return IntegrationResult<List<GitHubCommit>>.Ok(results);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get GitHub commits for {Repo}/{Branch}", repository, branch);
            return IntegrationResult<List<GitHubCommit>>.Fail(ex.Message);
        }
    }

    public async Task<IntegrationResult<GitHubPullRequestResult>> CreateGitHubPullRequestAsync(string repository, CreatePullRequestRequest request)
    {
        var httpClient = _httpClientFactory.CreateClient("github");

        try
        {
            _logger.LogInformation("Creating PR in {Repo}: {Title}", repository, request.Title);

            var payload = new
            {
                title = request.Title,
                body = request.Body,
                head = request.Head,
                @base = request.Base
            };

            var response = await httpClient.PostAsJsonAsync($"/repos/{repository}/pulls", payload);
            response.EnsureSuccessStatusCode();

            var pr = await response.Content.ReadFromJsonAsync<JsonElement>();
            var result = new GitHubPullRequestResult
            {
                Success = true,
                Number = pr.GetProperty("number").GetInt32(),
                Url = pr.GetProperty("html_url").GetString() ?? ""
            };
            return IntegrationResult<GitHubPullRequestResult>.Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create GitHub PR in {Repo}", repository);
            return IntegrationResult<GitHubPullRequestResult>.Fail(ex.Message);
        }
    }

    public async Task<IntegrationResult<GitHubMergeResult>> MergeGitHubPullRequestAsync(string repository, int pullRequestNumber)
    {
        var httpClient = _httpClientFactory.CreateClient("github");

        try
        {
            _logger.LogInformation("Merging PR #{Number} in {Repo}", pullRequestNumber, repository);

            var payload = new { merge_method = "squash" };
            var response = await httpClient.PutAsJsonAsync(
                $"/repos/{repository}/pulls/{pullRequestNumber}/merge", payload);
            response.EnsureSuccessStatusCode();

            var data = await response.Content.ReadFromJsonAsync<JsonElement>();
            var result = new GitHubMergeResult
            {
                Success = data.GetProperty("merged").GetBoolean(),
                MergeSha = data.GetProperty("sha").GetString() ?? ""
            };
            return IntegrationResult<GitHubMergeResult>.Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to merge GitHub PR #{Number}", pullRequestNumber);
            return IntegrationResult<GitHubMergeResult>.Fail(ex.Message);
        }
    }

    public async Task<IntegrationResult<List<GitHubFileChange>>> GetGitHubFileChangesAsync(string repository, string branch)
    {
        var httpClient = _httpClientFactory.CreateClient("github");

        try
        {
            // Compare branch against default branch
            var response = await httpClient.GetAsync(
                $"/repos/{repository}/compare/main...{branch}");
            if (!response.IsSuccessStatusCode)
            {
                response = await httpClient.GetAsync(
                    $"/repos/{repository}/compare/master...{branch}");
            }
            response.EnsureSuccessStatusCode();

            var data = await response.Content.ReadFromJsonAsync<JsonElement>();
            var files = data.GetProperty("files");

            var results = new List<GitHubFileChange>();
            foreach (var file in files.EnumerateArray())
            {
                results.Add(new GitHubFileChange
                {
                    FilePath = file.GetProperty("filename").GetString() ?? "",
                    ChangeType = file.GetProperty("status").GetString() ?? "modified",
                    Additions = file.GetProperty("additions").GetInt32(),
                    Deletions = file.GetProperty("deletions").GetInt32()
                });
            }

            return IntegrationResult<List<GitHubFileChange>>.Ok(results);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get file changes for {Repo}/{Branch}", repository, branch);
            return IntegrationResult<List<GitHubFileChange>>.Fail(ex.Message);
        }
    }
}
