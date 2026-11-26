using System.Text.Json;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Core.Redaction;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Chat;

/// <summary>
/// Per-turn identity and correlation context for recording a <c>CHAT.MESSAGE.*</c>
/// event (Story 39-19 D2 / D3).
/// </summary>
public sealed record ChatTurnContext(
    Guid? TenantId,
    Guid UserId,
    Guid ConversationId,
    string? IssueId = null);

/// <summary>
/// Story 39-19 (AC6 / D3) — the SOLE production implementation of Story 39-17's
/// <see cref="IChatTranscriptRecorder"/>.
///
/// <para><b>Fail-loud posture (deliberate deviation from <c>PromptEventsService</c>):</b>
/// chat has no dedicated database table — the DCB event stream IS the authoritative
/// chat history. Any failure from <see cref="IEventRepository.AppendAsync"/> propagates
/// to the caller so a message can never cross un-evented.</para>
///
/// <para><b>Redaction (AC6):</b> every message body passes through
/// <see cref="CredentialRedactor.Clean(string?, int)"/> with a 32 KiB budget BEFORE
/// serialization so secrets pasted in chat never land in the event store.</para>
/// </summary>
public sealed class EventStoreChatTranscriptRecorder : IChatTranscriptRecorder
{
    private readonly IEventRepository _events;

    public EventStoreChatTranscriptRecorder(IEventRepository events)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
    }

    /// <summary>
    /// Record an inbound user turn as <see cref="ChatEvents.MessageReceived"/> and
    /// return the newly minted UUID v7 <c>turnId</c>.
    /// </summary>
    public async Task<Guid> RecordUserTurnAsync(
        ChatTurnContext ctx,
        string content,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(ctx);
        if (ctx.UserId == Guid.Empty)
            throw new ArgumentException("UserId is required to record a chat turn.", nameof(ctx));
        if (ctx.ConversationId == Guid.Empty)
            throw new ArgumentException("ConversationId is required to record a chat turn.", nameof(ctx));

        var turnId = UuidV7.NewGuid();
        var cleaned = CredentialRedactor.Clean(content, ChatEvents.ChatRedactionMaxLength);
        var snippet = BuildSnippet(cleaned);

        await _events.AppendAsync(new DomainEvent
        {
            Id = UuidV7.NewGuid(),
            Type = ChatEvents.MessageReceived,
            TenantId = NormalizeTenantId(ctx.TenantId),
            Tags = JsonSerializer.Serialize(BuildTags(ctx, turnId)),
            Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-chat"}""",
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["conversationId"] = ctx.ConversationId.ToString("D"),
                ["turnId"] = turnId.ToString("D"),
                ["direction"] = "user->agent",
                ["content"] = cleaned,
                ["snippet"] = snippet,
            }),
            CreatedAt = DateTime.UtcNow,
        }).ConfigureAwait(false);

        return turnId;
    }

    /// <summary>
    /// Record the final agent reply for <paramref name="turnId"/> as
    /// <see cref="ChatEvents.MessageSent"/> (one event per logical turn — never per chunk).
    /// </summary>
    public async Task RecordAgentReplyAsync(
        ChatTurnContext ctx,
        Guid turnId,
        string content,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(ctx);
        if (ctx.UserId == Guid.Empty)
            throw new ArgumentException("UserId is required to record a chat reply.", nameof(ctx));
        if (ctx.ConversationId == Guid.Empty)
            throw new ArgumentException("ConversationId is required to record a chat reply.", nameof(ctx));

        var effectiveTurnId = turnId == Guid.Empty ? UuidV7.NewGuid() : turnId;
        var cleaned = CredentialRedactor.Clean(content, ChatEvents.ChatRedactionMaxLength);
        var snippet = BuildSnippet(cleaned);

        await _events.AppendAsync(new DomainEvent
        {
            Id = UuidV7.NewGuid(),
            Type = ChatEvents.MessageSent,
            TenantId = NormalizeTenantId(ctx.TenantId),
            Tags = JsonSerializer.Serialize(BuildTags(ctx, effectiveTurnId)),
            Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-chat"}""",
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["conversationId"] = ctx.ConversationId.ToString("D"),
                ["turnId"] = effectiveTurnId.ToString("D"),
                ["direction"] = "agent->user",
                ["content"] = cleaned,
                ["snippet"] = snippet,
            }),
            CreatedAt = DateTime.UtcNow,
        }).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RecordReceivedAsync(
        Guid tenantId,
        Guid userId,
        AgentConversationMessage message,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(message);
        var ctx = new ChatTurnContext(
            TenantId: NormalizeTenantId(tenantId),
            UserId: userId,
            ConversationId: message.ConversationId);
        await RecordUserTurnAsync(ctx, message.Text, ct).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RecordSentAsync(
        Guid tenantId,
        Guid userId,
        AgentConversationMessage reply,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(reply);
        var ctx = new ChatTurnContext(
            TenantId: NormalizeTenantId(tenantId),
            UserId: userId,
            ConversationId: reply.ConversationId);
        await RecordAgentReplyAsync(ctx, UuidV7.NewGuid(), reply.Text, ct).ConfigureAwait(false);
    }

    private static Dictionary<string, object?> BuildTags(ChatTurnContext ctx, Guid turnId)
    {
        var tags = new Dictionary<string, object?>
        {
            ["userId"] = ctx.UserId.ToString("D"),
            ["conversationId"] = ctx.ConversationId.ToString("D"),
            ["turnId"] = turnId.ToString("D"),
            // D2: ride the existing ix_domain_events_tags_correlationid index for per-conversation replay.
            ["correlationId"] = ctx.ConversationId.ToString("D"),
        };

        if (NormalizeTenantId(ctx.TenantId) is Guid tid)
            tags["tenantId"] = tid.ToString("D");

        if (!string.IsNullOrWhiteSpace(ctx.IssueId))
            tags["issueId"] = ctx.IssueId.Trim();

        return tags;
    }

    private static Guid? NormalizeTenantId(Guid? tenantId) =>
        tenantId is { } tid && tid != Guid.Empty ? tid : null;

    private static string BuildSnippet(string cleaned) =>
        cleaned.Length <= ChatEvents.SnippetMaxLength
            ? cleaned
            : cleaned[..ChatEvents.SnippetMaxLength];
}
