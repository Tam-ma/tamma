# Orchestrator Package Review

**Branch:** `feat/engine-mvp`
**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-12
**Scope:** All files in `packages/orchestrator/` (modified + new)

---

## Table of Contents

1. [Package Overview](#package-overview)
2. [File-by-File Analysis](#file-by-file-analysis)
   - [engine.ts (Modified)](#enginets-modified)
   - [index.ts (Modified)](#indexts-modified)
   - [workflow-engine.ts (New)](#workflow-enginets-new)
   - [elsa-client.ts (New)](#elsa-clientts-new)
   - [transports/in-process.ts (New)](#transportsin-processts-new)
   - [transports/remote.ts (New)](#transportsremotets-new)
3. [Test Coverage Analysis](#test-coverage-analysis)
4. [Cross-Cutting Concerns](#cross-cutting-concerns)
5. [Summary of Overall Quality](#summary-of-overall-quality)
6. [Prioritized Issue List](#prioritized-issue-list)

---

## Package Overview

The orchestrator package contains the core `TammaEngine` class that implements the autonomous development loop (select issue, analyze, plan, approve, implement, PR, merge), plus new infrastructure for ELSA workflow integration and transport abstractions.

**Dependencies:** `@tamma/shared`, `@tamma/observability`, `@tamma/providers`, `@tamma/platforms`

**File count:** 6 source files, 3 test files
**Estimated LOC:** ~925 production, ~1070 test

---

## File-by-File Analysis

### engine.ts (Modified)

**Path:** `packages/orchestrator/src/engine.ts`
**Lines:** 980
**Role:** Core autonomous development engine with a full pipeline state machine.

#### Architecture & Code Quality

The `TammaEngine` class is well-structured with clear separation of pipeline stages, each mapped to a state in the `EngineState` enum. The constructor uses dependency injection via `EngineContext`, which makes the engine testable and composable. JSDoc coverage is excellent: every public method has documentation including lifecycle notes, error semantics, and parameter descriptions.

The pipeline design (selectIssue -> analyzeIssue -> generatePlan -> awaitApproval -> createBranch -> implementCode -> createPR -> monitorAndMerge) is clean and linear, which is appropriate for the MVP.

The `IWorkflowEngine` interface is accepted in `EngineContext.workflowEngine` but is never used anywhere in the engine. This is dead configuration that creates confusion about the engine's relationship with ELSA workflows.

#### Error Handling & Resilience

- **Good:** The `processOneIssue` method has a proper try/catch/finally pattern that preserves `ERROR` state in the catch block while cleaning up work references in finally. The comment at line 203-204 explicitly explains why `resetCurrentWork()` is not called in finally.
- **Good:** Branch creation uses a retry loop with a cap of 10 attempts, handling name conflicts gracefully.
- **Good:** The CI monitor has both a time-based timeout (`ciMonitorTimeoutMs`) and a poll-count safety limit (500 polls), preventing infinite loops.
- **Good:** Non-critical operations like fetching related issues (line 299-310) and deleting branches (line 862-870) catch errors and continue.

- **Issue (Medium):** The `run()` loop catches errors from `processOneIssue` and logs them, but always calls `resetCurrentWork()` which transitions to `IDLE`. However, `processOneIssue` already sets `ERROR` state and clears work references in its catch/finally. The `resetCurrentWork()` call in `run()` at line 136 will overwrite the `ERROR` state to `IDLE`, making the error state transient and invisible to external observers. This contradicts the documented behavior that "state transitions to ERROR and stays there until the run loop resets it" -- the reset happens immediately, with no delay for observation.

- **Issue (Low):** The `promptUser` method (line 961-979) creates a readline interface with `close` and `error` listeners inside the Promise, but the `close` event listener rejects the promise. If `rl.close()` in the `finally` block fires the `close` event synchronously, it could reject an already-resolved promise. In practice, this is unlikely to cause issues since Node.js readline calls the callback before emitting `close`, but the pattern is fragile.

- **Issue (Low):** Plan cost from `generatePlan` is never accumulated into `totalCostUsd`. Only implementation cost is tracked (line 667). The plan generation call also has `costUsd` in its result, but it is discarded.

#### State Management & Concurrency

- **Good:** The `running` flag is set to `false` in `dispose()`, which cleanly breaks the `run()` loop at the next iteration.
- **Issue (Medium):** There is no guard against calling `run()` or `processOneIssue()` concurrently. If an external caller invokes `processOneIssue()` while `run()` is active, both will attempt to process issues simultaneously, leading to double-assignment of issues, duplicate PRs, and corrupted state. A mutex or `processing` flag would prevent this.

- **Issue (Low):** The `dispose()` method sets `running = false` but does not await the current `processOneIssue` cycle to complete. If the engine is mid-pipeline when `dispose()` is called, the agent and platform are disposed while the pipeline may still be executing asynchronous operations (e.g., `implementCode`). This could cause unhandled rejections or resource leaks.

#### Potential Bugs

- **Bug (Low):** In `selectIssue` (line 267-269), `extractIssueReferences` is called on the concatenation of `selected.body` and comment bodies. However, `selected` is the raw platform issue object (from `listIssues`), not the full issue with comments fetched by `getIssue`. The `listIssues` mock includes an empty `comments` array, meaning issue references in comments would be missed during selection. The full issue with comments is fetched separately in `analyzeIssue`, but the `relatedIssueNumbers` are set from the incomplete data.

- **Bug (Low):** The `analyzeIssue` method fetches the full issue via `getIssue` (line 294) but uses the `issue.labels` from the `IssueData` passed in (which came from `selectIssue`'s `listIssues` result). These could diverge if labels change between list and get calls. This is very unlikely in practice but is worth noting for correctness.

#### Suggestions for Improvement

1. Add a `processing` guard (mutex or boolean flag) to prevent concurrent pipeline execution.
2. Track plan generation cost in `totalCostUsd` alongside implementation cost.
3. Either use `EngineContext.workflowEngine` or remove it from the interface.
4. Consider adding a `waitForIdle()` method that resolves when the current pipeline cycle completes, useful for clean shutdown.
5. The `createBranch` method validates branch creation by calling `getBranch`, but the validation failure at line 579 only logs a warning and continues. If the branch was not actually created, subsequent `implementCode` will push to a nonexistent branch and fail. Consider retrying or erroring here.

---

### index.ts (Modified)

**Path:** `packages/orchestrator/src/index.ts`
**Lines:** 7
**Role:** Package barrel export.

```typescript
export { TammaEngine } from './engine.js';
export type { EngineContext, EngineStats, OnStateChangeCallback, ApprovalHandler } from './engine.js';
export type { IWorkflowEngine, WorkflowInstanceStatus } from './workflow-engine.js';
export { ElsaClient } from './elsa-client.js';
export { InProcessTransport } from './transports/in-process.js';
export { RemoteTransport } from './transports/remote.js';
```

#### Analysis

Clean and well-organized. Uses `export type` correctly for interfaces and type aliases, and concrete `export` for classes. All new modules are properly re-exported.

**No issues found.**

---

### workflow-engine.ts (New)

**Path:** `packages/orchestrator/src/workflow-engine.ts`
**Lines:** 27
**Role:** Interface contract for workflow engine interactions (targeting ELSA).

#### Architecture & Code Quality

This is a clean, minimal interface definition. The `IWorkflowEngine` interface defines six operations: `startWorkflow`, `getWorkflowStatus`, `pauseWorkflow`, `resumeWorkflow`, `cancelWorkflow`, and `sendSignal`. The `WorkflowInstanceStatus` type uses a discriminated union for the `status` field with a sensible set of values: `'Running' | 'Suspended' | 'Finished' | 'Cancelled' | 'Faulted' | 'Unknown'`.

#### Suggestions for Improvement

1. **Issue (Low):** The `variables` field on `WorkflowInstanceStatus` is typed as `Record<string, unknown>`. For stronger typing downstream, consider a generic parameter: `WorkflowInstanceStatus<T extends Record<string, unknown> = Record<string, unknown>>`.
2. **Issue (Low):** There is no `listWorkflows` or `getWorkflowDefinitions` method. These are common operations when managing workflows and will likely be needed as the ELSA integration matures.
3. The `sendSignal` method's `payload` parameter is typed as `unknown`. Consider constraining it to `Record<string, unknown>` for consistency with the `input` parameter on `startWorkflow`.

---

### elsa-client.ts (New)

**Path:** `packages/orchestrator/src/elsa-client.ts`
**Lines:** 195
**Role:** HTTP client for the ELSA workflow engine REST API.

#### Architecture & Code Quality

The `ElsaClient` class implements `IWorkflowEngine` and communicates with the ELSA server via HTTP. It uses a template-based URL construction pattern (`/api/workflow-instances/{instanceId}`) with `encodeURIComponent` for path parameter safety. The retry logic uses exponential backoff for transient failures (5xx, 429, network errors).

The code is clean with consistent patterns across all six interface methods. Internal types (`ElsaInstanceResponse`) are not exported, which is correct.

#### Error Handling & Resilience

- **Good:** The retry logic distinguishes between retryable (5xx, 429, network) and non-retryable (4xx) errors. Non-retryable errors throw immediately.
- **Good:** The `response.text().catch(() => '')` pattern at line 116 handles cases where the error response body cannot be read.
- **Good:** Empty response bodies are handled for endpoints that return no JSON (line 130-134).

- **Issue (Medium):** The network error detection at line 136 uses `err instanceof TypeError` or checks for `err.message.includes('fetch')`. This is fragile and environment-dependent. Node.js `fetch` throws `TypeError` for network errors, but the message check is brittle. A more robust approach would be to catch all errors in the retry loop and only re-throw errors that are known to be non-retryable (4xx responses already thrown above).

- **Issue (Medium):** There is no request timeout. If the ELSA server hangs, the `fetch` call will hang indefinitely. An `AbortSignal.timeout()` should be passed to each fetch call.

- **Issue (Low):** The `backoff` method uses `Math.pow(2, attempt)` which for `attempt=0` gives `1000ms`, `attempt=1` gives `2000ms`, `attempt=2` gives `4000ms`. This is correct exponential backoff. However, there is no jitter, which in a multi-engine deployment could lead to synchronized retry storms.

#### Potential Bugs

- **Bug (Low):** The `request<T>` method returns `undefined as unknown as T` when the response has no JSON body (line 134). For the `startWorkflow` method, which expects `{ workflowInstanceId: string }`, an empty response from ELSA would cause a runtime error at line 36 (`response.workflowInstanceId` on undefined). This could be guarded with a runtime check.

#### Suggestions for Improvement

1. Add a configurable request timeout using `AbortSignal.timeout()`.
2. Add jitter to the exponential backoff (`delay * (0.5 + Math.random())`).
3. Make `MAX_RETRIES` and `INITIAL_BACKOFF_MS` configurable via `ElsaClientConfig`.
4. Add a `healthCheck()` method that pings ELSA's status endpoint before starting workflows.
5. Consider logging retry attempts for observability.

---

### transports/in-process.ts (New)

**Path:** `packages/orchestrator/src/transports/in-process.ts`
**Lines:** 224
**Role:** Zero-overhead transport for CLI/in-process engine communication.

#### Architecture & Code Quality

The `InProcessTransport` implements `IEngineTransport` using Node.js `EventEmitter` for push-based notifications. It acts as a bridge between the `TammaEngine` and a UI layer (CLI), providing three factory methods that create engine callbacks:

- `createStateChangeHandler()` -- forwards state transitions as `EngineStateUpdate` events
- `createApprovalHandler()` -- pauses the engine until a UI command resolves a Promise
- `createLoggerProxy()` -- adapts `ILogger` calls into `EngineLogEntry` events

This is a well-designed adapter pattern. The separation between command handling (`sendCommand`) and event emission (`onStateUpdate`, `onLog`, etc.) follows the CQRS pattern cleanly.

#### Error Handling & Resilience

- **Good:** The `assertNotDisposed()` guard prevents commands after disposal.
- **Good:** The `emit` method checks `this.disposed` before emitting, preventing post-disposal events.
- **Good:** Fire-and-forget patterns (`void this.engine.run().catch(...)`) correctly catch and log errors.

- **Issue (Medium):** The `resolveApproval` method (line 211-217) silently ignores approval commands when there is no pending approval. If the UI sends `approve` before the engine requests approval (a race condition), the approval is lost. The engine will then hang waiting for an approval that was already consumed. Consider queuing the decision or throwing an error.

- **Issue (Medium):** The `dispose()` method sets `pendingApprovalResolve = null` without resolving it. If the engine is waiting for approval (the Promise at line 153 is pending), the engine's `awaitApproval` method will hang indefinitely -- the Promise is never resolved or rejected. The transport should reject the pending approval on disposal.

- **Issue (Low):** The `createLoggerProxy()` returns an `ILogger` that emits events but does not actually log to any backing store. If the transport is disposed but the engine continues logging (because `dispose()` does not stop the engine), the logs are silently dropped.

#### State Management & Concurrency

- **Issue (Low):** The `sendCommand('start')` fires the engine's `run()` or `processOneIssue()` in a fire-and-forget manner. There is no way for the caller to await completion or receive a result. This is acceptable for a transport but means errors in the engine loop are only surfaced via log events, which could be missed.

#### Suggestions for Improvement

1. In `dispose()`, reject the pending approval promise with a `DisposedError` to unblock the engine.
2. Add a `isApprovalPending()` query method for the UI to check before sending approval commands.
3. Consider adding a `sendCommand('start')` guard that prevents starting the engine twice.
4. The `command.type` switch has stubs for `pause`, `resume`, `process-issue`, and `describe-work`. These should be tracked as follow-up work items.

---

### transports/remote.ts (New)

**Path:** `packages/orchestrator/src/transports/remote.ts`
**Lines:** 257
**Role:** HTTP + SSE transport for remote engine communication (dashboard use case).

#### Architecture & Code Quality

The `RemoteTransport` implements `IEngineTransport` using HTTP POST for commands and Server-Sent Events (SSE) for event streaming. The SSE implementation uses `fetch` with streaming body reader, which is the correct approach for Node.js (no `EventSource` dependency needed).

The reconnection logic uses exponential backoff capped at 30 seconds, which is standard for SSE.

#### Error Handling & Resilience

- **Good:** SSE connection failures trigger automatic reconnection with exponential backoff.
- **Good:** The `dispose()` method cleans up the abort controller, reconnect timer, and all listeners.
- **Good:** Malformed JSON in SSE messages is silently skipped (line 215-217), preventing one bad event from crashing the stream.
- **Good:** Intentional disconnects (abort signal) are distinguished from errors (line 176).

- **Issue (High):** The `sendCommand` method has no retry logic. If the server returns a 5xx error or the network fails, the command is permanently lost. For critical commands like `approve` or `stop`, this could leave the system in an inconsistent state. At minimum, transient failures (5xx, network errors) should be retried.

- **Issue (Medium):** The SSE parser (line 182-218) concatenates all `data:` lines without a separator. If a multi-line SSE data field is sent (which is valid per the SSE spec where each line is a separate `data:` field), the lines will be concatenated without newlines, producing invalid JSON. The SSE spec says multi-line data should be joined with `\n`. The parser should use `data += line.slice(5).trim() + '\n'` and then trim the final newline before parsing.

- **Issue (Medium):** There is no mechanism for the SSE connection to send a `Last-Event-ID` header on reconnection. If events are missed during a reconnection window, the client will have a gap in its event stream. The server would need to support `id:` fields in SSE messages and the client would need to track the last seen ID.

- **Issue (Low):** The constructor starts the SSE connection immediately (`this.connectSSE()` at line 53). If construction happens before the server is ready, the initial connection will fail and trigger the reconnection loop. This is usually fine but can produce noisy logs during startup. Consider a lazy connection or an explicit `connect()` method.

- **Issue (Low):** The `sendCommand` method does not validate the response body. If the server returns a success status with an error in the body, it would be missed.

#### Potential Bugs

- **Bug (Medium):** The SSE message splitting uses `buffer.split('\n\n')` (line 167). However, the SSE spec requires `\r\n\r\n` or `\r\r` as valid message delimiters in addition to `\n\n`. While most servers use `\n\n`, the parser is not fully spec-compliant. This could cause message parsing failures with certain SSE server implementations.

- **Bug (Low):** The `TextDecoder` is created inside the `runSSELoop` method with `{ stream: true }` option in `decode()`. The `TextDecoder` instance itself does not take a `stream` option -- `stream` is a parameter of `decode()`. This is correct as written, but if the loop restarts (reconnection), a new `TextDecoder` is created, which is fine for the stateless UTF-8 decoder.

#### Suggestions for Improvement

1. Add retry logic to `sendCommand` for transient failures, matching the pattern in `ElsaClient`.
2. Fix the multi-line SSE data concatenation to use newline separators.
3. Track `Last-Event-ID` for gap-free reconnection.
4. Consider a configurable connection timeout for the initial SSE handshake.
5. Add a `connectionState` property or event so the UI can display connection status.
6. The auth token is sent as `Bearer` for commands but there is no token refresh mechanism. Long-lived connections may encounter expired tokens.

---

## Test Coverage Analysis

### engine.test.ts (1073 lines, 33 test cases)

**Coverage: Thorough for the engine pipeline.**

| Area | Tests | Coverage |
|------|-------|----------|
| `initialize` | 2 | Full (available + unavailable) |
| `getState` | 1 | Initial state only |
| `selectIssue` | 3 | Found, not found, exclude labels |
| `analyzeIssue` | 3 | Related issues, commits, full sections |
| `generatePlan` | 4 | Success, invalid JSON, missing fields, agent failure |
| `awaitApproval` | 5 | Auto mode, handler approve/reject/skip, CLI reject |
| `createBranch` | 2 | Success, conflict retry |
| `implementCode` | 1 | Success path |
| `createPR` | 1 | Success with issue link |
| `monitorAndMerge` | 7 | CI pass, timeout, CI fail, merge fail, external close/merge, merge strategy, branch deletion skip |
| `processOneIssue` | 3 | Full pipeline, no issues, error state |
| `dispose` | 1 | Cleanup |
| `getStats` | 4 | Initial, post-pipeline, cost tracking, failure |
| `onStateChange` | 3 | Invocation, args, no-callback |
| `eventStore` | 4 | Full lifecycle, optional, getter |

**Gaps:**
- No test for `implementCode` failure path (when `result.success` is false).
- No test for the `run()` loop behavior (continuous polling, error recovery, stopping).
- No test for CLI readline approval with 'y' answer (only rejection is tested).
- No test for `createBranch` hitting the maximum attempts limit (10).
- No test for `monitorAndMerge` when CI is pending and then transitions to success (multi-poll scenario).
- The `promptUser` method has no direct test for the error/close event handling.

### engine.integration.test.ts (163 lines, 1 test case)

Gated by `INTEGRATION_TEST_ENGINE=true`. Tests the full pipeline with mocked dependencies, verifying the complete event store audit trail. This is essentially a smoke test confirming that all pipeline stages execute in sequence.

**Gap:** Despite the name "integration test," this uses fully mocked dependencies and does not test any real integration points. It duplicates what `processOneIssue` unit tests already cover.

### engine.e2e.test.ts (224 lines, 3 test cases)

Gated by `E2E_TEST_ENABLED=true` and optionally `INTEGRATION_TEST_CLAUDE=true`. Tests against the real GitHub API (`Tam-ma/tamma-test` repo). Includes:
- Issue selection from real repo
- Issue analysis with real context
- Full pipeline with real Claude (double-gated)

**Quality:** The E2E tests have proper cleanup logic using `cleanupFns` with reverse execution order. The full pipeline test has a 5-minute timeout. Good use of `describe.skip` for conditional execution.

**Gap:** The cleanup for `selectIssue` acknowledges it cannot remove the pickup comment because the `IGitPlatform` interface lacks a `removeComment` method.

### Missing Test Files

- **No tests for `ElsaClient`**: The ELSA HTTP client has zero test coverage. No unit tests with mocked `fetch`, no integration tests.
- **No tests for `InProcessTransport`**: The in-process transport has zero test coverage. The approval promise flow, state change forwarding, and logger proxy are all untested.
- **No tests for `RemoteTransport`**: The remote transport has zero test coverage. The SSE parser, reconnection logic, and command dispatch are all untested.
- **No tests for `workflow-engine.ts`**: This is just an interface, so no tests are expected.

---

## Cross-Cutting Concerns

### 1. Unused IWorkflowEngine Integration

The `EngineContext` accepts an optional `workflowEngine?: IWorkflowEngine`, and the `TammaEngine` constructor does not store it. The engine has no code paths that use workflow engine capabilities. The `ElsaClient` exists but is never instantiated or called by the engine. This suggests that the ELSA integration was designed (interface + client) but not yet wired into the pipeline. This is acceptable for an MVP but should be explicitly noted as a future integration point.

### 2. Transport-Engine Wiring

The `InProcessTransport` creates engine callbacks (`createStateChangeHandler`, `createApprovalHandler`, `createLoggerProxy`) that must be manually wired by the caller when constructing `EngineContext`. There is no validation that this wiring is complete. If the transport's `createApprovalHandler()` is not passed to the engine, approval commands sent via the transport will be silently ignored. A factory function that creates both the engine and transport with correct wiring would reduce this risk.

### 3. Cost Tracking Incompleteness

Only implementation cost is tracked in `totalCostUsd` (line 667). Plan generation cost is available in the `AgentTaskResult` but is not accumulated. For accurate cost reporting to users, all agent calls should contribute to the total.

### 4. Observability

The `@tamma/observability` package is listed as a dependency in `package.json` but is not imported anywhere in the orchestrator code. All logging goes through the injected `ILogger`. Consider whether observability hooks (metrics, traces) should be added to the pipeline stages.

### 5. No `maxRetries` Usage

The `EngineConfig.maxRetries` field is defined and configured in tests but never read by the engine. When `processOneIssue` fails with a retryable `WorkflowError`, the `run()` loop simply sleeps and tries to process the next issue. There is no retry mechanism for the same issue. This means a transient failure causes the issue to be abandoned (though it remains open and labeled, so a future poll will pick it up again).

---

## Summary of Overall Quality

The orchestrator package demonstrates **good overall code quality** for an MVP. Key strengths:

- **Clean architecture:** The pipeline is linear and easy to follow. Dependency injection makes the engine highly testable.
- **Thorough documentation:** JSDoc comments cover all public methods with lifecycle, error, and parameter documentation.
- **Solid state machine:** The `EngineState` enum covers all pipeline stages with proper transitions.
- **Comprehensive engine tests:** 33 test cases covering the main pipeline paths, error handling, and edge cases.
- **Well-designed contracts:** The `IWorkflowEngine` and `IEngineTransport` interfaces are clean and minimal.

Key weaknesses:

- **Zero test coverage for new modules:** ElsaClient, InProcessTransport, and RemoteTransport have no tests.
- **Transport disposal bugs:** Both transports have edge cases around disposal that could hang the engine.
- **No concurrency protection:** The engine can be invoked concurrently without guards.
- **Incomplete ELSA integration:** The workflow engine is designed but not wired.

---

## Prioritized Issue List

### Critical (Must Fix)

| # | File | Issue |
|---|------|-------|
| 1 | `transports/in-process.ts` | `dispose()` sets `pendingApprovalResolve = null` without resolving/rejecting it, which can permanently hang the engine's `awaitApproval` call. Fix: reject the pending promise in `dispose()`. |
| 2 | `transports/remote.ts` | `sendCommand()` has no retry logic. A transient network failure during `approve` or `stop` leaves the system in an inconsistent state. Fix: add retry logic matching `ElsaClient`'s pattern. |

### High Priority (Should Fix)

| # | File | Issue |
|---|------|-------|
| 3 | `elsa-client.ts`, `transports/in-process.ts`, `transports/remote.ts` | Zero test coverage for all three new modules. These need at minimum unit tests with mocked `fetch`/`EventEmitter`. |
| 4 | `engine.ts` | No concurrency guard -- `run()` and `processOneIssue()` can be called concurrently leading to duplicate issue processing. Fix: add a `processing` mutex flag. |
| 5 | `transports/remote.ts` | SSE multi-line data concatenation drops newlines between `data:` lines, producing malformed JSON for multi-line payloads. Fix: join data lines with `\n`. |
| 6 | `elsa-client.ts` | No request timeout on `fetch` calls. A hanging ELSA server will hang the client indefinitely. Fix: add `AbortSignal.timeout()`. |

### Medium Priority (Should Fix When Possible)

| # | File | Issue |
|---|------|-------|
| 7 | `engine.ts` | `run()` immediately calls `resetCurrentWork()` after catching errors, overwriting `ERROR` state to `IDLE`. External observers cannot see the error state. Fix: delay the reset or emit the error state through a callback before resetting. |
| 8 | `engine.ts` | `dispose()` does not await the current pipeline cycle. Active async operations may continue after agent/platform are disposed. Fix: add a `waitForIdle()` mechanism. |
| 9 | `engine.ts` | Plan generation cost is not tracked in `totalCostUsd`. Fix: add `this.totalCostUsd += result.costUsd` after successful plan generation. |
| 10 | `engine.ts` | `EngineConfig.maxRetries` is defined but never used. Either implement retry logic for the same issue or remove the field. |
| 11 | `engine.ts` | `EngineContext.workflowEngine` is accepted but never stored or used. Either wire the ELSA integration or remove the field to avoid confusion. |
| 12 | `elsa-client.ts` | Network error detection uses fragile `err.message.includes('fetch')` heuristic. Fix: catch all errors in the retry loop by default, only re-throwing known non-retryable errors (already handled via the status code check). |
| 13 | `transports/in-process.ts` | `resolveApproval()` silently ignores approval commands when no approval is pending. This can cause lost approvals in race conditions. Fix: queue the decision or return an error. |

### Low Priority (Nice to Have)

| # | File | Issue |
|---|------|-------|
| 14 | `elsa-client.ts` | No jitter in exponential backoff. In multi-engine deployments, retries may synchronize. Fix: add `delay * (0.5 + Math.random())`. |
| 15 | `elsa-client.ts` | `MAX_RETRIES` and `INITIAL_BACKOFF_MS` are hard-coded. Make them configurable via `ElsaClientConfig`. |
| 16 | `transports/remote.ts` | No `Last-Event-ID` tracking for SSE reconnection. Events may be lost during reconnection windows. |
| 17 | `transports/remote.ts` | SSE message delimiter only handles `\n\n`, not `\r\n\r\n` or `\r\r` per the SSE spec. |
| 18 | `transports/remote.ts` | Constructor starts SSE connection immediately. Consider lazy connection or explicit `connect()` for better startup control. |
| 19 | `engine.ts` | `selectIssue` extracts `relatedIssueNumbers` from `listIssues` data which may have truncated/empty comments. Consider extracting references after `getIssue` in `analyzeIssue` instead. |
| 20 | `engine.test.ts` | Missing test for the `run()` loop behavior (continuous polling, error recovery, stop signal). |
| 21 | `engine.test.ts` | Missing test for `createBranch` exhausting all 10 attempts. |
| 22 | `workflow-engine.ts` | No `listWorkflows` or `getWorkflowDefinitions` method on the interface. Will likely be needed as ELSA integration matures. |
| 23 | `package.json` | `@tamma/observability` is a dependency but is not imported anywhere in the package. Either use it or remove it. |
