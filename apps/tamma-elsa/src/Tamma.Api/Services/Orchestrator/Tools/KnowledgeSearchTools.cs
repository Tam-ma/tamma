using System.Diagnostics;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC1 / AC2 / D6) — <c>kb_search</c> orchestrator tool.
///
/// <para><b>FAIL-CLOSED UNTIL STORY 39-21:</b> the interim <c>/api/kb/*</c>
/// intelligence-server sidecar is tenant-BLIND, so exposing it to a per-tenant
/// orchestrator would violate AC1's hard tenant tool-scoping requirement. This
/// tool returns a deterministic typed refusal until Story 39-21's tenant-scoped
/// C# RAG seam lands.</para>
/// </summary>
public sealed class KbSearchTool : IPrincipalScopedToolExecutor
{
    public const string UnavailableReason =
        "Knowledge tool 'kb_search' is unavailable (fail-closed) until Story 39-21's tenant-isolated C# RAG pipeline lands; " +
        "the interim /api/kb sidecar is tenant-blind and cannot satisfy per-tenant isolation.";

    public string ToolName => "kb_search";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Search the tenant's knowledge base. Currently gated off (fail-closed) until Story 39-21's tenant-isolated RAG pipeline lands.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["query"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Search query." },
        },
        ["required"] = new[] { "query" },
    };

    public Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(new ToolExecutionResult(toolCallId, ToolName, false, UnavailableReason, 0));
}

/// <summary>
/// Story 39-17 (AC1 / AC2 / D6) — <c>rag_query</c> orchestrator tool.
/// Fail-closed until Story 39-21's tenant-isolated C# RAG pipeline lands.
/// </summary>
public sealed class RagQueryTool : IPrincipalScopedToolExecutor
{
    public const string UnavailableReason =
        "Knowledge tool 'rag_query' is unavailable (fail-closed) until Story 39-21's tenant-isolated C# RAG pipeline lands; " +
        "the interim /api/kb sidecar is tenant-blind and cannot satisfy per-tenant isolation.";

    public string ToolName => "rag_query";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Run a RAG query over the tenant's indexed repositories and docs. Currently gated off (fail-closed) until Story 39-21's tenant-isolated RAG pipeline lands.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["query"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "RAG query." },
        },
        ["required"] = new[] { "query" },
    };

    public Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(new ToolExecutionResult(toolCallId, ToolName, false, UnavailableReason, 0));
}
