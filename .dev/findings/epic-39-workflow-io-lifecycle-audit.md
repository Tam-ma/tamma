# Finding: Epic 39 Workflow I/O & Lifecycle Audit

**Date**: 2026-11-26
**Author**: Antigravity (Story 39-1 Audit)
**Type**: 📚 Lesson Learned
**Category**: Architecture

## 📋 Summary

Complete, compiler- and reflection-verified inventory of all **49** `*Workflow.cs` files in `apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/` at commit `7cf99de24179cb53da43d1b9bbb4daa020df39a7`, reconciling every workflow's consumed inputs, produced shapes/validators, decision points, review loops, resumability classification, gap tags, document-type coverage, and consumer edges.

Because Stories **39-2 through 39-20** and **41-1b/1c/2/3/9** shipped prior to this discovery gate landing, this audit records the **real current state on `main`**:
- **15** producer/reader bindings have already migrated onto `DocumentLifecycleWorkflow` + typed `DocumentTypeRegistry` validators + `[ResumeBehavior]` (non-provisional in `DocumentTypeRegistry.WorkflowInterfaces`).
- **4** declared `WorkflowDocumentInterface` rows remain **`Provisional = true`** legacy workflows with live gaps: `task-review` (inline string-verdict panel with pessimistic `"concerns"` default — Shape 1), `code-review` (`ReviewResult`/`CodeReviewWorkflowResult` fork — Shape 3), `blocker-diagnosis` (lenient `ClassifyBlockerActivity.ParseAIDiagnosis` fallback), and `debugging` (apply-fix leg still legacy `llm-call`; diagnosis leg migrated to `debug-diagnosis`).
- **3** additional LLM-bearing non-migrated producers (`AssessmentWorkflow`, `ContextGatheringWorkflow`, `MentorshipWorkflow`) are flagged in the Document-Type Coverage check as explicit open questions or intentional free-text boundaries rather than silently dropped.
- **19** of **49** workflows declare `[ResumeBehavior(...)]` under Story 39-10's structural gate (`ResumableStandardStructuralTests`); the remaining **30** are accounted for in `LegacyResumeAllowlist` (mostly stateless/mechanical workflows, review sub-workflows, and the 4 remaining legacy producers).

---

## 🔍 Context

- **Story**: [Story 39-1: Workflow I/O & Lifecycle Audit](../../docs/stories/epic-39/story-39-1/39-1-workflow-io-and-lifecycle-audit.md)
- **Epic**: [Epic 39: Typed Work Documents & the Universal Workflow Lifecycle](../../docs/stories/epic-39/README.md)
- **Audited Commit**: `7cf99de24179cb53da43d1b9bbb4daa020df39a7` (`main`)
- **Template Adaptation Note**: Adapted from `.dev/templates/finding-template.md` (keeping the standard identity header, Summary, Context, and structured Evidence/Action Items skeleton while replacing generic TS snippet blocks with the Story 39-1 audit tables, family evidence, coverage check, consumer-edge list, and reconciliation appendices).
- **Zero-Code Constraint**: This audit modifies zero `.cs` files. All dispatch pairs were extracted by running `TaxonomyDriftBuildTests.EnumerateAllDispatchPairs()` (42 live pairs) and cross-checking `ContractBindingTests` (19/19 tests passing) and `ResumableStandardStructuralTests` (all passing).

### Related Components
- Workflows: `apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/*Workflow.cs` (49 files)
- Helpers: `apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/Helpers/*.cs` (21 files)
- Resume Endpoints: `apps/tamma-elsa/src/Tamma.ElsaServer/Endpoints/*.cs` (10 endpoints + `ResumeGuard.cs`)
- Document Core & Registry: `apps/tamma-elsa/src/Tamma.Core/Documents/` (`DocumentTypeKey.cs`, `DocumentTypeRegistry.cs`)
- Build-Time Drift Gates: `TaxonomyDriftBuildTests.cs`, `ContractBindingTests.cs`, `ResumableStandardStructuralTests.cs`, `WorkflowInterfaceGraphTests.cs`

---

## 🚫 Exclusion Note (Non-Workflow Files in `Workflows/`)

An `ls` of `apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/*.cs` yields **58** files: **49** `*Workflow.cs` files (all audited in the Master Table below) plus **9** non-workflow helper/scheduler/trigger files explicitly excluded from the workflow table:

| Excluded File | Reason |
|---|---|
| `ActivityDisplayTextExtensions.cs` | Extension helpers (`SetDisplayText`, `WithLabel`) for Elsa activity display metadata — not a workflow. |
| `AdlLoopWatchdogService.cs` | Hosted watchdog background service monitoring stalled ADL loops — not an Elsa workflow. |
| `FlowJoins.cs` | Shared Flowchart join-node builder utility — not a workflow. |
| `HourlyAnalyticsRollupScheduler.cs` | Hosted cron/timer scheduler shim dispatching `HourlyAnalyticsRollupWorkflow` — scheduler only (the workflow itself is audited). |
| `OrphanedCycleRecoveryService.cs` | Hosted startup/periodic recovery service for orphaned cycle instances — not an Elsa workflow. |
| `TenantCleanupRequestedTrigger.cs` | Event trigger shim dispatching `CleanUpFailedTenantWorkflow` — trigger only (the workflow itself is audited). |
| `TenantDeleteRequestedTrigger.cs` | Event trigger shim dispatching `DeleteTenantWorkflow` — trigger only (the workflow itself is audited). |
| `TenantScheduledTriggerService.cs` | Hosted scheduler dispatching per-tenant recurring workflows — scheduler shim only. |
| `WorkflowVersions.cs` | Compile-time `ComputedVersion` constant helper for Elsa workflow registration — not a workflow. |

---

## 📊 Master Workflow Inventory (49 / 49 Reconciled)

**Resumability legend (AC5):**
- **(a)** Suspends on a bookmark with a verified `*ResumeEndpoint.cs` (or proven resume driver) AND/OR declares `[ResumeBehavior(LatestStateReEntry|Both)]` with `ComputeReEntryPositionActivity` / `ComputeTaskResumeIndexActivity`.
- **(b)** Registers an Elsa bookmark / suspend activity, but no verified production resume endpoint exercises it.
- **(c)** No suspend point and no re-entry gate; meaningful multi-step LLM/git state restarts from scratch on stop/crash.
- **(d)** Stateless/mechanical single-shot or pure infra/platform saga (out of document-lifecycle scope).

**Closed Gap-Tag Set (AC6):** `UNTYPED_OUTPUT` | `PARSE_OK_IS_ACCEPT` | `NO_REVISE_LOOP` | `FORKED_REVIEW_SHAPE` | `NOT_RESUMABLE` | `BARE_FAILURE_ESCALATION` (or `None (migrated)` / `Out of scope (mechanical)`).

| # | Workflow (`DefinitionId`) | Consumes | Produces (shape + validator/parser) | Decision point | Review loop | Resumability | Gap tags | Closed by |
|---|---|---|---|---|---|---|---|---|
| 1 | `AcceptanceCriteriaAuthoringWorkflow` (`acceptance-criteria-authoring`) | `issueId`, `issueTitle`, `repository`, optional accepted `Clarification` + `Findings` | Typed `AcceptanceCriteria` (`AcceptanceCriteriaDocumentType.Validate` via `document-lifecycle`) | Deterministic validator + `DocumentLifecycleWorkflow` accept gate (`WaitForDocumentDecisionActivity`) | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) + child accept bookmark | None (migrated) | Closed by 39-6, 39-10, 41-1b, 41-2 |
| 2 | `AdlOrchestratorWorkflow` (`adl-orchestrator`) | `repository`, `baseBranch`, `mode`, `configJson`, `issueLabels`, `botAssignee` | Dispatches `SingleIssueCycleWorkflow` per picked issue (orchestration side-effects) | Issue-pick & cycle exit status; delegates decisions to child cycles | N/A (outer orchestrator) | **(c)** `LegacyResumeAllowlist` — no own suspend/re-entry; relies on `AdlLoopWatchdogService` + child resumability | `NOT_RESUMABLE` | 39-10 / 40-4 (orchestrator re-entry follow-up) |
| 3 | `AdrAuthoringWorkflow` (`adr-authoring`) | `issueId`, `decisionContext`, `audience`, optional accepted `Design` + `Findings` | Typed `Prose` (`kind=adr`, `ProseDocumentType.Validate` via `document-lifecycle`) | Envelope validator (`kind`/`audience`/`title`/`body`) + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-6, 41-1c, 41-9 |
| 4 | `AmbiguityScoringWorkflow` (`ambiguity-scoring`) | `requirement`, `context`, `issueId`, `sessionId`, `acceptanceRulesJson` | Typed `AmbiguityAssessment` (`AmbiguityAssessmentDocumentType.Validate` via `document-lifecycle`) | Deterministic validator + ambiguity threshold (`39-25`) + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-3, 39-6, 39-13, 39-25 |
| 5 | `AssessmentWorkflow` (`assessment`) | `storyId`, `juniorId`, `skillLevel`, `sessionId`, `previousAttemptJson` | Inline questions array (`ParseQuestionsResult`, `L196`) + assessment analysis JSON (`ParseAnalysisResult`, `L342`: `confidence`/`gaps`/`strengths`/`rationale`) | Fail-closed on missing/non-numeric `confidence`; `ClassifyResultActivity` recomputes status | None (one-shot Q&A assessment) | **(b)** Suspends on `WaitForResponseActivity` (`L281`), but no `*ResumeEndpoint.cs` maps it; in `LegacyResumeAllowlist` | `UNTYPED_OUTPUT`, `PARSE_OK_IS_ACCEPT`, `NO_REVISE_LOOP`, `NOT_RESUMABLE` | Open question for 39-3/39-4; 39-10 |
| 6 | `BacklogPrioritizationWorkflow` (`backlog-prioritization`) | `itemsJson`, `backlogScope`, `repoContext`, bounded accepted `TriageDecision` + `Findings` | Typed `BacklogOrdering` (`BacklogOrderingDocumentType.Validate` via `document-lifecycle`) | Deterministic gap-free `1..N` rank validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-6, 41-1b, 41-3 |
| 7 | `BlockerDiagnosisWorkflow` (`blocker-diagnosis`) | `storyId`, `juniorId`, `branchName`, `blockerContext`, `skillLevel` | `BlockerDiagnosisResult` via lenient `ClassifyBlockerActivity.ParseAIDiagnosis` (`ClassifyBlockerActivity.cs:100`) + free-text hints/guidance (`mentor-feedback`) + code fix (`implement-fix`) | Lenient parse with heuristic signal fallback (never fails closed); progressive resolution ladder | None (progressive escalation ladder, no document review loop) | **(a)** Suspends on `DetectProgressActivity` & `EscalateToSeniorActivity`; resumed by `BlockerResumeEndpoint` (`/elsa/api/adl/blocker/resume`); still in `LegacyResumeAllowlist` (legacy builder) | `UNTYPED_OUTPUT`, `PARSE_OK_IS_ACCEPT`, `NO_REVISE_LOOP`, `NOT_RESUMABLE` | 39-4 (`Diagnosis`), 39-15 follow-up, 39-10 |
| 8 | `BranchCreationWorkflow` (`branch-creation`) | `repository`, `baseBranch`, `issueNumber`, `issueTitle`, `conflictStrategy` | Git branch side-effect (`branchName` output) | Git command exit status + conflict strategy | N/A (mechanical) | **(d)** Stateless git leaf (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 9 | `CiWithDebugRetryWorkflow` (`ci-with-debug-retry`) | `repository`, `branchName`, `issueNumber`, `maxRetries`, `skillLevel` | Dispatches `testing-pipeline` ↔ `debugging` bounded retry loop | CI pass/fail boolean across `maxRetries` | Code fix retry loop (not document review) | **(c)** No own suspend/re-entry (`LegacyResumeAllowlist`); child `testing-pipeline` holds `WaitForCIResultsActivity` | `NOT_RESUMABLE` | 40-4 / 39-10 follow-up |
| 10 | `ClarifyingQuestionsWorkflow` (`clarifying-questions`) | `requirement`, `ambiguityContext`, `issueId`, `sessionId`, `acceptanceRulesJson` | Typed `Clarification` — Run A (`clarify-requirements`) + Run B (`incorporate-answers`) via `ClarificationDocumentType.Validate` | Deterministic validator + lifecycle accept gate + `WaitForDocumentInputActivity` human answer gate | Unified 39-6/39-7 review + bounded revise loop (both runs) | **(a)** `[ResumeBehavior(Both, WaitForDocumentInputActivity)]`; resumed by `DocumentInputResumeEndpoint` (`/elsa/api/documents/input/resume`) & `ClarifyResumeEndpoint` (`/elsa/api/adl/clarify/resume`) | None (migrated) | Closed by 39-3, 39-6, 39-10, 39-13 |
| 11 | `CleanUpFailedTenantWorkflow` (`clean-up-failed-tenant`) | `tenantId`, `note` | Control-plane / DB cleanup side-effects | Saga step completion | N/A (platform saga) | **(d)** Platform tenant-cleanup saga (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 12 | `CodeReviewWorkflow` (`code-review`) | `RepositoryUrl`, `BranchName`, `BaseBranch`, `JuniorId`, `MaxIterations`, `ReviewerIds` | `ReviewResult` / `CodeReviewWorkflowResult` (`ReviewModels.cs:111,223` built by `BuildCodeReviewResultActivity`) + raw `analysisText` (`code-review`) + free-text `mentor-feedback` | `BuildCodeReviewResultActivity` + `MaxIterations` loop; raw LLM text not schema-validated | Bounded fix-wait loop (`WaitForFixesActivity`), **forked shape #3** | **(b)** Suspends on `WaitForFixesActivity` (`L370`) with no `*ResumeEndpoint.cs` in `Endpoints/`; in `LegacyResumeAllowlist` | `FORKED_REVIEW_SHAPE`, `UNTYPED_OUTPUT`, `NOT_RESUMABLE`, `BARE_FAILURE_ESCALATION` | 39-4 (`Review`), 39-7, 39-10, 41-17 |
| 13 | `ContextGatheringWorkflow` (`context-gathering`) | `repository`, `issueNumber`, `workItemJson`, `tenantId` | 5 free-text role scans (`context-scan`) + lenient PO summary (`summarize-stakeholder`) bundled as context JSON | Opportunistic JSON lift with raw-text fallback (`ExtractPO`); never fails closed | None | **(c)** No suspend/re-entry (`LegacyResumeAllowlist`) | `UNTYPED_OUTPUT`, `PARSE_OK_IS_ACCEPT`, `NOT_RESUMABLE` | Open question (intentional free-text bundle vs `Findings`, 39-15 D5 split) |
| 14 | `CreateIssuesWorkflow` (`create-issues`) | `repository`, `issuesJson`, `tenantId` | Platform issue creation side-effects (title-deduped per Story 40-8 D3) | Platform API create/dedupe result | N/A (mechanical side-effect) | **(d)** Idempotent platform-side dedupe (`LegacyResumeAllowlist`, awaiting 40-4 clause-c seam) | Out of scope (mechanical) | 40-8 (idempotent), 40-4 seam |
| 15 | `CreateTenantWorkflow` (`create-tenant`) | `tenantId`, `attempt` | Tenant role/schema/migration/envelope provisioning side-effects | Saga step success/failure | N/A (platform saga) | **(d)** Platform provisioning saga (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 16 | `DebugDiagnosisWorkflow` (`debug-diagnosis`) | `issueId`, `errorContext`, `codeContext`, `gitContext`, `reproductionContext`, `previousContext` | Typed `Diagnosis` (`DiagnosisDocumentType.Validate` via `document-lifecycle`) | Deterministic hypothesis/affectedFiles validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-4, 39-6, 39-10, 39-15 |
| 17 | `DebuggingWorkflow` (`debugging`) | `repositoryUrl`, `branchName`, `issueDescription`, `errorOutput`, `relevantFiles`, `priorDiagnosisDocumentId` | Consumes `debug-diagnosis` (`Diagnosis`) + applies code fix via `(developer, debug)` `llm-call` + runs `testing-pipeline` | Diagnosis via lifecycle; fix leg checks `llm-call` `success` flag + test pass | Diagnosis reviewed via lifecycle; code fix validated by tests | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | `Provisional` seed flag on `debugging` (code-fix leg is code, not a doc) | Closed for diagnosis by 39-15; code leg out of doc scope |
| 18 | `DeleteTenantWorkflow` (`delete-tenant`) | `tenantId`, `attempt` | Tenant teardown / schema drop side-effects | Saga step success/failure | N/A (platform saga) | **(d)** Platform deprovisioning saga (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 19 | `DeploymentPipelineWorkflow` (`deployment-pipeline`) | `repository`, `branchName`, `mergeSha`, `issueNumber`, `mode`, `requireProdApproval` | Deployment/rollback actions; `ParseStageStatus` (`L975`) fail-closed on explicit `status:"success"` | Fail-closed JSON `"status"` check + human production approval gate | N/A (deployment pipeline) | **(a)** Suspends on `WaitForDeploymentApprovalActivity`; resumed by `DeploymentApprovalResumeEndpoint` (`/elsa/api/adl/deploy-approval/resume` & `/locate`); still in `LegacyResumeAllowlist` (legacy bookmark builder) | `NOT_RESUMABLE` (non-canonical builder) | 39-10 follow-up (mechanical pipeline) |
| 20 | `DesignDeliveryWorkflow` (`design-proposal-delivery`) | `documentJson`, `issueId`, `issueNumber`, `repository`, `sessionId`, `tenantId` | Pre-accept design delivery side-effect (emits `GENERATED`/`DELIVERED`, posts design artifact) | Delivery side-effect completion | N/A (delivery leaf invoked by `document-lifecycle`) | **(d)** Stateless pre-accept delivery leaf (`LegacyResumeAllowlist`) | Out of scope (mechanical) | Closed by 39-13 |
| 21 | `DesignProposalWorkflow` (`design-proposal`) | `requirement`, `constraints`, `conventions`, `issueId`, `sessionId`, `acceptanceRulesJson` | Typed `Design` (`DesignDocumentType.Validate` via `document-lifecycle`, with `design-proposal-delivery` hook) | Deterministic alternatives/recommendation validator + lifecycle accept gate (`DocumentDecisionResumeEndpoint` + `DesignResumeEndpoint` compat) | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) + child accept bookmark | None (migrated) | Closed by 39-4, 39-6, 39-10, 39-13 |
| 22 | `DocumentLifecycleWorkflow` (`document-lifecycle`) | `documentType`, `agentRole`, `action`, `issueId`, `correlationId`, `acceptanceRulesJson`, `ambiguityScore`, `deliveryWorkflowDefinitionId` | Persisted `DocumentEnvelope` (any registered `DocumentTypeKey`) + `DOCUMENT.*`/`APPROVAL.*`/`ESCALATION.*` DCB events | `IDocumentType.Validate` → bounded repair → `document-review` → bounded revise → `WaitForDocumentDecisionActivity` accept gate + guardrails | **THE canonical review-with-notes + bounded revise loop** | **(a)** `[ResumeBehavior(Both, WaitForDocumentDecisionActivity)]`; resumed by `DocumentDecisionResumeEndpoint` (`/elsa/api/documents/decision/resume`) | None (canonical engine) | Closed by 39-6, 39-8, 39-10, 39-25 |
| 23 | `DocumentReviewWorkflow` (`document-review`) | `documentType`, `documentJson`, `subjectJson`, `issueId`, `correlationId`, `acceptanceRulesJson` | Unified `Review` outcome (routes to `review-single-reviewer` or `review-panel` per `ReviewerSelectionHelper`) | Aggregates child `Review` doc(s); blocking issues forbid approval | Invoked inside `DocumentLifecycleWorkflow` review stage | **(d)** Stateless router sub-workflow (`LegacyResumeAllowlist`) | None (unified router) | Closed by 39-7 |
| 24 | `HourlyAnalyticsRollupWorkflow` (`hourly-analytics-rollup`) | `hour` | `platform_analytics_hourly` + per-tenant `analytics_usage_hourly`/`_daily` rows | Activity completion per tenant (fault-tolerant fan-out) | N/A (scheduled rollup) | **(d)** Scheduled analytics rollup (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 25 | `IssueDecompositionWorkflow` (`issue-decomposition`) | `issueId`, `issueNumber`, `issueTitle`, `workItemJson`, `repository`, `acceptanceRulesJson` | Typed `Decomposition` (`DecompositionDocumentType.Validate` via `document-lifecycle`, preceded by `context-gathering`) | Deterministic unique-ID / acyclic-`dependsOn` / sizing validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-3, 39-6, 39-10, 39-12 |
| 26 | `IssueTriageWorkflow` (`issue-triage`) | `repository`, `tenantId` | Fetches untriaged items and dispatches `triage-item-cycle` per item | Per-item cycle outcome aggregation | Delegates per-item review to `TriagePODecisionWorkflow` lifecycle | **(c)** Outer loop in `LegacyResumeAllowlist` (child `triage-item-cycle` is re-entrant) | `NOT_RESUMABLE` | 39-15 (children migrated); outer loop 39-10 follow-up |
| 27 | `LlmCallWorkflow` (`llm-call`) | `agentRole`, `action`, `content`, `context`, `conventions`, `documentType`, `enableTools`, `InputJson` | Raw LLM text + tool-loop diagnostics + usage/cost events | Provider chain fallback (`LlmProviderChainHelper`) + tool-loop termination + 39-9 repair ring | N/A (infra leaf) | **(d)** Mediated infra leaf (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A (39-9 repair ring integrated) |
| 28 | `MentorshipWorkflow` (`mentorship`) | `tenantId`, `maxBasicRetries`, `maxDebugRetries` | Mentorship session progression; dispatches `assessment`, `context-gathering`, `tdd-cycle`, `testing-pipeline`, `debugging`, `blocker-diagnosis`, `code-review`, and free-text `(senior_developer, mentor-feedback)` (result discarded) | State-machine transitions across child mentorship sub-workflows | Delegates code review to `CodeReviewWorkflow` | **(c)** Long-lived orchestration composite in `LegacyResumeAllowlist` with no own canonical bookmark/re-entry | `UNTYPED_OUTPUT`, `NOT_RESUMABLE`, `BARE_FAILURE_ESCALATION` | Open question (mentorship prose); 39-10 |
| 29 | `MergeApprovalWorkflow` (`merge-approval`) | `repository`, `branchName`, `prNumber`, `prUrl`, `issueNumber`, `breakingChange` | Dispatches `ci-with-debug-retry` → `merge` → `update-issue-status` on approval | Human merge-approval bookmark decision | N/A (approval gate) | **(a)** Suspends on `WaitForMergeApprovalActivity`; resumed by `MergeApprovalResumeEndpoint` (`/elsa/api/adl/merge-approval/resume` & `/locate`); still in `LegacyResumeAllowlist` (legacy bookmark builder) | `NOT_RESUMABLE` (non-canonical builder) | 39-8 / 39-10 follow-up |
| 30 | `MergeWorkflow` (`merge`) | `repository`, `branchName`, `prNumber`, `issueNumber`, `mergeStrategy` | Git/platform PR merge side-effect | Platform merge API result | N/A (mechanical) | **(d)** Mechanical merge leaf (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 31 | `PanelReviewWorkflow` (`review-panel`) | `documentTypeKey`, `contentJson`, `subjectJson`, `panelDecisionRule`, `acceptanceRulesJson` | Aggregated unified `Review` (`ReviewPanelAggregation` + `ReviewProducerHelper`) from N `SingleReviewerWorkflow` runs | Policy rule (`unanimous`/`majority`/blocking-veto) over typed `Review` docs | Invoked inside `DocumentLifecycleWorkflow` review stage | **(d)** Stateless panel aggregator (`LegacyResumeAllowlist`) | None (unified panel) | Closed by 39-7 |
| 32 | `PlanGenerationWorkflow` (`plan-generation`) | `issueId`, `issueNumber`, `repository`, `poSummary`, `contextIds`, `reviewNotes`, accepted `Decomposition` | Typed `Plan` (`PlanDocumentType.Validate` via `document-lifecycle`) | Deterministic task/fileMap/dependency validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-4, 39-6, 39-10, 39-14 |
| 33 | `PlanReviewWorkflow` (`plan-review`) | `issueId`, `issueNumber`, `repository`, `planJson`, `contextIds`, `workItemJson` | Zero-LLM read-through shim (`FetchLatestAcceptedDocumentActivity`) projecting accepted `Plan` + lineage to legacy output shape (`decision`/`planJson`/`discussionLog`) | Store lookup: accepted `plan` found → `"approved"`, else `"needsHuman"` | Retired bespoke 3-phase debate; review now lives in `PlanGenerationWorkflow` lifecycle | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated shim) | Closed by 39-7, 39-14 |
| 34 | `PullRequestWorkflow` (`pull-request`) | `repository`, `branchName`, `baseBranch`, `issueNumber`, `issueTitle`, `planJson`, `changeSummaryJson`, `draft` | GitHub/GitLab/Gitea PR creation side-effect + free-text PR body (`tech_writer`/`summarize-changes`, deterministic fallback if empty) | PR API create result (free-text description never fails closed) | N/A (mechanical + prose) | **(d)** Mechanical PR side-effect leaf (`LegacyResumeAllowlist`) | Out of scope (mechanical / prose) | N/A |
| 35 | `ResearchWorkflow` (`research`) | `issueId`, `issueNumber`, `topic`, `workItemJson`, `repository`, `sessionId`, `acceptanceRulesJson` | Typed `Findings` (`FindingsDocumentType.Validate` via `document-lifecycle`, preceded by `context-gathering`) | Deterministic citations/relevance/confidence validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-3, 39-6, 39-10, 39-13 |
| 36 | `ReviewFixWorkflow` (`review-fix`) | `repository`, `branchName`, `issueNumber`, `prNumber`, `tenantId` | Code patches via `(developer, address-review-comments)` + `ApplyReviewFixesActivity` | `ExtractGenerateSuccess` checks `llm-call` `success` flag only; code validated downstream by CI | Applies external PR review comments (not a document producer) | **(c)** No suspend/re-entry (`LegacyResumeAllowlist`) | `NOT_RESUMABLE` | Code leg out of doc scope; 40-4 / 39-10 |
| 37 | `RotateSecretWorkflow` (`rotate-secret`) | `secretId`, `newPlaintext`, `generateLength`, `graceWindowSeconds`, `operatorUserId` | Secret version rotation + grace-window retirement side-effects | Step completion | N/A (platform saga) | **(d)** Platform secret-rotation saga (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |
| 38 | `SingleIssueCycleWorkflow` (`single-issue-cycle`) | `repository`, `baseBranch`, `issueNumber`, `workItemJson`, `mode`, `requireProdApproval`, `botAssignee` | End-to-end issue delivery orchestration (dispatches 17 sub-workflows across research → design → plan → task → test → coding → PR → merge → deploy) | Step-by-step sub-workflow outcome switches + CI/PR/agent-run completion gates | Delegates document reviews to child lifecycle workflows; code review via `code-review` | **(a)** `[ResumeBehavior(Both, WaitForAgentRunActivity)]` + `ComputeTaskResumeIndexActivity` (Story 40-4/40-5) + `WaitForPRMergedActivity` (`PrMergedResumeEndpoint`, `/elsa/api/adl/pr-merged/resume`) + `AgentRunResumeEndpoint` (`/elsa/api/agent-runs/resume`) | Residual legacy calls to `task-review` & `code-review` | 40-2/40-3/40-4/40-5 closed cycle resumability; 39-15+/41-17 for review children |
| 39 | `SingleReviewerWorkflow` (`review-single-reviewer`) | `documentTypeKey`, `subjectJson`, `reviewerRole`, `reviewerAction`, `issueId`, `correlationId`, `acceptanceRulesJson` | Typed `Review` (`ReviewDocumentType.Validate` + `ReviewProducerHelper`) | Strict typed `Review` validation (blocking issues forbid approve) | Invoked inside `DocumentLifecycleWorkflow` / `PanelReviewWorkflow` | **(d)** Stateless single-reviewer producer (`LegacyResumeAllowlist`) | None (unified producer) | Closed by 39-4, 39-7 |
| 40 | `TaskCreationWorkflow` (`task-creation`) | `issueId`, `issueNumber`, `planJson`, `contextIds`, `workItemJson`, accepted `Plan` | Typed task-breakdown `Plan` (`PlanDocumentType.Validate` via `document-lifecycle`) | Deterministic task/fileMap validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-4, 39-6, 39-10, 39-15 |
| 41 | `TaskReviewWorkflow` (`task-review`) | `repository`, `issueNumber`, `planJson`, `tasksJson`, `tenantId` | **Legacy inline JSON** (`{approved, reviews[], notes[]}`) from 4-role `llm-call` panel (`architect`/`senior_developer` `plan-review`, `developer` `review-feasibility`, `tester` `review-testability`) | Inline `TryGetProperty("verdict")` (`L148-183`), pessimistic `"concerns"` default + raw-text fallback wrapper (`L376`); unanimous `"approve"` required | One-shot 4-role panel, **no revise loop**, **forked shape #1** | **(c)** No suspend/re-entry (`LegacyResumeAllowlist`) | `UNTYPED_OUTPUT`, `PARSE_OK_IS_ACCEPT`, `NO_REVISE_LOOP`, `FORKED_REVIEW_SHAPE`, `NOT_RESUMABLE`, `BARE_FAILURE_ESCALATION` | 39-4, 39-7, 39-14/15 follow-up (convert to read-through shim like `PlanReviewWorkflow`) |
| 42 | `TddWithDebugRetryWorkflow` (`tdd-with-debug-retry`) | `repositoryUrl`, `branchName`, `storyId`, `issueNumber`, `planJson`, `maxRetries` | Dispatches `tdd-cycle` ↔ `debugging` bounded retry loop | Test pass/fail across `maxRetries` | Code retry loop (not document review) | **(c)** No own suspend/re-entry (`LegacyResumeAllowlist`) | `NOT_RESUMABLE` | 40-4 / 39-10 follow-up |
| 43 | `TddWorkflow` (`tdd-cycle`) | `repositoryUrl`, `branchName`, `storyId`, `sessionId`, `taskDescription`, `skillLevel` | Red-green-refactor code changes + `testing-pipeline` execution | Test pass/fail | N/A (code execution) | **(c)** Composite in `LegacyResumeAllowlist` | Out of scope (code); `NOT_RESUMABLE` | 40-4 |
| 44 | `TestCaseCreationWorkflow` (`test-case-creation`) | `issueId`, `issueNumber`, `branchName`, `tasksJson`, `contextIds`, accepted `Plan` | Typed `TestSpec` (`TestSpecDocumentType.Validate` + cross-doc task-ID ring via `document-lifecycle`) | Deterministic task-ID binding + one-behavior-per-case validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-4, 39-6, 39-10, 39-15 |
| 45 | `TestingWorkflow` (`testing-pipeline`) | `Repository`, `Branch`, `SessionId`, `SkillLevel`, `maxRetries`, `tenantId` | CI trigger + wait + code fix via `(developer, implement-fix)` | CI result + `llm-call` `success` flag | Bounded CI-fix loop (code, not doc) | **(a)** Suspends on `WaitForCIResultsActivity` (`L185,426`); resumed by `CiWaitEndpoints` (`/elsa/api/ci/waits` & `/elsa/api/ci/waits/resume` via `CiCompletionPollerService`); in `LegacyResumeAllowlist` (non-canonical builder) | Out of scope (code) | Epic 31 P3 closed CI wait resume |
| 46 | `TriageContextGatheringWorkflow` (`triage-context-gathering`) | `issueId`, `itemJson`, `repository`, `tenantId`, `acceptanceRulesJson` | Typed `Findings` (`FindingsDocumentType.Validate` via `document-lifecycle` on split `(developer, triage-context-scan)` cell) | Deterministic citations/relevance/confidence validator + lifecycle accept gate | Unified 39-6/39-7 review + bounded revise loop | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-3, 39-6, 39-10, 39-15 |
| 47 | `TriageItemCycleWorkflow` (`triage-item-cycle`) | `itemJson`, `repository`, `tenantId` | Dispatches `triage-context-gathering` → `triage-po-decision` → applies triage labels/metadata (idempotency-gated) | `TriagePoDecisionHelper` (`ok`/`unparsed`/`llm-failed`/`skipped`) + `TriageItemCycleHelper` apply-fault guard | Delegates review to `TriagePODecisionWorkflow` lifecycle (4-role panel retired `TriagePanelReviewWorkflow`) | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity` on item's `triage-decision`) | None (migrated) | Closed by 39-10, 39-15 |
| 48 | `TriagePODecisionWorkflow` (`triage-po-decision`) | `issueId`, `itemJson`, `contextJson`, `findingsDocumentId`, `repository`, `acceptanceRulesJson`, accepted `Findings` | Typed `TriageDecision` (`TriageDecisionDocumentType.Validate` via `document-lifecycle`) | Deterministic closed-enum (`priority`/`type`/`complexity`/`automation`/`reasoning`) validator + lifecycle accept gate | Unified 39-6/39-7 4-role panel review + bounded revise loop (replaced deleted `TriagePanelReviewWorkflow`) | **(a)** `[ResumeBehavior(LatestStateReEntry)]` (`ComputeReEntryPositionActivity`) | None (migrated) | Closed by 39-4, 39-6, 39-7, 39-10, 39-15 |
| 49 | `UpdateIssueStatusWorkflow` (`update-issue-status`) | `repository`, `issueNumber`, `targetStatus`, `addLabels`, `removeLabels`, `message`, `prNumber`, `prUrl` | Issue label/comment/status mutation side-effects | Platform API mutation result | N/A (mechanical) | **(d)** Stateless side-effect leaf (`LegacyResumeAllowlist`) | Out of scope (mechanical) | N/A |

---

## 🔬 Per-Family Evidence & File/Line Pointers

### 1. The Three Forked Review/Verdict Shapes (AC4)

| Fork | Status on `main` | Exact File/Line Evidence | Shape & Failure Behavior |
|---|---|---|---|
| **Shape 1 — Legacy string verdict** | **STILL LIVE** in `TaskReviewWorkflow` | `apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/TaskReviewWorkflow.cs:148-183` (inline `TryGetProperty("verdict")`), `:376` (fallback wrapper) | Expects `{"verdict":"approve"\|"concerns","comments":"...","suggestedChanges":"..."}`. Parse failure or missing `"verdict"` silently defaults to pessimistic `"concerns"`, wrapping raw output as `{"verdict":"concerns","comments":output,"suggestedChanges":""}`. One-shot 4-role panel with **no revision loop**. |
| **Shape 2 — PlanReview object verdict** | **RETIRED** (Story 39-14) | Replaced by `PlanReviewWorkflow.cs:16-36` (zero-LLM read-through shim), unified `Tamma.Core/Documents/Types/ReviewDocumentType.cs`, and `Workflows/Helpers/ReviewPanelAggregation.cs` | Previously parsed `{"verdict":{"decision":"APPROVE"\|"REQUEST_CHANGES"\|"NEEDS_DISCUSSION"}}` with a bespoke 3-phase debate (7 reviews + 7 rebuttals + PO decision). Now runs inside `DocumentLifecycleWorkflow` via `DocumentReviewWorkflow` → `PanelReviewWorkflow` → `SingleReviewerWorkflow`. |
| **Shape 3 — Code-review result** | **STILL LIVE** in `CodeReviewWorkflow` | `apps/tamma-elsa/src/Tamma.Activities/Review/Models/ReviewModels.cs:111` (`ReviewResult`), `:223` (`CodeReviewWorkflowResult`); `CodeReviewWorkflow.cs:296-375` | Dispatches free-text `(senior_developer, code-review)` (`StoreAnalysis` keeps raw text) → `(senior_developer, mentor-feedback)`, then builds `CodeReviewWorkflowResult` and suspends on `WaitForFixesActivity` (`L370`) with no dedicated `*ResumeEndpoint.cs`. |

### 2. Migrated Typed-Document Bindings (15 Non-Provisional Workflows)
All 15 migrated bindings follow the same verified architecture:
- Declare `[ResumeBehavior(ResumeMode.LatestStateReEntry)]` (or `Both` for `ClarifyingQuestionsWorkflow` with `WaitForDocumentInputActivity`) and wire `ComputeReEntryPositionActivity` at workflow entry (verified by `ResumableStandardStructuralTests.EveryReEntryWorkflow_HasAComputeReEntryNode`).
- Dispatch `DocumentLifecycleWorkflow` (`DefinitionId = "document-lifecycle"`) with explicit `(producerRole, producerAction)` inputs (verified by `TaxonomyDriftBuildTests.EnumerateAllDispatchPairs()` via the 39-12 D5 lifecycle-binding walk).
- Validate outputs deterministically via `DocumentTypeRegistry` (`*DocumentType.Validate`), with every required JSON token pinned in `ContractBindingTests.Bindings` (19/19 tests green).
- **Retirements already completed**: `TriagePanelReviewWorkflow` was deleted in Story 39-15 (4-role panel moved into lifecycle `REVIEW` stage); `PlanReviewWorkflow`'s 15 `llm-call` dispatches were replaced by a pure store read-through shim in Story 39-14; `AIDiagnosisActivity`'s hand-parser was replaced by `DebugDiagnosisWorkflow` (`DiagnosisDocumentType.Validate`) in Story 39-15.

### 3. Remaining Legacy Producers & Ugly Truths (AC3)
- **`TaskReviewWorkflow.cs:148-183,376`**: Still uses 4 inline `llm-call` dispatches classified under `ContractBindingTests.IntentionallyUnbound` (`architect/plan-review`, `senior_developer/plan-review`, `developer/review-feasibility`, `tester/review-testability`) because its parser degrades silently to `"concerns"`. Should follow `PlanReviewWorkflow`'s Story 39-14 shim pattern (since `TaskCreationWorkflow` already produces a lifecycle-reviewed `Plan`!).
- **`AssessmentWorkflow.cs:196,342`**: Uses inline fail-closed parsers `ParseQuestionsResult` (bare JSON array or `{"questions":[...]}`) and `ParseAnalysisResult` (fail-closed on missing/non-numeric `"confidence"`, ignores model `"status"` and recomputes via `ClassifyResultActivity`). Suspends on `WaitForResponseActivity` (`L281`) with no mapped `*ResumeEndpoint.cs`.
- **`BlockerDiagnosisWorkflow.cs` + `ClassifyBlockerActivity.cs:78,100`**: `ParseAIDiagnosis` treats every JSON field (`blocker_type`, `confidence`, `root_cause`) as optional and silently falls back to heuristic signal classification (never fails closed). Resumes via `BlockerResumeEndpoint` on two legacy bookmark families (`DetectProgressActivity.ProgressBookmarkName`, `EscalateToSeniorActivity.EscalationBookmarkName`).
- **`TriagePoDecisionHelper.cs`**: Documents the historical laundered-failure bug where unparsed/failed LLM replies were previously coerced into low-priority triage decisions; enforces the explicit `ok | unparsed | llm-failed | skipped` status vocabulary in `TriageItemCycleWorkflow`.
- **`DeploymentPipelineWorkflow.cs:951,975,1045`**: `ParseStageStatus` is fail-closed on explicit `"status":"success"` for both `(devops, deploy)` and `(devops, rollback)` (bound in `ContractBindingTests.Bindings`).

---

## 🔁 Resumability Baseline: All 10 Resume Endpoints (AC5)

Mapped in `apps/tamma-elsa/src/Tamma.ElsaServer/Program.cs:578-698` (all behind `.RequireAuthorization()` engine-internal hop):

| # | Endpoint File | Engine Route(s) | Bookmark / Stimulus Builder | Owning Workflow(s) |
|---|---|---|---|---|
| 1 | `DocumentDecisionResumeEndpoint.cs` | `POST /elsa/api/documents/decision/resume` | `WaitForDocumentDecisionActivity.DecisionBookmarkName` (`document-decision-{tenant}-{session}`) | `DocumentLifecycleWorkflow` (and all 15 lifecycle bindings) |
| 2 | `DocumentInputResumeEndpoint.cs` | `POST /elsa/api/documents/input/resume` | `WaitForDocumentInputActivity.InputBookmarkName` (`document-input-{tenant}-{session}`) | `ClarifyingQuestionsWorkflow` |
| 3 | `ClarifyResumeEndpoint.cs` | `POST /elsa/api/adl/clarify/resume` | Adapter → `WaitForDocumentInputActivity.InputBookmarkName` | `ClarifyingQuestionsWorkflow` (legacy URL compat) |
| 4 | `DesignResumeEndpoint.cs` | `POST /elsa/api/adl/design/resume` | Adapter → `LifecycleBookmarks.ForDecisionSession` | `DesignProposalWorkflow` (legacy URL compat) |
| 5 | `AgentRunResumeEndpoint.cs` | `POST /elsa/api/agent-runs/resume` | `LifecycleBookmarks.ForAgentRun` | `SingleIssueCycleWorkflow` (`WaitForAgentRunActivity`) |
| 6 | `PrMergedResumeEndpoint.cs` | `POST /elsa/api/adl/pr-merged/resume` | `WaitForPRMergedActivity.BookmarkName` (+ `LegacyBookmarkName`) | `SingleIssueCycleWorkflow` (`WaitForPRMergedActivity`) |
| 7 | `CiWaitEndpoints.cs` | `GET /elsa/api/ci/waits`, `POST /elsa/api/ci/waits/resume` | `WaitForCIResultsActivity.CiWaitStimulusName` (`ci-result-wait`) | `TestingWorkflow` (`WaitForCIResultsActivity`) |
| 8 | `MergeApprovalResumeEndpoint.cs` | `POST /elsa/api/adl/merge-approval/resume`, `/locate` | `WaitForMergeApprovalActivity.BookmarkName` | `MergeApprovalWorkflow` |
| 9 | `DeploymentApprovalResumeEndpoint.cs` | `POST /elsa/api/adl/deploy-approval/resume`, `/locate` | `WaitForDeploymentApprovalActivity.BookmarkName` | `DeploymentPipelineWorkflow` |
| 10 | `BlockerResumeEndpoint.cs` | `POST /elsa/api/adl/blocker/resume` | `DetectProgressActivity.ProgressBookmarkName`, `EscalateToSeniorActivity.EscalationBookmarkName` | `BlockerDiagnosisWorkflow` |

**Unexercised / Missing Resume Seams (Class (b)):**
- `AssessmentWorkflow` (`WaitForResponseActivity`) — no `*ResumeEndpoint.cs` maps it.
- `CodeReviewWorkflow` (`WaitForFixesActivity`) — no `*ResumeEndpoint.cs` maps it.

**Structural Gate Accounting (`ResumableStandardStructuralTests`):**
- **19 workflows declaring `[ResumeBehavior]`**: `AcceptanceCriteriaAuthoringWorkflow`, `AdrAuthoringWorkflow`, `AmbiguityScoringWorkflow`, `BacklogPrioritizationWorkflow`, `ClarifyingQuestionsWorkflow` (`Both`), `DebugDiagnosisWorkflow`, `DebuggingWorkflow`, `DesignProposalWorkflow`, `DocumentLifecycleWorkflow` (`Both`), `IssueDecompositionWorkflow`, `PlanGenerationWorkflow`, `PlanReviewWorkflow`, `ResearchWorkflow`, `SingleIssueCycleWorkflow` (`Both`), `TaskCreationWorkflow`, `TestCaseCreationWorkflow`, `TriageContextGatheringWorkflow`, `TriageItemCycleWorkflow`, `TriagePODecisionWorkflow`.
- **30 workflows in `LegacyResumeAllowlist`**: **19 + 30 = 49** (exact partition, zero stale entries).

---

## ✅ Document-Type Coverage Check (AC7)

Cross-checking the Epic 39 README's **10 original types** plus the **7 Epic 41 types** (all **17** registered in `Tamma.Core/Documents/DocumentTypeRegistry.cs:27-54`):

| # | DocumentTypeKey (`wire`) | Registered By | Live Producer Workflow(s) | Status |
|---|---|---|---|---|
| 1 | `Findings` (`findings`) | 39-3 | `ResearchWorkflow`, `TriageContextGatheringWorkflow` | **Covered (migrated)** |
| 2 | `AmbiguityAssessment` (`ambiguity-assessment`) | 39-3 | `AmbiguityScoringWorkflow` | **Covered (migrated)** |
| 3 | `Clarification` (`clarification`) | 39-3 | `ClarifyingQuestionsWorkflow` (Run A + Run B) | **Covered (migrated)** |
| 4 | `Decomposition` (`decomposition`) | 39-3 | `IssueDecompositionWorkflow` | **Covered (migrated)** |
| 5 | `Plan` (`plan`) | 39-4 | `PlanGenerationWorkflow`, `TaskCreationWorkflow` | **Covered (migrated)** |
| 6 | `Design` (`design`) | 39-4 | `DesignProposalWorkflow` | **Covered (migrated)** |
| 7 | `Review` (`review`) | 39-4 | `SingleReviewerWorkflow`, `PanelReviewWorkflow` (via `DocumentReviewWorkflow`) | **Covered for docs**; **2 legacy forks remain** (`TaskReviewWorkflow`, `CodeReviewWorkflow`) |
| 8 | `TriageDecision` (`triage-decision`) | 39-4 | `TriagePODecisionWorkflow` | **Covered (migrated)** |
| 9 | `Diagnosis` (`diagnosis`) | 39-4 | `DebugDiagnosisWorkflow` | **Covered for debugging**; **`BlockerDiagnosisWorkflow` still legacy** |
| 10 | `TestSpec` (`test-spec`) | 39-4 | `TestCaseCreationWorkflow` | **Covered (migrated)** |
| 11 | `AcceptanceCriteria` (`acceptance-criteria`) | 41-1b | `AcceptanceCriteriaAuthoringWorkflow` | **Covered (migrated, Story 41-2)** |
| 12 | `BacklogOrdering` (`backlog-ordering`) | 41-1b | `BacklogPrioritizationWorkflow` | **Covered (migrated, Story 41-3)** |
| 13 | `SprintPlan` (`sprint-plan`) | 41-1b | *(pending Story 41-6)* | Registered, producer pending (`PendingProducerCells`) |
| 14 | `TestPlan` (`test-plan`) | 41-1b | *(pending Story 41-13)* | Registered, producer pending (`PendingProducerCells`) |
| 15 | `ThreatModel` (`threat-model`) | 41-1b | *(pending Story 41-19)* | Registered, producer pending (`PendingProducerCells`) |
| 16 | `UxSpec` (`ux-spec`) | 41-1b | *(pending Story 41-27)* | Registered, producer pending (`PendingProducerCells`) |
| 17 | `Prose` (`prose`) | 41-1c | `AdrAuthoringWorkflow` (`kind=adr`) | **Covered for ADR (41-9)**; other prose kinds pending 41-4/5/8/22/24/25/26 |

### Explicitly Out of Document Scope ("Code is NOT a document type" / "Prose stays prose" / Mechanical)
- **Code execution & fix workflows**: `TddWorkflow`, `TddWithDebugRetryWorkflow`, `TestingWorkflow`, `CiWithDebugRetryWorkflow`, `ReviewFixWorkflow`, `DebuggingWorkflow` (code-apply leg).
- **Mechanical git / platform / infra / saga workflows**: `BranchCreationWorkflow`, `MergeWorkflow`, `MergeApprovalWorkflow`, `PullRequestWorkflow` (PR body prose), `DeploymentPipelineWorkflow`, `CreateIssuesWorkflow`, `UpdateIssueStatusWorkflow`, `CreateTenantWorkflow`, `DeleteTenantWorkflow`, `CleanUpFailedTenantWorkflow`, `RotateSecretWorkflow`, `HourlyAnalyticsRollupWorkflow`, `LlmCallWorkflow`, `DesignDeliveryWorkflow`.
- **Composite orchestrators & routers**: `AdlOrchestratorWorkflow`, `SingleIssueCycleWorkflow`, `IssueTriageWorkflow`, `TriageItemCycleWorkflow`, `DocumentLifecycleWorkflow`, `DocumentReviewWorkflow`.

### Flagged Open Questions (AC7 — Never Quietly Dropped)
1. **`AssessmentWorkflow`** (`generate-assessment-questions` + `analyze-assessment-response`): Produces junior-comprehension Q&A and confidence/gaps/strengths JSON. Does not fit any of the 17 registered `DocumentTypeKey` values — decide whether mentorship assessment gets a dedicated type or stays mentorship-internal.
2. **`MentorshipWorkflow`** (`mentor-feedback`): Free-text mentoring guidance whose `llm-call` reply is currently discarded in `MentorshipWorkflow` (or posted verbatim in `CodeReviewWorkflow`/`BlockerDiagnosisWorkflow`). Fits the "Prose stays prose" principle; confirm no structured schema is desired.
3. **`ContextGatheringWorkflow`** (`context-scan` × 5 + `summarize-stakeholder`): Intentionally kept as a free-text context bundle after Story 39-15 D5 split `(developer, triage-context-scan)` onto `Findings`. Confirm whether `SingleIssueCycleWorkflow`'s context-gathering stage should remain free-text or migrate to `Findings`.
4. **`TaskReviewWorkflow`** (Shape 1) & **`CodeReviewWorkflow`** (Shape 3) & **`BlockerDiagnosisWorkflow`**: Still listed as `Provisional = true` in `DocumentTypeRegistry.WorkflowInterfaces` — schedule final retirement (`TaskReviewWorkflow` → read-through shim like `PlanReviewWorkflow`; `CodeReviewWorkflow` → unified `Review` via Story 41-17; `BlockerDiagnosisWorkflow` → `Diagnosis` lifecycle binding).

---

## 🔗 Verified Consumer-Edge List (AC8)

### A. Typed Document Store Edges (`DocumentTypeRegistry.WorkflowInterfaces` — 19 Entries)

| Producer (`DefinitionId`) | Document Type | Provisional? | Consumed By |
|---|---|---|---|
| `research` | `Findings` | No (39-13) | `SingleIssueCycleWorkflow`, `acceptance-criteria-authoring`, `adr-authoring`, `backlog-prioritization` |
| `triage-context-gathering` | `Findings` | No (39-15) | `triage-po-decision`, `TriageItemCycleWorkflow` |
| `ambiguity-scoring` | `AmbiguityAssessment` | No (39-13) | `SingleIssueCycleWorkflow` (gates `clarifying-questions` / 39-25 escalation) |
| `clarifying-questions` | `Clarification` | No (39-13) | `acceptance-criteria-authoring`, `SingleIssueCycleWorkflow` |
| `issue-decomposition` | `Decomposition` | No (39-12) | `plan-generation`, `SingleIssueCycleWorkflow` (`create-issues`) |
| `plan-generation` | `Plan` | No (39-14) | `plan-review` (read-through shim), `task-creation`, `SingleIssueCycleWorkflow` |
| `task-creation` | `Plan` (task breakdown) | No (39-15) | `test-case-creation`, `task-review` (legacy), `SingleIssueCycleWorkflow` |
| `design-proposal` | `Design` | No (39-13) | `adr-authoring`, `DesignDeliveryWorkflow`, `SingleIssueCycleWorkflow` |
| `plan-review` | *(none — reader)* | No (39-14) | Consumes `Plan`; projects legacy review output to `SingleIssueCycleWorkflow` |
| `triage-po-decision` | `TriageDecision` | No (39-15) | `TriageItemCycleWorkflow` (applies labels/priority), `backlog-prioritization` |
| `debug-diagnosis` | `Diagnosis` | No (39-15) | `DebuggingWorkflow` (consumes ranked hypotheses/affectedFiles for fix leg) |
| `test-case-creation` | `TestSpec` | No (39-15) | `SingleIssueCycleWorkflow` (feeds coding/TDD stage) |
| `acceptance-criteria-authoring` | `AcceptanceCriteria` | No (41-2) | Story 41-15 (acceptance verification) & merge gate *(terminal today)* |
| `adr-authoring` | `Prose` (`kind=adr`) | No (41-9) | Document store / engineering consumers *(terminal output)* |
| `backlog-prioritization` | `BacklogOrdering` | No (41-3) | Story 41-6 (sprint planning) & Story 41-4 (roadmap) *(terminal today)* |
| `task-review` | `Review` (legacy Shape 1) | **Yes** | `SingleIssueCycleWorkflow` |
| `code-review` | `Review` (legacy Shape 3) | **Yes** | `SingleIssueCycleWorkflow`, `MentorshipWorkflow` |
| `blocker-diagnosis` | `Diagnosis` (legacy) | **Yes** | `MentorshipWorkflow` |
| `debugging` | `Diagnosis` (delegates to `debug-diagnosis`) | **Yes** | `CiWithDebugRetryWorkflow`, `TddWithDebugRetryWorkflow`, `MentorshipWorkflow` |

### B. Orchestrator Sub-Workflow Dispatch Graph
- `AdlOrchestratorWorkflow` → `SingleIssueCycleWorkflow`
- `SingleIssueCycleWorkflow` → `context-gathering`, `research`, `design-proposal`, `plan-generation`, `plan-review`, `task-creation`, `task-review`, `test-case-creation`, `branch-creation`, `tdd-with-debug-retry`, `ci-with-debug-retry`, `code-review`, `pull-request`, `merge-approval`, `deployment-pipeline`, `create-issues`, `update-issue-status`
- `IssueTriageWorkflow` → `TriageItemCycleWorkflow` → `triage-context-gathering`, `triage-po-decision`
- `MentorshipWorkflow` → `assessment`, `context-gathering`, `tdd-cycle`, `testing-pipeline`, `debugging`, `blocker-diagnosis`, `code-review`, `llm-call`
- `MergeApprovalWorkflow` → `ci-with-debug-retry`, `merge`, `update-issue-status`
- `CiWithDebugRetryWorkflow` → `testing-pipeline`, `debugging`
- `TddWithDebugRetryWorkflow` → `tdd-cycle`, `debugging`
- `TddWorkflow` → `testing-pipeline`
- `DebuggingWorkflow` → `debug-diagnosis`, `testing-pipeline`, `llm-call`
- `DocumentLifecycleWorkflow` → `llm-call`, `document-review` (`review-single-reviewer` | `review-panel`), optional delivery workflow (`design-proposal-delivery`)

---

## ✅ Action Items (Remaining Post-39-15 Burn-Down)

1. **Retire `TaskReviewWorkflow` (Shape 1 fork)** — Convert to a zero-LLM read-through shim mirroring `PlanReviewWorkflow` (Story 39-14), since `TaskCreationWorkflow` already produces a lifecycle-reviewed `Plan`. Flip `task-review` non-provisional and delete the 4 remaining `IntentionallyUnbound` panel entries.
2. **Migrate `CodeReviewWorkflow` (Shape 3 fork)** — Align onto unified `Review` (Story 41-17) and add a canonical resume seam for `WaitForFixesActivity` (or retire the unexercised bookmark).
3. **Migrate `BlockerDiagnosisWorkflow` diagnosis leg** — Bind onto `Diagnosis` via `DocumentLifecycleWorkflow` (mirroring `DebugDiagnosisWorkflow`) and reconcile `BlockerResumeEndpoint` with `LifecycleBookmarks`.
4. **Resolve `AssessmentWorkflow` open question** — Either register an assessment document type + wire a resume endpoint for `WaitForResponseActivity`, or explicitly scope mentorship assessment outside Epic 39.

---

## 📎 Appendix A: Reconciled `ls` Inventory (`7cf99de24179cb53da43d1b9bbb4daa020df39a7`)

`find apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/ -maxdepth 1 -name "*Workflow.cs" | sort | wc -l` = **49** (`58` total `.cs` files minus `9` excluded non-workflows):

1. `AcceptanceCriteriaAuthoringWorkflow.cs`
2. `AdlOrchestratorWorkflow.cs`
3. `AdrAuthoringWorkflow.cs`
4. `AmbiguityScoringWorkflow.cs`
5. `AssessmentWorkflow.cs`
6. `BacklogPrioritizationWorkflow.cs`
7. `BlockerDiagnosisWorkflow.cs`
8. `BranchCreationWorkflow.cs`
9. `CiWithDebugRetryWorkflow.cs`
10. `ClarifyingQuestionsWorkflow.cs`
11. `CleanUpFailedTenantWorkflow.cs`
12. `CodeReviewWorkflow.cs`
13. `ContextGatheringWorkflow.cs`
14. `CreateIssuesWorkflow.cs`
15. `CreateTenantWorkflow.cs`
16. `DebugDiagnosisWorkflow.cs`
17. `DebuggingWorkflow.cs`
18. `DeleteTenantWorkflow.cs`
19. `DeploymentPipelineWorkflow.cs`
20. `DesignDeliveryWorkflow.cs`
21. `DesignProposalWorkflow.cs`
22. `DocumentLifecycleWorkflow.cs`
23. `DocumentReviewWorkflow.cs`
24. `HourlyAnalyticsRollupWorkflow.cs`
25. `IssueDecompositionWorkflow.cs`
26. `IssueTriageWorkflow.cs`
27. `LlmCallWorkflow.cs`
28. `MentorshipWorkflow.cs`
29. `MergeApprovalWorkflow.cs`
30. `MergeWorkflow.cs`
31. `PanelReviewWorkflow.cs`
32. `PlanGenerationWorkflow.cs`
33. `PlanReviewWorkflow.cs`
34. `PullRequestWorkflow.cs`
35. `ResearchWorkflow.cs`
36. `ReviewFixWorkflow.cs`
37. `RotateSecretWorkflow.cs`
38. `SingleIssueCycleWorkflow.cs`
39. `SingleReviewerWorkflow.cs`
40. `TaskCreationWorkflow.cs`
41. `TaskReviewWorkflow.cs`
42. `TddWithDebugRetryWorkflow.cs`
43. `TddWorkflow.cs`
44. `TestCaseCreationWorkflow.cs`
45. `TestingWorkflow.cs`
46. `TriageContextGatheringWorkflow.cs`
47. `TriageItemCycleWorkflow.cs`
48. `TriagePODecisionWorkflow.cs`
49. `UpdateIssueStatusWorkflow.cs`

---

## 📎 Appendix B: Reflection Dispatch-Pair Seed (`TaxonomyDriftBuildTests.EnumerateAllDispatchPairs`)

Captured directly from `TaxonomyDriftBuildTests.EnumerateAllDispatchPairs()` at commit `7cf99de24179cb53da43d1b9bbb4daa020df39a7` (**42** concrete pairs across **22** workflows, plus **4** data-driven dispatches justified in `ContractBindingTests.DataDrivenDispatchJustifications`: `DocumentLifecycleWorkflow.{DispatchProduce,DispatchRepair,DispatchRevise}` and `SingleReviewerWorkflow.DispatchReviewerCall`):

```text
TOTAL_PAIRS=42
AcceptanceCriteriaAuthoringWorkflow | DispatchLifecycle | product_owner | define-acceptance-criteria
AdrAuthoringWorkflow | DispatchLifecycle | architect | write-adr
AmbiguityScoringWorkflow | DispatchLifecycle | product_owner | score-ambiguity
AssessmentWorkflow | AnalyzeResponseLlm | product_owner | analyze-assessment-response
AssessmentWorkflow | GenerateQuestionsLlm | product_owner | generate-assessment-questions
BacklogPrioritizationWorkflow | DispatchLifecycle | product_owner | prioritize-backlog
BlockerDiagnosisWorkflow | AIDiagnosis | senior_developer | resolve-blocker
BlockerDiagnosisWorkflow | AssistanceLlmCall | developer | implement-fix
BlockerDiagnosisWorkflow | GuidanceLlmCall | senior_developer | mentor-feedback
BlockerDiagnosisWorkflow | HintLlmCall | senior_developer | mentor-feedback
ClarifyingQuestionsWorkflow | DispatchRunA | product_owner | clarify-requirements
ClarifyingQuestionsWorkflow | DispatchRunB | product_owner | incorporate-answers
CodeReviewWorkflow | AnalyzeChanges | senior_developer | code-review
CodeReviewWorkflow | GenerateGuidance | senior_developer | mentor-feedback
ContextGatheringWorkflow | ArchScan | architect | context-scan
ContextGatheringWorkflow | DevOpsScan | devops | context-scan
ContextGatheringWorkflow | DevScan | developer | context-scan
ContextGatheringWorkflow | POReview | product_owner | summarize-stakeholder
ContextGatheringWorkflow | QAScan | tester | context-scan
ContextGatheringWorkflow | SecurityScan | security | context-scan
DebugDiagnosisWorkflow | DispatchLifecycle | senior_developer | debug-rootcause
DebuggingWorkflow | applyFix | developer | debug
DeploymentPipelineWorkflow | ProdDeploy | devops | deploy
DeploymentPipelineWorkflow | QADeploy | devops | deploy
DeploymentPipelineWorkflow | RollbackProd | devops | rollback
DeploymentPipelineWorkflow | UATDeploy | devops | deploy
DesignProposalWorkflow | DispatchLifecycle | architect | propose-design
IssueDecompositionWorkflow | DispatchLifecycle | senior_developer | decompose-issue
MentorshipWorkflow | DispatchLlmCall | senior_developer | mentor-feedback
PlanGenerationWorkflow | DispatchLifecycle | architect | plan-system-design
PullRequestWorkflow | GenerateDescription | tech_writer | summarize-changes
ResearchWorkflow | DispatchLifecycle | product_owner | research
ReviewFixWorkflow | DispatchFixGeneration | developer | address-review-comments
TaskCreationWorkflow | DispatchLifecycle | senior_developer | create-tasks
TaskReviewWorkflow | ArchReview | architect | plan-review
TaskReviewWorkflow | DevReview | developer | review-feasibility
TaskReviewWorkflow | SrDevReview | senior_developer | plan-review
TaskReviewWorkflow | TesterReview | tester | review-testability
TestCaseCreationWorkflow | DispatchLifecycle | tester | write-tests
TestingWorkflow | GenerateFix | developer | implement-fix
TriageContextGatheringWorkflow | DispatchLifecycle | developer | triage-context-scan
TriagePODecisionWorkflow | DispatchLifecycle | product_owner | triage-intake
```
