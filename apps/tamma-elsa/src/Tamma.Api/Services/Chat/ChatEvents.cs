namespace Tamma.Api.Services.Chat;

/// <summary>
/// Story 39-19 (AC6 / D2 / D3 / D5) — DCB event constants for the user↔orchestrator
/// chat surface. Every constant conforms to <c>AGGREGATE.ACTION.STATUS</c> (3 segments).
///
/// <para><b>Tag set (D2):</b> every <c>CHAT.*</c> event carries <c>userId</c>,
/// <c>tenantId</c> (when in SaaS mode), <c>conversationId</c>, <c>turnId</c>,
/// <c>correlationId = conversationId</c> (rides the existing
/// <c>ix_domain_events_tags_correlationid</c> index), and <c>issueId</c> when known.
/// Workflow initiation / refusal events also carry <c>initiatedBy</c>.</para>
///
/// <para><b>Fail-loud posture (D3):</b> unlike best-effort telemetry emitters,
/// chat events ARE the chat history (no chat table exists). An append failure MUST
/// propagate and fail the turn rather than silently dropping history.</para>
/// </summary>
public static class ChatEvents
{
    public const string MessageReceived = "CHAT.MESSAGE.RECEIVED";
    public const string MessageSent = "CHAT.MESSAGE.SENT";
    public const string WorkflowInitiated = "CHAT.WORKFLOW.INITIATED";
    public const string WorkflowRefused = "CHAT.WORKFLOW.REFUSED";

    /// <summary>Maximum persisted length of a single chat turn after credential redaction (32 KiB).</summary>
    public const int ChatRedactionMaxLength = 32_768;

    /// <summary>Maximum preview snippet length shown in the conversation list.</summary>
    public const int SnippetMaxLength = 160;
}
