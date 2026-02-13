using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Tamma.Api.Services;

/// <summary>
/// Background service that periodically polls ELSA for workflow definitions and
/// running instances, then pushes them to the Tamma TypeScript server for
/// dashboard synchronisation.
///
/// Configured via the "TammaServer:Url" setting in appsettings.json.
/// Poll interval defaults to 30 seconds.
/// </summary>
public class WorkflowSyncService : BackgroundService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WorkflowSyncService> _logger;
    private readonly TimeSpan _pollInterval;

    public WorkflowSyncService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<WorkflowSyncService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
        var seconds = configuration.GetValue<int>("WorkflowSync:PollIntervalSeconds", 30);
        _pollInterval = TimeSpan.FromSeconds(seconds);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var tammaUrl = _configuration["TammaServer:Url"];
        if (string.IsNullOrEmpty(tammaUrl))
        {
            _logger.LogWarning(
                "TammaServer:Url is not configured. WorkflowSyncService will not start.");
            return;
        }

        _logger.LogInformation(
            "WorkflowSyncService started. Syncing to {TammaUrl} every {Interval}s",
            tammaUrl, _pollInterval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SyncDefinitionsAsync(tammaUrl, stoppingToken);
                await SyncInstancesAsync(tammaUrl, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during workflow sync cycle");
            }

            try
            {
                await Task.Delay(_pollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("WorkflowSyncService stopped");
    }

    // ---------------------------------------------------------------
    // Definition sync
    // ---------------------------------------------------------------

    private async Task SyncDefinitionsAsync(string tammaUrl, CancellationToken ct)
    {
        var elsaClient = _httpClientFactory.CreateClient("elsa");

        // Fetch all workflow definitions from ELSA
        var response = await elsaClient.GetAsync(
            "/elsa/api/workflow-definitions?page=1&pageSize=100", ct);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "Failed to fetch ELSA definitions: {Status}", response.StatusCode);
            return;
        }

        var body = await response.Content.ReadFromJsonAsync<ElsaDefinitionListResponse>(
            JsonOpts, ct);

        if (body?.Items is null || body.Items.Count == 0)
        {
            _logger.LogDebug("No ELSA workflow definitions found");
            return;
        }

        var tammaClient = _httpClientFactory.CreateClient();

        foreach (var def in body.Items)
        {
            var payload = new TammaWorkflowDefinition
            {
                Id = def.DefinitionId ?? def.Id,
                Name = def.Name ?? "Unnamed",
                Version = def.Version,
                Description = def.Description ?? string.Empty,
                Activities = def.Activities ?? new List<object>(),
                SyncedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            try
            {
                var upsertResponse = await tammaClient.PostAsJsonAsync(
                    $"{tammaUrl}/api/workflows/definitions", payload, JsonOpts, ct);

                if (!upsertResponse.IsSuccessStatusCode)
                {
                    _logger.LogWarning(
                        "Failed to upsert definition {Id}: {Status}",
                        payload.Id, upsertResponse.StatusCode);
                }
                else
                {
                    _logger.LogDebug("Synced definition {Id} ({Name})", payload.Id, payload.Name);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error upserting definition {Id}", payload.Id);
            }
        }

        _logger.LogInformation("Synced {Count} workflow definitions", body.Items.Count);
    }

    // ---------------------------------------------------------------
    // Instance sync
    // ---------------------------------------------------------------

    private async Task SyncInstancesAsync(string tammaUrl, CancellationToken ct)
    {
        var elsaClient = _httpClientFactory.CreateClient("elsa");

        // Fetch all workflow instances from ELSA (Running, Completed, Faulted, Suspended)
        var response = await elsaClient.GetAsync(
            "/elsa/api/workflow-instances?page=1&pageSize=100", ct);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "Failed to fetch ELSA instances: {Status}", response.StatusCode);
            return;
        }

        var body = await response.Content.ReadFromJsonAsync<ElsaInstanceListResponse>(
            JsonOpts, ct);

        if (body?.Items is null || body.Items.Count == 0)
        {
            _logger.LogDebug("No ELSA workflow instances found");
            return;
        }

        var tammaClient = _httpClientFactory.CreateClient();

        foreach (var inst in body.Items)
        {
            var payload = new TammaWorkflowInstance
            {
                Id = inst.Id,
                DefinitionId = inst.DefinitionId ?? string.Empty,
                Status = inst.Status ?? "Unknown",
                CurrentActivity = inst.CurrentActivity,
                Variables = inst.Variables ?? new Dictionary<string, object>(),
                CreatedAt = inst.CreatedAt.HasValue
                    ? new DateTimeOffset(inst.CreatedAt.Value).ToUnixTimeMilliseconds()
                    : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            try
            {
                // Try update first; if 404, create
                var putResponse = await tammaClient.PutAsJsonAsync(
                    $"{tammaUrl}/api/workflows/instances/{payload.Id}", payload, JsonOpts, ct);

                if (putResponse.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    var postResponse = await tammaClient.PostAsJsonAsync(
                        $"{tammaUrl}/api/workflows/instances", payload, JsonOpts, ct);

                    if (!postResponse.IsSuccessStatusCode)
                    {
                        _logger.LogWarning(
                            "Failed to create instance {Id}: {Status}",
                            payload.Id, postResponse.StatusCode);
                    }
                }
                else if (!putResponse.IsSuccessStatusCode)
                {
                    _logger.LogWarning(
                        "Failed to update instance {Id}: {Status}",
                        payload.Id, putResponse.StatusCode);
                }
                else
                {
                    _logger.LogDebug("Synced instance {Id}", payload.Id);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error syncing instance {Id}", payload.Id);
            }
        }

        _logger.LogInformation("Synced {Count} workflow instances", body.Items.Count);
    }

    // ---------------------------------------------------------------
    // Serialization options
    // ---------------------------------------------------------------

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // ---------------------------------------------------------------
    // ELSA response models
    // ---------------------------------------------------------------

    private sealed class ElsaDefinitionListResponse
    {
        public List<ElsaDefinitionItem> Items { get; set; } = new();
        public int TotalCount { get; set; }
    }

    private sealed class ElsaDefinitionItem
    {
        public string Id { get; set; } = string.Empty;
        public string? DefinitionId { get; set; }
        public string? Name { get; set; }
        public int Version { get; set; }
        public string? Description { get; set; }
        public List<object>? Activities { get; set; }
    }

    private sealed class ElsaInstanceListResponse
    {
        public List<ElsaInstanceItem> Items { get; set; } = new();
        public int TotalCount { get; set; }
    }

    private sealed class ElsaInstanceItem
    {
        public string Id { get; set; } = string.Empty;
        public string? DefinitionId { get; set; }
        public string? Status { get; set; }
        public string? CurrentActivity { get; set; }
        public DateTime? CreatedAt { get; set; }
        public Dictionary<string, object>? Variables { get; set; }
    }

    // ---------------------------------------------------------------
    // Tamma payload models (sent to TS server)
    // ---------------------------------------------------------------

    private sealed class TammaWorkflowDefinition
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int Version { get; set; }
        public string Description { get; set; } = string.Empty;
        public List<object> Activities { get; set; } = new();
        public long SyncedAt { get; set; }
    }

    private sealed class TammaWorkflowInstance
    {
        public string Id { get; set; } = string.Empty;
        public string DefinitionId { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string? CurrentActivity { get; set; }
        public Dictionary<string, object> Variables { get; set; } = new();
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }
}
