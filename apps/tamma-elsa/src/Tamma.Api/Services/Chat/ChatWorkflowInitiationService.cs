using System.Text.Json;
using Tamma.Api.Services.Access;
using Tamma.Core.Documents;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Chat;

/// <summary>Request to initiate a workflow on behalf of an authenticated chat user (Story 39-19 AC2 / D5).</summary>
public sealed record ChatWorkflowInitiationRequest(
    Guid? TenantId,
    Guid UserId,
    string WorkflowName,
    string RepoFullName,
    Guid ConversationId,
    Guid TurnId,
    IReadOnlyDictionary<string, object>? Input = null,
    string? IssueId = null);

/// <summary>Outcome of a chat-initiated workflow dispatch attempt.</summary>
public sealed record ChatWorkflowInitiationResult(
    bool Allowed,
    string? WorkflowInstanceId = null,
    string? RefusalReason = null)
{
    public static ChatWorkflowInitiationResult Initiated(string workflowInstanceId) =>
        new(true, WorkflowInstanceId: workflowInstanceId);

    public static ChatWorkflowInitiationResult Refused(string reason) =>
        new(false, RefusalReason: reason);
}

/// <summary>
/// Story 39-19 (AC2 / AC6 / D5) — the SINGLE authorized workflow-initiation door
/// from Orchestrator Chat.
///
/// <para>Every chat-originated dispatch MUST flow through <see cref="InitiateAsync"/>:
/// <list type="number">
///   <item>Enforces Story 39-20's <see cref="IWorkflowInitiationAuthorizer"/>
///     (tenant repo boundary + user repo access ≥ <c>contribute</c>). On refusal,
///     emits <see cref="ChatEvents.WorkflowRefused"/> and never touches Elsa.</item>
///   <item>Stamps server-derived <c>initiatedBy</c>, <c>conversationId</c>, and
///     <c>chatTurnId</c> (plus <c>tenantId</c> when set) into the workflow input,
///     unconditionally overwriting any caller/LLM-supplied values.</item>
///   <item>Starts the workflow via <see cref="IElsaWorkflowService.StartWorkflowAsync"/>
///     and appends <see cref="ChatEvents.WorkflowInitiated"/> fail-loud so the
///     resulting workflow correlates back to the exact originating chat turn.</item>
/// </list></para>
/// </summary>
public interface IChatWorkflowInitiationService
{
    Task<ChatWorkflowInitiationResult> InitiateAsync(
        ChatWorkflowInitiationRequest request,
        CancellationToken ct = default);
}

/// <inheritdoc />
public sealed class ChatWorkflowInitiationService : IChatWorkflowInitiationService
{
    private readonly IWorkflowInitiationAuthorizer _authorizer;
    private readonly IElsaWorkflowService _elsa;
    private readonly IEventRepository _events;

    public ChatWorkflowInitiationService(
        IWorkflowInitiationAuthorizer authorizer,
        IElsaWorkflowService elsa,
        IEventRepository events)
    {
        _authorizer = authorizer ?? throw new ArgumentNullException(nameof(authorizer));
        _elsa = elsa ?? throw new ArgumentNullException(nameof(elsa));
        _events = events ?? throw new ArgumentNullException(nameof(events));
    }

    public async Task<ChatWorkflowInitiationResult> InitiateAsync(
        ChatWorkflowInitiationRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.UserId == Guid.Empty)
            return ChatWorkflowInitiationResult.Refused("Acting userId is required to initiate a workflow.");
        if (string.IsNullOrWhiteSpace(request.WorkflowName))
            return ChatWorkflowInitiationResult.Refused("workflowName is required.");

        var normalizedTenantId = request.TenantId is { } tid && tid != Guid.Empty ? tid : (Guid?)null;
        var conversationId = request.ConversationId == Guid.Empty ? UuidV7.NewGuid() : request.ConversationId;
        var turnId = request.TurnId == Guid.Empty ? UuidV7.NewGuid() : request.TurnId;
        var repoFullName = request.RepoFullName?.Trim() ?? string.Empty;

        // 1. In SaaS mode (tenantId present), enforce 39-20's initiation authorizer.
        if (normalizedTenantId is Guid saasTenantId)
        {
            var decision = await _authorizer.AuthorizeAsync(
                request.UserId,
                saasTenantId,
                repoFullName,
                request.WorkflowName,
                ct).ConfigureAwait(false);

            if (!decision.Allowed)
            {
                var reason = decision.Reason ?? $"User is not authorized to initiate '{request.WorkflowName}' on '{repoFullName}'.";
                await EmitWorkflowEventAsync(
                    ChatEvents.WorkflowRefused,
                    saasTenantId,
                    request.UserId,
                    conversationId,
                    turnId,
                    request.IssueId,
                    new Dictionary<string, object?>
                    {
                        ["workflowName"] = request.WorkflowName,
                        ["repo"] = repoFullName,
                        ["reason"] = reason,
                    }).ConfigureAwait(false);

                return ChatWorkflowInitiationResult.Refused(reason);
            }
        }

        // 2. Build input dictionary with server-derived provenance (never trust LLM-supplied initiatedBy).
        var workflowInput = new Dictionary<string, object>(StringComparer.Ordinal);
        if (request.Input is not null)
        {
            foreach (var kv in request.Input)
                workflowInput[kv.Key] = kv.Value;
        }

        workflowInput["initiatedBy"] = request.UserId.ToString("D");
        workflowInput["conversationId"] = conversationId.ToString("D");
        workflowInput["chatTurnId"] = turnId.ToString("D");
        if (normalizedTenantId is Guid t)
            workflowInput["tenantId"] = t.ToString("D");
        if (!string.IsNullOrWhiteSpace(repoFullName))
            workflowInput["repository"] = repoFullName;

        // 3. Dispatch workflow via Elsa.
        var instanceId = await _elsa.StartWorkflowAsync(request.WorkflowName, workflowInput).ConfigureAwait(false);

        // 4. Emit CHAT.WORKFLOW.INITIATED fail-loud (AC6 audit trail).
        await EmitWorkflowEventAsync(
            ChatEvents.WorkflowInitiated,
            normalizedTenantId,
            request.UserId,
            conversationId,
            turnId,
            request.IssueId,
            new Dictionary<string, object?>
            {
                ["workflowName"] = request.WorkflowName,
                ["workflowInstanceId"] = instanceId,
                ["repo"] = repoFullName,
            }).ConfigureAwait(false);

        return ChatWorkflowInitiationResult.Initiated(instanceId);
    }

    private Task EmitWorkflowEventAsync(
        string eventType,
        Guid? tenantId,
        Guid userId,
        Guid conversationId,
        Guid turnId,
        string? issueId,
        Dictionary<string, object?> data)
    {
        var tags = new Dictionary<string, object?>
        {
            ["userId"] = userId.ToString("D"),
            ["initiatedBy"] = userId.ToString("D"),
            ["conversationId"] = conversationId.ToString("D"),
            ["turnId"] = turnId.ToString("D"),
            ["correlationId"] = conversationId.ToString("D"),
        };

        if (tenantId is Guid tid && tid != Guid.Empty)
            tags["tenantId"] = tid.ToString("D");
        if (!string.IsNullOrWhiteSpace(issueId))
            tags["issueId"] = issueId.Trim();

        return _events.AppendAsync(new DomainEvent
        {
            Id = UuidV7.NewGuid(),
            Type = eventType,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(tags),
            Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-chat"}""",
            Data = JsonSerializer.Serialize(data),
            CreatedAt = DateTime.UtcNow,
        });
    }
}
