using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Tamma.Core.Tracking;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 44-7 AC3/AC5/AC7 (D4/D5/D6) — native tracker intake source over
/// <c>GET /api/projects</c> and <c>GET /api/work-items?projectId=…&amp;status=ready</c>.
///
/// <para>Honours the tracker's own model rather than GitHub labels: filters
/// projects by <see cref="ProjectAutomationMode"/> (default <c>off</c> yields
/// nothing), selects <c>ready</c> items, stamps <see cref="WorkItem.Source"/> =
/// <c>tracker</c>, <see cref="WorkItem.Key"/> = <c>WorkItemRef.ToWire()</c>,
/// <see cref="WorkItem.Number"/> = <c>0</c>, and orders candidates by
/// <c>Rank</c> (ordinal) then priority.</para>
/// </summary>
public sealed class TrackerIntakeSource : IWorkIntakeSource
{
    private static readonly JsonSerializerOptions s_jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly IHttpClientFactory? _httpClientFactory;
    private readonly IConfiguration? _configuration;
    private readonly ILogger<TrackerIntakeSource>? _logger;

    public WorkIntakeSourceKind Kind => WorkIntakeSourceKind.Tracker;

    public TrackerIntakeSource(
        IHttpClientFactory? httpClientFactory,
        IConfiguration? configuration,
        ILogger<TrackerIntakeSource>? logger = null)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<WorkIntakeResult> FetchAsync(WorkIntakeQuery query, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var apiUrl = _configuration?["Tamma:ApiUrl"];
        if (string.IsNullOrWhiteSpace(apiUrl))
            apiUrl = _configuration?["Engine:CallbackUrl"];

        if (string.IsNullOrWhiteSpace(apiUrl) || _httpClientFactory is null)
        {
            _logger?.LogWarning("No Tamma:ApiUrl or Engine:CallbackUrl configured for tracker intake");
            return new WorkIntakeResult([], 0, Failed: false);
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var baseUrl = apiUrl.TrimEnd('/');

            var projects = await LoadOptedInProjectsAsync(httpClient, baseUrl, query.ProjectId, ct);
            if (projects is null)
                return new WorkIntakeResult([], 0, Failed: true, Error: "Failed to load tracker projects");

            if (projects.Count == 0)
                return new WorkIntakeResult([], 0, Failed: false);

            var candidates = new List<WorkItem>();
            var limit = query.Limit is > 0 and <= 500 ? query.Limit : 50;

            foreach (var project in projects)
            {
                var url = $"{baseUrl}/api/work-items?projectId={project.Id:D}&status=ready&limit={limit}";
                var response = await httpClient.GetAsync(url, ct);
                if (!response.IsSuccessStatusCode)
                {
                    var err = $"Tracker work-items fetch failed for project '{project.Key}' with HTTP {(int)response.StatusCode}";
                    _logger?.LogError("{Error}", err);
                    return new WorkIntakeResult([], 0, Failed: true, Error: err);
                }

                var json = await response.Content.ReadAsStringAsync(ct);
                var page = JsonSerializer.Deserialize<TrackerWorkItemsEnvelope>(json, s_jsonOptions);
                if (page?.Items is null)
                    continue;

                foreach (var row in page.Items)
                {
                    var labels = new List<string>();
                    if (!string.IsNullOrWhiteSpace(row.Kind))
                        labels.Add(row.Kind);
                    if (!string.IsNullOrWhiteSpace(row.IssueType))
                        labels.Add(row.IssueType);

                    candidates.Add(new WorkItem
                    {
                        Key = row.Key,
                        Source = WorkIntakeSourceKind.Tracker,
                        // AC9 / D3: native work items have no platform integer number.
                        Number = 0,
                        Title = row.Title,
                        Body = row.Description,
                        Type = "work-item",
                        Priority = NormalizePriority(row.Priority),
                        Rank = row.Rank,
                        Labels = labels,
                        CreatedAt = row.CreatedAt,
                        Metadata = new Dictionary<string, object?>
                        {
                            ["workItemId"] = row.Id.ToString("D"),
                            ["projectId"] = row.ProjectId.ToString("D"),
                            ["projectKey"] = project.Key,
                            ["automationMode"] = project.AutomationMode,
                            ["rank"] = row.Rank,
                        },
                    });
                }
            }

            // AC7 / D6: rank (ordinal COLLATE "C") then priority (urgent → low), then age.
            candidates.Sort(CompareTrackerCandidates);
            return new WorkIntakeResult(candidates, UntriagedCount: 0, Failed: false);
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error fetching tracker candidates");
            return new WorkIntakeResult([], 0, Failed: true, Error: ex.Message);
        }
    }

    private async Task<List<TrackerProjectWire>?> LoadOptedInProjectsAsync(
        HttpClient httpClient, string baseUrl, Guid? projectId, CancellationToken ct)
    {
        if (projectId is Guid pid && pid != Guid.Empty)
        {
            var resp = await httpClient.GetAsync($"{baseUrl}/api/projects/{pid:D}", ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger?.LogError("Tracker project fetch failed for {ProjectId} with HTTP {Status}", pid, (int)resp.StatusCode);
                return null;
            }
            var body = await resp.Content.ReadAsStringAsync(ct);
            var single = JsonSerializer.Deserialize<TrackerProjectWire>(body, s_jsonOptions);
            if (single is null || !IsOptedIn(single))
                return [];
            return [single];
        }

        var listResp = await httpClient.GetAsync($"{baseUrl}/api/projects", ct);
        if (!listResp.IsSuccessStatusCode)
        {
            _logger?.LogError("Tracker project list fetch failed with HTTP {Status}", (int)listResp.StatusCode);
            return null;
        }
        var listBody = await listResp.Content.ReadAsStringAsync(ct);
        var all = JsonSerializer.Deserialize<List<TrackerProjectWire>>(listBody, s_jsonOptions) ?? [];
        return all.Where(IsOptedIn).ToList();
    }

    private static bool IsOptedIn(TrackerProjectWire project) =>
        project.ArchivedAt is null
        && ProjectAutomationModeExtensions.TryParse(project.AutomationMode ?? "off", out var mode)
        && mode.AllowsIntake();

    internal static int CompareTrackerCandidates(WorkItem a, WorkItem b)
    {
        var rankComp = string.CompareOrdinal(a.Rank ?? string.Empty, b.Rank ?? string.Empty);
        if (rankComp != 0)
            return rankComp;
        var pComp = SelectWorkItemActivity.PriorityValue(a.Priority)
            .CompareTo(SelectWorkItemActivity.PriorityValue(b.Priority));
        if (pComp != 0)
            return pComp;
        return a.CreatedAt.CompareTo(b.CreatedAt);
    }

    private static string NormalizePriority(string? wire) => wire switch
    {
        "urgent" or "critical" => "urgent",
        "high" => "high",
        "low" => "low",
        _ => "normal",
    };

    private sealed class TrackerProjectWire
    {
        [JsonPropertyName("id")] public Guid Id { get; set; }
        [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
        [JsonPropertyName("automationMode")] public string? AutomationMode { get; set; }
        [JsonPropertyName("archivedAt")] public DateTime? ArchivedAt { get; set; }
    }

    private sealed class TrackerWorkItemsEnvelope
    {
        [JsonPropertyName("items")] public List<TrackerWorkItemWire> Items { get; set; } = [];
    }

    private sealed class TrackerWorkItemWire
    {
        [JsonPropertyName("id")] public Guid Id { get; set; }
        [JsonPropertyName("projectId")] public Guid ProjectId { get; set; }
        [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
        [JsonPropertyName("kind")] public string Kind { get; set; } = string.Empty;
        [JsonPropertyName("issueType")] public string? IssueType { get; set; }
        [JsonPropertyName("priority")] public string? Priority { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("rank")] public string Rank { get; set; } = string.Empty;
        [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    }
}
