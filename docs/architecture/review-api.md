# API Package Review (`packages/api`)

**Branch:** `feat/engine-mvp`
**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-12

---

## Table of Contents

1. [Overview](#overview)
2. [Modified Files](#modified-files)
   - [package.json](#packagejson)
   - [tsconfig.json](#tsconfigjson)
   - [src/index.ts](#srcindexts)
   - [src/routes/knowledge-base/mcp-routes.ts](#srcroutesknowledge-basemcp-routests)
   - [src/services/knowledge-base/IndexManagementService.ts](#srcservicesknowledge-baseindexmanagementservicets)
   - [src/services/knowledge-base/MCPManagementService.ts](#srcservicesknowledge-basemcpmanagementservicets)
3. [New Files](#new-files)
   - [src/auth/index.ts](#srcauthindexts)
   - [src/engine-registry.ts](#srcengine-registryts)
   - [src/persistence/workflow-store.ts](#srcpersistenceworkflow-storets)
   - [src/routes/engine/index.ts](#srcroutesengineindexts)
   - [src/routes/engine-callback.ts](#srcroutesengine-callbackts)
   - [src/routes/workflows/index.ts](#srcroutesworkflowsindexts)
   - [src/routes/dashboard/index.ts](#srcroutesdashboardindexts)
4. [Cross-Cutting Concerns](#cross-cutting-concerns)
5. [Summary & Overall Quality](#summary--overall-quality)
6. [Prioritized Issue List](#prioritized-issue-list)

---

## Overview

The `@tamma/api` package has been expanded from a placeholder into a fully structured Fastify REST API server with:
- JWT authentication plugin
- Engine control routes (command, state, SSE streams, history)
- Engine callback routes (ELSA workflow -> agent delegation)
- Workflow synchronization routes (ELSA bridge)
- Dashboard aggregation routes
- Multi-engine registry
- In-memory workflow persistence layer
- Knowledge-base management routes (pre-existing, now with MCP routes)

The architecture follows a clean plugin-based composition pattern with dependency injection through `CreateAppOptions`. All route modules are registered conditionally based on provided options, making the API composable and testable.

---

## Modified Files

### package.json

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/package.json`

**Changes:** Added `zod`, `@fastify/jwt`, `fastify-plugin`, and `@tamma/providers` as dependencies. Added `@tamma/orchestrator` reference.

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Low | `zod` is declared as a dependency but is only used in `src/schemas/knowledge-base/validation-schemas.ts`. None of the new MVP files use Zod for request validation. This is a missed opportunity -- the new routes do manual validation instead of using the schema library that is already a dependency. |
| 2 | Low | `@fastify/helmet` is declared but never imported anywhere in the source files. It should either be registered in `createApp()` for security headers or removed as a dependency. |
| 3 | Info | The dev dependency on `tsx` (for `dev` script) and `typescript` is appropriate. No issues. |

---

### tsconfig.json

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/tsconfig.json`

**Changes:** Added project references for `../orchestrator` and `../providers`.

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | None | Clean and correct. References match the runtime imports. Composite builds with `.tsbuildinfo` are properly configured. |

---

### src/index.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/index.ts`

**Changes:** Expanded from a simple `createApp(services?: KBServices)` to a full `createApp(options?: CreateAppOptions)` with conditional registration of auth, engine, workflow, and dashboard plugins.

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | High | **CORS is wide open:** `origin: true` allows any origin. For an MVP this may be acceptable, but it should be documented as a known security gap and replaced with a configurable allowlist before production. |
| 2 | Medium | **No Helmet registration:** `@fastify/helmet` is in `package.json` but never registered. This means no `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or other security headers are sent. |
| 3 | Medium | **Logger disabled:** `Fastify({ logger: false })` suppresses all request logging. For a production API server, structured logging is critical. Consider making this configurable via `CreateAppOptions`. |
| 4 | Low | **Engine callback routes not registered:** The `engineCallbackPlugin` from `./routes/engine-callback.ts` is exported as a standalone plugin but is never wired into `createApp()`. Consumers must manually register it, but this is not documented in the `CreateAppOptions` interface. Consider adding an `agentCallback?: EngineCallbackOptions` field. |
| 5 | Low | **No global error handler:** There is no custom `setErrorHandler` on the Fastify instance. Unhandled errors in route handlers will produce Fastify's default 500 response, which may leak stack traces in development. |
| 6 | Info | The conditional plugin registration pattern (`if (options?.auth !== undefined)`) is clean and allows gradual feature enablement. Good design. |
| 7 | Info | The `{ prefix: '' }` on sub-registrations is redundant but harmless. |

---

### src/routes/knowledge-base/mcp-routes.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/routes/knowledge-base/mcp-routes.ts`

**Changes:** New file (shown in git as new in the diff against main).

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **No input validation on tool invoke body:** The `POST /mcp/servers/:name/tools/:tool/invoke` endpoint casts `request.body as { arguments?: Record<string, unknown> }` without any validation. A malformed body (e.g., `arguments` is a string) will be silently passed through. |
| 2 | Medium | **Route parameter `:name` not sanitized:** The `name` parameter is used directly in service lookups. While the in-memory Map is safe, if the service layer ever does file system or shell operations based on `name`, this becomes an injection vector. |
| 3 | Low | **Inconsistent error status codes:** The restart endpoint returns `500` on error, while start/stop return `409`. All three are operational errors that should probably share the same status code pattern (e.g., `409` for conflict, `500` for unexpected errors). |
| 4 | Low | **No pagination on log endpoint:** `GET /mcp/servers/:name/logs` accepts a `limit` query param but has no `offset`/`page`, making it hard for clients to paginate through long log histories. |
| 5 | Low | **Type assertion instead of Fastify schema:** Uses `request.params as { name: string }` throughout instead of Fastify's generic type parameter `FastifyRequest<{ Params: { name: string } }>`. This bypasses Fastify's built-in type narrowing. |

---

### src/services/knowledge-base/IndexManagementService.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/services/knowledge-base/IndexManagementService.ts`

**Changes:** New file.

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **Simulated implementation with `setTimeout`:** The `triggerIndex` method uses `setTimeout` to simulate indexing. The timer handle is stored in `this.indexingTimer`, but if the service is garbage-collected before the timer fires, the timer callback will execute against stale/freed memory. The `dispose()` method exists but must be reliably called. |
| 2 | Medium | **`_request` parameter unused:** The `triggerIndex` accepts an optional `TriggerIndexRequest` parameter that is never used (prefixed with `_`). The request's `fullReindex` or `paths` fields are ignored. |
| 3 | Low | **Random data in simulated output:** `Math.random()` in `filesIndexed` and `chunksCreated` will produce different results every call, making testing difficult. Consider a deterministic stub or a flag for test mode. |
| 4 | Low | **Unbounded history growth:** The `history` array grows without limit (items are `unshift`ed). Over time this will consume increasing memory. Consider capping at a maximum size. |
| 5 | Info | The `cancelIndex` implementation correctly clears the timer and resets state. Good defensive programming. |

---

### src/services/knowledge-base/MCPManagementService.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/services/knowledge-base/MCPManagementService.ts`

**Changes:** New file.

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **Hardcoded seed data in constructor:** The service starts with pre-configured `filesystem`, `github`, and `memory` servers. This is fine for a demo/MVP but should be injected or loaded from configuration. |
| 2 | Medium | **`setTimeout` without cleanup handle:** The `startServer` method uses `setTimeout` to simulate startup but does not store the timer handle. There is no way to cancel the pending transition, and there is no `dispose()` method. If the service is torn down during a pending start, the callback will mutate state after teardown. |
| 3 | Medium | **`randomUUID` imported but never used:** The import `import { randomUUID } from 'node:crypto'` is present but unused in the working tree version of this file. |
| 4 | Low | **`listTools` returns hardcoded tool lists:** The tool lists for `filesystem` and `github` are hardcoded inline rather than derived from the server state. If a server is disconnected, `listTools` still returns its tools. |
| 5 | Low | **Unbounded log growth:** Logs are stored in a `Map<string, MCPServerLog[]>` that grows without limit. No pruning or rotation. |
| 6 | Low | **`invokeTool` simulates results:** The `invokeTool` method returns a fake success result without actually invoking anything. The `durationMs` calculation includes random jitter (`Math.floor(Math.random() * 50)`) added to a near-zero measured time. |

---

## New Files

### src/auth/index.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/auth/index.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Critical** | **Fallback JWT secret in production path:** Line 77 -- `jwtSecret \|\| 'dev-secret-do-not-use-in-production'`. If `enableAuth` is `true` but `jwtSecret` is empty/undefined, the plugin silently falls back to a well-known secret. An attacker who knows this default can forge valid JWTs. The plugin should **throw an error** when `enableAuth` is true and `jwtSecret` is falsy. |
| 2 | **Critical** | **Login always fails when auth is enabled:** Lines 133-135 -- when `enableAuth` is `true`, the login endpoint returns `401` for **all** credentials with a placeholder comment "reject all logins until a real user store is wired up." This means the auth system cannot actually authenticate anyone when it is turned on. |
| 3 | High | **API key comparison is not timing-safe:** Line 198 -- `apiKeys.includes(apiKey)` uses JavaScript's standard string comparison, which is vulnerable to timing side-channel attacks. Use `crypto.timingSafeEqual` (with fixed-length buffers) or a constant-time comparison library. |
| 4 | High | **No rate limiting on auth endpoints:** The login, refresh, and API key endpoints have no rate limiting. An attacker can brute-force credentials or API keys without restriction. |
| 5 | High | **Refresh token not invalidated after use:** The refresh endpoint issues a new access token but does not rotate or invalidate the old refresh token. This allows unlimited token refreshes from a single stolen refresh token. |
| 6 | Medium | **`publicPaths` uses `startsWith` matching:** Line 100 -- `request.url.startsWith(p)` means `/api/auth/login-anything` would also be treated as a public path. Use exact matching or proper path pattern matching. |
| 7 | Medium | **Role not validated on decode:** Line 110 -- `decoded.role as AuthUser['role']` does an unchecked type assertion. If a JWT contains `role: 'superadmin'`, it will be silently accepted. Validate against the union `'admin' | 'operator' | 'viewer'`. |
| 8 | Medium | **No RBAC enforcement anywhere:** Roles are captured but never checked. All authenticated users have equal access. The role system is declared but not enforced. |
| 9 | Low | **Dev mode grants admin to stub user:** When `enableAuth` is `false`, every request gets `STUB_USER` with `role: 'admin'`. This is expected for development but should be prominently documented. |
| 10 | Low | **Dynamic import of `@fastify/jwt`:** Line 76 -- `await import('@fastify/jwt').then((m) => m.default ?? m)`. The dynamic import with `.then()` is unusual; a static import at the top of the file would be cleaner and benefit from tree-shaking. |

---

### src/engine-registry.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/engine-registry.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Low | **No concurrency protection:** `register()`, `dispose()`, and `disposeAll()` are not protected against concurrent calls. If `disposeAll()` is called while a `register()` is in progress, the new engine may be registered into a registry that is being cleared. This is unlikely in single-threaded Node.js but could occur with interleaved async operations. |
| 2 | Low | **`dispose()` silently ignores unknown IDs:** If `dispose('nonexistent')` is called, it silently returns. This is a reasonable choice but should be documented or optionally throw. |
| 3 | Info | Clean, minimal class with a well-defined interface. The `list()` method correctly queries live engine state. Good design. |
| 4 | Info | The `size` getter is a nice touch for testing and dashboard use. |

---

### src/persistence/workflow-store.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/persistence/workflow-store.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **`listInstances` pagination with `pageSize: 0`:** When the dashboard routes call `listInstances({ pageSize: 0 })`, the `slice(start, start + 0)` returns an empty array for `data` -- only `total` is meaningful. This works but is a code smell; a dedicated `countInstances()` method would be clearer. |
| 2 | Medium | **No ordering guarantee on `listInstances`:** The `Map` iteration order is insertion order. There is no sorting by `createdAt` or `updatedAt`, which means paginated results may not be in a predictable chronological order if instances are created and updated in different sequences. |
| 3 | Low | **`upsertDefinition` ignores version conflicts:** When upserting, the spread `{ ...existing, ...def }` simply overwrites. There is no optimistic concurrency check on `version`. A concurrent upsert could silently overwrite a newer version with an older one. |
| 4 | Low | **`createInstance` accepts `id` as optional but the type says it is required:** `WorkflowInstance.id` is typed as `string` (non-optional), but `createInstance` has `instance.id || randomUUID()`, suggesting `id` can be empty. The type should reflect this with `id?: string`. |
| 5 | Info | The `IWorkflowStore` interface is clean and well-designed for future replacement with SQLite/PostgreSQL. Good abstraction boundary. |
| 6 | Info | Immutability of `id` in `updateInstance` is a good defensive practice. |

---

### src/routes/engine/index.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/routes/engine/index.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Critical** | **`pause` calls `engine.dispose()` -- destructive and misleading:** Lines 112-114 -- the `pause` command calls `engine.dispose()`, which is the same as `stop`. The comment says "Pause is advisory; the engine checks a running flag each iteration," but `dispose()` is not a pause operation -- it tears down the engine. If the engine's `dispose()` releases resources (connections, timers, event store), then "resume" after "pause" would attempt to `engine.run()` on a disposed engine. |
| 2 | High | **`approve`, `reject`, `skip` are not actually forwarded:** Lines 121-126 -- these commands return `{ ok: true, note: 'Forwarded to approval handler' }` but do nothing. The comment says "must be wired through the approval callback at construction time," but there is no mechanism to resolve the approval promise from the HTTP layer. These endpoints are effectively no-ops that lie to the client. |
| 3 | High | **SSE state stream polls every 1 second unconditionally:** Lines 148-154 -- the state SSE endpoint polls and pushes the full engine snapshot every second regardless of whether state has changed. For N connected clients, this means N * `buildSnapshot()` calls per second. The snapshot rebuilds stats and queries plan/issue/branch on every tick. Consider event-driven push using `onStateChange` callback instead. |
| 4 | High | **SSE log stream has same-timestamp race:** Lines 175-178 -- `events.filter((e) => e.timestamp > lastSeen)` will miss events that share the same millisecond timestamp as the last seen event. This is a known issue per the project's MEMORY.md ("same-millisecond timestamp races need monotonic increment"). Use `>=` with an event ID or sequence number instead. |
| 5 | Medium | **SSE endpoints do not call `reply.hijack()`:** Fastify expects you to call `reply.hijack()` when taking over the raw response. Without it, Fastify may attempt to send its own response after the handler returns, leading to "Reply already sent" errors or double-writes. |
| 6 | Medium | **No `Content-Type` validation on POST /api/engine/command:** The endpoint does not verify that the request has `Content-Type: application/json`. A client sending `text/plain` may cause unexpected parsing behavior. |
| 7 | Medium | **`void engine.run()` is fire-and-forget with no error handling:** Lines 103 and 118 -- if `engine.run()` rejects (throws), the rejection is silently swallowed. Use `.catch()` to at least log the error, or store the promise for later inspection. |
| 8 | Low | **`EngineCommand` type not validated at runtime:** The `switch` has a `default` case, but the command body could have additional unexpected fields. Consider using Zod (already a dependency) to validate. |
| 9 | Low | **History endpoint loads all events into memory:** Line 221 -- `store.getEvents(issueNumber)` returns all matching events, then slices for pagination. For a large event store, this is O(n) memory. |

---

### src/routes/engine-callback.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/routes/engine-callback.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | High | **No authentication on callback endpoints:** The `execute-task` and `agent-available` endpoints are registered without any auth check. Since these endpoints execute agent tasks (which can run arbitrary code via CLI agents), they must be protected. An unauthenticated attacker on the network could trigger expensive agent operations. |
| 2 | Medium | **No request body size limit:** The `prompt` field in `execute-task` can be arbitrarily large. A malicious ELSA server (or network attacker) could send a multi-gigabyte prompt. Configure Fastify's `bodyLimit` for this route. |
| 3 | Medium | **`analysisType` injected into prompt without sanitization:** Line 88 -- `taskConfig.prompt = \`[Analysis Type: ${analysisType}]\n\n${prompt}\`` directly interpolates user input into the prompt. While this is prompt construction (not SQL/shell), it could be used for prompt injection attacks against the LLM agent. |
| 4 | Low | **Not wired into `createApp()`:** As noted above, this plugin is exported but not integrated into the main app factory. Consumers must know to register it separately. |
| 5 | Low | **`agent-available` is POST but has no body:** Convention would be GET for idempotent status checks. Using POST for a read-only operation is non-standard. |
| 6 | Info | Good error handling pattern: catch block returns structured error response with timing info rather than crashing. |

---

### src/routes/workflows/index.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/routes/workflows/index.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **No input validation on `POST /api/workflows/definitions`:** Only `id` and `name` are checked. The `version` field (a number) is not validated -- a string value would pass. The `activities` array is unvalidated and typed as `unknown[]`. Consider Zod schemas. |
| 2 | Medium | **No input validation on `POST /api/workflows/instances`:** Only `definitionId` is checked. The `status`, `variables`, and other fields are unvalidated. A client could inject arbitrary data. |
| 3 | Medium | **`PUT /api/workflows/instances/:id` allows overwriting `definitionId`:** The `update` body is `Partial<WorkflowInstance>`, which includes `definitionId`. While the store protects `id` from being changed, `definitionId` can be mutated, which could break referential integrity. |
| 4 | Medium | **SSE endpoint for instance events has same issues as engine SSE:** No `reply.hijack()`, polling-based, and the `async` callback in `setInterval` can silently swallow errors. |
| 5 | Low | **Upsert returns 201 even for updates:** `POST /api/workflows/definitions` always returns `201 Created`, even when it updates an existing definition. Should return `200` for updates and `201` for creates. |
| 6 | Low | **`definitionId` filter uses `|| undefined`:** Line 125 -- `request.query.definitionId || undefined` will treat empty string as undefined, which is correct, but also treats `'0'` or `'false'` as undefined due to JavaScript truthiness. Use `=== '' ? undefined : value` or nullish coalescing. |

---

### src/routes/dashboard/index.ts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/api/src/routes/dashboard/index.ts`

**Findings:**

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **`any` type assertion in sort comparator:** Line 47 -- `(a: any, b: any) => (b.timestamp ?? 0) - (a.timestamp ?? 0)` uses `any`, bypassing TypeScript's type safety. Define a proper type for the enriched event objects. |
| 2 | Medium | **Redundant engine lookup:** Lines 34-36 -- `engineRegistry.list()` is called first, then inside the loop `engineRegistry.get(info.id)` is called again. The `list()` method already iterates the engines; consider returning the engine instances directly or using a different method. |
| 3 | Low | **No pagination on `/api/dashboard/workflows`:** Returns all workflow definitions at once. If there are many definitions, this could be a large payload. |
| 4 | Low | **N+1 query pattern:** The workflows endpoint calls `listInstances()` once per definition in a `Promise.all()`. While acceptable for in-memory stores, this pattern will be problematic when a real database is introduced. |
| 5 | Info | The `pageSize: 0` trick for counting instances works but is semantically odd (see workflow-store findings above). |

---

## Cross-Cutting Concerns

### 1. Test Coverage

The new files have **zero test coverage**. The only existing tests are for the pre-existing knowledge-base routes. The following areas are particularly risky without tests:
- Auth plugin (JWT signing/verification, public path bypass, role handling)
- Engine command routing (pause/stop confusion, SSE lifecycle)
- Workflow store (pagination edge cases, concurrent updates)

### 2. Input Validation Strategy

The codebase has `zod` as a dependency and uses it in `src/schemas/knowledge-base/validation-schemas.ts`, but none of the new routes use Zod schemas. Instead, they perform ad-hoc manual validation (`if (!body.id || !body.name)`). This is inconsistent and error-prone. Recommend standardizing on Zod validation with Fastify's schema support (`fastify-type-provider-zod`).

### 3. SSE Implementation

Three separate SSE implementations exist (engine state, engine logs, workflow instance events) with duplicated logic for:
- Setting SSE headers
- Polling intervals
- Cleanup on close

All three share the same issues:
- No `reply.hijack()` call
- No heartbeat/keepalive pings (reverse proxies may close idle connections)
- Polling-based rather than event-driven
- No reconnection support (no `Last-Event-ID` handling)

Recommend extracting a shared SSE helper that handles these concerns.

### 4. Error Handling Consistency

Error responses vary in shape across routes:
- Engine routes: `{ error: string }`
- MCP routes: `{ error: string }`
- Workflow routes: `{ error: string }`
- Engine callback: `ExecuteTaskResponse` with `success: false`

This is mostly consistent, but there is no standard error envelope (e.g., `{ error: { code: string, message: string } }`).

### 5. Security Posture

For an MVP, the security posture has several concerning gaps:
- CORS allows all origins
- Helmet not registered (no security headers)
- Auth endpoints lack rate limiting
- Engine callback endpoints are unauthenticated
- API key comparison is not timing-safe
- JWT secret has a dangerous fallback default

### 6. Memory Management

All state is in-memory (workflow store, event store, MCP server state). Multiple `setTimeout` callbacks exist without guaranteed cleanup. The `IndexManagementService` has a `dispose()` method, but `MCPManagementService` does not. Neither the engine registry's `disposeAll()` nor the workflow store has cleanup hooks in the Fastify lifecycle (e.g., `onClose`).

---

## Summary & Overall Quality

**Overall Grade: B-** (Good structure, significant security gaps, no tests for new code)

**Strengths:**
- Clean modular architecture with well-separated concerns
- Good use of Fastify plugin composition pattern
- `CreateAppOptions` provides a flexible, testable configuration surface
- `IWorkflowStore` interface is well-designed for future persistence backends
- `EngineRegistry` is minimal and focused
- Consistent async/await usage throughout
- Good JSDoc comments on public APIs

**Weaknesses:**
- No test coverage for any new code
- Multiple security vulnerabilities in the auth plugin
- SSE implementation is fragile (no hijack, no heartbeat, polling-based)
- `pause` command is destructive (calls `dispose()`)
- Approval commands (`approve`, `reject`, `skip`) are no-ops
- Input validation is ad-hoc instead of using the already-installed Zod
- Simulated/stub implementations throughout services

---

## Prioritized Issue List

### P0 -- Must Fix Before Merge

| # | File | Issue |
|---|------|-------|
| 1 | `auth/index.ts` | JWT secret falls back to well-known default when `enableAuth` is true. Throw an error instead. |
| 2 | `routes/engine/index.ts` | `pause` command calls `engine.dispose()`, which is destructive and not a pause. Implement a proper pause mechanism or document this as "stop." |
| 3 | `routes/engine-callback.ts` | Callback endpoints have no authentication. An unauthenticated attacker can trigger expensive agent tasks. |

### P1 -- High Priority

| # | File | Issue |
|---|------|-------|
| 4 | `auth/index.ts` | API key comparison (`apiKeys.includes()`) is not timing-safe. |
| 5 | `auth/index.ts` | Login always fails when `enableAuth` is true. The auth system is non-functional in production mode. |
| 6 | `routes/engine/index.ts` | SSE log stream has same-timestamp race condition; events may be dropped. |
| 7 | `routes/engine/index.ts` | `approve`/`reject`/`skip` commands are no-ops that return success. |
| 8 | `routes/engine/index.ts` | `void engine.run()` swallows promise rejections. |
| 9 | `routes/engine/index.ts` | SSE endpoints do not call `reply.hijack()`. |
| 10 | `index.ts` | Helmet not registered despite being in package.json. No security headers. |
| 11 | `auth/index.ts` | No rate limiting on auth endpoints. |

### P2 -- Medium Priority

| # | File | Issue |
|---|------|-------|
| 12 | `auth/index.ts` | `publicPaths` uses `startsWith` matching -- overly permissive. |
| 13 | `auth/index.ts` | JWT role is cast without validation. |
| 14 | `auth/index.ts` | Refresh token not invalidated after use. |
| 15 | `routes/engine/index.ts` | SSE state stream polls unconditionally every second per client. |
| 16 | `routes/workflows/index.ts` | Insufficient input validation on definition and instance creation. |
| 17 | `routes/workflows/index.ts` | `PUT` allows overwriting `definitionId`. |
| 18 | `routes/knowledge-base/mcp-routes.ts` | Tool invoke body not validated. |
| 19 | `routes/engine-callback.ts` | No request body size limit on prompt field. |
| 20 | `routes/dashboard/index.ts` | `any` type assertion in sort comparator. |
| 21 | `persistence/workflow-store.ts` | No ordering guarantee on paginated `listInstances`. |
| 22 | `services/knowledge-base/MCPManagementService.ts` | `setTimeout` in `startServer` has no cleanup handle. |
| 23 | All new files | Zero test coverage. |

### P3 -- Low Priority / Improvements

| # | File | Issue |
|---|------|-------|
| 24 | `index.ts` | Logger disabled; should be configurable. |
| 25 | `routes/workflows/index.ts` | Upsert always returns 201 even for updates. |
| 26 | `persistence/workflow-store.ts` | No optimistic concurrency on definition version. |
| 27 | `persistence/workflow-store.ts` | `createInstance` type says `id` is required but code treats it as optional. |
| 28 | `routes/knowledge-base/mcp-routes.ts` | Inconsistent error status codes across start/stop/restart. |
| 29 | `routes/engine-callback.ts` | `agent-available` should be GET, not POST. |
| 30 | `services/knowledge-base/IndexManagementService.ts` | Unbounded history array growth. |
| 31 | `services/knowledge-base/MCPManagementService.ts` | Unbounded log growth. |
| 32 | `services/knowledge-base/MCPManagementService.ts` | Unused `randomUUID` import. |
| 33 | `routes/knowledge-base/mcp-routes.ts` | Type assertions instead of Fastify generic params. |
| 34 | All SSE endpoints | No heartbeat pings, no `Last-Event-ID` support, no shared SSE helper. |
| 35 | All new routes | Should use Zod schemas instead of manual validation. |
| 36 | `index.ts` | Engine callback plugin not integrated into `createApp()`. |
| 37 | `package.json` | `@fastify/helmet` declared but unused. |
