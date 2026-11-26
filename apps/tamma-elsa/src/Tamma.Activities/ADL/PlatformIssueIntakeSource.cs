using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Tamma.Core.Tracking;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 44-7 AC1–AC5 (D1/D2/D4/D5) — platform-issue intake source over
/// <c>GET /api/engine/issues</c>.
///
/// <para>Deserializes the real <c>{ issues, total }</c> envelope via
/// <see cref="EngineIssuesResponse"/> (rejecting non-numeric platform numbers
/// loudly), sets <see cref="WorkItem.Source"/> = <c>platform-issue</c>, and
/// stamps <see cref="WorkItem.Key"/> = <c>{repository}#{number}</c> — byte-identical
/// to <c>CreationBindingHelper.DeriveIssueId</c> so zero existing lineage moves.</para>
/// </summary>
public sealed class PlatformIssueIntakeSource : IWorkIntakeSource
{
    private static readonly JsonSerializerOptions s_jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly IHttpClientFactory? _httpClientFactory;
    private readonly IConfiguration? _configuration;
    private readonly ILogger<PlatformIssueIntakeSource>? _logger;

    public WorkIntakeSourceKind Kind => WorkIntakeSourceKind.PlatformIssue;

    public PlatformIssueIntakeSource(
        IHttpClientFactory? httpClientFactory,
        IConfiguration? configuration,
        ILogger<PlatformIssueIntakeSource>? logger = null)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Byte-identical platform issue key format matching
    /// <c>CreationBindingHelper.DeriveIssueId</c> and
    /// <c>PlanBindingHelper.DeriveIssueId</c> (<c>{repository}#{number}</c>).
    /// </summary>
    public static string FormatPlatformKey(string? repository, int issueNumber) =>
        $"{repository ?? string.Empty}#{issueNumber}";

    public async Task<WorkIntakeResult> FetchAsync(WorkIntakeQuery query, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var callbackUrl = _configuration?["Engine:CallbackUrl"];
        if (string.IsNullOrWhiteSpace(callbackUrl) || _httpClientFactory is null)
        {
            _logger?.LogWarning("No Engine:CallbackUrl configured for platform-issue intake");
            return new WorkIntakeResult([], 0, Failed: false);
        }

        var candidates = new List<WorkItem>();
        var untriaged = 0;

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var baseUrl = callbackUrl.TrimEnd('/');
            var autoLabels = query.AutoLabels ?? Array.Empty<string>();
            var excludeLabels = query.ExcludeLabels ?? Array.Empty<string>();

            var response = await httpClient.GetAsync(
                $"{baseUrl}/api/engine/issues?repo={Uri.EscapeDataString(query.Repository)}&labels={string.Join(",", autoLabels)}",
                ct);

            if (!response.IsSuccessStatusCode)
            {
                var err = $"Engine issues fetch failed with HTTP {(int)response.StatusCode}";
                _logger?.LogError("{Error}", err);
                return new WorkIntakeResult([], 0, Failed: true, Error: err);
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            var envelope = JsonSerializer.Deserialize<EngineIssuesResponse>(json, s_jsonOptions);
            if (envelope?.Issues is { Count: > 0 } issues)
            {
                foreach (var issue in issues)
                {
                    if (issue.Labels.Any(l => excludeLabels.Contains(l)))
                        continue;
                    if (!string.IsNullOrEmpty(issue.Assignee) && issue.Assignee != query.BotAssignee)
                        continue;

                    issue.Priority = SelectWorkItemActivity.ResolvePriority(issue.Labels);
                    issue.Type = "issue";
                    issue.Source = WorkIntakeSourceKind.PlatformIssue;
                    issue.Key = FormatPlatformKey(query.Repository, issue.Number);
                    candidates.Add(issue);
                }
            }

            var triagedLabels = new HashSet<string>(autoLabels.Concat(
            [
                "bug", "feature", "chore", "question", "security", "docs",
                "priority-critical", "priority-high", "priority-medium", "priority-low",
            ]));

            var untriagedResponse = await httpClient.GetAsync(
                $"{baseUrl}/api/engine/issues?repo={Uri.EscapeDataString(query.Repository)}&state=open",
                ct);

            if (untriagedResponse.IsSuccessStatusCode)
            {
                var untriagedJson = await untriagedResponse.Content.ReadAsStringAsync(ct);
                var allIssues = JsonSerializer.Deserialize<EngineIssuesResponse>(untriagedJson, s_jsonOptions)?.Issues;
                if (allIssues is not null)
                    untriaged = allIssues.Count(i => !i.Labels.Any(l => triagedLabels.Contains(l)));
            }

            return new WorkIntakeResult(candidates, untriaged, Failed: false);
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error fetching platform-issue candidates from engine");
            return new WorkIntakeResult([], 0, Failed: true, Error: ex.Message);
        }
    }
}
