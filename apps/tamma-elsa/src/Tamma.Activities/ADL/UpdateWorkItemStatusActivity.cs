using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities.Flowchart.Attributes;
using Elsa.Workflows.Attributes;
using Elsa.Workflows.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Tamma.Core.Tracking;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 44-7 AC8 (D7/D8) — opt-in, idempotent native tracker status write-back
/// over HTTP (<c>GET /api/work-items/by-key/{key}</c>,
/// <c>GET /api/projects/{projectId}</c>, <c>POST /api/work-items/{id}/status</c>).
///
/// <para><b>Opt-in per project (default off):</b> only projects with
/// <c>automationMode == "auto"</c> allow autonomous status transitions; projects
/// in <c>off</c> or <c>assist</c> complete as a no-op (<c>NoOp = true</c>).</para>
///
/// <para><b>Idempotent by target state (D7):</b> if the work item already holds
/// <see cref="TargetStatus"/>, completes as a no-op without issuing a
/// <c>POST</c> — safe under 39-10 crash re-entry.</para>
///
/// Outcomes:
///   - Updated: transition applied OR idempotent/opt-out no-op
///   - Failed:  HTTP/transport/contract error (loud failure)
/// </summary>
[Activity(
    "Tamma.ADL",
    "Update Work Item Status",
    "Idempotently transition a native tracker work item's status over HTTP when project automation is opted in",
    Kind = ActivityKind.Task
)]
[FlowNode("Updated", "Failed")]
public class UpdateWorkItemStatusActivity : Activity
{
    private static readonly JsonSerializerOptions s_jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly ILogger<UpdateWorkItemStatusActivity>? _logger;
    private readonly IHttpClientFactory? _httpClientFactory;
    private readonly IConfiguration? _configuration;

    [Input(Description = "Native work item key (WorkItemRef.ToWire(), e.g. TAM-142)")]
    public Input<string> WorkItemKey { get; set; } = default!;

    [Input(Description = "Target WorkItemStatus wire value (e.g. in_progress, in_review)")]
    public Input<string> TargetStatus { get; set; } = default!;

    [Input(Description = "Tenant id header (optional)")]
    public Input<string?> TenantId { get; set; } = new((string?)null);

    [Input(Description = "Audit actor tag carried in WORKITEM.STATUS_CHANGED.SUCCESS (default 'loop')")]
    public Input<string> Actor { get; set; } = new("loop");

    [Output(Description = "True when a status transition was actually applied")]
    public Output<bool> Updated { get; set; } = default!;

    [Output(Description = "True when the call was an idempotent or opt-out no-op")]
    public Output<bool> NoOp { get; set; } = default!;

    [Output(Description = "Failure classification when Failed fires")]
    public Output<string?> ErrorCode { get; set; } = default!;

    [Output(Description = "Human-readable error reason when Failed fires")]
    public Output<string?> Error { get; set; } = default!;

    [JsonConstructor]
    public UpdateWorkItemStatusActivity() { }

    public UpdateWorkItemStatusActivity(
        ILogger<UpdateWorkItemStatusActivity>? logger,
        IHttpClientFactory? httpClientFactory,
        IConfiguration? configuration)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    protected override async ValueTask ExecuteAsync(ActivityExecutionContext context)
    {
        var key = WorkItemKey.GetOrDefault(context) ?? string.Empty;
        var targetStatus = TargetStatus.GetOrDefault(context) ?? string.Empty;
        var tenantId = TenantId.GetOrDefault(context);
        var actor = Actor.GetOrDefault(context);
        if (string.IsNullOrWhiteSpace(actor))
            actor = "loop";

        var configuration = _configuration ?? context.GetService<IConfiguration>();
        var httpClientFactory = _httpClientFactory ?? context.GetService<IHttpClientFactory>();
        var logger = _logger ?? context.GetService<ILogger<UpdateWorkItemStatusActivity>>();

        var result = await ExecuteCoreAsync(
            key, targetStatus, tenantId, actor, configuration, httpClientFactory, logger, context.CancellationToken);

        Updated.Set(context, result.Applied);
        NoOp.Set(context, result.NoOp);
        ErrorCode.Set(context, result.ErrorCode);
        Error.Set(context, result.Error);

        await context.CompleteActivityWithOutcomesAsync(result.Success ? "Updated" : "Failed");
    }

    public static async Task<WorkItemStatusWriteBackResult> ExecuteCoreAsync(
        string workItemKey,
        string targetStatus,
        string? tenantId,
        string actor,
        IConfiguration? configuration,
        IHttpClientFactory? httpClientFactory,
        ILogger? logger,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(workItemKey))
            return WorkItemStatusWriteBackResult.Failure("missing-work-item-key", "WorkItemKey is required.");

        if (!WorkItemStatusExtensions.TryParse(targetStatus, out var parsedStatus))
            return WorkItemStatusWriteBackResult.Failure("invalid-target-status", $"Unknown target status '{targetStatus}'.");

        var apiUrl = configuration?["Tamma:ApiUrl"];
        if (string.IsNullOrWhiteSpace(apiUrl))
            apiUrl = configuration?["Engine:CallbackUrl"];
        if (string.IsNullOrWhiteSpace(apiUrl) || httpClientFactory is null)
            return WorkItemStatusWriteBackResult.Failure("api-url-not-configured", "Neither Tamma:ApiUrl nor Engine:CallbackUrl is configured.");

        try
        {
            var client = httpClientFactory.CreateClient();
            var baseUrl = apiUrl.TrimEnd('/');

            using var getItemReq = CreateRequest(HttpMethod.Get, $"{baseUrl}/api/work-items/by-key/{Uri.EscapeDataString(workItemKey)}", tenantId);
            using var getItemResp = await client.SendAsync(getItemReq, ct);
            if (!getItemResp.IsSuccessStatusCode)
            {
                return WorkItemStatusWriteBackResult.Failure(
                    $"http-{(int)getItemResp.StatusCode}",
                    $"GET work item '{workItemKey}' failed with HTTP {(int)getItemResp.StatusCode}.");
            }

            var itemBody = await getItemResp.Content.ReadAsStringAsync(ct);
            var item = JsonSerializer.Deserialize<WorkItemWire>(itemBody, s_jsonOptions);
            if (item is null || item.Id == Guid.Empty)
                return WorkItemStatusWriteBackResult.Failure("invalid-work-item-payload", $"Work item '{workItemKey}' response missing id.");

            // AC8 / D7: opt-in per project (default off). Only automationMode == "auto" permits write-back.
            using var getProjReq = CreateRequest(HttpMethod.Get, $"{baseUrl}/api/projects/{item.ProjectId:D}", tenantId);
            using var getProjResp = await client.SendAsync(getProjReq, ct);
            if (!getProjResp.IsSuccessStatusCode)
            {
                return WorkItemStatusWriteBackResult.Failure(
                    $"http-{(int)getProjResp.StatusCode}",
                    $"GET project '{item.ProjectId}' failed with HTTP {(int)getProjResp.StatusCode}.");
            }

            var projBody = await getProjResp.Content.ReadAsStringAsync(ct);
            var project = JsonSerializer.Deserialize<ProjectWire>(projBody, s_jsonOptions);
            if (!ProjectAutomationModeExtensions.TryParse(project?.AutomationMode ?? "off", out var mode)
                || !mode.AllowsStatusWriteBack())
            {
                logger?.LogInformation(
                    "Skipping status write-back for {Key}: project automationMode is '{Mode}' (opt-in required)",
                    workItemKey, project?.AutomationMode ?? "off");
                return WorkItemStatusWriteBackResult.Skipped();
            }

            // AC8 / D7: idempotent by target state — already at target => 0 POSTs, 0 duplicate events.
            var canonicalTarget = parsedStatus.ToWire();
            if (string.Equals(item.Status, canonicalTarget, StringComparison.Ordinal))
            {
                logger?.LogInformation(
                    "Work item {Key} is already '{Status}'; idempotent no-op", workItemKey, canonicalTarget);
                return WorkItemStatusWriteBackResult.Skipped();
            }

            using var postReq = CreateRequest(HttpMethod.Post, $"{baseUrl}/api/work-items/{item.Id:D}/status", tenantId);
            postReq.Headers.TryAddWithoutValidation("If-Match", $"\"{item.Version}\"");
            postReq.Content = JsonContent.Create(new { status = canonicalTarget, actor });

            using var postResp = await client.SendAsync(postReq, ct);
            if (!postResp.IsSuccessStatusCode)
            {
                return WorkItemStatusWriteBackResult.Failure(
                    $"http-{(int)postResp.StatusCode}",
                    $"POST status '{canonicalTarget}' for '{workItemKey}' failed with HTTP {(int)postResp.StatusCode}.");
            }

            return WorkItemStatusWriteBackResult.Transitioned();
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Error during tracker status write-back for {Key}", workItemKey);
            return WorkItemStatusWriteBackResult.Failure("transport-error", ex.Message);
        }
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, string url, string? tenantId)
    {
        var req = new HttpRequestMessage(method, url);
        if (!string.IsNullOrWhiteSpace(tenantId))
            req.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId);
        return req;
    }

    private sealed class WorkItemWire
    {
        [JsonPropertyName("id")] public Guid Id { get; set; }
        [JsonPropertyName("projectId")] public Guid ProjectId { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; } = string.Empty;
        [JsonPropertyName("version")] public int Version { get; set; }
    }

    private sealed class ProjectWire
    {
        [JsonPropertyName("automationMode")] public string? AutomationMode { get; set; }
    }
}

public sealed record WorkItemStatusWriteBackResult(
    bool Success,
    bool Applied,
    bool NoOp,
    string? ErrorCode = null,
    string? Error = null)
{
    public static WorkItemStatusWriteBackResult Transitioned() => new(true, Applied: true, NoOp: false);
    public static WorkItemStatusWriteBackResult Skipped() => new(true, Applied: false, NoOp: true);
    public static WorkItemStatusWriteBackResult Failure(string code, string error) => new(false, Applied: false, NoOp: false, code, error);
}
