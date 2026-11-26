using Tamma.Activities.LlmCall.Tools;

namespace Tamma.Api.Services.Agents;

/// <summary>
/// Canonical DCB event types for durable tool-use auditing (Story 42-5).
/// Follows the <c>AGGREGATE.ACTION.STATUS</c> convention with the <c>TOOL</c> aggregate.
///
/// <para><b>Three-sink invariant (Story 42-5 D6):</b></para>
/// <list type="bullet">
///   <item><description><see cref="Tamma.Activities.ToolExecution.IToolLoopEventSink"/> (<c>TOOL_LOOP.*</c>):
///     ephemeral live SSE/dashboard progress only (note: <c>TOOL_LOOP.COMPLETED</c> is never emitted
///     by <see cref="InlineToolLoopRunner"/> today; pinned as a baseline, not modified here).</description></item>
///   <item><description><c>TOOL.INVOKED</c> / <c>TOOL.SUCCEEDED</c> / <c>TOOL.FAILED</c>:
///     the durable, sink-independent DCB invocation audit trail of record (this seam).</description></item>
///   <item><description><c>ACTION.GATE.*</c> (Epic 43):
///     the durable governance decision trail (never duplicated here).</description></item>
///   <item><description><c>AGENT.TOOL_CALL.*</c> (Story 32-6):
///     structurally dead because <see cref="InlineToolLoopResult.ToolCalls"/> is always empty;
///     deliberately NOT revived here to avoid a second durable tool-call family.</description></item>
/// </list>
/// </summary>
public static class ToolAuditEventTypes
{
    /// <summary>Emitted immediately before a tool call executes (or before recording a pre-execution rejection).</summary>
    public const string Invoked = "TOOL.INVOKED";

    /// <summary>Emitted after a tool call finishes with <c>ToolExecutionResult.Success == true</c>.</summary>
    public const string Succeeded = "TOOL.SUCCEEDED";

    /// <summary>Emitted after a tool call fails, times out, throws, or is rejected before execution.</summary>
    public const string Failed = "TOOL.FAILED";
}

/// <summary>
/// Story 42-5 (D1/D5/D8) — durable DCB audit emitter for tool invocations inside
/// <see cref="InlineToolLoopRunner"/>.
///
/// <para><b>Never-hold guarantee (D5 / AC4):</b> no method on this interface accepts a
/// credential or plaintext secret parameter. Argument payloads are field-suppressed (when
/// <see cref="ToolDescriptor.RequiredSecret"/> is present), pattern-redacted, and truncated
/// before persistence.</para>
///
/// <para><b>Failure policy (D8 / AC8):</b> swallow-and-warn — an event-store append failure
/// logs a warning and NEVER fails the tool invocation or agent run.</para>
/// </summary>
public interface IToolAuditEmitter
{
    /// <summary>
    /// Record a <see cref="ToolAuditEventTypes.Invoked"/> DCB event before tool execution
    /// (or paired with <see cref="EmitFailedAsync"/> for pre-execution rejections).
    /// </summary>
    Task EmitInvokedAsync(
        AgentTrailContext trailContext,
        string toolName,
        string toolCallId,
        string? argumentsJson,
        ToolDescriptor? descriptor,
        CancellationToken ct = default);

    /// <summary>
    /// Record a terminal <see cref="ToolAuditEventTypes.Succeeded"/> DCB event after
    /// successful tool execution.
    /// </summary>
    Task EmitSucceededAsync(
        AgentTrailContext trailContext,
        string toolName,
        string toolCallId,
        long durationMs,
        int outputSizeBytes,
        CancellationToken ct = default);

    /// <summary>
    /// Record a terminal <see cref="ToolAuditEventTypes.Failed"/> DCB event after a failed,
    /// timed-out, throwing, or rejected tool invocation.
    /// </summary>
    Task EmitFailedAsync(
        AgentTrailContext trailContext,
        string toolName,
        string toolCallId,
        long durationMs,
        string? failureReason,
        CancellationToken ct = default);
}
