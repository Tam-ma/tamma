using System.Diagnostics;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / AC4 / D5 / D6) — workflow inspection and control tool
/// backed by <see cref="IElsaWorkflowService"/>.
///
/// <para>Read verb (<c>inspect</c>) is always available. Write-capable verbs
/// (<c>dispatch</c>, <c>resume</c>, <c>cancel</c>) are individually allowlisted
/// and strictly gated on <see cref="OrchestratorToolContext.AllowWriteVerbs"/>:
/// when serving an unprivileged user in chat, write verbs are refused server-side.</para>
/// </summary>
public sealed class WorkflowControlTool : IPrincipalScopedToolExecutor
{
    public static readonly IReadOnlySet<string> ReadVerbs =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "inspect" };

    public static readonly IReadOnlySet<string> WriteVerbs =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "dispatch", "resume", "cancel" };

    private readonly OrchestratorToolContext _ctx;
    private readonly IElsaWorkflowService _elsa;

    public WorkflowControlTool(OrchestratorToolContext ctx, IElsaWorkflowService elsa)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _elsa = elsa ?? throw new ArgumentNullException(nameof(elsa));
    }

    public string ToolName => "workflow_control";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Inspect or control Elsa workflows. Read verb: 'inspect' (instanceId). " +
        "Individually allowlisted write verbs (require write permission): 'dispatch' (workflowName, input), " +
        "'resume' (instanceId), 'cancel' (instanceId).";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["verb"] = new Dictionary<string, object> { ["type"] = "string", ["enum"] = new[] { "inspect", "dispatch", "resume", "cancel" } },
            ["instanceId"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Workflow instance id (for inspect/resume/cancel)." },
            ["workflowName"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Workflow definition name (for dispatch)." },
            ["input"] = new Dictionary<string, object> { ["type"] = "object", ["description"] = "Optional workflow input dictionary (for dispatch)." },
        },
        ["required"] = new[] { "verb" },
    };

    public async Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            if (string.IsNullOrWhiteSpace(argumentsJson))
                return Fail(toolCallId, sw, "verb is required ('inspect', 'dispatch', 'resume', or 'cancel').");

            using var doc = JsonDocument.Parse(argumentsJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return Fail(toolCallId, sw, "Arguments must be a JSON object.");

            var root = doc.RootElement;
            var verb = root.TryGetProperty("verb", out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString()?.Trim().ToLowerInvariant()
                : null;

            if (string.IsNullOrWhiteSpace(verb) || (!ReadVerbs.Contains(verb) && !WriteVerbs.Contains(verb)))
                return Fail(toolCallId, sw, $"Unknown workflow_control verb '{verb}'. Allowed: inspect, dispatch, resume, cancel.");

            if (WriteVerbs.Contains(verb) && !_ctx.AllowWriteVerbs)
                return Fail(toolCallId, sw, $"Write verb '{verb}' is denied for the current acting principal (attenuated read-only scope).");

            switch (verb)
            {
                case "inspect":
                {
                    var instanceId = GetString(root, "instanceId");
                    if (string.IsNullOrWhiteSpace(instanceId))
                        return Fail(toolCallId, sw, "instanceId is required for verb 'inspect'.");
                    var status = await _elsa.GetWorkflowStatusAsync(instanceId).ConfigureAwait(false);
                    return Ok(toolCallId, sw, JsonSerializer.Serialize(status));
                }
                case "dispatch":
                {
                    var workflowName = GetString(root, "workflowName");
                    if (string.IsNullOrWhiteSpace(workflowName))
                        return Fail(toolCallId, sw, "workflowName is required for verb 'dispatch'.");

                    var input = new Dictionary<string, object>();
                    if (root.TryGetProperty("input", out var inputEl) && inputEl.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in inputEl.EnumerateObject())
                            input[prop.Name] = prop.Value.Clone();
                    }
                    // Always stamp server-derived tenantId into dispatched workflow input.
                    if (_ctx.TenantId is { } tid && tid != Guid.Empty)
                        input["tenantId"] = tid.ToString("D");

                    var instanceId = await _elsa.StartWorkflowAsync(workflowName, input).ConfigureAwait(false);
                    return Ok(toolCallId, sw, JsonSerializer.Serialize(new { dispatched = true, workflowName, instanceId }));
                }
                case "resume":
                {
                    var instanceId = GetString(root, "instanceId");
                    if (string.IsNullOrWhiteSpace(instanceId))
                        return Fail(toolCallId, sw, "instanceId is required for verb 'resume'.");
                    await _elsa.ResumeWorkflowAsync(instanceId).ConfigureAwait(false);
                    return Ok(toolCallId, sw, JsonSerializer.Serialize(new { resumed = true, instanceId }));
                }
                case "cancel":
                {
                    var instanceId = GetString(root, "instanceId");
                    if (string.IsNullOrWhiteSpace(instanceId))
                        return Fail(toolCallId, sw, "instanceId is required for verb 'cancel'.");
                    await _elsa.CancelWorkflowAsync(instanceId).ConfigureAwait(false);
                    return Ok(toolCallId, sw, JsonSerializer.Serialize(new { cancelled = true, instanceId }));
                }
                default:
                    return Fail(toolCallId, sw, $"Unsupported verb '{verb}'.");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"workflow_control failed: {ex.Message}");
        }
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;

    private ToolExecutionResult Ok(string toolCallId, Stopwatch sw, string output) =>
        new(toolCallId, ToolName, true, output, sw.ElapsedMilliseconds);

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}
