# Full-runtime workflow suites: never ran, then found two Elsa graph bugs

**Date:** 2026-11-07

## What was wrong

Eight full-runtime suites in `tests/Tamma.Activities.Tests/Workflows` were marked
`[Explicit]`, and their comments said "the Postgres CI jobs run it". No CI job
selected `[Explicit]` fixtures, so they never ran. Run by hand, 7 suites failed: 6 of
them on every test, and `AmbiguityThreadingExecutionTests` on 1 of 4. They are now
tagged `[Category("WorkflowExecution")]` (`ElsaRuntimeHarness.Category`) and run in
CI's `workflow-exec` slice. They also run in a plain local `dotnet test`.

Selecting an `[Explicit]` fixture is tricky: `--filter "FullyQualifiedName~A|FullyQualifiedName~B"`
and `NUnit.Where` both skip it. Only a filter that names a single class selects it.
That is part of why "run them by name" looked like it worked while CI never could.

## Harness causes (test-side)

1. **Registries never populated.** `WorkflowDefinitionHandle.ByDefinitionId(...)`
   throws `WorkflowGraphNotFoundException` until `IRegistriesPopulator.PopulateAsync`
   has run. The hosted services must also be started, so that the background
   dispatcher drains `DispatchWorkflow` children and the background activity
   invoker runs `Kind=Task` activities. Use `ElsaRuntimeHarness.Start(provider)`.
   In `AmbiguityThreadingExecutionTests` this call had been pasted *after* the run
   in three places.
2. **Output read before the run finished.** `CreateAndRunInstanceAsync` returns while
   the parent is still suspended on its dispatched children. Reading
   `ExportStateAsync().Output` at that point sees an empty dictionary, which reads as
   "status null" / "success false" in every assertion. Use
   `ElsaRuntimeHarness.RunUntilDoneAsync`, `WaitAsync` and `WaitForFinishedAsync`.
   Never assume a gate fired: `if (publisher.Last is {} r)` silently skips the step.
   The AcceptanceRequest is published one step *before* the gate creates its decision
   bookmark. A resume sent the moment the request lands can find nothing (about 1 run in 3
   locally), so wait for the bookmark first: `ElsaRuntimeHarness.WaitForDecisionBookmarkAsync`.
3. **Fixture drift.** Two cases:
   - Captured HTTP bodies now include document-persist calls, not just event
     batches. Use `ElsaRuntimeHarness.EventsIn`.
   - A review without a `subject` no longer deserializes as a `Review`, so it is
     "unusable", which routes to review-undecidable.

## Real bugs found (production code)

### 1. Implicit joins never fire (Elsa 3.5 `WaitAllActive`)

In Elsa 3.5, any flowchart node with more than one forward inbound connection is an
implicit join in `WaitAllActive` mode. It runs only after *every* inbound connection
has been visited, whether followed or reached by skip propagation. When the inbound
branches are mutually exclusive and one of them sits behind a loop or a suspend,
skip propagation never reaches it. The node then never runs, the flowchart sees no
pending work, and it **completes silently with none of its outputs set**.

`DocumentLifecycleWorkflow` hit this on every escalation and revise path. A
validation-exhausted run finished `Finished/Finished` with `output={}` instead of
`status=escalated`. Fix: `FlowJoins.WaitAny(flowchart, targets…)` puts an explicit
`FlowJoin(WaitAny)` in front of each convergence point.

**Still open:** a probe found 98 such implicit joins across 33 coded workflows.
Simple if/else merges work, because skip propagation reaches the untaken branch.
`LlmCallWorkflow`'s output join is one: both its paths execute in
`LlmCallWorkflowExecutionTests`. The risky ones merge a branch that sits behind a
loop or a suspend. Each needs an execution test, or a reasoned
`FlowJoins.WaitAny`. Workflows with the most: `SingleIssueCycleWorkflow` (13; an
Epic 40 file), `PanelReviewWorkflow` (10; it executes fine in
`ReviewProducerExecutionTests`), `MentorshipWorkflow` (10; dead code),
`DeploymentPipelineWorkflow` (7).

How to find them: build each workflow with `WorkflowTestHelper.BuildWorkflow`, then
for each `Flowchart` use `new FlowGraph(fc.Connections, fc.Start)
.GetForwardInboundConnections(a).Count > 1` on every non-`FlowJoin` activity.

### 2. "Invalid backward connection": the revise loop always faulted

Elsa accepts a loop (backward) edge only when its target lies on **every** path from
the start to its source. Otherwise it throws `Invalid backward connection` at run time
when the edge is taken. In `DocumentLifecycleWorkflow` the revise path looped
`IngestRevise → ValidateDraft`. But the 39-10 re-entry gates jump straight into
REVIEW and ACCEPT, so `ValidateDraft` does not lie on every path to the revise step,
and every revise round faulted. Bug 1 hid this, because the revise join never fired.

Fix: the revise path sets `ReEntryStage = "validate"` and loops back to the head of
the re-entry gate chain, which dominates everything. A new `ReEntryValidateGate`
then routes to `ValidateDraft`. Rule of thumb: a loop must re-enter through a node
that every path passes through. In a flowchart with re-entry jumps, that means the
gate chain.

### 3. The Clarification contract contradicts its validator

The resolution shape in `ClarificationDocumentType.RenderContract()`, which the
repair ring shows the model, had `resolutions[].questionId: "Q-1"` but no
`questions`. The validator resolves each `questionId` against *this* document's
`questions`, so a model that follows the contract exactly always failed
(`UNKNOWN_QUESTION_REF`). The contract now includes `questions`. A test pins that the
contract's own resolution shape validates.
