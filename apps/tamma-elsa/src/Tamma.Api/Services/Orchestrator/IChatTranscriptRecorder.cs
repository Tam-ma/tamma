using Tamma.Core.Documents.Channels;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (D12 / AC5) — contract ONLY for recording user↔orchestrator chat
/// transcript events (<c>CHAT.MESSAGE.RECEIVED</c> / <c>CHAT.MESSAGE.SENT</c>).
///
/// <para>Owned and implemented by Story 39-19's <c>OrchestratorChatService</c>
/// (which constructor-requires this recorder around every
/// <c>HandleConversationAsync</c> turn so no chat reply path can bypass event
/// emission). Story 39-17 registers NO default implementation.</para>
/// </summary>
public interface IChatTranscriptRecorder
{
    Task RecordReceivedAsync(
        Guid tenantId,
        Guid userId,
        AgentConversationMessage message,
        CancellationToken ct = default);

    Task RecordSentAsync(
        Guid tenantId,
        Guid userId,
        AgentConversationMessage reply,
        CancellationToken ct = default);
}
