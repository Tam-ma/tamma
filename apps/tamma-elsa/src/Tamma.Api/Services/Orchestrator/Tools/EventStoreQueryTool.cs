using System.Diagnostics;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC1 / AC2 / D6) — read-only DCB event-store query tool wrapping
/// Story 4-7's <see cref="IEventRepository.QueryEventsAsync"/>. Hard-scoped to
/// the bound <see cref="OrchestratorToolContext.TenantId"/> at construction — a
/// cross-tenant query is structurally impossible.
/// </summary>
public sealed class EventStoreQueryTool : IPrincipalScopedToolExecutor
{
    private readonly OrchestratorToolContext _ctx;
    private readonly IEventRepository _events;

    public EventStoreQueryTool(OrchestratorToolContext ctx, IEventRepository events)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _events = events ?? throw new ArgumentNullException(nameof(events));
    }

    public string ToolName => "event_store_query";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Query the tenant's DCB domain event stream by event type (exact or prefix), correlationId, actor, " +
        "time window, and cursor. Read-only and structurally hard-scoped to the tenant.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["type"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Event type or prefix (e.g. 'APPROVAL.', 'DOCUMENT.')." },
            ["typeIsPrefix"] = new Dictionary<string, object> { ["type"] = "boolean", ["description"] = "When true, matches events whose type starts with 'type'." },
            ["correlationId"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional correlation / workflow-instance id." },
            ["actor"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional actor / userId filter." },
            ["limit"] = new Dictionary<string, object> { ["type"] = "integer", ["description"] = "Maximum events to return (1..100, default 25)." },
            ["cursor"] = new Dictionary<string, object> { ["type"] = "integer", ["description"] = "Optional SequenceNumber keyset cursor." },
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
                return Fail(toolCallId, sw, "event_store_query requires a non-empty tenant scope.");

            string? type = null;
            bool? explicitTypeIsPrefix = null;
            string? correlationId = null;
            string? actor = null;
            long? cursor = null;
            var limit = 25;

            if (!string.IsNullOrWhiteSpace(argumentsJson))
            {
                using var doc = JsonDocument.Parse(argumentsJson);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    var root = doc.RootElement;
                    if (root.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String) type = t.GetString();
                    if (root.TryGetProperty("typeIsPrefix", out var p) && p.ValueKind is JsonValueKind.True or JsonValueKind.False) explicitTypeIsPrefix = p.GetBoolean();
                    if (root.TryGetProperty("correlationId", out var c) && c.ValueKind == JsonValueKind.String) correlationId = c.GetString();
                    if (root.TryGetProperty("actor", out var a) && a.ValueKind == JsonValueKind.String) actor = a.GetString();
                    if (root.TryGetProperty("cursor", out var cur) && cur.ValueKind == JsonValueKind.Number && cur.TryGetInt64(out var curVal)) cursor = curVal;
                    if (root.TryGetProperty("limit", out var lim) && lim.ValueKind == JsonValueKind.Number && lim.TryGetInt32(out var limVal)) limit = Math.Clamp(limVal, 1, 100);
                }
            }

            var typeIsPrefix = explicitTypeIsPrefix ?? (!string.IsNullOrEmpty(type) && type.EndsWith('.'));

            // Structural tenant scoping: always pass _ctx.TenantId (ignoring any tenantId in args).
            var (rows, _) = await _events.QueryEventsAsync(
                _ctx.TenantId.Value,
                type,
                typeIsPrefix,
                correlationId,
                actor,
                from: null,
                to: null,
                cursor: cursor,
                limit: limit,
                includeTotal: false).ConfigureAwait(false);

            var projected = rows.Select(e => new
            {
                id = e.Id,
                sequenceNumber = e.SequenceNumber,
                type = e.Type,
                issueNumber = e.IssueNumber,
                createdAt = e.CreatedAt,
                tags = e.Tags,
                data = e.Data,
            }).ToList();

            var output = JsonSerializer.Serialize(new { count = projected.Count, events = projected });
            return new ToolExecutionResult(toolCallId, ToolName, true, output, sw.ElapsedMilliseconds);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"event_store_query failed: {ex.Message}");
        }
    }

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}
