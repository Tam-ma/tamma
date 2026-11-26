using System.Diagnostics;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Tasks;
using Tamma.Core;
using Tamma.Core.Documents;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / AC4 / D5 / D6) + Story 39-19 (AC2 / AC5 / D5 / D8) — workflow
/// inspection and control tool backed by <see cref="IElsaWorkflowService"/>.
///
/// <para>Read verb (<c>inspect</c>) is always available. Write-capable verbs
/// (<c>dispatch</c>, <c>resume</c>, <c>cancel</c>) are individually allowlisted
/// and strictly gated on <see cref="OrchestratorToolContext.AllowWriteVerbs"/>:
/// when serving an unprivileged user in chat, write verbs are refused server-side.</para>
///
/// <para><b>Story 39-19 chat safeguards when <c>ActingUserId != null</c>:</b>
/// <list type="bullet">
///   <item><c>dispatch</c> MUST flow through <see cref="IChatWorkflowInitiationService"/>
///     (enforces 39-20 authorization, stamps server-derived <c>initiatedBy</c>, emits
///     <c>CHAT.WORKFLOW.INITIATED</c>/<c>REFUSED</c>); fails closed if unwired.</item>
///   <item><c>resume</c> routes document decisions ONLY through Story 39-8's
///     <see cref="DocumentDecisionSubmissionService"/> with server-derived decider
///     (= acting user id) and channel (<c>user</c>), ignoring any caller-supplied
///     identity fields (no chat backdoor, AC5).</item>
/// </list></para>
/// </summary>
public sealed class WorkflowControlTool : IPrincipalScopedToolExecutor
{
    public static readonly IReadOnlySet<string> ReadVerbs =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "inspect" };

    public static readonly IReadOnlySet<string> WriteVerbs =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "dispatch", "resume", "cancel" };

    private readonly OrchestratorToolContext _ctx;
    private readonly IElsaWorkflowService _elsa;
    private readonly IChatWorkflowInitiationService? _chatInitiation;
    private readonly DocumentDecisionSubmissionService? _decisionSubmission;
    private readonly ITaskAudienceResolver? _audienceResolver;
    private readonly ITaskAssignmentService? _taskAssignment;

    public WorkflowControlTool(
        OrchestratorToolContext ctx,
        IElsaWorkflowService elsa,
        IChatWorkflowInitiationService? chatInitiation = null,
        DocumentDecisionSubmissionService? decisionSubmission = null,
        ITaskAudienceResolver? audienceResolver = null,
        ITaskAssignmentService? taskAssignment = null)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _elsa = elsa ?? throw new ArgumentNullException(nameof(elsa));
        _chatInitiation = chatInitiation;
        _decisionSubmission = decisionSubmission;
        _audienceResolver = audienceResolver;
        _taskAssignment = taskAssignment;
    }

    public string ToolName => "workflow_control";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Inspect or control Elsa workflows. Read verb: 'inspect' (instanceId). " +
        "Individually allowlisted write verbs (require write permission): 'dispatch' (workflowName, repo, input), " +
        "'resume' (instanceId or sessionId+decisionKind), 'cancel' (instanceId).";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["verb"] = new Dictionary<string, object> { ["type"] = "string", ["enum"] = new[] { "inspect", "dispatch", "resume", "cancel" } },
            ["instanceId"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Workflow instance id (for inspect/resume/cancel)." },
            ["workflowName"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Workflow definition name (for dispatch)." },
            ["repo"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Target repository full name owner/repo (required for chat dispatch)." },
            ["input"] = new Dictionary<string, object> { ["type"] = "object", ["description"] = "Optional workflow input dictionary (for dispatch)." },
            ["sessionId"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Document decision session id (for chat decision resume)." },
            ["decisionKind"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Decision kind: accept | request-revision | reject | escalate." },
            ["notes"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional revision notes." },
            ["reason"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional reject/escalate reason." },
            ["detail"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional escalate detail." },
            ["feedback"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional decision feedback." },
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

                    // Story 39-19 AC2 / D5: chat-originated dispatches MUST flow through
                    // IChatWorkflowInitiationService (authorizer + server-derived initiatedBy + audit).
                    if (_ctx.ActingUserId is { } actingUserId && actingUserId != Guid.Empty)
                    {
                        if (_chatInitiation is null)
                            return Fail(toolCallId, sw, "Chat workflow initiation service is not configured; refusing un-authorized chat dispatch.");

                        var repo = GetString(root, "repo")
                            ?? GetString(root, "repository")
                            ?? (input.TryGetValue("repository", out var rObj) ? rObj.ToString() : null)
                            ?? string.Empty;
                        var conversationId = ParseChatConversationId(_ctx.CorrelationId);
                        var issueId = GetString(root, "issueId") ?? _ctx.IssueId;

                        var initResult = await _chatInitiation.InitiateAsync(
                            new ChatWorkflowInitiationRequest(
                                TenantId: _ctx.TenantId,
                                UserId: actingUserId,
                                WorkflowName: workflowName,
                                RepoFullName: repo,
                                ConversationId: conversationId,
                                TurnId: UuidV7.NewGuid(),
                                Input: input,
                                IssueId: issueId),
                            cancellationToken).ConfigureAwait(false);

                        if (!initResult.Allowed)
                            return Fail(toolCallId, sw, $"Workflow initiation refused: {initResult.RefusalReason}");

                        return Ok(toolCallId, sw, JsonSerializer.Serialize(new
                        {
                            dispatched = true,
                            workflowName,
                            instanceId = initResult.WorkflowInstanceId,
                            initiatedBy = actingUserId.ToString("D"),
                        }));
                    }

                    // Orchestrator autonomous dispatch: stamp server-derived tenantId.
                    if (_ctx.TenantId is { } tid && tid != Guid.Empty)
                        input["tenantId"] = tid.ToString("D");

                    var instanceId = await _elsa.StartWorkflowAsync(workflowName, input).ConfigureAwait(false);
                    return Ok(toolCallId, sw, JsonSerializer.Serialize(new { dispatched = true, workflowName, instanceId }));
                }
                case "resume":
                {
                    // Story 39-19 AC5 / D8: when acting for a chat user, task completion MUST flow
                    // through Story 39-8's DocumentDecisionSubmissionService with server-derived
                    // decider identity (never a caller/LLM-supplied decider or raw workflow bypass).
                    if (_ctx.ActingUserId is { } actingUserId && actingUserId != Guid.Empty)
                    {
                        var sessionRaw = GetString(root, "sessionId");
                        var decisionKind = GetString(root, "decisionKind") ?? GetString(root, "kind");
                        if (!Guid.TryParse(sessionRaw, out var sessionId) || sessionId == Guid.Empty)
                            return Fail(toolCallId, sw, "Chat resume requires a valid decision sessionId and decisionKind (no raw workflow resume backdoor).");

                        if (string.IsNullOrWhiteSpace(decisionKind) || !DocumentDecisionSubmissionService.IsAllowedKind(decisionKind))
                            return Fail(toolCallId, sw, "decisionKind must be one of: accept, request-revision, reject, escalate.");

                        // Optional scope check when repo/issue context is provided and resolver is available.
                        if (_audienceResolver is not null && _ctx.TenantId is { } tenantId && tenantId != Guid.Empty)
                        {
                            var repo = GetString(root, "repo");
                            var issueId = GetString(root, "issueId") ?? _ctx.IssueId;
                            if (!string.IsNullOrWhiteSpace(repo) || !string.IsNullOrWhiteSpace(issueId))
                            {
                                var taskRef = new TaskRef(tenantId, InitiatorUserId: null, RepoKey: repo, IssueId: issueId);
                                if (!await _audienceResolver.CanSeeAsync(actingUserId, taskRef).ConfigureAwait(false))
                                    return Fail(toolCallId, sw, "Acting user is not authorized to complete this task.");
                            }
                        }

                        var submission = _decisionSubmission ?? new DocumentDecisionSubmissionService(_elsa);
                        var req = new DocumentDecisionEndpoints.DecisionRequest(
                            Kind: decisionKind,
                            Notes: GetString(root, "notes"),
                            Reason: GetString(root, "reason"),
                            Detail: GetString(root, "detail"),
                            Feedback: GetString(root, "feedback"));

                        // Server-derived decider = actingUserId, channel = User (NEVER read from args!).
                        var res = await submission.SubmitAsync(
                            sessionId,
                            req,
                            _ctx.TenantId,
                            deciderId: actingUserId.ToString("D"),
                            channel: ApprovalChannel.User).ConfigureAwait(false);

                        if (res.GateNotFound)
                            return Fail(toolCallId, sw, "gate_not_waiting: no document decision is currently suspended for this session.");

                        // AC5: emit TASK.COMPLETED.SUCCESS (surface: "chat") so every role-holder's inbox clears.
                        if (res.Resumed && _taskAssignment is not null && _ctx.TenantId is { } compTid && compTid != Guid.Empty)
                        {
                            var compRepo = GetString(root, "repo");
                            var compIssue = GetString(root, "issueId") ?? _ctx.IssueId;
                            var compTask = new TaskRef(compTid, InitiatorUserId: null, RepoKey: compRepo, IssueId: compIssue);
                            await _taskAssignment.CompleteAsync(
                                compTid, compTask, actingUserId, TaskEvents.SurfaceChat, cancellationToken).ConfigureAwait(false);
                        }

                        return Ok(toolCallId, sw, JsonSerializer.Serialize(new
                        {
                            resumed = res.Resumed,
                            workflowInstanceId = res.WorkflowInstanceId,
                            kind = decisionKind.Trim().ToLowerInvariant(),
                            decider = actingUserId.ToString("D"),
                            channel = ApprovalChannel.User.ToWire(),
                        }));
                    }

                    var instanceId = GetString(root, "instanceId");
                    if (string.IsNullOrWhiteSpace(instanceId))
                        return Fail(toolCallId, sw, "instanceId is required for verb 'resume'.");
                    await _elsa.ResumeWorkflowAsync(instanceId).ConfigureAwait(false);
                    return Ok(toolCallId, sw, JsonSerializer.Serialize(new { resumed = true, instanceId }));
                }
                case "cancel":
                {
                    if (_ctx.ActingUserId is { } actingUid && actingUid != Guid.Empty)
                        return Fail(toolCallId, sw, "Write verb 'cancel' is denied for chat user scope.");

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

    private static Guid ParseChatConversationId(string? correlationId)
    {
        if (!string.IsNullOrWhiteSpace(correlationId))
        {
            const string prefix = "chat:";
            var raw = correlationId.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                ? correlationId[prefix.Length..]
                : correlationId;
            if (Guid.TryParse(raw, out var g) && g != Guid.Empty)
                return g;
        }
        return UuidV7.NewGuid();
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
