using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Agents;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (D4 / AC7) — input to one Orchestrator Agent LLM turn.
/// </summary>
public sealed record OrchestratorTurnRequest(
    Guid? TenantId,
    Guid? UserId,
    OrchestratorAgentConfig Config,
    List<ConversationMessage> Messages,
    IToolExecutorRegistry Registry,
    IReadOnlyList<ResolvedTool> Tools,
    string CorrelationId,
    AgentTrailContext? TrailContext = null);

/// <summary>
/// Story 39-17 (D4 / AC7) — structured outcome of one Orchestrator Agent turn.
/// </summary>
public sealed record OrchestratorTurnResult(
    bool Success,
    string ResponseText,
    int InputTokens,
    int OutputTokens,
    decimal CostUsd,
    string? ErrorCode = null,
    string? ErrorMessage = null);

/// <summary>
/// Story 39-17 (D4 / AC7) — abstraction over executing one conversation turn
/// against an LLM provider + audited tool registry. Production wires
/// <see cref="ToolLoopTurnRunner"/>; tests substitute <c>ScriptedTurnRunner</c>
/// (which still invokes the real <see cref="IToolExecutorRegistry"/> handed to it).
/// </summary>
public interface IOrchestratorTurnRunner
{
    Task<OrchestratorTurnResult> RunTurnAsync(OrchestratorTurnRequest request, CancellationToken ct = default);
}
