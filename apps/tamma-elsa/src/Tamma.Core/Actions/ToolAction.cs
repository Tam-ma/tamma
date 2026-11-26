using System.Text.Json.Serialization;
using Tamma.Api.Services.Agents;
using Tamma.Core.Documents;

namespace Tamma.Core.Actions;

/// <summary>
/// The <c>tool:*</c> plane of the Action Catalog (Story 43-2 AC4): the LLM
/// tool-loop executors. Derived from the tree, not the design doc — the seven
/// <c>IToolExecutor</c> implementations (six DI-registered in
/// <c>Tamma.Api/Program.cs</c> plus the deliberately-unregistered
/// <c>GetAcceptanceRulesTool</c>, whose factory mints principal-bound instances
/// per tenant-agent session; see Story 39-5 D6 and the epic-43 README's 43-0
/// correction), with <c>git_operations</c> SPLIT by subcommand class
/// (<see cref="GitSubcommand"/>) so <c>git push</c> is independently gateable.
/// The split is the only argument-bound split in the epic.
///
/// <para>Bound to the real executors by the reflection sweep in
/// <c>Tamma.Activities.Tests/Actions/ToolExecutorCatalogSweepTests</c>.</para>
/// </summary>
[JsonConverter(typeof(WireEnumJsonConverter<ToolAction>))]
public enum ToolAction
{
    /// <summary><c>Tamma.Activities.LlmCall.Tools.FileReadTool</c> (<c>ToolName = "file_read"</c>).</summary>
    [Wire("file_read")] FileRead,

    /// <summary><c>Tamma.Activities.LlmCall.Tools.FileWriteTool</c> (<c>ToolName = "file_write"</c>).</summary>
    [Wire("file_write")] FileWrite,

    /// <summary><c>Tamma.Activities.LlmCall.Tools.SearchCodeTool</c> (<c>ToolName = "search_code"</c>).</summary>
    [Wire("search_code")] SearchCode,

    /// <summary><c>Tamma.Activities.LlmCall.Tools.ShellExecuteTool</c> (<c>ToolName = "shell_execute"</c>).</summary>
    [Wire("shell_execute")] ShellExecute,

    /// <summary><c>Tamma.Activities.LlmCall.Tools.RunTestsTool</c> (<c>ToolName = "run_tests"</c>).</summary>
    [Wire("run_tests")] RunTests,

    /// <summary><c>Tamma.Api.Services.AcceptanceRules.GetAcceptanceRulesTool</c>
    /// (<c>ToolName = "get_acceptance_rules"</c>; deliberately NOT DI-registered — see class doc).</summary>
    [Wire("get_acceptance_rules")] GetAcceptanceRules,

    /// <summary><c>Tamma.Activities.LlmCall.Tools.GitOperationsTool</c> restricted to the
    /// read-graded <see cref="GitSubcommand"/> members.</summary>
    [Wire("git_operations.read")] GitOperationsRead,

    /// <summary><c>Tamma.Activities.LlmCall.Tools.GitOperationsTool</c> restricted to the
    /// write-graded <see cref="GitSubcommand"/> members (including <c>push</c>).</summary>
    [Wire("git_operations.write")] GitOperationsWrite,

    // ── Story 39-17 — principal-scoped Orchestrator Agent closed toolset ──
    // All 9 are IPrincipalScopedToolExecutor implementations (never registered
    // in the global singleton coding-agent registry; mounted per tenant session
    // inside AuditedToolRegistry alongside get_acceptance_rules).

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.GitReadTool</c> (<c>ToolName = "git_read"</c>).</summary>
    [Wire("git_read")] GitRead,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.EventStoreQueryTool</c> (<c>ToolName = "event_store_query"</c>).</summary>
    [Wire("event_store_query")] EventStoreQuery,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.LogSearchTool</c> (<c>ToolName = "log_search"</c>).</summary>
    [Wire("log_search")] LogSearch,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.WorkflowControlTool</c> (<c>ToolName = "workflow_control"</c>).</summary>
    [Wire("workflow_control")] WorkflowControl,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.DocumentGetTool</c> (<c>ToolName = "document_get"</c>).</summary>
    [Wire("document_get")] DocumentGet,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.DocumentLineageTool</c> (<c>ToolName = "document_lineage"</c>).</summary>
    [Wire("document_lineage")] DocumentLineage,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.KbSearchTool</c> (<c>ToolName = "kb_search"</c>; fail-closed until 39-21).</summary>
    [Wire("kb_search")] KbSearch,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.RagQueryTool</c> (<c>ToolName = "rag_query"</c>; fail-closed until 39-21).</summary>
    [Wire("rag_query")] RagQuery,

    /// <summary><c>Tamma.Api.Services.Orchestrator.Tools.IssueReadTool</c> (<c>ToolName = "issue_read"</c>).</summary>
    [Wire("issue_read")] IssueRead,
}

/// <summary><see cref="ToolAction"/> wire helper.</summary>
public static class ToolActionExtensions
{
    /// <summary>The canonical wire string for <paramref name="tool"/>.</summary>
    public static string ToWire(this ToolAction tool) => EnumWire<ToolAction>.ToWire(tool);
}
