using System.Text.Json;
using System.Text.Json.Serialization;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities.Flowchart.Attributes;
using Elsa.Workflows.Attributes;
using Elsa.Workflows.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Tamma.Activities.ADL.Models;
using Tamma.Activities.Core;
using Tamma.Core.Tracking;

namespace Tamma.Activities.ADL;

/// <summary>
/// Selects the highest-priority work item from configured intake sources
/// (<see cref="IWorkIntakeSource"/> via <see cref="WorkIntakeSourceRegistry"/>):
/// 1. Platform issues with <c>tamma-auto</c> label (<c>platform-issue</c>)
/// 2. Native tracker <c>ready</c> work items in opted-in projects (<c>tracker</c>)
/// 3. Untriaged platform issues (→ trigger triage)
///
/// Outcomes:
///   - Selected: a work item was found
///   - NothingFound: no work items available (or fetch failed loudly in DCB stream)
///   - NeedsTriage: found untriaged issues that need classification
/// </summary>
[Activity(
    "Tamma.ADL",
    "Select Work Item",
    "Find the highest-priority work item from configured intake sources",
    Kind = ActivityKind.Task
)]
[FlowNode("Selected", "NothingFound", "NeedsTriage")]
public class SelectWorkItemActivity : TammaOutcomeActivity
{
    private const string FetchErrorTransientKey = "select:fetchError";
    private const string SelectedSourceTransientKey = "select:source";
    private const string SelectedKeyTransientKey = "select:key";

    public override string? EventType => "ADL.WORKITEM.SELECT";

    private readonly IHttpClientFactory? _httpClientFactory;
    private readonly IConfiguration? _configuration;
    private readonly WorkIntakeSourceRegistry? _registry;

    // --- Inputs ---

    [Input(Description = "Repository (owner/repo)")]
    public Input<string> Repository { get; set; } = default!;

    [Input(Description = "Labels that mark issues for Tamma")]
    public Input<string[]> AutoLabels { get; set; } = new(new[] { "tamma-auto" });

    [Input(Description = "Labels to exclude")]
    public Input<string[]> ExcludeLabels { get; set; } = new(new[] { "blocked", "wontfix", "needs-human" });

    [Input(Description = "Bot username for assignment")]
    public Input<string> BotAssignee { get; set; } = new("tamma-bot");

    // --- Outputs ---

    [Output(Description = "Selected work item as JSON")]
    public Output<string?> WorkItemJson { get; set; } = default!;

    [Output(Description = "Work item type: issue, work-item, security-alert, ci-failure")]
    public Output<string?> WorkItemType { get; set; } = default!;

    [Output(Description = "Issue number (if applicable; 0 for native tracker items)")]
    public Output<int> IssueNumber { get; set; } = default!;

    [Output(Description = "Work item title")]
    public Output<string?> WorkItemTitle { get; set; } = default!;

    [Output(Description = "Resolved priority: urgent, high, normal, low")]
    public Output<string> Priority { get; set; } = default!;

    [Output(Description = "Count of untriaged issues found")]
    public Output<int> UntriagedCount { get; set; } = default!;

    [Output(Description = "Unified issueId / work-item key (WorkItem.Key)")]
    public Output<string?> WorkItemKey { get; set; } = default!;

    [Output(Description = "Intake source wire name (platform-issue | tracker)")]
    public Output<string?> WorkItemSource { get; set; } = default!;

    [JsonConstructor]
    public SelectWorkItemActivity() { }

    public SelectWorkItemActivity(
        ILogger<SelectWorkItemActivity> logger,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        WorkIntakeSourceRegistry? registry = null)
    {
        Logger = logger;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _registry = registry;
    }

    protected override async Task RunAsync(ActivityExecutionContext context)
    {
        var repo = Repository.Get(context);
        var autoLabels = AutoLabels.Get(context);
        var excludeLabels = ExcludeLabels.Get(context);
        var bot = BotAssignee.Get(context);

        var configuration = _configuration ?? context.GetService<IConfiguration>();
        var httpClientFactory = _httpClientFactory ?? context.GetService<IHttpClientFactory>();
        var registry = _registry ?? context.GetService<WorkIntakeSourceRegistry>();

        var useMock = configuration?.GetValue<bool>("Anthropic:UseMock") ?? false;

        var candidates = new List<WorkItem>();
        var untriaged = 0;
        var fetchErrors = new List<string>();

        if (useMock)
        {
            candidates = SimulateCandidates(repo);
            untriaged = 0;
        }
        else
        {
            var effectiveRegistry = registry ?? BuildDefaultRegistry(httpClientFactory, configuration);
            var configuredNames = WorkIntakeSourceRegistry.ReadConfiguredSourceNames(configuration);
            var sources = effectiveRegistry.ResolveConfigured(configuredNames);

            var hasAnyEndpoint = !string.IsNullOrWhiteSpace(configuration?["Engine:CallbackUrl"])
                || !string.IsNullOrWhiteSpace(configuration?["Tamma:ApiUrl"]);
            if (!hasAnyEndpoint || (httpClientFactory is null && registry is null))
            {
                Logger?.LogWarning("No Engine:CallbackUrl or Tamma:ApiUrl configured, using mock candidates");
                candidates = SimulateCandidates(repo);
            }
            else
            {
                var query = new WorkIntakeQuery(repo, autoLabels, excludeLabels, bot);
                foreach (var source in sources)
                {
                    var res = await source.FetchAsync(query, context.CancellationToken);
                    if (res.Failed)
                    {
                        fetchErrors.Add($"{source.Kind.ToWire()}: {res.Error ?? "unknown fetch failure"}");
                    }
                    else
                    {
                        candidates.AddRange(res.Candidates);
                        untriaged += res.UntriagedCount;
                    }
                }
            }
        }

        UntriagedCount.Set(context, untriaged);

        if (candidates.Count == 0)
        {
            if (fetchErrors.Count > 0)
            {
                // AC2 / D2: record the fetch failure so TammaEventEmitter emits
                // ADL.WORKITEM.SELECT.FAILED (status="error") instead of conflating
                // a broken intake with an empty backlog, while preserving the
                // NothingFound outcome edge (no workflow graph change).
                context.WorkflowExecutionContext.TransientProperties[FetchErrorTransientKey] =
                    string.Join("; ", fetchErrors);
            }

            if (untriaged > 0)
            {
                WorkItemJson.Set(context, (string?)null);
                WorkItemType.Set(context, (string?)null);
                WorkItemTitle.Set(context, (string?)null);
                WorkItemKey.Set(context, (string?)null);
                WorkItemSource.Set(context, (string?)null);
                Priority.Set(context, "normal");

                Logger?.LogInformation("No work items ready, but {Count} untriaged issues found", untriaged);
                await context.CompleteActivityWithOutcomesAsync("NeedsTriage");
                return;
            }

            WorkItemJson.Set(context, (string?)null);
            WorkItemType.Set(context, (string?)null);
            WorkItemTitle.Set(context, (string?)null);
            WorkItemKey.Set(context, (string?)null);
            WorkItemSource.Set(context, (string?)null);
            Priority.Set(context, "none");

            Logger?.LogInformation("No work items found — repo is clean");
            await context.CompleteActivityWithOutcomesAsync("NothingFound");
            return;
        }

        // Preserve tracker Rank-then-Priority ordering when all candidates are
        // native tracker items; otherwise sort by Priority (urgent first) then age.
        if (candidates.All(c => c.Source == WorkIntakeSourceKind.Tracker))
        {
            candidates.Sort(TrackerIntakeSource.CompareTrackerCandidates);
        }
        else
        {
            candidates.Sort((a, b) =>
            {
                var pComp = PriorityValue(a.Priority).CompareTo(PriorityValue(b.Priority));
                if (pComp != 0) return pComp;
                return a.CreatedAt.CompareTo(b.CreatedAt);
            });
        }

        var selected = candidates[0];
        if (string.IsNullOrWhiteSpace(selected.Key))
            selected.Key = PlatformIssueIntakeSource.FormatPlatformKey(repo, selected.Number);

        context.WorkflowExecutionContext.TransientProperties[SelectedSourceTransientKey] = selected.Source.ToWire();
        context.WorkflowExecutionContext.TransientProperties[SelectedKeyTransientKey] = selected.Key;

        WorkItemJson.Set(context, JsonSerializer.Serialize(selected));
        WorkItemType.Set(context, selected.Type);
        IssueNumber.Set(context, selected.Number);
        WorkItemTitle.Set(context, selected.Title);
        WorkItemKey.Set(context, selected.Key);
        WorkItemSource.Set(context, selected.Source.ToWire());
        Priority.Set(context, selected.Priority);

        Logger?.LogInformation(
            "Selected work item: {Key} (#{Number}) [{Source}/{Type}] {Title} (priority: {Priority})",
            selected.Key, selected.Number, selected.Source.ToWire(), selected.Type, selected.Title, selected.Priority);

        await context.CompleteActivityWithOutcomesAsync("Selected");
    }

    private static WorkIntakeSourceRegistry BuildDefaultRegistry(
        IHttpClientFactory? httpClientFactory, IConfiguration? configuration) =>
        new([
            new PlatformIssueIntakeSource(httpClientFactory, configuration),
            new TrackerIntakeSource(httpClientFactory, configuration),
        ]);

    internal static string ResolvePriority(List<string> labels)
    {
        if (labels.Contains("priority-critical") || labels.Contains("security")) return "urgent";
        if (labels.Contains("priority-high") || labels.Contains("bug")) return "high";
        if (labels.Contains("priority-low")) return "low";
        return "normal";
    }

    internal static int PriorityValue(string priority) => priority switch
    {
        "urgent" => 0,
        "high" => 1,
        "normal" => 2,
        "low" => 3,
        _ => 2,
    };

    private static List<WorkItem> SimulateCandidates(string? repo) => new()
    {
        new WorkItem
        {
            Key = PlatformIssueIntakeSource.FormatPlatformKey(repo, 1),
            Source = WorkIntakeSourceKind.PlatformIssue,
            Number = 1,
            Title = "[Mock] Sample issue for autonomous development",
            Type = "issue",
            Priority = "normal",
            Labels = new() { "tamma-auto" },
            CreatedAt = DateTime.UtcNow.AddHours(-2),
        }
    };

    public override Dictionary<string, object?> BuildEndData(ActivityExecutionContext context)
    {
        var data = new Dictionary<string, object?>
        {
            ["workItemType"] = this.GetOutput<string?>(context, nameof(WorkItemType)),
            ["issueNumber"] = this.GetOutput<int>(context, nameof(IssueNumber)),
            ["priority"] = this.GetOutput<string>(context, nameof(Priority)),
            ["untriagedCount"] = this.GetOutput<int>(context, nameof(UntriagedCount)),
        };

        if (context.WorkflowExecutionContext.TransientProperties.TryGetValue(SelectedSourceTransientKey, out var src)
            && src is string srcWire)
            data["source"] = srcWire;
        if (context.WorkflowExecutionContext.TransientProperties.TryGetValue(SelectedKeyTransientKey, out var key)
            && key is string keyWire)
            data["key"] = keyWire;
        if (context.WorkflowExecutionContext.TransientProperties.TryGetValue(FetchErrorTransientKey, out var err)
            && err is string errStr)
            data["fetchError"] = errStr;

        return data;
    }

    public override Dictionary<string, object?>? BuildTags(ActivityExecutionContext context)
    {
        var tags = new Dictionary<string, object?>();
        if (context.WorkflowExecutionContext.TransientProperties.TryGetValue(SelectedSourceTransientKey, out var src)
            && src is string srcWire && !string.IsNullOrWhiteSpace(srcWire))
        {
            tags["source"] = srcWire;
        }
        if (context.WorkflowExecutionContext.TransientProperties.TryGetValue(SelectedKeyTransientKey, out var key)
            && key is string keyWire && !string.IsNullOrWhiteSpace(keyWire))
        {
            tags["key"] = keyWire;
            tags["issueId"] = keyWire;
        }
        return tags.Count > 0 ? tags : null;
    }

    public override string? GetSoftFailureReason(ActivityExecutionContext context) =>
        context.WorkflowExecutionContext.TransientProperties.TryGetValue(FetchErrorTransientKey, out var err)
        && err is string errStr && !string.IsNullOrWhiteSpace(errStr)
            ? errStr
            : null;
}

/// <summary>
/// The response envelope of <c>GET /api/engine/issues</c>.
/// </summary>
internal sealed class EngineIssuesResponse
{
    [JsonPropertyName("issues")]
    public List<WorkItem> Issues { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }
}

/// <summary>
/// Represents a work item from any source (platform issue, native tracker item,
/// alert, CI failure). Single shared shape across all <see cref="IWorkIntakeSource"/>
/// implementations (Story 44-7 AC5 / D4 / D5).
/// </summary>
public class WorkItem
{
    /// <summary>
    /// Story 44-7 AC5 / D5 — unified <c>issueId</c> string for both sources:
    /// <c>WorkItemRef.ToWire()</c> (e.g. <c>TAM-142</c>) for native tracker items,
    /// <c>{owner}/{repo}#{number}</c> for platform issues.
    /// </summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Story 44-7 AC5 / D5 — intake source discriminator (<c>platform-issue | tracker</c>).</summary>
    public WorkIntakeSourceKind Source { get; set; } = WorkIntakeSourceKind.PlatformIssue;

    [JsonConverter(typeof(StrictIssueNumberConverter))]
    public int Number { get; set; }

    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }
    public string Type { get; set; } = "issue";
    public string Priority { get; set; } = "normal";

    /// <summary>Lexicographic rank for native tracker items (null for platform issues).</summary>
    public string? Rank { get; set; }

    [JsonConverter(typeof(LabelNamesConverter))]
    public List<string> Labels { get; set; } = new();

    public string? Assignee { get; set; }

    [JsonPropertyName("html_url")]
    public string? Url { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Dictionary<string, object?> Metadata { get; set; } = new();
}

/// <summary>
/// Story 44-7 AC1 (Test 4) — accepts either an integer JSON token (<c>42</c>) or
/// a numeric string token (<c>"42"</c>, matching <c>Tamma.Platforms.Abstractions.Models.Issue.Number</c>),
/// and loudly rejects non-numeric strings with <see cref="JsonException"/> rather
/// than silently defaulting to <c>0</c>.
/// </summary>
public sealed class StrictIssueNumberConverter : JsonConverter<int>
{
    public override int Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var num))
            return num;

        if (reader.TokenType == JsonTokenType.String)
        {
            var raw = reader.GetString();
            if (int.TryParse(raw, System.Globalization.NumberStyles.Integer,
                    System.Globalization.CultureInfo.InvariantCulture, out var parsed))
            {
                return parsed;
            }
            throw new JsonException(
                $"Platform issue number '{raw}' is not a valid integer (AC1: non-numeric numbers are rejected loudly, never defaulted to 0).");
        }

        throw new JsonException($"Expected integer or numeric string for issue number, got {reader.TokenType}.");
    }

    public override void Write(Utf8JsonWriter writer, int value, JsonSerializerOptions options) =>
        writer.WriteNumberValue(value);
}

/// <summary>
/// Reads a labels array whose elements are either plain strings
/// (<c>["a"]</c> — the internal WorkItemJson round-trip shape) or objects with
/// a <c>name</c> property (<c>[{"name":"a"}]</c> — the platform-proxy shape of
/// <c>GET /api/engine/issues</c>). Always writes plain strings.
/// </summary>
public sealed class LabelNamesConverter : JsonConverter<List<string>>
{
    public override List<string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var labels = new List<string>();
        if (reader.TokenType != JsonTokenType.StartArray)
            throw new JsonException("labels must be an array");

        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.String:
                    labels.Add(reader.GetString() ?? string.Empty);
                    break;
                case JsonTokenType.StartObject:
                    using (var doc = JsonDocument.ParseValue(ref reader))
                    {
                        if (doc.RootElement.TryGetProperty("name", out var name)
                            && name.ValueKind == JsonValueKind.String)
                        {
                            labels.Add(name.GetString() ?? string.Empty);
                        }
                    }
                    break;
                default:
                    throw new JsonException($"Unexpected labels element token: {reader.TokenType}");
            }
        }

        return labels;
    }

    public override void Write(Utf8JsonWriter writer, List<string> value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        foreach (var label in value) writer.WriteStringValue(label);
        writer.WriteEndArray();
    }
}
