using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC2 / AC7 / D5 / D6) — drift pins for the closed Orchestrator
/// Agent tool catalog: exact 10 tool names, write-capable subset, absence of
/// global coding-agent tools, attenuated write-verb refusal, and fail-closed
/// interim stubs for <c>kb_search</c>/<c>rag_query</c> until Story 39-21.
/// </summary>
[TestFixture]
public class OrchestratorToolCatalogDriftTests
{
    private static OrchestratorToolDependencies MakeDeps()
    {
        var events = new Mock<IEventRepository>();
        var elsa = new Mock<IElsaWorkflowService>();
        var docs = new Mock<IDocumentInstanceRepository>();
        var platforms = new Mock<IPlatformResolver>();
        var rulesService = new Mock<Tamma.Core.Documents.Policy.IAcceptanceRulesResolver>();
        var factory = new GetAcceptanceRulesToolFactory(rulesService.Object);
        return new OrchestratorToolDependencies(events.Object, elsa.Object, docs.Object, platforms.Object, factory);
    }

    [Test]
    public void Built_registry_exposes_exact_10_pinned_tools_and_zero_coding_agent_tools()
    {
        var ctx = new OrchestratorToolContext(
            TenantId: Guid.NewGuid(),
            UserId: null,
            ActingUserId: null,
            DecisionSessionId: null,
            CorrelationId: "corr-drift",
            AllowWriteVerbs: false);

        var registry = OrchestratorToolCatalog.Build(ctx, MakeDeps());
        var names = registry.GetAll().Select(t => t.ToolName).ToArray();

        names.Should().BeEquivalentTo(new[]
        {
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
        });

        names.Should().BeEquivalentTo(OrchestratorToolCatalog.PinnedToolNames);

        // Must never expose coding-agent filesystem/shell/git-write tools.
        names.Should().NotContain(new[]
        {
            "file_read", "file_write", "search_code", "shell_execute", "run_tests", "git_operations",
        });
    }

    [Test]
    public void WriteCapableToolNames_is_pinned_to_workflow_control_only()
    {
        OrchestratorToolCatalog.WriteCapableToolNames.Should().BeEquivalentTo(new[] { "workflow_control" });
    }

    [Test]
    public async Task WorkflowControl_refuses_write_verbs_when_AllowWriteVerbs_is_false()
    {
        var elsa = new Mock<IElsaWorkflowService>(MockBehavior.Strict);
        var ctx = new OrchestratorToolContext(
            TenantId: Guid.NewGuid(),
            UserId: null,
            ActingUserId: Guid.NewGuid(),
            DecisionSessionId: null,
            CorrelationId: "corr-attenuated",
            AllowWriteVerbs: false);

        var tool = new WorkflowControlTool(ctx, elsa.Object);

        foreach (var verb in new[] { "dispatch", "resume", "cancel" })
        {
            var res = await tool.ExecuteAsync("c1", $$"""{"verb":"{{verb}}","workflowInstanceId":"wf-1","workflowDefinitionId":"def-1","bookmarkId":"bm-1"}""");
            res.Success.Should().BeFalse($"write verb '{verb}' must be refused when AllowWriteVerbs=false");
            res.Output.Should().Contain("denied");
        }

        elsa.VerifyNoOtherCalls();
    }

    [Test]
    public async Task KbSearch_and_RagQuery_fail_closed_with_explicit_unconfigured_reason()
    {
        var kb = new KbSearchTool();
        var rag = new RagQueryTool();

        var kbRes = await kb.ExecuteAsync("c1", """{"query":"adr"}""");
        var ragRes = await rag.ExecuteAsync("c2", """{"query":"architecture"}""");

        kbRes.Success.Should().BeFalse();
        kbRes.Output.Should().Contain("39-21");

        ragRes.Success.Should().BeFalse();
        ragRes.Output.Should().Contain("39-21");
    }

    [Test]
    public void Every_orchestrator_tool_implements_IPrincipalScopedToolExecutor()
    {
        var ctx = new OrchestratorToolContext(Guid.NewGuid(), null, null, null, "corr-1");
        var registry = OrchestratorToolCatalog.Build(ctx, MakeDeps());

        foreach (var tool in registry.GetAll())
        {
            tool.Should().BeAssignableTo<IPrincipalScopedToolExecutor>(
                $"tool '{tool.ToolName}' is principal-bound and must never be registered in the global singleton DI registry");
        }
    }
}
