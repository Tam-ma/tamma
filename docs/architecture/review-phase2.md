# Phase 2 Review: Engine <-> ELSA Integration

**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-12
**Branch:** `feat/engine-mvp`
**Scope:** TypeScript packages (`orchestrator`, `api`, `shared`) + .NET ELSA activity callback mode

---

## 1. Phase Overview

Phase 2 introduces a bidirectional integration between the TypeScript engine and the ELSA .NET workflow runtime:

- **Engine -> ELSA (outbound):** `IWorkflowEngine` interface + `ElsaClient` HTTP client lets the TS engine start, pause, resume, cancel, and signal ELSA workflows.
- **ELSA -> Engine (inbound / callback):** Fastify routes in `engineCallbackPlugin` let ELSA activities POST back to the TS engine for agent task execution and availability checks.
- **Shared config:** `ElsaConfig` and `ServerConfig` added to `TammaConfig` in the shared types package.
- **.NET activity update:** `ClaudeAnalysisActivity` gained a callback mode that delegates to the TS engine via `Engine:CallbackUrl`.

---

## 2. File-by-File Review

### 2.1 `packages/orchestrator/src/workflow-engine.ts`

**Purpose:** Defines the `IWorkflowEngine` abstraction.

| Aspect | Assessment |
|--------|-----------|
| Completeness | Good -- covers start, status, pause, resume, cancel, and signal |
| Type safety | Strong -- `WorkflowInstanceStatus.status` is a literal union, `variables` is `Record<string, unknown>` |
| No `any` usage | Correct |

**Findings:**

- **Line 12, status union:** The union `'Running' | 'Suspended' | 'Finished' | 'Cancelled' | 'Faulted' | 'Unknown'` matches ELSA v3 workflow instance statuses well. The `'Unknown'` fallback is a good defensive choice.

- **Line 20, `startWorkflow` return type:** Returns `Promise<string>` (instance ID). This is clean but loses type context -- callers must know the string is an instance ID. A branded type (`WorkflowInstanceId`) could improve clarity but is not strictly necessary at this stage.

- **Line 25, `sendSignal` payload:** `payload?: unknown` is correctly permissive for signal payloads that vary by signal type.

- **Missing:** No `healthCheck()` or `isAvailable()` method on the interface. The .NET `ElsaWorkflowService` has a health-check pattern (`EnsureHealthyAsync`). Adding this to the interface would allow the engine to verify ELSA connectivity at startup, mirroring what it does with `agent.isAvailable()`.

- **Missing:** No `listWorkflowDefinitions()` or `getWorkflowDefinition()`. Not required for Phase 2 MVP, but worth noting.

### 2.2 `packages/orchestrator/src/elsa-client.ts`

**Purpose:** HTTP client implementing `IWorkflowEngine` against the ELSA Server REST API.

| Aspect | Assessment |
|--------|-----------|
| Implements interface | Yes, `implements IWorkflowEngine` |
| Uses native `fetch` | Yes |
| Retry with backoff | Yes, exponential with max 3 attempts |
| No `any` usage | Correct |

**Findings:**

- **Lines 30-37, `startWorkflow` endpoint:** Uses `/api/workflow-definitions/by-name/{name}/execute`. However, the .NET `ElsaWorkflowService` (line 79) uses `/elsa/api/workflow-definitions/{workflowName}/execute` -- note the `/elsa` prefix and the absence of `by-name/`. This is a **critical mismatch**. Either:
  - The TS client expects a different ELSA API version or configuration (ELSA v3 has both routes, with the path depending on server configuration), or
  - One of them is wrong.

  **Recommendation:** Align the TS client endpoints with the .NET service, or make the path prefix configurable. At minimum, document which ELSA version/configuration each assumes.

- **Lines 72-79, `sendSignal` endpoint:** Uses `/api/workflow-instances/{instanceId}/signals/{signal}`. The .NET side (line 220) uses `/elsa/api/signals/{signalName}/execute` -- a **completely different endpoint shape**. The .NET endpoint is signal-name-scoped (not instance-scoped) and uses ELSA's signal dispatch API. The TS client uses an instance-scoped route that may not exist in standard ELSA v3.

  **Severity: HIGH.** This will fail at runtime if both sides target the same ELSA server.

- **Lines 64-69, `cancelWorkflow`:** Uses `POST /api/workflow-instances/{instanceId}/cancel`. The .NET side (line 157) uses `DELETE` on the same path. This is another **HTTP method mismatch**.

  **Severity: MEDIUM.** The correct method depends on the ELSA version. ELSA v3 generally uses `POST` for cancel, so the TS client may be correct and the .NET side may be the one that is wrong. This should be verified.

- **Lines 85-147, `request()` method:** The retry/backoff logic is well-structured:
  - Retries on 5xx and 429 (rate limiting) -- correct.
  - Retries on network errors (`TypeError` or messages containing "fetch") -- reasonable heuristic.
  - Non-retryable 4xx errors are thrown immediately -- correct.
  - Empty-body responses are handled for endpoints that return no content (line 134).

- **Line 134, `return undefined as unknown as T`:** This double-cast is a code smell. When `T` is `void`, the caller discards the return value anyway, so it works at runtime. A cleaner approach would be to have a separate `requestVoid()` helper that returns `Promise<void>`.

- **Line 136, network error detection:** `err instanceof TypeError || (err instanceof Error && err.message.includes('fetch'))` -- the `TypeError` check is correct for `fetch` network failures, but the string match on `'fetch'` is fragile. A custom error from any library containing "fetch" in its message would be incorrectly retried.

- **Lines 149-152, `backoff()`:** Pure exponential without jitter: `1000 * 2^attempt`. Adding random jitter would reduce thundering-herd effects when multiple clients retry simultaneously.

- **Lines 154-166, `mapInstanceResponse()`:** Clean mapping. The `.NET ElsaWorkflowInstance` (line 255 of `ElsaWorkflowService.cs`) uses `CurrentActivity` as a plain string, while the TS client expects `currentActivity: { activityId: string }`. This is a **potential deserialization mismatch** depending on what the ELSA server actually returns.

- **Lines 186-194, `ElsaInstanceResponse`:** Correctly kept as a private (non-exported) interface. Good encapsulation.

- **Missing:** No `AbortController` / timeout support on individual `fetch` calls. If the ELSA server hangs, the client will wait indefinitely (up to OS-level TCP timeout). Consider adding `signal: AbortSignal.timeout(ms)` to each fetch.

### 2.3 `packages/api/src/routes/engine-callback.ts`

**Purpose:** Fastify plugin registering `POST /api/engine/execute-task` and `POST /api/engine/agent-available`.

| Aspect | Assessment |
|--------|-----------|
| Fastify plugin pattern | Correct (`async function` with `FastifyInstance` + options) |
| Input validation | Partial -- manual check for `prompt` field only |
| Error handling | Good -- catches agent errors and returns structured 500 |
| No `any` usage | Correct |

**Findings:**

- **Lines 67-117, `/api/engine/execute-task`:** The route handler:
  - Validates that `prompt` is a non-empty string (line 75). Good.
  - Does **not** validate `analysisType` -- if it is provided, it is string-interpolated into the prompt (line 88). Not a security issue since it goes to the agent, not to a database, but schema validation would be more robust.
  - Measures elapsed time with `Date.now()` (line 91) -- adequate for millisecond-level precision.
  - Catches all errors and returns a structured `ExecuteTaskResponse` with `success: false` (line 113). Good.
  - Returns `500` for all agent errors (line 114). Some errors could arguably be `502 Bad Gateway` since the agent is an upstream service, but `500` is acceptable.

- **Lines 119-132, `/api/engine/agent-available`:** The route handler:
  - Swallows all errors and returns `{ available: false }` (line 128). Appropriate for a health-check endpoint.
  - Uses `POST` instead of `GET`. `GET` would be more semantically correct for a read-only availability check. However, POST is acceptable if the ELSA activity is always calling via POST.

- **Missing: No Fastify JSON schema validation.** Fastify supports declarative schemas for request bodies (`schema: { body: { ... } }`), which provide automatic 400 responses and potential serialization speedups. The manual `if (!prompt)` check works but doesn't leverage the framework.

- **Missing: No authentication/authorization.** The callback endpoints are wide open. In production, the ELSA server should authenticate when calling back. Consider requiring an API key or JWT in the `Authorization` header, potentially shared via `ElsaConfig`.

- **Not re-exported from `@tamma/api` index.** The `engineCallbackPlugin` function is not listed in `packages/api/src/index.ts` exports and is not wired into `createApp()`. Consumers must import directly from the route file, and there is no automatic registration path. This means the callback server must be set up manually by the CLI or service entrypoint.

### 2.4 `packages/orchestrator/src/engine.ts` (EngineContext changes)

**Purpose:** Add optional `workflowEngine` to `EngineContext`.

| Aspect | Assessment |
|--------|-----------|
| Backward compatible | Yes |
| Type-only import | Correct (`import type`) |
| No runtime usage yet | Correct |

**Findings:**

- **Line 15, import:** `import type { IWorkflowEngine } from './workflow-engine.js';` -- type-only import, zero runtime cost. Correct.

- **Line 43, `workflowEngine?: IWorkflowEngine`:** Optional property, so no existing code breaks. All 1072 lines of existing tests pass without providing this field (verified by inspecting `engine.test.ts` -- `createEngine()` does not set `workflowEngine`).

- **Constructor (lines 90-98):** The `workflowEngine` field is **not stored** on the engine instance. The constructor destructures `ctx` but only assigns `config`, `platform`, `agent`, `logger`, `eventStore`, `onStateChange`, and `approvalHandler`. The `workflowEngine` is accepted in the context but silently dropped.

  **Severity: MEDIUM.** This is technically backward-compatible and won't break anything, but it means the integration is structurally incomplete -- providing a `workflowEngine` to the engine has no effect. The plan presumably intends for the engine to use it in a future phase, but the current implementation discards it entirely. At minimum, it should be stored as `this.workflowEngine = ctx.workflowEngine` for future use.

### 2.5 `packages/shared/src/types/index.ts` (ElsaConfig + ServerConfig)

**Purpose:** Add ELSA and server configuration types to the shared config.

| Aspect | Assessment |
|--------|-----------|
| Type safety | Good |
| Optional on TammaConfig | Yes (`elsa?`, `server?`) |
| Backward compatible | Yes |

**Findings:**

- **Lines 109-114, `ElsaConfig`:**
  ```typescript
  export interface ElsaConfig {
    enabled: boolean;
    serverUrl: string;
    apiKey: string;
    callbackPort?: number;
  }
  ```
  Clean and sufficient. The `enabled` flag allows toggling ELSA integration without removing config. The `callbackPort` is optional, defaulting to the main server port presumably.

- **Lines 116-122, `ServerConfig`:**
  ```typescript
  export interface ServerConfig {
    port: number;
    host: string;
    jwtSecret: string;
    corsOrigins: string[];
    enableAuth: boolean;
  }
  ```
  Reasonable, though `jwtSecret` being a `string` (not a branded/opaque type) means it could accidentally be logged. Not a code issue per se, but worth being careful about in logging middleware.

- **`ElsaConfig` vs `ElsaClientConfig`:** The shared `ElsaConfig` has `serverUrl` and `apiKey` while the orchestrator's `ElsaClientConfig` has `baseUrl` and `apiKey`. The field name mismatch (`serverUrl` vs `baseUrl`) means constructing an `ElsaClient` from `TammaConfig.elsa` requires a manual mapping: `new ElsaClient({ baseUrl: config.elsa.serverUrl, apiKey: config.elsa.apiKey })`. This is workable but a potential source of confusion. Consider aligning the names.

- **Line 61, `TammaConfig.elsa?`:** Correctly optional. No breakage for consumers that don't use ELSA.

### 2.6 `packages/orchestrator/src/index.ts` (re-exports)

**Purpose:** Barrel exports for the orchestrator package.

**Findings:**

- **Line 3:** `export type { IWorkflowEngine, WorkflowInstanceStatus } from './workflow-engine.js';` -- type-only re-exports. Correct.
- **Line 4:** `export { ElsaClient } from './elsa-client.js';` -- value export for the concrete class. Correct.
- **Missing:** `ElsaClientConfig` is not re-exported. Consumers constructing an `ElsaClient` externally will need to import from the internal path or define their own compatible type. Should add: `export type { ElsaClientConfig } from './elsa-client.js';`

### 2.7 .NET Side: `ClaudeAnalysisActivity` callback mode

**Purpose:** When `Engine:CallbackUrl` is set, delegate analysis to the TS engine instead of calling Claude directly.

| Aspect | Assessment |
|--------|-----------|
| Three-mode dispatch | Clean (mock -> callback -> direct API) |
| Endpoint construction | Correct |
| Error handling | Relies on `EnsureSuccessStatusCode()` -- exceptions bubble to `catch` block |

**Findings:**

- **Lines 87-104, mode selection:** Priority order is Mock > Callback > Direct. This is correct: mock always wins for testing, callback takes precedence over direct API when configured. The empty-string check (`!string.IsNullOrEmpty(callbackUrl)`) properly treats unconfigured values as "not set."

- **Lines 190-207, `CallEngineCallback()`:**
  - Constructs the URL as `{callbackUrl}/api/engine/execute-task` (line 202). This matches the Fastify route exactly.
  - Sends `{ prompt, analysisType }` matching the `ExecuteTaskBody` interface in the TS callback route. Correct alignment.
  - Reads `output` from the response (line 206), matching the `ExecuteTaskResponse.output` field. Correct.
  - **No retry logic.** The direct Claude API path has retry for 429s (lines 154-164), but the callback path has none. If the TS engine is temporarily unavailable, the activity will fail immediately.
  - **No authentication.** As noted in the callback route review, neither side implements auth for the callback channel.

- **Lines 195-198, prompt construction:** Concatenates `systemPrompt + "\n\n" + userPrompt` into a single `prompt` field. The TS callback route then optionally prepends `[Analysis Type: ...]` (line 88-89 of `engine-callback.ts`). This means the analysis type appears twice in the final prompt (once via the enum stringification, once via the bracket prefix). Minor redundancy but not harmful.

- **Test coverage (ClaudeAnalysisActivityTests.cs):** Tests only cover constructor creation and output model properties. There are **no tests for the callback code path** (`CallEngineCallback`). The mock mode and direct API mode are also untested at the integration level.

---

## 3. Summary Table

| Requirement | Status | Notes |
|---|---|---|
| `IWorkflowEngine` interface in `workflow-engine.ts` | DONE | Complete, well-typed, missing optional `healthCheck()` |
| `ElsaClient` implements `IWorkflowEngine` | DONE | Functional but has endpoint path mismatches with .NET side |
| `ElsaClient` uses native `fetch` | DONE | No external HTTP library dependency |
| `ElsaClient` retry with exponential backoff | DONE | 3 retries, no jitter, no per-request timeout |
| Callback route `POST /api/engine/execute-task` | DONE | Works, no Fastify schema validation, no auth |
| Callback route `POST /api/engine/agent-available` | DONE | Swallows errors correctly |
| `ClaudeAnalysisActivity` callback mode | DONE | Uses `Engine:CallbackUrl`, no retry, no auth |
| `workflowEngine?` on `EngineContext` | PARTIAL | Field accepted but **not stored** on the engine instance |
| `ElsaConfig` in `TammaConfig` | DONE | Field name mismatch with `ElsaClientConfig` (`serverUrl` vs `baseUrl`) |
| `ServerConfig` in `TammaConfig` | DONE | Clean |
| Re-exports from `orchestrator/index.ts` | PARTIAL | `ElsaClientConfig` type not re-exported |
| Re-exports from `api/index.ts` | MISSING | `engineCallbackPlugin` not exported or wired into `createApp()` |
| Unit tests for `ElsaClient` | MISSING | No test file found |
| Unit tests for callback routes | MISSING | No test file found |
| Integration tests (TS <-> ELSA) | MISSING | Expected given Phase 2 scope |

---

## 4. Open Issues and Recommendations

### Critical (blocks correct runtime behavior)

1. **ELSA API endpoint mismatch -- signals.** The TS `ElsaClient.sendSignal()` calls `POST /api/workflow-instances/{instanceId}/signals/{signal}`, but the .NET `ElsaWorkflowService.SendSignalAsync()` calls `POST /elsa/api/signals/{signalName}/execute`. These are fundamentally different endpoints. Align them to whichever path the actual ELSA v3 server exposes (likely the .NET path, which uses the standard ELSA signal dispatch API).

2. **ELSA API endpoint mismatch -- start workflow.** The TS client uses `/api/workflow-definitions/by-name/{name}/execute` while .NET uses `/elsa/api/workflow-definitions/{workflowName}/execute`. The `/elsa` prefix and `by-name/` segment differ. Verify against the actual ELSA server configuration and align.

3. **ELSA API method mismatch -- cancel.** The TS client uses `POST` for cancel, the .NET side uses `DELETE`. One is wrong.

### High (functional gaps)

4. **`workflowEngine` not stored on `TammaEngine`.** The constructor accepts it via `EngineContext` but never assigns it to an instance field. Add `private readonly workflowEngine: IWorkflowEngine | undefined;` and `this.workflowEngine = ctx.workflowEngine;` in the constructor.

5. **No tests for `ElsaClient` or `engineCallbackPlugin`.** Both are untestable-by-convention right now. Add:
   - `elsa-client.test.ts` with mocked `fetch` (e.g., via `vi.stubGlobal` or `msw`) covering: success, retry on 500, retry on 429, non-retryable 4xx, network error retry, empty body handling.
   - `engine-callback.test.ts` with a real Fastify test instance and a mock `IAgentProvider`.

6. **`engineCallbackPlugin` not exported from `@tamma/api`.** Add it to `packages/api/src/index.ts` exports and optionally wire it into `createApp()` behind an option flag.

### Medium (robustness / best practices)

7. **No per-request timeout in `ElsaClient`.** Add `signal: AbortSignal.timeout(timeoutMs)` to `fetch` calls to prevent indefinite hangs.

8. **No jitter in backoff.** Add `+ Math.random() * INITIAL_BACKOFF_MS` to the delay calculation to avoid thundering-herd retries.

9. **No auth on callback routes.** Add an API key check (e.g., `Authorization: ApiKey <key>` header validation) to `engineCallbackPlugin`, with the key sourced from `ElsaConfig`.

10. **Callback route should use Fastify schema validation.** Replace the manual `if (!prompt)` check with a proper Fastify JSON schema on the route definition for automatic 400 responses and OpenAPI compatibility.

11. **Field name inconsistency: `ElsaConfig.serverUrl` vs `ElsaClientConfig.baseUrl`.** Rename one to match the other for consistency.

12. **`ElsaClientConfig` not re-exported from orchestrator barrel.** Add `export type { ElsaClientConfig } from './elsa-client.js';` to `packages/orchestrator/src/index.ts`.

### Low (minor improvements)

13. **`return undefined as unknown as T` double-cast (line 134).** Extract a `requestVoid()` helper that returns `Promise<void>` cleanly.

14. **Network error detection heuristic (line 136).** The `err.message.includes('fetch')` check is fragile. Consider catching only `TypeError` (which is what `fetch` throws for network errors) and checking `err.cause` for more specificity.

15. **Callback route uses POST for availability check.** `GET /api/engine/agent-available` would be more RESTful, but POST is acceptable if ELSA always uses POST.

16. **No retry in `CallEngineCallback` on the .NET side.** Add retry with backoff to match the direct Claude API path's resilience.

17. **`agent-available` response could include metadata.** Consider adding `model`, `provider`, or `version` fields to help ELSA workflows make routing decisions.

---

## 5. Verdict

Phase 2 establishes the correct architectural shape for Engine <-> ELSA integration. The interface design is clean, the HTTP client is functional, the callback routes are well-structured, and the shared types are properly extended. The `.NET` callback mode in `ClaudeAnalysisActivity` correctly bridges the two runtimes.

However, there are **three critical endpoint path mismatches** between the TS `ElsaClient` and the .NET `ElsaWorkflowService` that will cause runtime failures if both target the same ELSA server. These must be resolved before the integration can work end-to-end. Additionally, the `workflowEngine` field is accepted in `EngineContext` but silently discarded, and there are no tests for any of the new Phase 2 code on the TypeScript side.

**Recommended priority:**
1. Fix endpoint path alignment (critical items 1-3)
2. Store `workflowEngine` on the engine instance (item 4)
3. Add unit tests (item 5)
4. Export and wire `engineCallbackPlugin` (item 6)
5. Address robustness items (7-12) in a follow-up
