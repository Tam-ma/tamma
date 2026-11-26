using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / AC5 / D5) — closed per-session <see cref="IToolExecutorRegistry"/>
/// wrapping the orchestrator's principal-bound toolset.
///
/// <para>Every <see cref="ExecuteAsync"/> invocation emits an
/// <see cref="OrchestratorEvents.ToolInvoked"/> (<c>ORCHESTRATOR.TOOL.INVOKED</c>)
/// DCB event carrying tool name, SHA-256 args digest (NEVER raw args), success,
/// duration, and correlation / tenant / acting-user tags. Event-emission failure is
/// logged and swallowed so a completed tool result is never lost.</para>
///
/// <para>Runtime <see cref="Register"/> / <see cref="Unregister"/> are refused
/// (<see cref="NotSupportedException"/>): the orchestrator toolset is closed and
/// drift-tested.</para>
/// </summary>
public sealed class AuditedToolRegistry : IToolExecutorRegistry
{
    private readonly Dictionary<string, IToolExecutor> _executors;
    private readonly IReadOnlyList<IToolExecutor> _ordered;
    private readonly OrchestratorToolContext _context;
    private readonly IEventRepository _events;
    private readonly ILogger? _logger;

    public AuditedToolRegistry(
        IEnumerable<IToolExecutor> tools,
        OrchestratorToolContext context,
        IEventRepository events,
        ILogger? logger = null)
    {
        ArgumentNullException.ThrowIfNull(tools);
        _context = context ?? throw new ArgumentNullException(nameof(context));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _logger = logger;

        _executors = new Dictionary<string, IToolExecutor>(StringComparer.OrdinalIgnoreCase);
        var list = new List<IToolExecutor>();
        foreach (var tool in tools)
        {
            if (!_executors.TryAdd(tool.ToolName, tool))
                throw new InvalidOperationException($"Duplicate orchestrator tool name '{tool.ToolName}'.");
            list.Add(tool);
        }
        _ordered = list;
    }

    public IToolExecutor? GetExecutor(string toolName) =>
        string.IsNullOrWhiteSpace(toolName)
            ? null
            : _executors.GetValueOrDefault(toolName);

    public bool IsAllowed(string toolName, string[]? allowlist)
    {
        if (!_executors.ContainsKey(toolName))
            return false;
        if (allowlist is null || allowlist.Length == 0)
            return true;
        return allowlist.Any(a => string.Equals(a, toolName, StringComparison.OrdinalIgnoreCase));
    }

    public IReadOnlyList<IToolExecutor> GetAll() => _ordered;

    public IReadOnlyList<IToolExecutor> GetAllowed(string[]? allowlist)
    {
        if (allowlist is null || allowlist.Length == 0)
            return _ordered;
        var set = new HashSet<string>(allowlist, StringComparer.OrdinalIgnoreCase);
        return _ordered.Where(t => set.Contains(t.ToolName)).ToList();
    }

    public void Register(IToolExecutor executor) =>
        throw new NotSupportedException("Orchestrator AuditedToolRegistry is a closed toolset; dynamic registration is forbidden.");

    public bool Unregister(string toolName) =>
        throw new NotSupportedException("Orchestrator AuditedToolRegistry is a closed toolset; dynamic unregistration is forbidden.");

    public async Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string toolName,
        string argumentsJson,
        CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        var executor = GetExecutor(toolName);
        ToolExecutionResult result;
        if (executor is null)
        {
            sw.Stop();
            result = new ToolExecutionResult(
                toolCallId,
                toolName,
                false,
                $"Unknown orchestrator tool: '{toolName}'.",
                sw.ElapsedMilliseconds);
        }
        else
        {
            try
            {
                result = await executor.ExecuteAsync(toolCallId, argumentsJson, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                sw.Stop();
                result = new ToolExecutionResult(
                    toolCallId,
                    executor.ToolName,
                    false,
                    $"Tool '{executor.ToolName}' failed unexpectedly: {ex.Message}",
                    sw.ElapsedMilliseconds);
            }
            sw.Stop();
        }

        await EmitToolInvokedBestEffortAsync(
            toolCallId,
            executor?.ToolName ?? toolName,
            argumentsJson,
            result,
            sw.ElapsedMilliseconds).ConfigureAwait(false);

        return result;
    }

    /// <summary>Compute the lowercase hex SHA-256 digest of tool arguments (never raw args).</summary>
    public static string ComputeArgsDigest(string? argumentsJson)
    {
        var bytes = Encoding.UTF8.GetBytes(argumentsJson ?? string.Empty);
        var hash = SHA256.HashData(bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private async Task EmitToolInvokedBestEffortAsync(
        string toolCallId,
        string toolName,
        string argumentsJson,
        ToolExecutionResult result,
        long durationMs)
    {
        try
        {
            var argsDigest = ComputeArgsDigest(argumentsJson);
            var tags = new Dictionary<string, object?>
            {
                ["correlationId"] = _context.CorrelationId,
                ["tool"] = toolName,
            };
            if (_context.TenantId is { } tid && tid != Guid.Empty)
                tags["tenantId"] = tid.ToString("D");
            if (_context.DecisionSessionId is { } dsid && dsid != Guid.Empty)
                tags["decisionSessionId"] = dsid.ToString("D");
            if (!string.IsNullOrWhiteSpace(_context.IssueId))
                tags["issueId"] = _context.IssueId;
            if (_context.ActingUserId is { } uid && uid != Guid.Empty)
                tags["userId"] = uid.ToString("D");

            var data = new Dictionary<string, object?>
            {
                ["tool"] = toolName,
                ["toolCallId"] = toolCallId,
                ["argsDigest"] = argsDigest,
                ["success"] = result.Success,
                ["durationMs"] = durationMs,
                ["correlationId"] = _context.CorrelationId,
            };

            await _events.AppendAsync(new DomainEvent
            {
                Type = OrchestratorEvents.ToolInvoked,
                TenantId = _context.TenantId,
                Tags = JsonSerializer.Serialize(tags),
                Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-agent"}""",
                Data = JsonSerializer.Serialize(data),
            }).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex,
                "Best-effort {EventType} emission failed for tool {ToolName} (callId={ToolCallId}); tool result preserved.",
                OrchestratorEvents.ToolInvoked, toolName, toolCallId);
        }
    }
}
