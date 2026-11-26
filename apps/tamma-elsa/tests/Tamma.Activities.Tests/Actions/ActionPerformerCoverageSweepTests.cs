using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.LlmCall;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Activities.Tests.Workflows;
using Tamma.Api.Endpoints;
using Tamma.Api.Endpoints.Admin;
using Tamma.Api.Infrastructure;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.Agents;
using Tamma.Core.Actions;
using Tamma.Core.Documents;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Actions;

/// <summary>
/// Story 43-17 — <b>Action-to-Workflow Coverage Map</b>: every dial-governed
/// catalog row must either derive ≥ 1 live performer from the tree or carry an
/// explicit, owned-or-surfaced entry in <see cref="ReservedActions"/>; every
/// derived performer must resolve to a catalogued action; stale reservations
/// fail the build; and <c>Performed ∪ Reserved ∪ Machinery</c> partitions
/// <see cref="ActionCatalog.All"/> with zero overlap and zero gap.
///
/// <para><b>PENDING / FUTURE EDITORS (AC7):</b>
/// Stories <b>43-12</b> (per-target merge/deploy + checks.bypass + webhook.register),
/// <b>42-10</b> (secret.read), and <b>31-13</b> (PR verbs + issue callbacks) have
/// landed their keys into the catalog (now 177 dial rows); future stories that
/// mint new keys or land performers for reserved rows (<b>40-8</b>, <b>41-4..41-28</b>,
/// <b>41-31</b>, and any story activating <c>deploy.dev</c>/<c>deploy.staging</c>/
/// <c>git.checks.bypass</c>) MUST edit <see cref="ReservedActions"/> in the SAME
/// PR — AC4 (stale reservations) and AC5 (catalog partition) enforce this at
/// build time.</para>
///
/// <para><b>FOUR PERFORMER PLANES DERIVED LIVE (AC1):</b>
/// <list type="number">
///   <item><b>Route plane</b> — <c>[Governs]</c> attributes reflected off
///     <c>Tamma.Api</c>, <c>.Governs(...)</c> route bindings in
///     <c>Tamma.Api/Program.cs</c>, plus reflected human-operated route handlers
///     (<see cref="ScheduledTriggerEndpoints"/>, <see cref="TrackerEndpoints"/>,
///     <see cref="KbEndpoints"/>).</item>
///   <item><b>Method plane</b> — <c>[PerformsEffect]</c> attributes reflected off
///     <see cref="TammaApiClient"/>.</item>
///   <item><b>Tool plane</b> — concrete <see cref="IToolExecutor"/> types
///     reflected across the three production assemblies (<c>Tamma.Activities</c>,
///     <c>Tamma.Api</c>, <c>Tamma.ElsaServer</c>).</item>
///   <item><b>Dispatch plane</b> — compiled Elsa workflow dispatches from
///     <see cref="TaxonomyDriftBuildTests.EnumerateAllDispatchPairs"/> (shared
///     source, no re-grep), direct <c>MediatedLlmText.CompleteAsync</c> activity
///     call sites in <c>src/Tamma.Activities/</c> (settling AC6 for
///     <c>agent-action:implement-feature</c>), document-type producers derived
///     from <see cref="ContractBindingTests.DocumentTypeValidatedCells"/> +
///     <see cref="DocumentLifecycleWorkflow"/>, and in-process effects verified
///     against <see cref="ShellExecuteTool"/> and
///     <see cref="DeploymentPipelineWorkflow"/>.</item>
/// </list></para>
/// </summary>
[TestFixture]
public class ActionPerformerCoverageSweepTests
{
    private const string PlaneRoute = "route";
    private const string PlaneMethod = "method";
    private const string PlaneTool = "tool";
    private const string PlaneDispatch = "dispatch";

    /// <summary>One reserved (not-yet-performed) dial action with its reason and owning story (or <c>"none"</c>).</summary>
    internal sealed record ReservedAction(string Reason, string Owner);

    /// <summary>One grandfathered live uncatalogued performer (AC3 shrink-only ratchet).</summary>
    internal sealed record KnownUncataloguedPerformer(
        string Id, string Site, string MissingKey, string Owner, string Reason);

    // ====================================================================
    // Checked-in ReservedActions fixture (AC1, AC2, AC4, AC5, AC7, AC8)
    // ====================================================================

    /// <summary>
    /// Every dial-governed action that has NO live performer in the tree today.
    /// <list type="bullet">
    ///   <item>Owned reservations name their owning story (e.g. <c>"41-4"</c>,
    ///     <c>"43-12"</c>).</item>
    ///   <item>Unowned reservations carry <c>Owner = "none"</c> (AC8 — surfaced
    ///     explicitly for product-owner triage to either assign or retire).</item>
    /// </list>
    /// When a story lands a performer for any row here, AC4 fails until that row
    /// is deleted in the same PR.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, ReservedAction> ReservedActions =
        new Dictionary<string, ReservedAction>(StringComparer.Ordinal)
        {
            // ── Effects reserved with no live pipeline/performer yet (3) ────
            ["effect:deploy.dev"] = new(
                "No dev stage exists in DeploymentPipelineWorkflow (shipped pipeline is QA -> UAT -> Prod only).",
                "43-12"),
            ["effect:deploy.staging"] = new(
                "No staging stage exists in DeploymentPipelineWorkflow (shipped pipeline is QA -> UAT -> Prod only).",
                "43-12"),
            ["effect:git.checks.bypass"] = new(
                "No code path in the tree bypasses required PR checks yet.",
                "43-12"),

            // ── Document types awaiting their producer workflow (4 — mirrors ContractBindingTests.PendingProducerCells) ──
            ["document-type:test-plan"] = new(
                "No workflow dispatches its producer cell (tester, plan-test-strategy) yet.",
                "41-13"),
            ["document-type:threat-model"] = new(
                "No workflow dispatches its producer cell (security, threat-model) yet.",
                "41-19"),
            ["document-type:sprint-plan"] = new(
                "No workflow dispatches its producer cell (scrum_master, plan-sprint) yet.",
                "41-6"),
            ["document-type:ux-spec"] = new(
                "No workflow dispatches its producer cell (designer, author-ui-spec) yet.",
                "41-27"),

            // ── Agent actions owned by drafted Epic 41 stories (36) ─────────
            // Note: 41-2 (define-acceptance-criteria), 41-3 (prioritize-backlog),
            // 41-9 (write-adr) already shipped; write-regression-test, plan-refactor,
            // refactor, and implement-feature are live via MediatedLlmText.CompleteAsync.
            ["agent-action:analyze-security-incident"] = new("Awaiting security incident response workflow.", "41-21"),
            ["agent-action:assess-capacity"] = new("Awaiting capacity/SLO monitoring workflow.", "41-23"),
            ["agent-action:assess-technical-risk"] = new("Awaiting tech-debt/risk triage workflow.", "41-11"),
            ["agent-action:assess-vulnerability"] = new("Awaiting security audit workflow.", "41-20"),
            ["agent-action:audit-accessibility"] = new("Awaiting design/accessibility review workflow.", "41-28"),
            ["agent-action:audit-dependencies"] = new("Awaiting dependency audit workflow.", "41-20"),
            ["agent-action:audit-secrets"] = new("Awaiting security audit workflow (metadata-only pin owned by 42-10 AC7).", "41-20"),
            ["agent-action:author-ui-spec"] = new("Awaiting UX/UI spec authoring workflow.", "41-27"),
            ["agent-action:coordinate-release"] = new("Awaiting release coordination workflow.", "41-24"),
            ["agent-action:design-system"] = new("Awaiting system design workflow.", "41-10"),
            ["agent-action:diagnose-incident"] = new("Awaiting incident diagnosis workflow.", "41-22"),
            ["agent-action:draft-user-flow"] = new("Awaiting UX user-flow workflow.", "41-27"),
            ["agent-action:exploratory-test"] = new("Awaiting exploratory testing workflow.", "41-14"),
            ["agent-action:facilitate-retro"] = new("Awaiting retrospective facilitation workflow (Phase A).", "41-8"),
            ["agent-action:incident-rootcause"] = new("Awaiting incident root-cause workflow.", "41-22"),
            ["agent-action:manage-regression"] = new("Awaiting regression management workflow.", "41-16"),
            ["agent-action:monitor-health"] = new("Awaiting health monitoring workflow.", "41-23"),
            ["agent-action:plan-incident-response"] = new("Awaiting incident response planning workflow.", "41-22"),
            ["agent-action:plan-migration-strategy"] = new("Awaiting migration strategy workflow.", "41-12"),
            ["agent-action:plan-roadmap"] = new("Awaiting roadmap planning workflow.", "41-4"),
            ["agent-action:plan-sprint"] = new("Awaiting sprint planning workflow.", "41-6"),
            ["agent-action:plan-test-strategy"] = new("Awaiting test-plan authoring workflow.", "41-13"),
            ["agent-action:report-status"] = new("Awaiting status reporting workflow.", "41-5"),
            ["agent-action:review-design"] = new("Awaiting design review workflow.", "41-28"),
            ["agent-action:review-docs"] = new("Awaiting docs review workflow (tech_writer reviewer arm).", "41-24/41-25"),
            ["agent-action:review-operability"] = new("Awaiting runbook/operability review workflow.", "41-26"),
            ["agent-action:synthesize-standup"] = new("Awaiting standup synthesis workflow.", "41-7"),
            ["agent-action:threat-model"] = new("Awaiting threat modeling workflow.", "41-19"),
            ["agent-action:track-impediments"] = new("Awaiting sprint impediment tracking workflow.", "41-6"),
            ["agent-action:triage-pr"] = new("Awaiting standalone PR triage workflow.", "41-17"),
            ["agent-action:triage-tech-debt"] = new("Awaiting tech-debt triage workflow.", "41-11"),
            ["agent-action:update-changelog"] = new("Awaiting release changelog workflow.", "41-24"),
            ["agent-action:verify-acceptance"] = new("Awaiting acceptance verification workflow.", "41-15"),
            ["agent-action:write-api-docs"] = new("Awaiting API docs authoring workflow.", "41-25"),
            ["agent-action:write-postmortem"] = new("Awaiting postmortem authoring workflow.", "41-22"),
            ["agent-action:write-release-notes"] = new("Awaiting release notes authoring workflow.", "41-24"),
            ["agent-action:write-retro-narrative"] = new("Awaiting retrospective narrative workflow (Phase B).", "41-8"),
            ["agent-action:write-runbook"] = new("Awaiting runbook authoring workflow.", "41-26"),
            ["agent-action:write-user-docs"] = new("Awaiting user docs authoring workflow.", "41-25"),

            // ── Unowned reserved agent actions (AC8 — owner: "none") ────────
            // Surfaced explicitly for product-owner decision: assign an owning
            // story or retire from ActionCatalog via a 43-11 amendment.
            // (Re-derived from the live tree: agent-action:refactor is performed
            // by ApplyRefactoringActivity.cs:95; review-feasibility and
            // review-testability are performed by TaskReviewWorkflow.DevReview
            // and TaskReviewWorkflow.TesterReview — leaving 19 unowned rows.)
            ["agent-action:configure-cicd"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:design-api-contract"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:design-data-model"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:design-integration"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:implement-infrastructure"] = new("No dispatcher; 41-29 routes infra tasks to the coding path rather than this cell.", "none"),
            ["agent-action:plan-debugging"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:plan-deployment"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:plan-fix"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:plan-implementation"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:plan-review-security"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:plan-scope"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:review-acceptance"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:review-compliance"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:review-scope"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:self-review"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:summarize-technical"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:triage-defect"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:triage-technical"] = new("No dispatcher and no owning story.", "none"),
            ["agent-action:write-test-cases"] = new("No dispatcher; TestCaseCreationWorkflow dispatches agent-action:write-tests instead.", "none"),
        };

    // ====================================================================
    // Checked-in KnownUncataloguedPerformers ratchet (AC3 — shrink-only)
    // ====================================================================

    /// <summary>
    /// Shrink-only ratchet of grandfathered uncatalogued performers (AC3).
    /// Five of the six holes documented on 2026-08-03 are ALREADY CLOSED:
    /// <list type="bullet">
    ///   <item><c>POST /api/engine/create-issue</c> → <c>effect:git.issue.create</c> (Story 31-13)</item>
    ///   <item><c>POST /api/engine/issue-comment</c> → <c>effect:git.issue.comment</c> (Story 31-13)</item>
    ///   <item><c>POST/DELETE /api/engine/issue-labels</c> → <c>effect:git.issue.labels.{set,remove}</c> (Story 31-13)</item>
    ///   <item><c>POST /api/engine/trigger-ci</c> → <c>effect:ci.workflow.dispatch</c> (PR #509)</item>
    ///   <item><c>POST /api/engine/execute-task</c> → <c>effect:llm.task.execute</c> (PR #509)</item>
    /// </list>
    /// Only the arg-level <c>git push --force</c> split remains. This ratchet
    /// may only SHRINK when that split lands; it may never grow.
    /// </summary>
    internal static readonly IReadOnlyList<KnownUncataloguedPerformer> KnownUncataloguedPerformers =
    [
        new(
            Id: "git-operations-force-push",
            Site: "GitOperationsTool.ExecuteAsync (subcommand 'push' with arbitrary --force extraArgs)",
            MissingKey: "tool:git_operations.force-push",
            Owner: "43-11 (recorded arg-level split)",
            Reason: "GitOperationsTool allows subcommand 'push' with unchecked extraArgs, so 'push --force' rides tool:git_operations.write (level 25) instead of a dedicated destructive key."),
    ];

    internal const int UncataloguedPinSeed = 1;
    internal static readonly int[] UncataloguedPinHistory = [1];

    // ====================================================================
    // Live derivation across the four performer planes (AC1)
    // ====================================================================

    internal sealed record DerivedPerformer(string Plane, string ActionKeyWire, string Site);

    private static string FindTammaElsaRoot()
    {
        var dir = TestContext.CurrentContext.TestDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Tamma.sln")))
        {
            dir = Path.GetDirectoryName(dir);
        }
        dir.Should().NotBeNull("must locate apps/tamma-elsa root containing Tamma.sln");
        return dir!;
    }

    /// <summary>
    /// Derives EVERY live performer across all four planes directly from the
    /// compiled assemblies and source files — never a hand-typed shadow copy.
    /// </summary>
    internal static IReadOnlyList<DerivedPerformer> DeriveAllPerformers()
    {
        var performers = new List<DerivedPerformer>();
        var root = FindTammaElsaRoot();

        // ── Plane 1: Route plane ────────────────────────────────────────────
        // 1a. Controller [Governs] attributes reflected off Tamma.Api.
        var apiAssembly = typeof(ActionPolicyEndpoints).Assembly;
        foreach (var type in apiAssembly.GetTypes())
        {
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                foreach (var attr in method.GetCustomAttributes<GovernsAttribute>(inherit: false))
                {
                    performers.Add(new DerivedPerformer(
                        PlaneRoute,
                        attr.Action.ToWire(),
                        $"[Governs] {type.Name}.{method.Name}"));
                }
            }
        }

        // 1b. Minimal-API .Governs(new ActionKey(ActionNamespace.Effect, ExternalEffect.<Name>.ToWire()))
        //     bindings parsed directly from Tamma.Api/Program.cs.
        var programCs = File.ReadAllText(Path.Combine(root, "src", "Tamma.Api", "Program.cs"));
        var governsRegex = new Regex(
            @"\.Governs\s*\(\s*new\s+ActionKey\s*\(\s*ActionNamespace\.Effect\s*,\s*ExternalEffect\.(\w+)\.ToWire\s*\(\s*\)\s*\)\s*\)",
            RegexOptions.Compiled);
        foreach (Match match in governsRegex.Matches(programCs))
        {
            var memberName = match.Groups[1].Value;
            if (Enum.TryParse<ExternalEffect>(memberName, out var effect))
            {
                performers.Add(new DerivedPerformer(
                    PlaneRoute,
                    new ActionKey(ActionNamespace.Effect, effect.ToWire()).ToWire(),
                    $"Program.cs .Governs(ExternalEffect.{memberName})"));
            }
            else
            {
                performers.Add(new DerivedPerformer(
                    PlaneRoute,
                    $"effect:{memberName}",
                    $"Program.cs .Governs(ExternalEffect.{memberName}) [unresolved]"));
            }
        }

        // 1c. Human-operated / route-only catalogued effects whose routes exist
        //     without .Governs() yet (3 schedule + 10 native tracker + 1 MCP proxy).
        //     Each is verified by reflection on its real endpoint handler method
        //     so deleting or renaming the handler immediately drops the performer.
        var humanRoutePerformers = new (ExternalEffect Effect, Type HandlerType, string MethodName)[]
        {
            (ExternalEffect.ScheduleCreate, typeof(ScheduledTriggerEndpoints), nameof(ScheduledTriggerEndpoints.Create)),
            (ExternalEffect.ScheduleUpdate, typeof(ScheduledTriggerEndpoints), nameof(ScheduledTriggerEndpoints.Update)),
            (ExternalEffect.ScheduleDelete, typeof(ScheduledTriggerEndpoints), nameof(ScheduledTriggerEndpoints.Delete)),
            (ExternalEffect.TrackerProjectCreate, typeof(TrackerEndpoints), nameof(TrackerEndpoints.CreateProject)),
            (ExternalEffect.TrackerProjectUpdate, typeof(TrackerEndpoints), nameof(TrackerEndpoints.PatchProject)),
            (ExternalEffect.TrackerProjectDelete, typeof(TrackerEndpoints), nameof(TrackerEndpoints.DeleteProject)),
            (ExternalEffect.TrackerWorkItemCreate, typeof(TrackerEndpoints), nameof(TrackerEndpoints.CreateWorkItem)),
            (ExternalEffect.TrackerWorkItemUpdate, typeof(TrackerEndpoints), nameof(TrackerEndpoints.PatchWorkItem)),
            (ExternalEffect.TrackerWorkItemDelete, typeof(TrackerEndpoints), nameof(TrackerEndpoints.DeleteWorkItem)),
            (ExternalEffect.TrackerWorkItemAssign, typeof(TrackerEndpoints), nameof(TrackerEndpoints.AssignWorkItem)),
            (ExternalEffect.TrackerWorkItemSetStatus, typeof(TrackerEndpoints), nameof(TrackerEndpoints.SetWorkItemStatus)),
            (ExternalEffect.TrackerPreferencesSet, typeof(TrackerEndpoints), nameof(TrackerEndpoints.PutPreferences)),
            (ExternalEffect.TrackerPreferencesDelete, typeof(TrackerEndpoints), nameof(TrackerEndpoints.DeletePreferences)),
            (ExternalEffect.McpToolInvoke, typeof(KbEndpoints), nameof(KbEndpoints.InvokeMcpTool)),
        };
        foreach (var (effect, handlerType, methodName) in humanRoutePerformers)
        {
            var mi = handlerType.GetMethod(methodName, BindingFlags.Public | BindingFlags.Static);
            if (mi is not null)
            {
                performers.Add(new DerivedPerformer(
                    PlaneRoute,
                    new ActionKey(ActionNamespace.Effect, effect.ToWire()).ToWire(),
                    $"route handler {handlerType.Name}.{methodName}"));
            }
        }

        // ── Plane 2: Method plane ([PerformsEffect] on TammaApiClient) ──────
        foreach (var method in typeof(TammaApiClient).GetMethods(
                     BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            foreach (var attr in method.GetCustomAttributes<PerformsEffectAttribute>(inherit: false))
            {
                performers.Add(new DerivedPerformer(
                    PlaneMethod,
                    attr.Key.ToWire(),
                    $"[PerformsEffect] TammaApiClient.{method.Name}"));
            }
        }

        // ── Plane 3: Tool plane (concrete IToolExecutor across 3 assemblies) ─
        var toolAssemblies = new[]
        {
            typeof(GitOperationsTool).Assembly,
            typeof(Tamma.Api.Services.AcceptanceRules.GetAcceptanceRulesTool).Assembly,
            typeof(Tamma.ElsaServer.WorkflowSeeder).Assembly,
        }.Distinct();
        foreach (var type in toolAssemblies
                     .SelectMany(a => a.GetTypes())
                     .Where(t => t is { IsAbstract: false, IsInterface: false }
                                 && typeof(IToolExecutor).IsAssignableFrom(t)))
        {
            var toolName = (string)typeof(IToolExecutor)
                .GetProperty(nameof(IToolExecutor.ToolName))!
                .GetValue(RuntimeHelpers.GetUninitializedObject(type))!;
            if (string.Equals(toolName, "git_operations", StringComparison.OrdinalIgnoreCase))
            {
                performers.Add(new DerivedPerformer(
                    PlaneTool,
                    new ActionKey(ActionNamespace.Tool, ToolAction.GitOperationsRead.ToWire()).ToWire(),
                    $"IToolExecutor {type.Name} (read subcommands)"));
                performers.Add(new DerivedPerformer(
                    PlaneTool,
                    new ActionKey(ActionNamespace.Tool, ToolAction.GitOperationsWrite.ToWire()).ToWire(),
                    $"IToolExecutor {type.Name} (write subcommands)"));
            }
            else if (ToolNameAliases.TryResolve(toolName, out var toolKey))
            {
                performers.Add(new DerivedPerformer(
                    PlaneTool,
                    toolKey.ToWire(),
                    $"IToolExecutor {type.Name}"));
            }
            else
            {
                performers.Add(new DerivedPerformer(
                    PlaneTool,
                    $"tool:{toolName}",
                    $"IToolExecutor {type.Name} [unresolved]"));
            }
        }

        // ── Plane 4: Dispatch plane ─────────────────────────────────────────
        // 4a. Compiled Elsa workflow dispatches (shared source: TaxonomyDriftBuildTests).
        var dispatchedActionWires = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pair in TaxonomyDriftBuildTests.EnumerateAllDispatchPairs())
        {
            var normalized = RolePhaseMap.NormalizePhase(pair.Action);
            dispatchedActionWires.Add(normalized);
            performers.Add(new DerivedPerformer(
                PlaneDispatch,
                $"agent-action:{normalized}",
                $"workflow {pair.Workflow}.{pair.DispatchId} (role={pair.Role})"));
        }

        // 4b. Direct MediatedLlmText.CompleteAsync(..., action: "<wire>") call sites
        //     in Tamma.Activities (captures WriteImplementationActivity → implement-feature,
        //     WriteRegressionTestActivity, AnalyzeCodeActivity, ApplyRefactoringActivity, etc.).
        var activitiesDir = Path.Combine(root, "src", "Tamma.Activities");
        var mediatedRegex = new Regex(
            @"MediatedLlmText\.CompleteAsync\s*\([^;]*?action\s*:\s*""([^""]+)""",
            RegexOptions.Compiled | RegexOptions.Singleline);
        foreach (var file in Directory.EnumerateFiles(activitiesDir, "*.cs", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            foreach (Match match in mediatedRegex.Matches(text))
            {
                var rawAction = match.Groups[1].Value;
                var normalized = RolePhaseMap.NormalizePhase(rawAction);
                dispatchedActionWires.Add(normalized);
                var rel = Path.GetRelativePath(root, file);
                performers.Add(new DerivedPerformer(
                    PlaneDispatch,
                    $"agent-action:{normalized}",
                    $"MediatedLlmText.CompleteAsync in {rel}"));
            }
        }

        // 4b-ii. Diff-review panel lens dispatches resolved at runtime by
        //        ReviewerSelectionHelper.Resolve(..., subjectKind: "diff") inside
        //        PanelReviewWorkflow / SingleReviewerWorkflow.
        foreach (var role in new[]
                 {
                     AgentRole.SeniorDeveloper,
                     AgentRole.Developer,
                     AgentRole.Architect,
                     AgentRole.Security,
                     AgentRole.Tester,
                 })
        {
            var spec = Tamma.ElsaServer.Workflows.Helpers.ReviewerSelectionHelper.Resolve(
                role.ToWire(), actionOverride: null,
                subjectKind: Tamma.ElsaServer.Workflows.Helpers.ReviewerSelectionHelper.DiffSubjectKind,
                documentTypeKey: null);
            var wire = spec.Action.ToWire();
            dispatchedActionWires.Add(wire);
            performers.Add(new DerivedPerformer(
                PlaneDispatch,
                $"agent-action:{wire}",
                $"ReviewerSelectionHelper.Resolve(role={role.ToWire()}, subject=diff)"));
        }

        // 4c. Document-type producers: derived from ContractBindingTests.DocumentTypeValidatedCells
        //     where the producing action is live-dispatched above, plus DocumentTypeKey.Review
        //     which is directly produced by DocumentLifecycleWorkflow / ReviewProducerHelper.
        var validatorNameToDocType = Enum.GetValues<DocumentTypeKey>()
            .ToDictionary(
                dt => $"{dt}DocumentType.Validate",
                dt => dt,
                StringComparer.Ordinal);
        foreach (var ((role, action), parser) in ContractBindingTests.DocumentTypeValidatedCells)
        {
            if (dispatchedActionWires.Contains(action)
                && validatorNameToDocType.TryGetValue(parser, out var docType))
            {
                performers.Add(new DerivedPerformer(
                    PlaneDispatch,
                    new ActionKey(ActionNamespace.DocumentType, docType.ToWire()).ToWire(),
                    $"document producer ({role}, {action}) -> {parser}"));
            }
        }

        var lifecycleCs = File.ReadAllText(
            Path.Combine(root, "src", "Tamma.ElsaServer", "Workflows", "DocumentLifecycleWorkflow.cs"));
        if (lifecycleCs.Contains("DocumentTypeKey.Review", StringComparison.Ordinal))
        {
            performers.Add(new DerivedPerformer(
                PlaneDispatch,
                new ActionKey(ActionNamespace.DocumentType, DocumentTypeKey.Review.ToWire()).ToWire(),
                "DocumentLifecycleWorkflow / SingleReviewerWorkflow (DocumentTypeKey.Review)"));
        }

        // 4d. In-process non-HTTP effects verified directly against live code.
        //     - effect:process.spawn -> ShellExecuteTool
        var shellToolCs = File.ReadAllText(
            Path.Combine(root, "src", "Tamma.Activities", "LlmCall", "Tools", "ShellExecuteTool.cs"));
        if (shellToolCs.Contains("ProcessStartInfo", StringComparison.Ordinal))
        {
            performers.Add(new DerivedPerformer(
                PlaneDispatch,
                new ActionKey(ActionNamespace.Effect, ExternalEffect.ProcessSpawn.ToWire()).ToWire(),
                "in-process ShellExecuteTool (ProcessStartInfo)"));
        }

        //     - effect:deploy.{qa,uat,prod,rollback} -> DeploymentPipelineWorkflow
        var deployWorkflowCs = File.ReadAllText(
            Path.Combine(root, "src", "Tamma.ElsaServer", "Workflows", "DeploymentPipelineWorkflow.cs"));
        var deployEffects = new[]
        {
            ExternalEffect.DeployQa,
            ExternalEffect.DeployUat,
            ExternalEffect.DeployProd,
            ExternalEffect.DeployRollback,
        };
        foreach (var de in deployEffects)
        {
            var expectedToken = de == ExternalEffect.DeployRollback
                ? "AgentAction.Rollback"
                : new ActionKey(ActionNamespace.Effect, de.ToWire()).ToWire();
            if (deployWorkflowCs.Contains(expectedToken, StringComparison.Ordinal))
            {
                performers.Add(new DerivedPerformer(
                    PlaneDispatch,
                    new ActionKey(ActionNamespace.Effect, de.ToWire()).ToWire(),
                    $"in-process DeploymentPipelineWorkflow ({expectedToken})"));
            }
        }

        return performers;
    }

    internal static IReadOnlyDictionary<string, IReadOnlyList<DerivedPerformer>> GroupByActionKey(
        IEnumerable<DerivedPerformer> performers) =>
        performers
            .GroupBy(p => p.ActionKeyWire, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<DerivedPerformer>)g.ToList(),
                StringComparer.Ordinal);

    // ── Pure sweep evaluators (shared by live tests + meta-tests) ──────────

    internal static IReadOnlyList<string> FindOrphanedDialActions(
        IReadOnlyDictionary<string, IReadOnlyList<DerivedPerformer>> performersByKey,
        IReadOnlyDictionary<string, ReservedAction> reserved)
    {
        var orphans = new List<string>();
        foreach (var d in ActionCatalog.All.Where(d => !d.IsMachinery))
        {
            var wire = d.Key.ToWire();
            if (!performersByKey.ContainsKey(wire) && !reserved.ContainsKey(wire))
            {
                orphans.Add(
                    $"  {wire}: no performer derived across [{PlaneRoute}, {PlaneMethod}, {PlaneTool}, {PlaneDispatch}] "
                    + "and no ReservedActions entry.");
            }
        }
        return orphans.OrderBy(s => s, StringComparer.Ordinal).ToList();
    }

    internal static IReadOnlyList<string> FindUncataloguedPerformers(
        IEnumerable<DerivedPerformer> performers)
    {
        var catalogWires = ActionCatalog.All.Select(d => d.Key.ToWire())
            .ToHashSet(StringComparer.Ordinal);
        return performers
            .Where(p => !catalogWires.Contains(p.ActionKeyWire))
            .Select(p => $"  [{p.Plane}] {p.ActionKeyWire} at {p.Site} is not in ActionCatalog.All.")
            .Distinct(StringComparer.Ordinal)
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();
    }

    internal static IReadOnlyList<string> FindStaleReservations(
        IReadOnlyDictionary<string, IReadOnlyList<DerivedPerformer>> performersByKey,
        IReadOnlyDictionary<string, ReservedAction> reserved)
    {
        var stale = new List<string>();
        foreach (var (wire, info) in reserved)
        {
            if (performersByKey.TryGetValue(wire, out var sites) && sites.Count > 0)
            {
                stale.Add(
                    $"  {wire} (owner={info.Owner}): remove the ReservedActions marker — the action is performed now at "
                    + string.Join(", ", sites.Select(s => $"{s.Plane}:{s.Site}")));
            }
        }
        return stale.OrderBy(s => s, StringComparer.Ordinal).ToList();
    }

    // ====================================================================
    // AC1 — All four planes derive real performers (anti-no-op tripwires)
    // ====================================================================

    [Test]
    public void Ac1_ThePerformerMap_DerivesFromAllFourPlanes()
    {
        var all = DeriveAllPerformers();
        all.Where(p => p.Plane == PlaneRoute).Should().NotBeEmpty("route plane must contribute performers");
        all.Where(p => p.Plane == PlaneMethod).Should().NotBeEmpty("method plane must contribute performers");
        all.Where(p => p.Plane == PlaneTool).Should().NotBeEmpty("tool plane must contribute performers");
        all.Where(p => p.Plane == PlaneDispatch).Should().NotBeEmpty("dispatch plane must contribute performers");
    }

    // ====================================================================
    // AC2 — Failure direction 1: orphaned level (+ meta-test)
    // ====================================================================

    [Test]
    public void Ac2_FailureDirection1_EveryDialAction_HasPerformerOrReservation()
    {
        var performersByKey = GroupByActionKey(DeriveAllPerformers());
        var orphans = FindOrphanedDialActions(performersByKey, ReservedActions);

        orphans.Should().BeEmpty(
            "Story 43-17 AC2 — every dial-governed action must either derive a live performer from one of "
            + "the four planes or carry a ReservedActions entry:"
            + Environment.NewLine + string.Join(Environment.NewLine, orphans));
    }

    [Test]
    public void Ac2_MetaTest_DeletingAnyReservation_MakesOrphanedLevelSweepRed()
    {
        var performersByKey = GroupByActionKey(DeriveAllPerformers());
        var sampleKey = ReservedActions.Keys.OrderBy(k => k, StringComparer.Ordinal).First();

        var doctored = ReservedActions
            .Where(kv => kv.Key != sampleKey)
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

        var orphans = FindOrphanedDialActions(performersByKey, doctored);
        orphans.Should().ContainSingle()
            .Which.Should().Contain(sampleKey)
            .And.Contain(PlaneRoute)
            .And.Contain(PlaneMethod)
            .And.Contain(PlaneTool)
            .And.Contain(PlaneDispatch);
    }

    // ====================================================================
    // AC3 — Failure direction 2: uncatalogued performer (+ meta-test + ratchet)
    // ====================================================================

    [Test]
    public void Ac3_FailureDirection2_EveryDerivedPerformer_ResolvesInActionCatalog()
    {
        var uncatalogued = FindUncataloguedPerformers(DeriveAllPerformers());
        uncatalogued.Should().BeEmpty(
            "Story 43-17 AC3 — every derived performer across all four planes must resolve to a "
            + "catalogued action in ActionCatalog.All:"
            + Environment.NewLine + string.Join(Environment.NewLine, uncatalogued));
    }

    [Test]
    public void Ac3_MetaTest_UncataloguedDispatchToken_MakesSweepRed()
    {
        var synthetic = DeriveAllPerformers().Append(new DerivedPerformer(
            PlaneDispatch,
            "agent-action:phantom-uncatalogued-step",
            "SyntheticWorkflow.DispatchPhantom"));

        var uncatalogued = FindUncataloguedPerformers(synthetic);
        uncatalogued.Should().ContainSingle()
            .Which.Should().Contain("agent-action:phantom-uncatalogued-step")
            .And.Contain("SyntheticWorkflow.DispatchPhantom");
    }

    [Test]
    public void Ac3_KnownUncataloguedPerformers_RatchetIsShrinkOnlyAndJustified()
    {
        UncataloguedPinHistory.Should().NotBeEmpty();
        UncataloguedPinHistory[0].Should().Be(UncataloguedPinSeed);
        for (var i = 1; i < UncataloguedPinHistory.Length; i++)
        {
            UncataloguedPinHistory[i].Should().BeLessThan(UncataloguedPinHistory[i - 1],
                "the uncatalogued-performer ratchet may only shrink");
        }

        KnownUncataloguedPerformers.Should().HaveCount(UncataloguedPinHistory[^1]);
        foreach (var entry in KnownUncataloguedPerformers)
        {
            entry.Id.Should().NotBeNullOrWhiteSpace();
            entry.Site.Should().NotBeNullOrWhiteSpace();
            entry.MissingKey.Should().NotBeNullOrWhiteSpace();
            entry.Owner.Should().NotBeNullOrWhiteSpace();
            entry.Reason.Should().NotBeNullOrWhiteSpace();
            // Staleness: if the missing key gets minted into ActionCatalog, fail until removed here.
            ActionCatalog.All.Select(d => d.Key.ToWire()).Should().NotContain(entry.MissingKey,
                $"'{entry.MissingKey}' is now catalogued — remove '{entry.Id}' from KnownUncataloguedPerformers and shrink the pin");
        }
    }

    // ====================================================================
    // AC4 — Stale reservations fail (+ meta-test)
    // ====================================================================

    [Test]
    public void Ac4_StaleReservations_FailTheBuild()
    {
        var performersByKey = GroupByActionKey(DeriveAllPerformers());
        var stale = FindStaleReservations(performersByKey, ReservedActions);

        stale.Should().BeEmpty(
            "Story 43-17 AC4 — a ReservedActions entry whose action now has a live performer must be "
            + "removed in the same PR that landed the performer:"
            + Environment.NewLine + string.Join(Environment.NewLine, stale));
    }

    [Test]
    public void Ac4_MetaTest_AddingReservationForPerformedAction_MakesSweepRed()
    {
        var performersByKey = GroupByActionKey(DeriveAllPerformers());
        var doctored = new Dictionary<string, ReservedAction>(ReservedActions, StringComparer.Ordinal)
        {
            ["agent-action:code-review"] = new("stale test marker", "test"),
        };

        var stale = FindStaleReservations(performersByKey, doctored);
        stale.Should().ContainSingle()
            .Which.Should().Contain("agent-action:code-review")
            .And.Contain("remove the ReservedActions marker");
    }

    // ====================================================================
    // AC5 — Performed ∪ Reserved ∪ Machinery partitions ActionCatalog.All
    // ====================================================================

    [Test]
    public void Ac5_Performed_Reserved_And_Machinery_PartitionTheEntireCatalog()
    {
        var allCatalog = ActionCatalog.All.Select(d => d.Key.ToWire()).ToHashSet(StringComparer.Ordinal);
        var machinery = ActionCatalog.All.Where(d => d.IsMachinery)
            .Select(d => d.Key.ToWire()).ToHashSet(StringComparer.Ordinal);

        var performersByKey = GroupByActionKey(DeriveAllPerformers());
        var performedDial = performersByKey.Keys
            .Where(k => allCatalog.Contains(k) && !machinery.Contains(k))
            .ToHashSet(StringComparer.Ordinal);
        var reserved = ReservedActions.Keys.ToHashSet(StringComparer.Ordinal);

        // Every reserved entry must exist in ActionCatalog and must NOT be machinery.
        reserved.Except(allCatalog).Should().BeEmpty(
            "every ReservedActions key must exist in ActionCatalog.All");
        reserved.Intersect(machinery).Should().BeEmpty(
            "machinery rows are owned by 43-13's MachineryInventory, never ReservedActions");

        // Pairwise disjointness across all three partitions.
        performedDial.Intersect(reserved).Should().BeEmpty("performed and reserved must be disjoint");
        performedDial.Intersect(machinery).Should().BeEmpty("performed-dial and machinery must be disjoint");
        reserved.Intersect(machinery).Should().BeEmpty("reserved and machinery must be disjoint");

        // Exact union equals ActionCatalog.All (derived dynamically — no hardcoded totals).
        var union = new HashSet<string>(performedDial, StringComparer.Ordinal);
        union.UnionWith(reserved);
        union.UnionWith(machinery);

        allCatalog.Except(union).Should().BeEmpty("no catalog member may fall outside the three partitions");
        union.Except(allCatalog).Should().BeEmpty("no partition may contain an unknown key");
        (performedDial.Count + reserved.Count + machinery.Count).Should().Be(ActionCatalog.All.Count);
    }

    // ====================================================================
    // AC6 — The implement-feature question is settled with live proof
    // ====================================================================

    [Test]
    public void Ac6_ImplementFeature_IsLivePerformedByWriteImplementationActivity()
    {
        var performersByKey = GroupByActionKey(DeriveAllPerformers());

        performersByKey.Should().ContainKey("agent-action:implement-feature",
            "Story 43-17 AC6 settled: WriteImplementationActivity dispatches agent-action:implement-feature "
            + "live via MediatedLlmText.CompleteAsync");
        performersByKey["agent-action:implement-feature"]
            .Should().Contain(p => p.Site.Contains("WriteImplementationActivity.cs", StringComparison.Ordinal));
        ReservedActions.Should().NotContainKey("agent-action:implement-feature");
    }

    // ====================================================================
    // AC8 — Unowned reserved rows are explicitly surfaced with owner: "none"
    // ====================================================================

    [Test]
    public void Ac8_UnownedReservedActions_AreExplicitlySurfacedWithOwnerNone()
    {
        var unowned = ReservedActions
            .Where(kv => string.Equals(kv.Value.Owner, "none", StringComparison.Ordinal))
            .Select(kv => kv.Key)
            .OrderBy(k => k, StringComparer.Ordinal)
            .ToArray();

        // Every reserved entry must carry a non-empty reason and a non-empty owner
        // (either an owning story id or the explicit sentinel "none").
        foreach (var (key, info) in ReservedActions)
        {
            info.Reason.Should().NotBeNullOrWhiteSpace(key);
            info.Owner.Should().NotBeNullOrWhiteSpace(key);
        }

        // Exact pin of the unowned list so product-owner retirement or assignment is
        // always a visible, reviewed diff (19 rows — refactor graduated via
        // ApplyRefactoringActivity.cs:95; review-feasibility and review-testability
        // graduated via TaskReviewWorkflow.DevReview / TesterReview).
        unowned.Should().Equal(
            "agent-action:configure-cicd",
            "agent-action:design-api-contract",
            "agent-action:design-data-model",
            "agent-action:design-integration",
            "agent-action:implement-infrastructure",
            "agent-action:plan-debugging",
            "agent-action:plan-deployment",
            "agent-action:plan-fix",
            "agent-action:plan-implementation",
            "agent-action:plan-review-security",
            "agent-action:plan-scope",
            "agent-action:review-acceptance",
            "agent-action:review-compliance",
            "agent-action:review-scope",
            "agent-action:self-review",
            "agent-action:summarize-technical",
            "agent-action:triage-defect",
            "agent-action:triage-technical",
            "agent-action:write-test-cases");
    }
}
