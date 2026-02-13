# Phase 3 Review: IEngineTransport Interface

**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-12
**Branch:** `feat/engine-mvp`

---

## 1. Phase Overview

Phase 3 called for introducing an `IEngineTransport` abstraction to decouple the CLI (and future web dashboard) from the `TammaEngine` internals. The plan specified four deliverables:

1. **Contract** -- `IEngineTransport` interface with supporting types (`EngineCommand`, `EngineStateUpdate`, `EngineLogEntry`) in `packages/shared`.
2. **InProcessTransport** -- zero-overhead EventEmitter bridge for the CLI.
3. **RemoteTransport** -- HTTP POST commands + SSE event stream for the web dashboard.
4. **CLI refactoring** -- rewrite `start.tsx`, `SessionLayout.tsx`, and `types.ts` to consume `IEngineTransport` instead of the ad-hoc `StateEmitter`/`LogEmitter` pattern.

Items 1-3 were implemented. Item 4 was **not** implemented. The CLI continues to use its own `StateEmitter`, `LogEmitter`, and `PendingApproval` wiring, completely independent of the transport layer.

---

## 2. File-by-File Review

### 2.1 `packages/shared/src/contracts/engine-transport.ts`

**Status: Implemented, clean design.**

```typescript
export type EngineCommand =
  | { type: 'start'; options?: { once?: boolean } }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'approve' }
  | { type: 'reject'; feedback?: string }
  | { type: 'skip' }
  | { type: 'process-issue'; issueNumber: number }
  | { type: 'describe-work'; description: string };
```

**Findings:**

- **Good:** The `EngineCommand` union is a well-structured discriminated union covering all user-driven actions. The `feedback` field on `reject` and the `options` bag on `start` are nice forward-looking touches.
- **Good:** `EngineStateUpdate` flattens the callback args into a single object with `state`, `issue`, and `stats` -- cleaner than the 3-arity callback signature on the engine.
- **Good:** `EngineLogEntry` mirrors the `ILogger` levels exactly and adds `timestamp` + optional `context`.
- **Good:** All `on*` methods return `() => void` disposers, which is the correct pattern for listener cleanup.
- **Minor:** The `EngineEvent` type (imported from `@tamma/shared`) carries an `id` field populated by the `IEventStore.record()` method. The transport exposes this type through `onEvent()`, but the `InProcessTransport` never actually emits `event`-type events because the engine does not have an event callback hook that would feed into the transport. The `onEvent` subscription is currently dead code in both transports.
- **Minor:** `EngineStateUpdate.stats` uses an inline `{ issuesProcessed: number; totalCostUsd: number; startedAt: number }` shape. This is identical to the `EngineStats` type from `@tamma/orchestrator`. It should either reuse `EngineStats` directly or be extracted into a named type in `@tamma/shared` to avoid subtle drift.

### 2.2 `packages/shared/src/contracts/index.ts`

**Status: Implemented.**

```typescript
export * from './engine-transport.js';
```

Re-export is present. All transport types are accessible via `@tamma/shared/contracts`. No issues.

### 2.3 `packages/orchestrator/src/transports/in-process.ts`

**Status: Implemented, well-structured, with some observations.**

**What works well:**

- Clean `IEngineTransport` implementation with proper `disposed` guard.
- Type-safe `TransportEventMap` ensures `emit` and `addListener` agree on payloads.
- `createStateChangeHandler()`, `createApprovalHandler()`, and `createLoggerProxy()` are the right approach: they return callbacks that the host code wires into the `EngineContext`. This avoids any modification to the engine itself.
- The approval flow correctly uses a `Promise` with a stored `resolve` function. The `resolveApproval()` helper nulls out the reference before calling `resolve`, which is safe.

**Findings:**

- **Missing: `pause`, `resume`, `process-issue`, `describe-work` commands.** These are listed in the `EngineCommand` union but are stubs in the `default` branch that log a warning. The engine itself does not support these operations natively (there are no `pause()`/`resume()` methods on `TammaEngine`), so this is expected for now, but it means the command union over-promises relative to what the transport can actually do.

- **Potential issue: `reject` command loses feedback.** When `sendCommand({ type: 'reject', feedback: 'some reason' })` is called, the transport calls `resolveApproval('reject')` but does not forward `command.feedback` anywhere. The `createApprovalHandler` only returns `'approve' | 'reject' | 'skip'` (a string), so rejection feedback is silently dropped. Compare with the CLI's `rejectCurrentPlan(feedback)` which explicitly logs the feedback. This is a design gap between the contract (which has `feedback`) and the approval handler return type (which does not carry feedback).

- **Fire-and-forget pattern for `start`.** The `void this.engine.run().catch(...)` pattern is correct for not blocking `sendCommand`, but there is no way for the caller to know when the engine finishes or errors. For CLI use this is fine (errors surface via log events), but for remote use it could be surprising.

- **No `onEvent` emission.** As noted above, `InProcessTransport` never calls `this.emit('event', ...)` because there is no callback hook on the engine for `EngineEvent`. The `onEvent` subscription will never fire.

- **Good: dispose() calls `removeAllListeners()`.** This prevents memory leaks from accumulated listeners. However, note that individual `addListener` disposers returned to the caller become silently no-op after `dispose()` since the underlying listener is already gone. This is acceptable behavior.

### 2.4 `packages/orchestrator/src/transports/remote.ts`

**Status: Implemented, good SSE handling.**

**What works well:**

- Clean separation: commands via `fetch` POST, events via SSE stream.
- Proper exponential backoff: starts at 1s, doubles each failure, caps at 30s.
- `AbortController` is properly used for cancellation and cleaned up in `dispose()`.
- The SSE parser handles multi-line messages and partial buffer management correctly (keeping the last incomplete chunk in `buffer`).
- Auth token is sent on both command POST and SSE GET requests.
- Error responses on commands include status code and response body in the error message.

**Findings:**

- **SSE data concatenation bug.** In `parseSSEMessage`, when the SSE spec allows multi-line `data:` fields (multiple `data:` lines), the current code concatenates them without a delimiter:
  ```typescript
  data += line.slice(5).trim();
  ```
  Per the SSE spec, multiple `data:` lines should be joined with `\n`. This implementation joins them with no separator, which would produce malformed JSON if the server ever splits a JSON payload across multiple `data:` lines. In practice this is unlikely (servers typically send single-line `data:` fields), but it is a spec violation.

- **No `Last-Event-ID` support.** The SSE spec defines a mechanism for resuming from the last received event ID. The `RemoteTransport` does not track event IDs or send a `Last-Event-ID` header on reconnection. This means any events emitted during the reconnect window are lost. For a production system with plan approval flow, this could cause the UI to miss an `approvalRequest` event.

- **Constructor starts SSE immediately.** `connectSSE()` is called in the constructor. If the server is not yet running, this triggers the reconnection loop, which is fine, but there is no way to defer the connection. A `connect()` method that the consumer calls explicitly might be cleaner for testability.

- **No request timeout on `sendCommand`.** The `fetch` call has no `AbortSignal` or timeout. If the server hangs, the caller's `await sendCommand(...)` promise will hang indefinitely. Consider adding a configurable timeout.

- **Good: `dispose()` cleans up everything.** Clears the reconnect timer, aborts the SSE connection, and removes all listeners. No leaks.

### 2.5 `packages/orchestrator/src/index.ts`

**Status: Implemented.**

```typescript
export { InProcessTransport } from './transports/in-process.js';
export { RemoteTransport } from './transports/remote.js';
```

Both transports are re-exported from the package barrel. Consumers can import directly from `@tamma/orchestrator`.

### 2.6 `packages/cli/src/commands/start.tsx` -- CLI Refactoring

**Status: NOT REFACTORED. The CLI does not use IEngineTransport.**

The `startCommand` function continues to use the pre-transport architecture:

- It creates a `StateEmitter` (line 21-36) -- a custom single-listener pub/sub.
- It creates a `LogEmitter` via `createLogEmitter()` (line 84) -- a custom multi-listener pub/sub.
- It manages approval via an `approvalRef` holding a `PendingApproval` (line 81).
- It constructs `TammaEngine` directly with raw callbacks:
  ```typescript
  const engine = new TammaEngine({
    config, platform, agent, logger,
    onStateChange: (state, issue, stats) => { ... },
    approvalHandler,
  });
  ```
- It manually runs the engine loop (lines 270-322) instead of using `transport.sendCommand({ type: 'start' })`.

There is **zero reference** to `IEngineTransport`, `InProcessTransport`, or any transport type anywhere in the CLI package (confirmed via grep). The transport layer exists but is entirely unused.

### 2.7 `packages/cli/src/components/SessionLayout.tsx` -- CLI Refactoring

**Status: NOT REFACTORED.**

`SessionLayout` still accepts the old prop types:

```typescript
interface SessionLayoutProps {
  stateEmitter: StateEmitter;
  logEmitter: LogEmitter;
  approvalRef: React.MutableRefObject<PendingApproval | null>;
  commandContext: CommandContext;
}
```

There is no `IEngineTransport` prop. The component wires into `stateEmitter.listener` directly and checks `approvalRef.current` for pending approvals.

### 2.8 `packages/cli/src/types.ts` -- CLI Types

**Status: NOT REFACTORED.**

`CommandContext` does not include a `transport` field. It still references `logEmitter: LogEmitter` and manages approval via imperative `approveCurrentPlan()` / `rejectCurrentPlan()` methods. The `StateEmitter` and `PendingApproval` types remain unchanged.

---

## 3. Critical Finding: CLI Was Not Refactored

The CLI package (`packages/cli/src/`) has **no dependency** on the transport layer. Specifically:

- No imports of `IEngineTransport`, `InProcessTransport`, `EngineCommand`, `EngineStateUpdate`, or `EngineLogEntry` exist anywhere in the CLI.
- The CLI constructs and drives the `TammaEngine` directly via `engine.initialize()`, `engine.processOneIssue()`, `engine.run()`, and `engine.dispose()`.
- State updates flow through a bespoke `StateEmitter` (single-listener pattern), not through `transport.onStateUpdate()`.
- Logs flow through a bespoke `LogEmitter` (multi-listener with history buffer), not through `transport.onLog()`.
- Plan approvals flow through a React ref (`approvalRef`), not through `transport.onApprovalRequest()`.

The `InProcessTransport` class provides `createStateChangeHandler()`, `createApprovalHandler()`, and `createLoggerProxy()` -- three helper methods specifically designed to bridge the engine's callback-based API to the transport's event-based API. These are well-designed but have **no consumer**.

This means the Phase 3 plan is approximately 60% complete. The contract and both transport implementations are in place, but the integration with the CLI (the primary consumer) was not done.

---

## 4. Summary Table

| Requirement | Status | Notes |
|---|---|---|
| `EngineCommand` union type | Done | 9 command variants, well-typed discriminated union |
| `EngineStateUpdate` type | Done | Clean structure; inline `stats` shape should reference a named type |
| `EngineLogEntry` type | Done | Matches `ILogger` levels, adds timestamp |
| `EngineEvent` in `onEvent` | Done (interface) | Never emitted by either transport; dead subscription |
| `IEngineTransport` interface | Done | 6 methods: `sendCommand`, 4 subscriptions, `dispose` |
| Re-export from contracts barrel | Done | `packages/shared/src/contracts/index.ts` |
| `InProcessTransport` | Done | EventEmitter bridge with approval promise flow |
| `InProcessTransport` -- state wiring | Done (code exists) | `createStateChangeHandler()` is never called by any consumer |
| `InProcessTransport` -- approval wiring | Done (code exists) | `createApprovalHandler()` is never called by any consumer |
| `InProcessTransport` -- logger proxy | Done (code exists) | `createLoggerProxy()` is never called by any consumer |
| `RemoteTransport` | Done | HTTP POST + SSE with exponential backoff |
| `RemoteTransport` -- SSE parsing | Done (minor bug) | Multi-line `data:` concatenation lacks `\n` separator |
| `RemoteTransport` -- reconnection | Done | Exponential backoff 1s to 30s cap |
| `RemoteTransport` -- cleanup | Done | AbortController + timer + removeAllListeners in dispose |
| Re-export transports from orchestrator | Done | Both exported from `packages/orchestrator/src/index.ts` |
| CLI refactored to use `IEngineTransport` | **NOT DONE** | CLI still uses `StateEmitter`/`LogEmitter`/`approvalRef` |
| `SessionLayout` uses transport | **NOT DONE** | Props still accept old types |
| `CommandContext` includes transport | **NOT DONE** | No `transport` field; uses imperative methods |
| Tests for transports | **NOT DONE** | No test files in `packages/orchestrator/src/transports/` |

---

## 5. Open Issues and Recommendations

### P0 -- Must Fix

1. **Complete the CLI refactoring.** The entire point of `IEngineTransport` is to decouple the UI from the engine. Without the CLI consuming it, the abstraction is dead code. The refactoring should:
   - Replace `StateEmitter` with `transport.onStateUpdate()`.
   - Replace `LogEmitter` with `transport.onLog()`.
   - Replace `approvalRef` with `transport.onApprovalRequest()` + `transport.sendCommand({ type: 'approve' })`.
   - Replace direct `engine.run()` / `engine.processOneIssue()` calls with `transport.sendCommand({ type: 'start' })`.
   - Wire `InProcessTransport` helper methods (`createStateChangeHandler`, `createApprovalHandler`, `createLoggerProxy`) into the `EngineContext`.

2. **Add unit tests for both transports.** Neither `InProcessTransport` nor `RemoteTransport` has any test coverage. Key scenarios to test:
   - `InProcessTransport`: command dispatch, approval promise flow (approve/reject/skip), state update emission, log emission, dispose idempotency, post-dispose error.
   - `RemoteTransport`: command POST (success/failure), SSE message parsing, reconnection scheduling, dispose cleanup.

### P1 -- Should Fix

3. **Fix SSE multi-line `data:` concatenation.** In `RemoteTransport.parseSSEMessage`, change `data += line.slice(5).trim()` to `data += (data ? '\n' : '') + line.slice(5).trim()` or accumulate lines in an array and join with `\n`. This aligns with the SSE spec.

4. **Propagate rejection feedback.** The `EngineCommand` type includes `feedback?: string` on the `reject` variant, but `InProcessTransport` drops it. Either:
   - Expand the approval handler return type to `{ decision: 'approve' | 'reject' | 'skip'; feedback?: string }`, or
   - Have the transport emit the feedback as a log entry before resolving the approval.

5. **Extract `EngineStats` into `@tamma/shared`.** The inline `stats` shape in `EngineStateUpdate` duplicates the `EngineStats` interface from `@tamma/orchestrator`. Moving it to shared prevents import cycles and avoids type drift.

### P2 -- Nice to Have

6. **Add `Last-Event-ID` support to `RemoteTransport`.** Track the last received event ID and send it on reconnection to avoid lost events.

7. **Add a configurable timeout to `RemoteTransport.sendCommand`.** Pass an `AbortSignal` with a timeout to the `fetch` call to prevent indefinite hangs.

8. **Wire `onEvent` to something.** Currently neither transport ever emits on the `event` channel. Consider having the engine expose an event callback (similar to `onStateChange`) that feeds into the transport, or remove `onEvent` from the interface until there is a producer.

9. **Defer SSE connection in `RemoteTransport`.** Move the `connectSSE()` call out of the constructor into an explicit `connect()` method for better testability and lifecycle control.

10. **Consider removing stub commands from `EngineCommand`.** `pause`, `resume`, `process-issue`, and `describe-work` are defined in the union but not implemented by any transport. They create a false sense of capability. Either implement them or gate them behind a separate `ExtendedEngineCommand` type.
