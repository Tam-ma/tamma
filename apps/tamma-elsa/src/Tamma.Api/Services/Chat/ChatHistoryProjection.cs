using System.Text.Json;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Chat;

/// <summary>Summary entry for one user-owned orchestrator chat conversation.</summary>
public sealed record ChatConversationSummary(
    Guid ConversationId,
    DateTimeOffset LastActivityAt,
    string LastSnippet,
    int MessageCount);

/// <summary>One persisted chat message projected from <c>CHAT.MESSAGE.*</c> events.</summary>
public sealed record ChatMessageItem(
    Guid EventId,
    long SequenceNumber,
    Guid ConversationId,
    Guid? TurnId,
    string Direction,
    string Content,
    DateTimeOffset Timestamp);

/// <summary>One paginated slice of messages inside a conversation, ordered oldest-first.</summary>
public sealed record ChatConversationPage(
    Guid ConversationId,
    IReadOnlyList<ChatMessageItem> Messages,
    long? NextCursor,
    bool HasMore);

/// <summary>
/// Story 39-19 (AC1 / D2) — pure DCB projection over <c>CHAT.MESSAGE.*</c> events.
/// No chat table exists; conversation identity is strictly <c>(userId, conversationId)</c>.
///
/// <para>Every query scopes by <c>actor = userId</c> (mapped to <c>Tags.userId</c>) AND
/// re-verifies <c>Tags.userId == userId</c> in memory, so user B requesting user A's
/// <c>conversationId</c> structurally receives an empty page.</para>
/// </summary>
public sealed class ChatHistoryProjection
{
    internal const string MessagePrefix = "CHAT.MESSAGE.";
    private const int DefaultConversationLimit = 50;
    private const int MaxConversationLimit = 200;
    private const int DefaultMessageLimit = 100;
    private const int MaxMessageLimit = 500;
    private const int SingleUserFetchLimit = 500;

    private readonly IEventRepository _events;

    public ChatHistoryProjection(IEventRepository events)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
    }

    public async Task<IReadOnlyList<ChatConversationSummary>> ListConversationsAsync(
        Guid? tenantId,
        Guid userId,
        int limit = DefaultConversationLimit,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
            return Array.Empty<ChatConversationSummary>();

        var boundedLimit = Math.Clamp(limit, 1, MaxConversationLimit);
        var rawEvents = await FetchMessageEventsAsync(
            tenantId,
            userId,
            conversationId: null,
            cursor: null,
            fetchLimit: Math.Clamp(boundedLimit * 10, 100, 1000)).ConfigureAwait(false);

        var items = rawEvents
            .Select(evt => TryProjectMessage(evt, userId, requiredConversationId: null))
            .Where(item => item is not null)
            .Select(item => item!)
            .ToList();

        return items
            .GroupBy(m => m.ConversationId)
            .Select(g =>
            {
                var ordered = g
                    .OrderBy(m => m.SequenceNumber)
                    .ThenBy(m => m.Timestamp)
                    .ToList();
                var latest = ordered[^1];
                var snippet = latest.Content.Length <= ChatEvents.SnippetMaxLength
                    ? latest.Content
                    : latest.Content[..ChatEvents.SnippetMaxLength];
                return new ChatConversationSummary(
                    ConversationId: g.Key,
                    LastActivityAt: latest.Timestamp,
                    LastSnippet: snippet,
                    MessageCount: ordered.Count);
            })
            .OrderByDescending(c => c.LastActivityAt)
            .Take(boundedLimit)
            .ToList();
    }

    public async Task<ChatConversationPage> GetConversationAsync(
        Guid? tenantId,
        Guid userId,
        Guid conversationId,
        long? cursor = null,
        int limit = DefaultMessageLimit,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty || conversationId == Guid.Empty)
            return new ChatConversationPage(conversationId, Array.Empty<ChatMessageItem>(), null, false);

        var boundedLimit = Math.Clamp(limit, 1, MaxMessageLimit);
        var rawEvents = await FetchMessageEventsAsync(
            tenantId,
            userId,
            conversationId: conversationId,
            cursor: cursor,
            fetchLimit: boundedLimit + 1).ConfigureAwait(false);

        var matched = rawEvents
            .Select(evt => TryProjectMessage(evt, userId, requiredConversationId: conversationId))
            .Where(item => item is not null)
            .Select(item => item!)
            .ToList();

        // When single-user mode falls back to QueryAsync (no cursor predicate at DB level),
        // enforce cursor filtering here so pagination behaves consistently.
        if (cursor is long c && (tenantId is null || tenantId == Guid.Empty))
        {
            matched = matched.Where(m => m.SequenceNumber < c).ToList();
        }

        // Events arrive newest-first from QueryEventsAsync; take the newest `boundedLimit`
        // (tracking whether older messages exist) and return oldest-first for chat display.
        var descending = matched
            .OrderByDescending(m => m.SequenceNumber)
            .ThenByDescending(m => m.Timestamp)
            .ToList();

        var hasMore = descending.Count > boundedLimit;
        var pageSlice = descending.Take(boundedLimit).ToList();
        pageSlice.Reverse(); // oldest-first

        long? nextCursor = hasMore && pageSlice.Count > 0 && pageSlice[0].SequenceNumber > 0
            ? pageSlice[0].SequenceNumber
            : null;

        return new ChatConversationPage(conversationId, pageSlice, nextCursor, hasMore);
    }

    private async Task<IReadOnlyList<DomainEvent>> FetchMessageEventsAsync(
        Guid? tenantId,
        Guid userId,
        Guid? conversationId,
        long? cursor,
        int fetchLimit)
    {
        if (tenantId is { } tid && tid != Guid.Empty)
        {
            var (events, _) = await _events.QueryEventsAsync(
                tenantId: tid,
                type: MessagePrefix,
                typeIsPrefix: true,
                correlationId: conversationId?.ToString("D"),
                actor: userId.ToString("D"),
                from: null,
                to: null,
                cursor: cursor,
                limit: fetchLimit,
                includeTotal: false).ConfigureAwait(false);
            return events;
        }

        // Single-user mode (D2): tenantId is null; merge RECEIVED + SENT from platform scope.
        var received = await _events.QueryAsync(null, ChatEvents.MessageReceived, null, SingleUserFetchLimit)
            .ConfigureAwait(false);
        var sent = await _events.QueryAsync(null, ChatEvents.MessageSent, null, SingleUserFetchLimit)
            .ConfigureAwait(false);
        return received.Concat(sent).ToList();
    }

    private static ChatMessageItem? TryProjectMessage(
        DomainEvent evt,
        Guid requiredUserId,
        Guid? requiredConversationId)
    {
        if (evt.Type is not (ChatEvents.MessageReceived or ChatEvents.MessageSent))
            return null;

        var tags = ParseObject(evt.Tags);
        var data = ParseObject(evt.Data);

        // Structural per-user isolation: require exact Tags.userId match.
        var tagUserId = TryGetGuid(tags, "userId");
        if (tagUserId != requiredUserId)
            return null;

        var conversationId = TryGetGuid(tags, "conversationId")
            ?? TryGetGuid(data, "conversationId")
            ?? TryGetGuid(tags, "correlationId");
        if (conversationId is not { } cid || cid == Guid.Empty)
            return null;

        if (requiredConversationId is { } reqCid && cid != reqCid)
            return null;

        var turnId = TryGetGuid(tags, "turnId") ?? TryGetGuid(data, "turnId");
        var direction = TryGetString(data, "direction")
            ?? (evt.Type == ChatEvents.MessageReceived ? "user->agent" : "agent->user");
        var content = TryGetString(data, "content") ?? string.Empty;

        var ts = evt.CreatedAt.Kind == DateTimeKind.Utc
            ? new DateTimeOffset(evt.CreatedAt, TimeSpan.Zero)
            : new DateTimeOffset(DateTime.SpecifyKind(evt.CreatedAt, DateTimeKind.Utc), TimeSpan.Zero);

        return new ChatMessageItem(
            EventId: evt.Id,
            SequenceNumber: evt.SequenceNumber,
            ConversationId: cid,
            TurnId: turnId,
            Direction: direction,
            Content: content,
            Timestamp: ts);
    }

    internal static Dictionary<string, JsonElement> ParseObject(string? json)
    {
        var result = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json)) return result;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return result;
            foreach (var prop in doc.RootElement.EnumerateObject())
                result[prop.Name] = prop.Value.Clone();
        }
        catch (JsonException)
        {
            // Ignore malformed JSON gracefully in projection.
        }
        return result;
    }

    internal static string? TryGetString(Dictionary<string, JsonElement> map, string key) =>
        map.TryGetValue(key, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;

    internal static Guid? TryGetGuid(Dictionary<string, JsonElement> map, string key)
    {
        var raw = TryGetString(map, key);
        return Guid.TryParse(raw, out var g) && g != Guid.Empty ? g : null;
    }
}
