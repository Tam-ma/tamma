using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.Diagnostics;
using Tamma.Api.Services.Documents;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Dependencies required to construct a principal-bound per-session orchestrator
/// toolset via <see cref="OrchestratorToolCatalog.Build"/>.
/// </summary>
public sealed record OrchestratorToolDependencies(
    IEventRepository Events,
    IElsaWorkflowService Elsa,
    IDocumentInstanceRepository Documents,
    IPlatformResolver Platforms,
    GetAcceptanceRulesToolFactory AcceptanceRulesToolFactory,
    IDiagnosticsService? Diagnostics = null,
    ITaskAudienceResolver? AudienceResolver = null,
    IRepoAccessEvaluator? RepoAccessEvaluator = null,
    ILogger? AuditLogger = null,
    IChatWorkflowInitiationService? ChatWorkflowInitiation = null,
    ITaskAssignmentService? TaskAssignment = null);

/// <summary>
/// Story 39-17 (AC2 / AC4 / D5 / D6) — the CLOSED, drift-tested orchestrator
/// tool catalog. Never shares the global DI coding-agent registry (no
/// <c>file_write</c>, <c>shell_execute</c>, <c>run_tests</c>, or
/// <c>git_operations</c>). Every built registry is wrapped in
/// <see cref="AuditedToolRegistry"/> so every invocation emits
/// <see cref="OrchestratorEvents.ToolInvoked"/>.
/// </summary>
public static class OrchestratorToolCatalog
{
    /// <summary>Exact closed tool-name set (10 tools — drift-pinned by <c>OrchestratorToolCatalogDriftTests</c>).</summary>
    public static readonly IReadOnlyList<string> PinnedToolNames =
    [
        "git_read",
        "event_store_query",
        "log_search",
        "workflow_control",
        "document_get",
        "document_lineage",
        "kb_search",
        "rag_query",
        "get_acceptance_rules",
        "issue_read",
    ];

    /// <summary>Write-capable tool names (only <c>workflow_control</c>, with verbs dispatch/resume/cancel individually gated).</summary>
    public static readonly IReadOnlySet<string> WriteCapableToolNames =
        new HashSet<string>(StringComparer.Ordinal) { "workflow_control" };

    /// <summary>
    /// Construct a principal-bound, audited <see cref="AuditedToolRegistry"/>
    /// for <paramref name="context"/>.
    /// </summary>
    public static AuditedToolRegistry Build(
        OrchestratorToolContext context,
        OrchestratorToolDependencies deps)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(deps);

        // get_acceptance_rules requires exactly one principal (tenantId in SaaS or userId in single-user).
        var rulesTool = context.TenantId is { } tid && tid != Guid.Empty
            ? deps.AcceptanceRulesToolFactory.Create(userId: null, tenantId: tid)
            : deps.AcceptanceRulesToolFactory.Create(userId: context.UserId ?? Guid.Empty, tenantId: null);

        var tools = new IToolExecutor[]
        {
            new GitReadTool(context, deps.Platforms, deps.RepoAccessEvaluator),
            new EventStoreQueryTool(context, deps.Events),
            new LogSearchTool(context, deps.Events, deps.Diagnostics),
            new WorkflowControlTool(
                context,
                deps.Elsa,
                deps.ChatWorkflowInitiation,
                new DocumentDecisionSubmissionService(deps.Elsa),
                deps.AudienceResolver,
                deps.TaskAssignment),
            new DocumentGetTool(context, deps.Documents, deps.AudienceResolver),
            new DocumentLineageTool(context, deps.Documents, deps.AudienceResolver),
            new KbSearchTool(),
            new RagQueryTool(),
            rulesTool,
            new IssueReadTool(context, deps.Platforms, deps.RepoAccessEvaluator),
        };

        return new AuditedToolRegistry(tools, context, deps.Events, deps.AuditLogger);
    }

    /// <summary>Project an <see cref="IToolExecutorRegistry"/> into the LLM tool-definition list.</summary>
    public static IReadOnlyList<ResolvedTool> ToResolvedTools(IToolExecutorRegistry registry) =>
        registry.GetAll()
            .Select(t => new ResolvedTool
            {
                Name = t.ToolName,
                Description = t.Description,
                InputSchema = t.InputSchema,
            })
            .ToList();
}
