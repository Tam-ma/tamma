using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tamma.Api.Services.Channels;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;

namespace Tamma.Api.Services.Chat;

/// <summary>
/// Story 39-19 (AC1 / AC5 / AC6 / D4) — the SOLE chat coordinator &amp; transcript
/// recorder, replacing Story 39-18's <see cref="AgentOfflineChatRelay"/> in DI.
///
/// <para><b>Availability before recording (D4):</b> when the tenant's orchestrator
/// agent is offline (not running and <see cref="OrchestratorHostOptions.Enabled"/>
/// is <c>false</c>), <see cref="RelayUserMessageAsync"/> returns
/// <see cref="ChatRelayResult.Offline"/> without recording any <c>CHAT.*</c> event
/// and without touching the user channel — offline chat fails loudly and never
/// forges history or silently queues turns.</para>
///
/// <para><b>Ordering invariant:</b>
/// <list type="number">
///   <item>Check orchestrator availability (or start on-demand when host is enabled).</item>
///   <item>Record <c>CHAT.MESSAGE.RECEIVED</c> fail-loud via <see cref="IChatTranscriptRecorder"/>.</item>
///   <item>Dispatch turn to <see cref="OrchestratorAgentInstance.HandleConversationAsync"/>
///     with per-user attenuated scope (<c>ActingUserId = userId</c>).</item>
///   <item>Record <c>CHAT.MESSAGE.SENT</c> fail-loud and push the reply envelope to
///     <see cref="IUserChannelSender"/> (exact <c>(tenantId, userId)</c> group).</item>
/// </list></para>
/// </summary>
public sealed class OrchestratorChatService : IOrchestratorChatRelay
{
    private readonly IOrchestratorAgentRegistry _agents;
    private readonly IChatTranscriptRecorder _recorder;
    private readonly IUserChannelSender _userChannel;
    private readonly OrchestratorHostOptions _hostOptions;
    private readonly ILogger<OrchestratorChatService> _logger;

    public OrchestratorChatService(
        IOrchestratorAgentRegistry agents,
        IChatTranscriptRecorder recorder,
        IUserChannelSender userChannel,
        IOptions<OrchestratorHostOptions> hostOptions,
        ILogger<OrchestratorChatService> logger)
    {
        _agents = agents ?? throw new ArgumentNullException(nameof(agents));
        _recorder = recorder ?? throw new ArgumentNullException(nameof(recorder));
        _userChannel = userChannel ?? throw new ArgumentNullException(nameof(userChannel));
        _hostOptions = hostOptions?.Value ?? new OrchestratorHostOptions();
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <inheritdoc />
    public async Task<ChatRelayResult> RelayUserMessageAsync(
        Guid tenantId,
        Guid userId,
        AgentConversationMessage message,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (tenantId == Guid.Empty || userId == Guid.Empty)
            return new ChatRelayResult(false, "invalid-principal: tenantId and userId are required.");

        if (string.IsNullOrWhiteSpace(message.Text))
            return new ChatRelayResult(false, "empty-message: message text is required.");

        // 1. Availability check BEFORE recording any event (D4).
        var instance = await TryResolveAgentAsync(tenantId, ct).ConfigureAwait(false);
        if (instance is null)
        {
            _logger.LogInformation(
                "Chat turn refused because orchestrator agent is offline for tenant {TenantId}",
                tenantId);
            return ChatRelayResult.Offline;
        }

        // Server-stamp userId, direction, and ensure a valid conversationId.
        var conversationId = message.ConversationId == Guid.Empty
            ? UuidV7.NewGuid()
            : message.ConversationId;
        var stampedInbound = message with
        {
            ConversationId = conversationId,
            UserId = userId,
            Direction = "user->agent",
        };

        // 2. Fail-loud CHAT.MESSAGE.RECEIVED BEFORE invoking the agent.
        await _recorder.RecordReceivedAsync(tenantId, userId, stampedInbound, ct).ConfigureAwait(false);

        // 3. Execute the per-user attenuated agent turn (AC1 / AC2 / AC5).
        //    Pass recorder: null because OrchestratorChatService owns recording on both legs.
        //    AllowWriteVerbs: true lets WorkflowControlTool gate chat dispatch through
        //    IChatWorkflowInitiationService (39-20 authorizer + initiatedBy) and chat decision
        //    resume through 39-8 DocumentDecisionSubmissionService (server-derived user identity),
        //    while refusing raw cancel.
        var reply = await instance.HandleConversationAsync(
            userId,
            stampedInbound,
            allowWriteVerbs: true,
            recorder: null,
            ct).ConfigureAwait(false);

        // 4. Record CHAT.MESSAGE.SENT (fail-loud) and push to the user's SignalR group.
        var replyResult = await RelayAgentReplyAsync(tenantId, reply, ct).ConfigureAwait(false);
        return replyResult;
    }

    /// <inheritdoc />
    public async Task<ChatRelayResult> RelayAgentReplyAsync(
        Guid tenantId,
        AgentConversationMessage message,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (tenantId == Guid.Empty || message.UserId == Guid.Empty)
            return new ChatRelayResult(false, "invalid-reply: tenantId and userId are required.");

        var conversationId = message.ConversationId == Guid.Empty
            ? UuidV7.NewGuid()
            : message.ConversationId;
        var stampedReply = message with
        {
            ConversationId = conversationId,
            Direction = "agent->user",
        };

        // Record CHAT.MESSAGE.SENT fail-loud BEFORE pushing over SignalR (transport is never truth).
        await _recorder.RecordSentAsync(tenantId, stampedReply.UserId, stampedReply, ct).ConfigureAwait(false);

        var envelope = new ChannelEnvelope(
            MessageId: UuidV7.NewGuid(),
            TenantId: tenantId,
            Audience: ChannelAudience.User,
            RecipientUserId: stampedReply.UserId,
            Message: stampedReply,
            CreatedAt: DateTimeOffset.UtcNow);

        await _userChannel.SendToUserAsync(tenantId, stampedReply.UserId, envelope, ct).ConfigureAwait(false);
        return new ChatRelayResult(true, null);
    }

    private async Task<OrchestratorAgentInstance?> TryResolveAgentAsync(Guid tenantId, CancellationToken ct)
    {
        if (_agents.TryGet(tenantId, out var running) && running is not null)
            return running;

        if (!_hostOptions.Enabled)
            return null;

        try
        {
            return await _agents.GetOrStartAsync(tenantId, ownerUserId: null, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to start orchestrator instance for tenant {TenantId} during chat turn.", tenantId);
            return null;
        }
    }
}
