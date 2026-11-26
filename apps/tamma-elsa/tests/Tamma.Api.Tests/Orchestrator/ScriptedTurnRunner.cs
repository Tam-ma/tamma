using Tamma.Activities.LlmCall.Models;
using Tamma.Api.Services.Orchestrator;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (D4 / AC7) — deterministic <see cref="IOrchestratorTurnRunner"/>
/// test double. Every scripted turn executes its scripted tool calls against the
/// REAL <see cref="OrchestratorTurnRequest.Registry"/> (<c>AuditedToolRegistry</c>)
/// so tool scope, repo attenuation, and <c>ORCHESTRATOR.TOOL.INVOKED</c> DCB
/// emission are exercised end-to-end without calling a live LLM API.
/// </summary>
public sealed class ScriptedTurnRunner : IOrchestratorTurnRunner
{
    public sealed record ScriptedToolCall(string ToolName, string ArgumentsJson, string? ToolCallId = null);

    public sealed record ScriptedTurn(
        string FinalResponse,
        IReadOnlyList<ScriptedToolCall>? ToolCalls = null,
        decimal CostUsd = 0.01m,
        int InputTokens = 100,
        int OutputTokens = 50,
        bool Success = true,
        string? ErrorCode = null,
        string? ErrorMessage = null);

    private readonly Queue<Func<OrchestratorTurnRequest, ScriptedTurn>> _script = new();

    public List<OrchestratorTurnRequest> RecordedRequests { get; } = new();
    public List<ToolExecutionResult> ExecutedToolResults { get; } = new();
    public int CallCount => RecordedRequests.Count;

    public ScriptedTurnRunner Enqueue(ScriptedTurn turn)
    {
        _script.Enqueue(_ => turn);
        return this;
    }

    public ScriptedTurnRunner Enqueue(Func<OrchestratorTurnRequest, ScriptedTurn> factory)
    {
        _script.Enqueue(factory);
        return this;
    }

    public async Task<OrchestratorTurnResult> RunTurnAsync(
        OrchestratorTurnRequest request,
        CancellationToken ct = default)
    {
        RecordedRequests.Add(request);

        if (_script.Count == 0)
            throw new InvalidOperationException("ScriptedTurnRunner received an unexpected turn with no scripted response queued.");

        var turn = _script.Dequeue()(request);

        if (turn.ToolCalls is { Count: > 0 })
        {
            var idx = 0;
            foreach (var call in turn.ToolCalls)
            {
                var callId = call.ToolCallId ?? $"script-call-{CallCount}-{++idx}";
                var res = await request.Registry.ExecuteAsync(callId, call.ToolName, call.ArgumentsJson, ct)
                    .ConfigureAwait(false);
                ExecutedToolResults.Add(res);
            }
        }

        if (turn.Success)
        {
            request.Messages.Add(new ConversationMessage
            {
                Role = "assistant",
                Content = turn.FinalResponse,
            });
        }

        return new OrchestratorTurnResult(
            turn.Success,
            turn.FinalResponse,
            turn.InputTokens,
            turn.OutputTokens,
            turn.CostUsd,
            turn.ErrorCode,
            turn.ErrorMessage);
    }
}
