# Elsa: child workflows share the parent's input objects; bookmarks exist only after commit

**When**: 2026-11 — fixing the nightly Gitea engine-driven E2E flake (`FullEngineCycle_SingleIssue_CompletesOnGitea`, ~45% failure rate)
**Related**: `LlmCallWorkflow.cs`, `ReconcileBufferedPrMergeHandler.cs`, `WaitForPRMergedActivity.cs`, `PrMergedResumeEndpoint.cs`

## 1. Never mutate an input you received from `DispatchWorkflow`

In-process `DispatchWorkflow` hands the child the **same dictionary instance** the
parent holds in its activity state. `LlmCallWorkflow` added `role`/`conventions`
keys to its `variables` input while the parent was serializing its state
(`JsonWorkflowStateSerializer`) → `InvalidOperationException: Collection was
modified`. The parent's first commit failed, it was never persisted, the
child-completion bookmark-queue items expired (1 min TTL), and the cycle hung
until the test timeout (14 min).

**Rule**: treat workflow inputs as read-only — copy before adding keys.

## 2. A bookmark is not in the store until the workflow commits

`WaitForPRMergedActivity` checks `PendingPrMergeBuffer` before and after
`CreateBookmark`, but the bookmark is persisted only when the workflow commits,
after the activity returns. A merged-PR webhook in that window finds no bookmark,
is buffered (202), and nothing consumed it → cycle waits for the 12 h SLA.

**Fix**: `ReconcileBufferedPrMergeHandler` handles Elsa's
`WorkflowBookmarksPersisted`; for each new `pr-merged-*` bookmark it consumes the
buffer entry and enqueues the resume on `IBookmarkQueue`.

**Rule**: any "buffer the event if no bookmark yet" pattern needs a reconcile
step that runs after bookmarks are persisted, not only inside the activity.
