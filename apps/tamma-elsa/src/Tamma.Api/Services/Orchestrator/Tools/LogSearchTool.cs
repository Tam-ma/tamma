using System.Diagnostics;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Diagnostics;
using Tamma.Api.Services.Diagnostics.Models;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / D7) — structured log search tool for the Orchestrator Agent.
///
/// <para><b>Honest v1 backing (D7):</b> the repository emits application logs to
/// stdout via <c>Microsoft.Extensions.Logging</c> with no persisted log store.
/// <c>log_search</c> therefore searches the two durable structured record stores
/// that exist per tenant: the tenant's DCB domain-event stream
/// (<see cref="IEventRepository.QueryEventsAsync"/>) and its
/// <see cref="IDiagnosticsService"/> <c>ProviderDiagnostic</c> rows. Both reads
/// are structurally hard-scoped to <see cref="OrchestratorToolContext.TenantId"/>.</para>
/// </summary>
public sealed class LogSearchTool : IPrincipalScopedToolExecutor
{
    private readonly OrchestratorToolContext _ctx;
    private readonly IEventRepository _events;
    private readonly IDiagnosticsService? _diagnostics;

    public LogSearchTool(
        OrchestratorToolContext ctx,
        IEventRepository events,
        IDiagnosticsService? diagnostics = null)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _diagnostics = diagnostics;
    }

    public string ToolName => "log_search";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Search the tenant's structured operational records: DCB domain events (by typePrefix, actor, time window) " +
        "and provider diagnostics (providerKey, success). Note: application stdout logs are not persisted in v1; " +
        "this tool queries the tenant's durable event stream and provider diagnostics store. Read-only.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["typePrefix"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional event type prefix (e.g. 'AGENT.', 'APPROVAL.', 'WORKFLOW.')." },
            ["actor"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional actor/userId filter." },
            ["providerKey"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional LLM provider key for diagnostics search." },
            ["onlyFailures"] = new Dictionary<string, object> { ["type"] = "boolean", ["description"] = "When true, filter provider diagnostics to failed calls only." },
            ["sinceMinutes"] = new Dictionary<string, object> { ["type"] = "integer", ["description"] = "Lookback window in minutes (1..10080, default 60)." },
            ["limit"] = new Dictionary<string, object> { ["type"] = "integer", ["description"] = "Max records per source (1..50, default 20)." },
        },
        ["required"] = Array.Empty<string>(),
    };

    public async Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            if (_ctx.TenantId is null || _ctx.TenantId == Guid.Empty)
                return Fail(toolCallId, sw, "log_search requires a non-empty tenant scope.");

            string? typePrefix = null;
            string? actor = null;
            string? providerKey = null;
            bool? onlyFailures = null;
            var sinceMinutes = 60;
            var limit = 20;

            if (!string.IsNullOrWhiteSpace(argumentsJson))
            {
                using var doc = JsonDocument.Parse(argumentsJson);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    var root = doc.RootElement;
                    if (root.TryGetProperty("typePrefix", out var tp) && tp.ValueKind == JsonValueKind.String) typePrefix = tp.GetString();
                    if (root.TryGetProperty("actor", out var ac) && ac.ValueKind == JsonValueKind.String) actor = ac.GetString();
                    if (root.TryGetProperty("providerKey", out var pk) && pk.ValueKind == JsonValueKind.String) providerKey = pk.GetString();
                    if (root.TryGetProperty("onlyFailures", out var of) && of.ValueKind is JsonValueKind.True or JsonValueKind.False) onlyFailures = of.GetBoolean();
                    if (root.TryGetProperty("sinceMinutes", out var sm) && sm.TryGetInt32(out var smVal)) sinceMinutes = Math.Clamp(smVal, 1, 10_080);
                    if (root.TryGetProperty("limit", out var lim) && lim.TryGetInt32(out var limVal)) limit = Math.Clamp(limVal, 1, 50);
                }
            }

            var from = DateTimeOffset.UtcNow.AddMinutes(-sinceMinutes);
            var (eventRows, _) = await _events.QueryEventsAsync(
                _ctx.TenantId.Value,
                type: typePrefix,
                typeIsPrefix: !string.IsNullOrWhiteSpace(typePrefix),
                correlationId: null,
                actor: actor,
                from: from,
                to: null,
                cursor: null,
                limit: limit,
                includeTotal: false).ConfigureAwait(false);

            var eventsSummary = eventRows.Select(e => new
            {
                id = e.Id,
                type = e.Type,
                createdAt = e.CreatedAt,
                tags = e.Tags,
                data = e.Data,
            }).ToList();

            var diagnosticsSummary = new List<object>();
            if (_diagnostics is not null)
            {
                var (diagRows, _) = await _diagnostics.QueryAsync(new DiagnosticsFilter
                {
                    TenantId = _ctx.TenantId.Value,
                    ProviderKey = providerKey,
                    From = from.UtcDateTime,
                    Success = onlyFailures == true ? false : null,
                    Limit = limit,
                }, cancellationToken).ConfigureAwait(false);

                foreach (var d in diagRows)
                {
                    diagnosticsSummary.Add(new
                    {
                        id = d.Id,
                        provider = d.ProviderKey,
                        model = d.Model,
                        success = d.Success,
                        errorMessage = d.ErrorMessage,
                        durationMs = d.RequestDurationMs,
                        createdAt = d.CreatedAt,
                    });
                }
            }

            var output = JsonSerializer.Serialize(new
            {
                backingSources = new[] { "domain_events", "provider_diagnostics" },
                eventCount = eventsSummary.Count,
                events = eventsSummary,
                diagnosticCount = diagnosticsSummary.Count,
                diagnostics = diagnosticsSummary,
            });
            return new ToolExecutionResult(toolCallId, ToolName, true, output, sw.ElapsedMilliseconds);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"log_search failed: {ex.Message}");
        }
    }

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}
