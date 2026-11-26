using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Core.Redaction;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Agents;

/// <summary>
/// Story 42-5 — concrete Api-side <see cref="IToolAuditEmitter"/>. Appends
/// <c>TOOL.INVOKED</c> / <c>TOOL.SUCCEEDED</c> / <c>TOOL.FAILED</c> directly via
/// <see cref="IEventRepository.AppendAsync"/>, tagged through <see cref="AgentTrailTags.Build"/>,
/// with layered redaction (field suppression + pattern redaction + truncation) and a
/// swallow-and-warn failure posture (D8).
/// </summary>
public sealed class ToolAuditEmitter : IToolAuditEmitter
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
    };

    private readonly IEventRepository _events;
    private readonly ILogger<ToolAuditEmitter> _logger;
    private readonly TimeProvider _timeProvider;

    public ToolAuditEmitter(
        IEventRepository events,
        ILogger<ToolAuditEmitter> logger,
        TimeProvider? timeProvider = null)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <inheritdoc />
    public Task EmitInvokedAsync(
        AgentTrailContext trailContext,
        string toolName,
        string toolCallId,
        string? argumentsJson,
        ToolDescriptor? descriptor,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(trailContext);

        var argsRedacted = ToolAuditRedactor.RedactArguments(argumentsJson, descriptor, _logger, toolName, toolCallId);
        var data = new Dictionary<string, object?>
        {
            ["toolName"] = toolName,
            ["toolCallId"] = toolCallId,
            ["argsRedacted"] = argsRedacted,
        };

        return AppendAsync(trailContext, ToolAuditEventTypes.Invoked, toolName, toolCallId, data, ct);
    }

    /// <inheritdoc />
    public Task EmitSucceededAsync(
        AgentTrailContext trailContext,
        string toolName,
        string toolCallId,
        long durationMs,
        int outputSizeBytes,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(trailContext);

        var data = new Dictionary<string, object?>
        {
            ["toolName"] = toolName,
            ["durationMs"] = durationMs,
            ["outputSizeBytes"] = outputSizeBytes,
        };

        return AppendAsync(trailContext, ToolAuditEventTypes.Succeeded, toolName, toolCallId, data, ct);
    }

    /// <inheritdoc />
    public Task EmitFailedAsync(
        AgentTrailContext trailContext,
        string toolName,
        string toolCallId,
        long durationMs,
        string? failureReason,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(trailContext);

        var redactedReason = ToolAuditRedactor.RedactText(failureReason, _logger, toolName, toolCallId);
        var data = new Dictionary<string, object?>
        {
            ["toolName"] = toolName,
            ["durationMs"] = durationMs,
            ["failureReason"] = redactedReason,
        };

        return AppendAsync(trailContext, ToolAuditEventTypes.Failed, toolName, toolCallId, data, ct);
    }

    private async Task AppendAsync(
        AgentTrailContext trailContext,
        string eventType,
        string toolName,
        string toolCallId,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct)
    {
        try
        {
            // Reuse the landed AgentTrailTags contract (D3): issueId, correlationId, agentId,
            // role, provider, model, iteration, credentialSource come from AgentTrailContext;
            // extra adds tenantId, toolName, and toolCallId (no governance fields).
            var extraTags = new Dictionary<string, string?>
            {
                ["tenantId"] = trailContext.TenantId?.ToString(),
                ["toolName"] = toolName,
                ["toolCallId"] = toolCallId,
            };

            await _events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = eventType,
                TenantId = trailContext.TenantId,
                IssueNumber = trailContext.IssueNumber,
                Tags = AgentTrailTags.Build(trailContext, extraTags),
                Metadata = """{"eventSource":"system","workflowVersion":"1.0.0"}""",
                Data = JsonSerializer.Serialize(data, JsonOpts),
                CreatedAt = _timeProvider.GetUtcNow().UtcDateTime,
            }).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Story 42-5 D8: swallow-and-warn — a durable-audit write failure must never fail
            // a tool invocation or abort the agent run.
            _logger.LogWarning(
                ex,
                "Tool audit write failed for {EventType}; run is NOT affected. "
                + "toolName={ToolName}, toolCallId={ToolCallId}, correlationId={CorrelationId}, tenantId={TenantId}",
                eventType,
                toolName,
                toolCallId,
                trailContext.CorrelationId,
                trailContext.TenantId);
        }

        _ = ct; // IEventRepository.AppendAsync does not accept a CancellationToken (AlertEventEmitter.cs:88).
    }
}

/// <summary>
/// Story 42-5 (D5) — layered redaction helper for tool audit payloads:
/// <list type="number">
///   <item><description><b>Field suppression</b>: when <see cref="ToolDescriptor.RequiredSecret"/>
///     is declared, JSON argument properties matching the secret's logical name (or trailing
///     slug segment) are dropped completely before serialization.</description></item>
///   <item><description><b>Pattern redaction</b>: <see cref="ToolOutputHelper.RedactSecrets"/>
///     followed by <see cref="CredentialRedactor.Clean"/>. (Pattern-based only; never holds
///     plaintext secrets to value-match against — Story 42-4 D8.)</description></item>
///   <item><description><b>Truncation</b>: <see cref="ToolOutputHelper.Truncate"/> (50 KB max,
///     which also redacts before truncating).</description></item>
/// </list>
/// </summary>
public static class ToolAuditRedactor
{
    /// <summary>
    /// Redact and truncate tool invocation arguments using D5's layered pipeline.
    /// Works identically when <paramref name="descriptor"/> is <c>null</c> (Story 42-5 D7 soft
    /// dependency on Story 42-1).
    /// </summary>
    public static string RedactArguments(
        string? argumentsJson,
        ToolDescriptor? descriptor,
        ILogger? logger = null,
        string? toolName = null,
        string? toolCallId = null)
    {
        if (string.IsNullOrEmpty(argumentsJson))
        {
            return string.Empty;
        }

        var working = argumentsJson;
        if (descriptor?.RequiredSecret is { } secretReq && !string.IsNullOrWhiteSpace(secretReq.Name))
        {
            working = SuppressSecretNamedFields(working, secretReq.Name);
        }

        return RedactText(working, logger, toolName, toolCallId);
    }

    /// <summary>
    /// Apply pattern redaction (<see cref="ToolOutputHelper.RedactSecrets"/> +
    /// <see cref="CredentialRedactor.Clean"/>) and 50 KB truncation to free text.
    /// </summary>
    public static string RedactText(
        string? text,
        ILogger? logger = null,
        string? toolName = null,
        string? toolCallId = null)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        // First enforce the 50 KB cap + ToolOutputHelper.RedactSecrets via ToolOutputHelper.Truncate
        // (D5: oversized args/outputs go through ToolOutputHelper.Truncate, which redacts first).
        // CredentialRedactor.Clean caps at 1024 chars, so apply it directly on strings within its
        // length limit (and preserve ToolOutputHelper's 50 KB budget for larger payloads).
        var truncated = ToolOutputHelper.Truncate(text, logger, toolName, toolCallId);
        if (truncated.Length <= CredentialRedactor.MaxLength)
        {
            return CredentialRedactor.Clean(truncated) ?? string.Empty;
        }

        return truncated;
    }

    private static string SuppressSecretNamedFields(string argumentsJson, string secretName)
    {
        try
        {
            var node = JsonNode.Parse(argumentsJson);
            if (node is null)
            {
                return argumentsJson;
            }

            var candidateNames = BuildNormalizedFieldNames(secretName);
            var modified = RemoveMatchingProperties(node, candidateNames);
            return modified ? node.ToJsonString() : argumentsJson;
        }
        catch (JsonException)
        {
            // Non-JSON or malformed arguments still pass through pattern redaction + truncation.
            return argumentsJson;
        }
    }

    private static HashSet<string> BuildNormalizedFieldNames(string secretName)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var trimmed = secretName.Trim();
        set.Add(NormalizeKey(trimmed));

        var lastSlash = trimmed.LastIndexOf('/');
        if (lastSlash >= 0 && lastSlash < trimmed.Length - 1)
        {
            set.Add(NormalizeKey(trimmed[(lastSlash + 1)..]));
        }

        return set;
    }

    private static string NormalizeKey(string key) =>
        key.Replace("-", string.Empty, StringComparison.Ordinal)
           .Replace("_", string.Empty, StringComparison.Ordinal)
           .Replace(".", string.Empty, StringComparison.Ordinal)
           .Trim();

    private static bool RemoveMatchingProperties(JsonNode node, HashSet<string> candidateNames)
    {
        var modified = false;

        if (node is JsonObject obj)
        {
            var keysToRemove = new List<string>();
            foreach (var kv in obj)
            {
                if (candidateNames.Contains(NormalizeKey(kv.Key)))
                {
                    keysToRemove.Add(kv.Key);
                }
                else if (kv.Value is not null)
                {
                    if (RemoveMatchingProperties(kv.Value, candidateNames))
                    {
                        modified = true;
                    }
                }
            }

            foreach (var k in keysToRemove)
            {
                obj.Remove(k);
                modified = true;
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not null && RemoveMatchingProperties(item, candidateNames))
                {
                    modified = true;
                }
            }
        }

        return modified;
    }
}
