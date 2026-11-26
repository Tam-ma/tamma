using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Models;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Core.Documents.Policy;
using Tamma.Core.Documents.Types;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC1 / AC3 / AC4 / AC5 / AC7 / D9–D13) — one long-running
/// Orchestrator Agent instance bound to a SINGLE tenant (or the sole user's
/// personal tenant in single-user mode).
///
/// <para><b>Routing discipline (AC3 / D11):</b> there is NO <c>if (autonomy &gt;= X)</c>
/// branch anywhere in this class. The server-resolved rules and autonomy level ride
/// in the prompt context; the agent either decides itself (wrapped by
/// <see cref="AcceptanceGuardrails.Clamp"/> and delivered via Story 39-8's
/// idempotent <see cref="DocumentDecisionSubmissionService"/> on channel
/// <c>orchestrator</c>) or assigns to a role (validated by Story 39-20's
/// <see cref="ITaskAssignmentService"/>; unknown role / empty audience refused
/// and re-routed).</para>
///
/// <para><b>Per-user chat attenuation (AC4 / D12):</b> user chat turns execute
/// in isolated per-user conversation histories with a freshly constructed
/// <see cref="OrchestratorToolContext"/> carrying <c>ActingUserId = userId</c>
/// so tools carry X's authorization and user Y never sees user X's transcript.</para>
/// </summary>
public sealed class OrchestratorAgentInstance
{
    private const int MaxAssignmentRerouteAttempts = 2;

    private readonly Guid _tenantId;
    private readonly Guid? _ownerUserId;
    private readonly IOrchestratorInbox _inbox;
    private readonly IOrchestratorTurnRunner _turnRunner;
    private readonly IOrchestratorConfigService _configService;
    private readonly OrchestratorToolDependencies _toolDeps;
    private readonly DocumentDecisionSubmissionService _decisionSubmission;
    private readonly EscalationDispositionService _escalationDisposition;
    private readonly ITaskAssignmentService _taskAssignment;
    private readonly IEventRepository _events;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<OrchestratorAgentInstance> _logger;
    private readonly Func<Guid, GuidanceReply, CancellationToken, Task>? _onGuidanceReply;

    private readonly SemaphoreSlim _turnLock = new(1, 1);
    private readonly ConcurrentDictionary<Guid, List<ConversationMessage>> _userChatSessions = new();
    private DateOnly _spendDayUtc;
    private decimal _dailySpendUsd;
    private DateTimeOffset _lastActivityUtc;
    private bool _started;

    public Guid TenantId => _tenantId;
    public OrchestratorSession Session { get; }
    public DateTimeOffset LastActivityUtc => _lastActivityUtc;
    public decimal DailySpendUsd => _dailySpendUsd;

    public OrchestratorAgentInstance(
        Guid tenantId,
        Guid? ownerUserId,
        IOrchestratorInbox inbox,
        IOrchestratorTurnRunner turnRunner,
        IOrchestratorConfigService configService,
        OrchestratorToolDependencies toolDeps,
        DocumentDecisionSubmissionService decisionSubmission,
        EscalationDispositionService escalationDisposition,
        ITaskAssignmentService taskAssignment,
        IEventRepository events,
        ILogger<OrchestratorAgentInstance> logger,
        TimeProvider? timeProvider = null,
        Func<Guid, GuidanceReply, CancellationToken, Task>? onGuidanceReply = null)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required for an OrchestratorAgentInstance.", nameof(tenantId));

        _tenantId = tenantId;
        _ownerUserId = ownerUserId;
        _inbox = inbox ?? throw new ArgumentNullException(nameof(inbox));
        _turnRunner = turnRunner ?? throw new ArgumentNullException(nameof(turnRunner));
        _configService = configService ?? throw new ArgumentNullException(nameof(configService));
        _toolDeps = toolDeps ?? throw new ArgumentNullException(nameof(toolDeps));
        _decisionSubmission = decisionSubmission ?? throw new ArgumentNullException(nameof(decisionSubmission));
        _escalationDisposition = escalationDisposition ?? throw new ArgumentNullException(nameof(escalationDisposition));
        _taskAssignment = taskAssignment ?? throw new ArgumentNullException(nameof(taskAssignment));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? TimeProvider.System;
        _onGuidanceReply = onGuidanceReply;

        Session = new OrchestratorSession(tenantId);
        var now = _timeProvider.GetUtcNow();
        _lastActivityUtc = now;
        _spendDayUtc = DateOnly.FromDateTime(now.UtcDateTime);
    }

    /// <summary>
    /// Start or re-hydrate this instance's bootstrap context from the tenant's
    /// DCB stream (D9), emitting <see cref="OrchestratorEvents.SessionRehydrated"/>
    /// if prior stream history existed or <see cref="OrchestratorEvents.SessionStarted"/>
    /// on a fresh start.
    /// </summary>
    public async Task StartOrRehydrateAsync(CancellationToken ct = default)
    {
        if (_started) return;
        var hadHistory = await Session.RehydrateFromStreamAsync(_events, maxEvents: 40, ct).ConfigureAwait(false);
        _started = true;
        TouchActivity();

        await EmitSessionEventBestEffortAsync(
            hadHistory ? OrchestratorEvents.SessionRehydrated : OrchestratorEvents.SessionStarted,
            new Dictionary<string, object?>
            {
                ["rehydrated"] = hadHistory,
                ["bootstrapChars"] = Session.BootstrapContext?.Length ?? 0,
            }).ConfigureAwait(false);
    }

    /// <summary>
    /// Long-running consumption loop over <see cref="IOrchestratorInbox.SubscribeAsync"/>.
    /// Idle = awaiting the async enumerable with ZERO LLM calls / token burn (AC1).
    /// Acknowledges each item ONLY after durable handling succeeds so a crash mid-request
    /// causes clean redelivery on restart.
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        await StartOrRehydrateAsync(ct).ConfigureAwait(false);

        await foreach (var item in _inbox.SubscribeAsync(_tenantId, ct).ConfigureAwait(false))
        {
            if (item.TenantId != _tenantId)
            {
                _logger.LogError(
                    "Cross-tenant inbox item rejected: instance tenant={InstanceTenant}, item tenant={ItemTenant}, itemId={ItemId}",
                    _tenantId, item.TenantId, item.ItemId);
                continue;
            }

            try
            {
                switch (item.Message)
                {
                    case AcceptanceRequested acc:
                        await HandleAcceptanceRequestAsync(acc.Request, ct).ConfigureAwait(false);
                        break;
                    case EscalationRaised esc:
                        await HandleEscalationAsync(esc, ct).ConfigureAwait(false);
                        break;
                    case GuidanceQuery q:
                        await HandleGuidanceAsync(q, ct).ConfigureAwait(false);
                        break;
                    case AgentConversationMessage conv when item.ActingUserId is { } uid:
                        await HandleConversationAsync(uid, conv, allowWriteVerbs: false, recorder: null, ct).ConfigureAwait(false);
                        break;
                    default:
                        _logger.LogDebug(
                            "Orchestrator instance for tenant {TenantId} ignoring unsupported inbox kind {Kind}",
                            _tenantId, item.Message.GetType().Name);
                        break;
                }

                await _inbox.AckAsync(_tenantId, item.ItemId, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                // Leave item unacked so restart/sweeper redelivers it cleanly.
                _logger.LogError(ex,
                    "Orchestrator failed processing inbox item {ItemId} for tenant {TenantId}; left unacked for redelivery.",
                    item.ItemId, _tenantId);
            }
        }
    }

    /// <summary>
    /// Story 39-17 (AC3 / D11) — single routing &amp; acceptance decision handler.
    /// Pre-gates deterministically, then runs one audited turn, clamps any
    /// self-decision through <see cref="AcceptanceGuardrails.Clamp"/>, and lands
    /// either on 39-8's idempotent resume surface (channel <c>orchestrator</c>)
    /// or on 39-20's server-validated <see cref="ITaskAssignmentService"/>.
    /// </summary>
    public async Task<OrchestratorAcceptanceResult> HandleAcceptanceRequestAsync(
        AcceptanceRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await _turnLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            TouchActivity();
            var docType = DocumentTypeKeyExtensions.TryParse(request.Document.Type, out var parsedType)
                ? parsedType
                : DocumentTypeKey.Review;
            var reviewFacts = ExtractReviewFacts(request.Review);
            var gateCtx = new AcceptanceGateContext(
                docType,
                request.Document.ProducedBy?.Action,
                reviewFacts,
                request.RoundsUsed,
                request.Rules.Rules,
                ApprovalChannel.Orchestrator);

            // 1. Deterministic pre-gate BEFORE any LLM call (AC3 / AC7).
            if (AcceptanceGuardrails.TryPreGate(gateCtx, out var preGateEsc))
            {
                var preResume = await SubmitDecisionAsync(
                    request.DecisionSessionId, preGateEsc, preGateEsc.Detail, ct).ConfigureAwait(false);
                if (!preResume.GateNotFound)
                {
                    await EmitDecisionMadeAsync(
                        kind: "acceptance",
                        routing: "decide-self",
                        decisionKind: "escalate",
                        reasoningSummary: preGateEsc.Detail,
                        rulesVersion: request.Rules.Version,
                        decisionSessionId: request.DecisionSessionId,
                        issueId: request.IssueId,
                        correlationId: request.DecisionSessionId.ToString("D"),
                        assignedRole: null,
                        preGated: true,
                        clamped: false).ConfigureAwait(false);
                }

                return new OrchestratorAcceptanceResult(
                    Routing: "decide-self",
                    Decision: preGateEsc,
                    AssignedRole: null,
                    AlreadyAnswered: preResume.GateNotFound,
                    PreGated: true,
                    Clamped: false,
                    ReasoningSummary: preGateEsc.Detail);
            }

            // 2. Load tenant config & enforce daily spend cap.
            var resolvedConfig = await ResolveConfigAsync(ct).ConfigureAwait(false);
            var config = resolvedConfig.Config;

            if (IsDailySpendExhausted(config))
            {
                var spendEsc = new AcceptanceDecision.Escalate(
                    AcceptanceEscalationReason.AcceptorJudgment,
                    $"Orchestrator daily spend cap (${config.MaxUsdPerDay:F2}) reached; escalating for human decision.");
                var spendResume = await SubmitDecisionAsync(
                    request.DecisionSessionId, spendEsc, spendEsc.Detail, ct).ConfigureAwait(false);
                if (!spendResume.GateNotFound)
                {
                    await EmitDecisionMadeAsync(
                        "acceptance", "decide-self", "escalate", spendEsc.Detail,
                        request.Rules.Version, request.DecisionSessionId, request.IssueId,
                        request.DecisionSessionId.ToString("D"), null, false, false).ConfigureAwait(false);
                }
                return new OrchestratorAcceptanceResult(
                    "decide-self", spendEsc, null, spendResume.GateNotFound, false, false, spendEsc.Detail);
            }

            // 3. Build principal-bound audited tool registry for this decision turn.
            var correlationId = request.DecisionSessionId.ToString("D");
            var toolCtx = new OrchestratorToolContext(
                TenantId: _tenantId,
                UserId: _ownerUserId,
                ActingUserId: null,
                DecisionSessionId: request.DecisionSessionId,
                CorrelationId: correlationId,
                IssueId: request.IssueId,
                AllowWriteVerbs: true);
            var registry = OrchestratorToolCatalog.Build(toolCtx, _toolDeps);
            var tools = OrchestratorToolCatalog.ToResolvedTools(registry);

            // 4. Append request context (rules + autonomy level ride in the prompt;
            //    NO host-side `if (autonomy >= X)` branch).
            Session.AppendUserTurn(ComposeAcceptancePrompt(request, reviewFacts));
            Session.CompactIfNeeded(config.MaxSessionTokens, config.CompactAfterTurns);

            var turnResult = await RunTurnAndTrackSpendAsync(
                config, Session.Messages, registry, tools, correlationId, ct).ConfigureAwait(false);

            var outcome = turnResult.Success
                ? OrchestratorOutcomeParser.ParseAcceptanceOutcome(turnResult.ResponseText)
                : new OrchestratorTurnOutcome.DecideSelf(
                    new AcceptanceDecision.Escalate(
                        AcceptanceEscalationReason.AcceptorJudgment,
                        $"Orchestrator LLM turn failed ({turnResult.ErrorCode}): {turnResult.ErrorMessage}"),
                    turnResult.ErrorMessage ?? "LLM turn failed.");

            // 5. Handle role assignment with bounded server-validated re-routing.
            var rerouteAttempt = 0;
            while (outcome is OrchestratorTurnOutcome.AssignToRole assign)
            {
                var taskRef = new TaskRef(
                    _tenantId,
                    InitiatorUserId: _ownerUserId,
                    RepoKey: ExtractRepoKey(request.IssueId),
                    IssueId: request.IssueId,
                    DocumentId: request.Document.Id);

                var assignResult = await _taskAssignment.AssignAsync(
                    _tenantId,
                    taskRef,
                    assign.RoleWire,
                    assign.Basis.ToWire(),
                    autonomyContextRef: $"autonomy={request.Rules.Rules.AutonomyLevel};rulesV={request.Rules.Version}",
                    ct).ConfigureAwait(false);

                if (assignResult.IsAccepted)
                {
                    await EmitDecisionMadeAsync(
                        kind: "acceptance",
                        routing: "assign-to-role",
                        decisionKind: null,
                        reasoningSummary: assign.ReasoningSummary,
                        rulesVersion: request.Rules.Version,
                        decisionSessionId: request.DecisionSessionId,
                        issueId: request.IssueId,
                        correlationId: correlationId,
                        assignedRole: assignResult.RoleWire,
                        preGated: false,
                        clamped: false).ConfigureAwait(false);

                    return new OrchestratorAcceptanceResult(
                        Routing: "assign-to-role",
                        Decision: null,
                        AssignedRole: assignResult.RoleWire,
                        AlreadyAnswered: false,
                        PreGated: false,
                        Clamped: false,
                        ReasoningSummary: assign.ReasoningSummary,
                        AssignedAudienceCount: assignResult.Audience.Count);
                }

                // Server refused the assignment (unknown role or empty audience) → re-route!
                rerouteAttempt++;
                if (rerouteAttempt > MaxAssignmentRerouteAttempts)
                {
                    var fallbackEsc = new AcceptanceDecision.Escalate(
                        AcceptanceEscalationReason.AcceptorJudgment,
                        $"Role assignment refused after {MaxAssignmentRerouteAttempts} attempts: {assignResult.RefusalReason}");
                    outcome = new OrchestratorTurnOutcome.DecideSelf(fallbackEsc, fallbackEsc.Detail);
                    break;
                }

                Session.AppendUserTurn(
                    $"SERVER ASSIGNMENT REFUSED ({assignResult.Outcome}): {assignResult.RefusalReason}. " +
                    "Re-route to a valid role with a non-empty eligible audience, or output a decide-self Escalate decision.");
                var retryTurn = await RunTurnAndTrackSpendAsync(
                    config, Session.Messages, registry, tools, correlationId, ct).ConfigureAwait(false);
                outcome = retryTurn.Success
                    ? OrchestratorOutcomeParser.ParseAcceptanceOutcome(retryTurn.ResponseText)
                    : new OrchestratorTurnOutcome.DecideSelf(
                        new AcceptanceDecision.Escalate(
                            AcceptanceEscalationReason.AcceptorJudgment,
                            $"Re-route turn failed: {retryTurn.ErrorMessage}"),
                        retryTurn.ErrorMessage ?? "Re-route turn failed.");
            }

            // 6. Self-decision path: ALWAYS clamp via AcceptanceGuardrails BEFORE resume (AC3 / AC7).
            var decideSelf = outcome as OrchestratorTurnOutcome.DecideSelf
                ?? new OrchestratorTurnOutcome.DecideSelf(
                    new AcceptanceDecision.Escalate(
                        AcceptanceEscalationReason.AcceptorJudgment,
                        "Unexpected non-acceptance turn outcome; failing closed to escalate."),
                    "Unexpected turn outcome.");

            var clampedDecision = AcceptanceGuardrails.Clamp(decideSelf.Decision, gateCtx);
            var wasClamped = !ReferenceEquals(clampedDecision, decideSelf.Decision);

            var resume = await SubmitDecisionAsync(
                request.DecisionSessionId, clampedDecision, decideSelf.ReasoningSummary, ct).ConfigureAwait(false);

            // Idempotency on restart redelivery: if the gate is already answered (GateNotFound),
            // do NOT emit a duplicate decision event — ack and drop cleanly (AC1 / AC7).
            if (!resume.GateNotFound)
            {
                await EmitDecisionMadeAsync(
                    kind: "acceptance",
                    routing: "decide-self",
                    decisionKind: DecisionKindWire(clampedDecision),
                    reasoningSummary: decideSelf.ReasoningSummary,
                    rulesVersion: request.Rules.Version,
                    decisionSessionId: request.DecisionSessionId,
                    issueId: request.IssueId,
                    correlationId: correlationId,
                    assignedRole: null,
                    preGated: false,
                    clamped: wasClamped).ConfigureAwait(false);
            }

            return new OrchestratorAcceptanceResult(
                Routing: "decide-self",
                Decision: clampedDecision,
                AssignedRole: null,
                AlreadyAnswered: resume.GateNotFound,
                PreGated: false,
                Clamped: wasClamped,
                ReasoningSummary: decideSelf.ReasoningSummary);
        }
        finally
        {
            _turnLock.Release();
        }
    }

    /// <summary>
    /// Story 39-17 (AC4) — consume a 39-8 <see cref="EscalationRaised"/> delivery
    /// and either disposition it (<c>ESCALATION.RESOLVED</c>) or assign it to an
    /// eligible role via <see cref="ITaskAssignmentService"/>.
    /// </summary>
    public async Task<OrchestratorEscalationResult> HandleEscalationAsync(
        EscalationRaised escalation,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(escalation);
        await _turnLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            TouchActivity();
            var config = (await ResolveConfigAsync(ct).ConfigureAwait(false)).Config;
            var correlationId = $"escalation:{escalation.EscalationId}";

            var toolCtx = new OrchestratorToolContext(
                TenantId: _tenantId,
                UserId: _ownerUserId,
                ActingUserId: null,
                DecisionSessionId: null,
                CorrelationId: correlationId,
                IssueId: escalation.IssueId,
                AllowWriteVerbs: true);
            var registry = OrchestratorToolCatalog.Build(toolCtx, _toolDeps);
            var tools = OrchestratorToolCatalog.ToResolvedTools(registry);

            Session.AppendUserTurn(
                $"Escalation raised (id={escalation.EscalationId}, issue={escalation.IssueId}, outcome={escalation.Outcome}).\n" +
                $"Lineage:\n{escalation.LineageJson}\n" +
                "Respond with JSON: {\"routing\":\"disposition\",\"disposition\":\"resolved\"|\"overridden\"|\"abandoned\",\"note\":\"...\",\"reasoningSummary\":\"...\"} " +
                "or {\"routing\":\"assign-to-role\",\"roleWire\":\"<role>\",\"basis\":\"repo-access\",\"reasoningSummary\":\"...\"}.");
            Session.CompactIfNeeded(config.MaxSessionTokens, config.CompactAfterTurns);

            var turn = await RunTurnAndTrackSpendAsync(
                config, Session.Messages, registry, tools, correlationId, ct).ConfigureAwait(false);
            var parsed = OrchestratorOutcomeParser.ParseEscalationOutcome(turn.ResponseText);

            if (parsed is OrchestratorTurnOutcome.DispositionEscalation disp)
            {
                var dispResult = await _escalationDisposition.DispositionAsync(
                    _tenantId,
                    escalation.EscalationId,
                    disp.Disposition,
                    disp.Note,
                    ApprovalChannels.OrchestratorPrincipalType,
                    ApprovalChannel.Orchestrator).ConfigureAwait(false);

                await EmitDecisionMadeAsync(
                    kind: "escalation",
                    routing: "disposition",
                    decisionKind: disp.Disposition.ToWire(),
                    reasoningSummary: disp.ReasoningSummary,
                    rulesVersion: null,
                    decisionSessionId: null,
                    issueId: escalation.IssueId,
                    correlationId: correlationId,
                    assignedRole: null,
                    preGated: false,
                    clamped: false).ConfigureAwait(false);

                return new OrchestratorEscalationResult(
                    Routing: "disposition",
                    DispositionOutcome: dispResult.Outcome,
                    AssignedRole: null,
                    ReasoningSummary: disp.ReasoningSummary);
            }

            var roleAssign = (OrchestratorTurnOutcome.AssignToRole)parsed;
            var taskRef = new TaskRef(_tenantId, _ownerUserId, ExtractRepoKey(escalation.IssueId), escalation.IssueId);
            var assignRes = await _taskAssignment.AssignAsync(
                _tenantId, taskRef, roleAssign.RoleWire, roleAssign.Basis.ToWire(), escalation.RulesReference, ct)
                .ConfigureAwait(false);

            await EmitDecisionMadeAsync(
                kind: "escalation",
                routing: "assign-to-role",
                decisionKind: null,
                reasoningSummary: roleAssign.ReasoningSummary,
                rulesVersion: null,
                decisionSessionId: null,
                issueId: escalation.IssueId,
                correlationId: correlationId,
                assignedRole: assignRes.RoleWire,
                preGated: false,
                clamped: false).ConfigureAwait(false);

            return new OrchestratorEscalationResult(
                Routing: "assign-to-role",
                DispositionOutcome: null,
                AssignedRole: assignRes.RoleWire,
                ReasoningSummary: roleAssign.ReasoningSummary);
        }
        finally
        {
            _turnLock.Release();
        }
    }

    /// <summary>
    /// Story 39-17 (AC4 / AC5 / D12) — answer a workflow <see cref="GuidanceQuery"/>
    /// and emit <see cref="OrchestratorEvents.DecisionMade"/>.
    /// </summary>
    public async Task<GuidanceReply> HandleGuidanceAsync(
        GuidanceQuery query,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        await _turnLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            TouchActivity();
            var config = (await ResolveConfigAsync(ct).ConfigureAwait(false)).Config;

            var toolCtx = new OrchestratorToolContext(
                TenantId: _tenantId,
                UserId: _ownerUserId,
                ActingUserId: null,
                DecisionSessionId: null,
                CorrelationId: query.CorrelationId,
                AllowWriteVerbs: false);
            var registry = OrchestratorToolCatalog.Build(toolCtx, _toolDeps);
            var tools = OrchestratorToolCatalog.ToResolvedTools(registry);

            Session.AppendUserTurn(
                $"Workflow guidance query (queryId={query.QueryId}, correlationId={query.CorrelationId}):\n" +
                $"Question: {query.Question}\nContext: {query.ContextJson ?? "{}"}");
            Session.CompactIfNeeded(config.MaxSessionTokens, config.CompactAfterTurns);

            var turn = await RunTurnAndTrackSpendAsync(
                config, Session.Messages, registry, tools, query.CorrelationId, ct).ConfigureAwait(false);

            var replyText = turn.Success && !string.IsNullOrWhiteSpace(turn.ResponseText)
                ? turn.ResponseText.Trim()
                : $"Unable to produce guidance: {turn.ErrorMessage ?? "empty response"}";

            var reply = new GuidanceReply(query.QueryId, replyText);

            await EmitDecisionMadeAsync(
                kind: "guidance",
                routing: "reply",
                decisionKind: "guidance-reply",
                reasoningSummary: Bounded(replyText, 512),
                rulesVersion: null,
                decisionSessionId: null,
                issueId: null,
                correlationId: query.CorrelationId,
                assignedRole: null,
                preGated: false,
                clamped: false).ConfigureAwait(false);

            if (_onGuidanceReply is not null)
                await _onGuidanceReply(_tenantId, reply, ct).ConfigureAwait(false);

            return reply;
        }
        finally
        {
            _turnLock.Release();
        }
    }

    /// <summary>
    /// Story 39-17 (AC4 / AC5 / D12) — serve a user↔orchestrator chat turn with
    /// strict per-user tool attenuation and isolated per-user conversation state.
    /// User Y's session never sees user X's transcript; every tool invocation
    /// carries user X's <c>ActingUserId</c> tag and permission scope.
    /// </summary>
    public async Task<AgentConversationMessage> HandleConversationAsync(
        Guid userId,
        AgentConversationMessage message,
        bool allowWriteVerbs = false,
        IChatTranscriptRecorder? recorder = null,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
            throw new ArgumentException("userId is required for conversation handling.", nameof(userId));
        ArgumentNullException.ThrowIfNull(message);

        await _turnLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            TouchActivity();
            if (recorder is not null)
                await recorder.RecordReceivedAsync(_tenantId, userId, message, ct).ConfigureAwait(false);

            var config = (await ResolveConfigAsync(ct).ConfigureAwait(false)).Config;
            var correlationId = $"chat:{message.ConversationId:D}";

            // Per-user attenuated tool context: tools enforce user X's 39-20 scope & write flag.
            var toolCtx = new OrchestratorToolContext(
                TenantId: _tenantId,
                UserId: _ownerUserId,
                ActingUserId: userId,
                DecisionSessionId: null,
                CorrelationId: correlationId,
                AllowWriteVerbs: allowWriteVerbs);
            var registry = OrchestratorToolCatalog.Build(toolCtx, _toolDeps);
            var tools = OrchestratorToolCatalog.ToResolvedTools(registry);

            // Isolated per-user conversation transcript (never shared with another user's session).
            var userMessages = _userChatSessions.GetOrAdd(userId, _ => new List<ConversationMessage>
            {
                new() { Role = "system", Content = OrchestratorSession.SystemPrompt },
            });
            userMessages.Add(new ConversationMessage { Role = "user", Content = message.Text });

            var turn = await RunTurnAndTrackSpendAsync(
                config, userMessages, registry, tools, correlationId, ct).ConfigureAwait(false);

            var replyText = turn.Success && !string.IsNullOrWhiteSpace(turn.ResponseText)
                ? turn.ResponseText.Trim()
                : $"Unable to answer right now: {turn.ErrorMessage ?? "empty response"}";

            var reply = new AgentConversationMessage(
                message.ConversationId,
                userId,
                Direction: "agent->user",
                Text: replyText);

            if (recorder is not null)
                await recorder.RecordSentAsync(_tenantId, userId, reply, ct).ConfigureAwait(false);

            await EmitDecisionMadeAsync(
                kind: "chat",
                routing: "reply",
                decisionKind: "chat-reply",
                reasoningSummary: Bounded(replyText, 512),
                rulesVersion: null,
                decisionSessionId: null,
                issueId: null,
                correlationId: correlationId,
                assignedRole: null,
                preGated: false,
                clamped: false,
                actingUserId: userId).ConfigureAwait(false);

            return reply;
        }
        finally
        {
            _turnLock.Release();
        }
    }

    /// <summary>Inspect one user's isolated chat transcript (for tests / diagnostics).</summary>
    internal IReadOnlyList<ConversationMessage> GetUserChatTranscriptSnapshot(Guid userId) =>
        _userChatSessions.TryGetValue(userId, out var list) ? list.ToList() : Array.Empty<ConversationMessage>();

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task<ResolvedOrchestratorConfig> ResolveConfigAsync(CancellationToken ct)
    {
        if (_ownerUserId is { } uid && uid != Guid.Empty)
            return await _configService.ResolveForUserAsync(uid, _tenantId, ct).ConfigureAwait(false);
        return await _configService.ResolveForTenantAsync(_tenantId, ct).ConfigureAwait(false);
    }

    private async Task<OrchestratorTurnResult> RunTurnAndTrackSpendAsync(
        OrchestratorAgentConfig config,
        List<ConversationMessage> messages,
        AuditedToolRegistry registry,
        IReadOnlyList<ResolvedTool> tools,
        string correlationId,
        CancellationToken ct)
    {
        var result = await _turnRunner.RunTurnAsync(new OrchestratorTurnRequest(
            TenantId: _tenantId,
            UserId: _ownerUserId,
            Config: config,
            Messages: messages,
            Registry: registry,
            Tools: tools,
            CorrelationId: correlationId), ct).ConfigureAwait(false);

        if (result.CostUsd > 0m)
        {
            RollSpendDayIfNeeded();
            _dailySpendUsd += result.CostUsd;
        }

        return result;
    }

    private bool IsDailySpendExhausted(OrchestratorAgentConfig config)
    {
        RollSpendDayIfNeeded();
        return _dailySpendUsd >= config.MaxUsdPerDay;
    }

    private void RollSpendDayIfNeeded()
    {
        var today = DateOnly.FromDateTime(_timeProvider.GetUtcNow().UtcDateTime);
        if (today != _spendDayUtc)
        {
            _spendDayUtc = today;
            _dailySpendUsd = 0m;
        }
    }

    private void TouchActivity() => _lastActivityUtc = _timeProvider.GetUtcNow();

    private Task<DecisionSubmitResult> SubmitDecisionAsync(
        Guid sessionId,
        AcceptanceDecision decision,
        string? feedback,
        CancellationToken ct)
    {
        var decisionJson = DocumentDecisionSubmissionService.SerializeDecision(decision);
        var kind = DecisionKindWire(decision);
        return _decisionSubmission.ResumeAsync(
            sessionId,
            decisionJson,
            feedback,
            _tenantId,
            ApprovalChannels.OrchestratorPrincipalType,
            ApprovalChannel.Orchestrator,
            kind);
    }

    private async Task EmitDecisionMadeAsync(
        string kind,
        string routing,
        string? decisionKind,
        string reasoningSummary,
        int? rulesVersion,
        Guid? decisionSessionId,
        string? issueId,
        string correlationId,
        string? assignedRole,
        bool preGated,
        bool clamped,
        Guid? actingUserId = null)
    {
        var tags = new Dictionary<string, object?>
        {
            ["tenantId"] = _tenantId.ToString("D"),
            ["correlationId"] = correlationId,
            ["kind"] = kind,
        };
        if (decisionSessionId is { } dsid && dsid != Guid.Empty) tags["decisionSessionId"] = dsid.ToString("D");
        if (!string.IsNullOrWhiteSpace(issueId)) tags["issueId"] = issueId;
        if (actingUserId is { } uid && uid != Guid.Empty) tags["userId"] = uid.ToString("D");

        var data = new Dictionary<string, object?>
        {
            ["kind"] = kind,
            ["routing"] = routing,
            ["decisionKind"] = decisionKind,
            ["assignedRole"] = assignedRole,
            ["reasoningSummary"] = Bounded(reasoningSummary, 1024),
            ["rulesVersion"] = rulesVersion,
            ["preGated"] = preGated,
            ["clamped"] = clamped,
            ["channel"] = ApprovalChannel.Orchestrator.ToWire(),
        };

        await _events.AppendAsync(new DomainEvent
        {
            Type = OrchestratorEvents.DecisionMade,
            TenantId = _tenantId,
            Tags = JsonSerializer.Serialize(tags),
            Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-agent"}""",
            Data = JsonSerializer.Serialize(data),
        }).ConfigureAwait(false);
    }

    private async Task EmitSessionEventBestEffortAsync(string eventType, Dictionary<string, object?> data)
    {
        try
        {
            await _events.AppendAsync(new DomainEvent
            {
                Type = eventType,
                TenantId = _tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["tenantId"] = _tenantId.ToString("D"),
                }),
                Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-agent"}""",
                Data = JsonSerializer.Serialize(data),
            }).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Best-effort {EventType} emission failed for tenant {TenantId}", eventType, _tenantId);
        }
    }

    internal static ReviewFacts ExtractReviewFacts(DocumentEnvelope reviewEnvelope)
    {
        var decision = ReviewDecision.RequestChanges;
        var hasBlocking = false;

        try
        {
            var body = reviewEnvelope.Payload;
            if (body.ValueKind == JsonValueKind.Object)
            {
                if (body.TryGetProperty("decision", out var decEl) && decEl.ValueKind == JsonValueKind.String)
                {
                    var wire = decEl.GetString()?.Trim().ToLowerInvariant();
                    decision = wire switch
                    {
                        "approve" => ReviewDecision.Approve,
                        "needs-discussion" or "needs_discussion" => ReviewDecision.NeedsDiscussion,
                        _ => ReviewDecision.RequestChanges,
                    };
                }

                if (body.TryGetProperty("hasBlockingIssues", out var hbEl)
                    && hbEl.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    hasBlocking = hbEl.GetBoolean();
                }

                if (!hasBlocking && body.TryGetProperty("issues", out var issuesEl) && issuesEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in issuesEl.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.Object
                            && item.TryGetProperty("severity", out var sevEl)
                            && sevEl.ValueKind == JsonValueKind.String)
                        {
                            var sev = sevEl.GetString()?.Trim().ToLowerInvariant();
                            if (sev is "critical" or "blocking")
                            {
                                hasBlocking = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
        catch
        {
            // Fail closed: treat unreadable review as non-approved with blocking issues.
            return new ReviewFacts(ReviewDecision.RequestChanges, HasBlockingIssues: true);
        }

        return new ReviewFacts(decision, hasBlocking);
    }

    private static string ComposeAcceptancePrompt(AcceptanceRequest req, ReviewFacts reviewFacts)
    {
        var rulesJson = JsonSerializer.Serialize(req.Rules, AcceptanceRulesJson.Options);
        return
            $"AcceptanceRequest (decisionSessionId={req.DecisionSessionId}, issueId={req.IssueId}, " +
            $"documentId={req.Document.Id}, documentType={req.Document.Type}, roundsUsed={req.RoundsUsed}):\n" +
            $"Review summary: decision={reviewFacts.Decision.ToWire()}, hasBlockingIssues={reviewFacts.HasBlockingIssues}\n" +
            $"Effective acceptance rules (autonomyLevel={req.Rules.Rules.AutonomyLevel}, version={req.Rules.Version}):\n{rulesJson}\n" +
            "Inspect any additional context via your tools (including get_acceptance_rules / document_get / document_lineage), " +
            "then respond with your JSON routing outcome (decide-self or assign-to-role).";
    }

    private static string DecisionKindWire(AcceptanceDecision decision) => decision switch
    {
        AcceptanceDecision.Accept => "accept",
        AcceptanceDecision.RequestRevision => "request-revision",
        AcceptanceDecision.Reject => "reject",
        AcceptanceDecision.Escalate => "escalate",
        _ => "escalate",
    };

    private static string? ExtractRepoKey(string? issueId)
    {
        if (string.IsNullOrWhiteSpace(issueId)) return null;
        var hashIdx = issueId.IndexOf('#');
        if (hashIdx > 0 && issueId[..hashIdx].Contains('/'))
            return issueId[..hashIdx];
        return null;
    }

    private static string Bounded(string? text, int max) =>
        string.IsNullOrEmpty(text) ? string.Empty : (text.Length <= max ? text : text[..max]);
}

public sealed record OrchestratorAcceptanceResult(
    string Routing,
    AcceptanceDecision? Decision,
    string? AssignedRole,
    bool AlreadyAnswered,
    bool PreGated,
    bool Clamped,
    string ReasoningSummary,
    int AssignedAudienceCount = 0);

public sealed record OrchestratorEscalationResult(
    string Routing,
    EscalationDispositionOutcome? DispositionOutcome,
    string? AssignedRole,
    string ReasoningSummary);
