# Phase 4 "Server" Implementation Review

**Reviewer:** Claude Opus 4.6 (automated)
**Date:** 2026-02-12
**Branch:** `feat/engine-mvp`

---

## 1. Phase Overview

Phase 4 adds an HTTP server layer to the Tamma engine, exposing the `TammaEngine` over REST/SSE so that dashboards, remote CLIs, and CI tooling can interact with the engine over the network. The planned deliverables are:

| Deliverable | Description |
|---|---|
| Engine REST/SSE routes | 7 endpoints under `/api/engine/*` |
| JWT authentication | Login, refresh, API-key flows via `@fastify/jwt` |
| Multi-engine registry | `EngineRegistry` managing multiple concurrent engine instances |
| CLI `server` command | `tamma server` starts the Fastify server with all plugins |
| CLI `--server` flag | `tamma start --server http://...` drives the engine via `RemoteTransport` |
| `ServerConfig` in config | Typed config for port, host, JWT secret, CORS, auth enable |

---

## 2. File-by-File Review

### 2.1 `packages/api/src/routes/engine/index.ts` -- Engine REST/SSE Routes

**All 7 planned endpoints are implemented:**

| Endpoint | Method | Status |
|---|---|---|
| `/api/engine/command` | POST | Implemented |
| `/api/engine/state` | GET | Implemented |
| `/api/engine/events/state` | GET (SSE) | Implemented |
| `/api/engine/events/logs` | GET (SSE) | Implemented |
| `/api/engine/stats` | GET | Implemented |
| `/api/engine/plan` | GET | Implemented |
| `/api/engine/history` | GET | Implemented |

**Findings:**

1. **Command type mismatch (Medium Severity).** The route's `EngineCommand` type uses `action` as the discriminator field (e.g., `{ action: 'start' }`), while the `IEngineTransport` contract in `@tamma/shared/contracts/engine-transport.ts` and `RemoteTransport` use `type` (e.g., `{ type: 'start' }`). This means a `RemoteTransport` client sending `{ type: 'start' }` to the server will receive a 400 error ("Missing or invalid action"). These types have diverged and need reconciliation.

2. **`pause` delegates to `engine.dispose()` (Bug).** Lines 113-114 implement `pause` by calling `engine.dispose()`, which fully tears down the engine rather than pausing it. This is identical to the `stop` behavior. A paused engine should retain its state and be resumable, but after `dispose()` the engine is destroyed. Similarly, `resume` calls `engine.run()` which creates a brand-new run loop -- not a resumption of the prior one.

3. **`approve`/`reject`/`skip` commands are no-ops.** Lines 121-126 return `{ ok: true, note: 'Forwarded to approval handler' }` but do not actually resolve any pending approval promise. The engine's approval handler is set at construction time and the server layer has no reference to it. The approval flow over HTTP is non-functional.

4. **SSE state stream uses polling, not event-driven push.** Lines 148-154 poll `buildSnapshot(engine)` every 1 second regardless of whether state changed. This generates unnecessary network traffic. An event-driven approach (subscribing to engine state changes) would be more efficient, though the polling approach is functional.

5. **SSE log stream filters by timestamp (potential duplicates/misses).** Lines 175-178 use `e.timestamp > lastSeen` to find new events. If two events share the same millisecond timestamp, only one is delivered. The `lastSeen` should track an index or sequence number rather than a timestamp.

6. **No Fastify schema validation.** The POST `/api/engine/command` endpoint does manual validation (`typeof cmd.action !== 'string'`), but does not use Fastify's built-in JSON schema validation. While functional, this misses out on automatic 400 responses, OpenAPI generation, and type coercion that Fastify schemas provide.

7. **History pagination works correctly.** Page and pageSize are clamped, optional `issueNumber` filter is supported. Implementation is clean.

### 2.2 `packages/api/src/auth/index.ts` -- JWT Authentication

**All 3 auth endpoints are implemented:**

| Endpoint | Method | Status |
|---|---|---|
| `/api/auth/login` | POST | Implemented (placeholder) |
| `/api/auth/refresh` | POST | Implemented |
| `/api/auth/api-key` | POST | Implemented |

**Findings:**

1. **Login always rejects when auth is enabled (Intentional but limiting).** Lines 133-135: when `enableAuth` is true, the login endpoint returns 401 for all credentials because there is no user store. This is documented as a placeholder, but it means production auth mode is login-broken. Only API-key auth works in production.

2. **Dev mode bypass works correctly.** When `enableAuth` is false, the global `onRequest` hook decorates every request with a `STUB_USER` (admin role). All routes pass through without token verification.

3. **Refresh token flow is correct.** The refresh endpoint verifies the refresh token, checks for `type: 'refresh'` to prevent access tokens being used as refresh tokens, and issues a new access token.

4. **API-key auth works but bypasses validation when auth is disabled.** Lines 198-199: when `enableAuth` is false, any API key (even invalid ones) is accepted and returns a JWT. This is consistent with dev mode behavior but should be documented.

5. **JWT secret has an insecure default.** Line 77: `secret: jwtSecret || 'dev-secret-do-not-use-in-production'`. If `jwtSecret` is an empty string, the fallback is used. The server command (line 80 in `server.ts`) uses `process.env['TAMMA_JWT_SECRET'] ?? 'dev-secret'`, so if the env var is unset, the server runs with a predictable secret. There is no warning logged.

6. **`/api/auth/refresh` is not in the public paths list.** Line 99: the `publicPaths` array includes `/api/auth/login` and `/api/auth/api-key` but not `/api/auth/refresh`. This means a valid JWT is required to call the refresh endpoint, which defeats the purpose -- you cannot refresh an expired token because you need a valid token to make the request. This is a **bug**.

7. **Correct use of `fastify-plugin`.** The auth plugin is wrapped with `fp()` so that decorations (like `authUser`) propagate to the parent Fastify instance, ensuring downstream route handlers can access the auth user.

### 2.3 `packages/api/src/engine-registry.ts` -- Multi-Engine Registry

**Findings:**

1. **Clean, minimal implementation.** The `EngineRegistry` class wraps a `Map<string, TammaEngine>` with `register`, `get`, `list`, `dispose`, `disposeAll` methods.

2. **Duplicate ID check is present.** Line 25: `register()` throws if an engine with the same ID already exists. This is correct.

3. **`dispose()` is safe for unknown IDs.** Lines 57-59: calling `dispose('nonexistent')` is a silent no-op. This is reasonable.

4. **`disposeAll()` runs in parallel.** Line 70: `Promise.all(ids.map(...))` disposes all engines concurrently. This is good for performance but could mask individual disposal errors -- if one engine fails to dispose, the entire `Promise.all` rejects and other engines may not complete disposal. Should use `Promise.allSettled` instead.

5. **No thread safety concern.** JavaScript is single-threaded, so the `Map` operations are inherently safe. However, the `disposeAll` method takes a snapshot of keys before iterating, which correctly handles the case where `dispose` removes entries from the map during iteration.

6. **No `unregister` method (without dispose).** If you want to remove an engine from the registry without disposing it (e.g., for transferring ownership), there is no API for that. Minor gap.

### 2.4 `packages/cli/src/commands/server.ts` -- CLI `server` Command

**Findings:**

1. **Wires everything together correctly.** The command loads config, validates it, creates platform + agent + event store + engine, registers the engine with an `EngineRegistry`, creates a workflow store, and passes everything to `createApp()`.

2. **Graceful shutdown is implemented.** Lines 88-100: SIGINT and SIGTERM handlers call `engineRegistry.disposeAll()` and `app.close()`. This is correct.

3. **`ServerConfig` from `TammaConfig` is not used.** The `TammaConfig` type has a `server?: ServerConfig` field with `port`, `host`, `jwtSecret`, `corsOrigins`, `enableAuth`, but `server.ts` ignores it entirely. Port and host come from `ServerOptions` (CLI flags); JWT secret comes from `TAMMA_JWT_SECRET` env var; auth enable comes from `TAMMA_ENABLE_AUTH` env var. The `corsOrigins` field from `ServerConfig` is never read -- CORS is configured as `origin: true` (allow all) in `createApp`. This is a gap in config unification.

4. **No test coverage.** There are no test files for the server command.

5. **Engine initialization happens before server start.** Line 67: `engine.initialize()` is awaited before `app.listen()`. This is correct -- the engine must be ready before accepting requests.

### 2.5 `packages/api/src/index.ts` -- Updated `createApp` with Options

**Findings:**

1. **`CreateAppOptions` interface is well-structured.** All plugins are optional, with sensible defaults (e.g., in-memory workflow store, dev mode auth).

2. **Plugin registration order is correct.** Auth is registered before engine/workflow/dashboard routes, ensuring the `onRequest` hook runs before route handlers.

3. **CORS is configured as `origin: true` (allow all origins).** Line 70. The `ServerConfig.corsOrigins` field is never consulted. In production this would need to be restricted.

4. **Health check endpoint is present.** `/api/health` returns `{ status: 'ok', timestamp }` and is listed in the auth plugin's public paths.

5. **`@fastify/helmet` is listed as a dependency but never used.** The `package.json` includes `@fastify/helmet` (security headers), but it is not registered anywhere in `createApp` or any other plugin. This means the server lacks standard security headers (X-Frame-Options, Content-Security-Policy, etc.).

6. **Dashboard routes require both `engineRegistry` and `workflowStore`.** Line 104. If only one is provided, dashboard routes are silently skipped. This is a reasonable design choice.

### 2.6 CLI `--server` Flag in `tamma start` -- **NOT IMPLEMENTED**

**CRITICAL: The `--server` flag was not added to the `tamma start` command.**

The `start.tsx` file has no reference to `--server`, `RemoteTransport`, or any server URL configuration. The `CLIOptions` interface in `config.ts` does not include a `server` field. The `RemoteTransport` class exists in `packages/orchestrator/src/transports/remote.ts` and the `IEngineTransport` contract exists in `packages/shared/src/contracts/engine-transport.ts`, but they are never wired into the CLI `start` command.

This means:
- Users cannot run `tamma start --server http://localhost:3001` to connect to a remote engine.
- The `RemoteTransport` is implemented but orphaned -- it can only be used programmatically, not from the CLI.
- The `InProcessTransport` in `packages/orchestrator/src/transports/in-process.ts` is also implemented but not used by `start.tsx` -- the start command uses direct engine method calls and manual event emitters rather than the transport abstraction.

### 2.7 Additional Supporting Files

**`packages/orchestrator/src/transports/remote.ts` (RemoteTransport):**
- Well-implemented SSE client with exponential backoff reconnection.
- Uses `fetch()` for HTTP and manual SSE parsing.
- **URL mismatch**: Connects to `/api/engine/events` (line 132) but the server only exposes `/api/engine/events/state` and `/api/engine/events/logs` as separate SSE endpoints. There is no unified `/api/engine/events` endpoint. The RemoteTransport would get a 404.

**`packages/shared/src/contracts/engine-transport.ts` (IEngineTransport):**
- Clean contract with `sendCommand`, event subscriptions, and `dispose`.
- Uses `type` discriminator for commands, conflicting with the route's `action` discriminator.

**`packages/api/src/routes/engine-callback.ts` (ELSA Callbacks):**
- Not part of Phase 4 plan but present. Provides `POST /api/engine/execute-task` and `POST /api/engine/agent-available` for ELSA workflow integration. Not registered in `createApp()` -- appears unused.

---

## 3. Summary Table

| Requirement | Status | Notes |
|---|---|---|
| POST `/api/engine/command` | Implemented | `action` vs `type` mismatch with transport contract; pause/resume broken |
| GET `/api/engine/state` | Implemented | Works correctly |
| GET `/api/engine/events/state` (SSE) | Implemented | Polling-based (1s), proper headers and cleanup |
| GET `/api/engine/events/logs` (SSE) | Implemented | Polling-based (500ms), timestamp-based dedup may miss same-ms events |
| GET `/api/engine/stats` | Implemented | Works correctly |
| GET `/api/engine/plan` | Implemented | Returns null when no plan |
| GET `/api/engine/history` | Implemented | Paginated, with optional issueNumber filter |
| POST `/api/auth/login` | Implemented (stub) | Always rejects when auth enabled (no user store) |
| POST `/api/auth/refresh` | Implemented | **Bug**: requires valid JWT to call (not in public paths) |
| POST `/api/auth/api-key` | Implemented | Works; bypasses validation in dev mode |
| Dev mode auth bypass | Implemented | Stub user with admin role |
| `EngineRegistry` | Implemented | Clean; should use `Promise.allSettled` in `disposeAll` |
| `tamma server` command | Implemented | Ignores `ServerConfig` from `TammaConfig`; no tests |
| `tamma start --server` flag | **NOT IMPLEMENTED** | `RemoteTransport` exists but is not wired to CLI |
| `ServerConfig` in `TammaConfig` | Partially implemented | Type defined in shared; not read by server command |
| CORS configuration | Partial | Hardcoded `origin: true` (allow all); `corsOrigins` config ignored |
| Security headers (`@fastify/helmet`) | **NOT IMPLEMENTED** | Dependency installed but never registered |
| Approval flow over HTTP | **NOT FUNCTIONAL** | Commands return OK but never resolve engine's approval promise |
| Tests for Phase 4 code | **NONE** | No test files for engine routes, auth, registry, or server command |

---

## 4. Open Issues and Recommendations

### Bugs (must fix)

1. **`/api/auth/refresh` not in public paths.** Add `'/api/auth/refresh'` to the `publicPaths` array in the auth plugin's `onRequest` hook. Without this, token refresh is impossible when the access token has expired.

2. **`pause` command calls `engine.dispose()`.** This destroys the engine instead of pausing it. Either implement a proper pause mechanism on `TammaEngine` or return a "not supported" error until one exists.

3. **EngineCommand `action` vs `type` mismatch.** The REST route uses `action` while `IEngineTransport` and `RemoteTransport` use `type`. The `RemoteTransport` sends `{ type: 'start' }` to `POST /api/engine/command`, which returns 400. Align on one discriminator field.

4. **RemoteTransport SSE URL mismatch.** `RemoteTransport` connects to `/api/engine/events` but the server exposes `/api/engine/events/state` and `/api/engine/events/logs` separately. Either add a unified `/api/engine/events` SSE endpoint or update `RemoteTransport` to use two connections.

### Gaps (should implement)

5. **`--server` flag on `tamma start`.** The plan specified this, and the `RemoteTransport` is already built. Wire it into `start.tsx` so that when `--server http://...` is provided, the CLI creates a `RemoteTransport` instead of a local engine.

6. **Approval flow over HTTP.** The server needs a mechanism (e.g., a `pendingApprovalResolve` ref similar to `InProcessTransport`) to resolve approval promises when commands arrive over HTTP.

7. **Register `@fastify/helmet`.** The dependency is already in `package.json`. Add `await app.register(helmet)` in `createApp` to set security headers.

8. **Use `ServerConfig` from `TammaConfig`.** The `server.ts` command should read `config.server?.port`, `config.server?.host`, `config.server?.jwtSecret`, `config.server?.corsOrigins`, and `config.server?.enableAuth` instead of duplicating them in env vars and CLI flags.

9. **Add tests.** None of the Phase 4 files have test coverage. At minimum, unit tests for `EngineRegistry`, integration tests for engine routes (with a mock engine), and auth flow tests should be added.

### Improvements (nice to have)

10. **Event-driven SSE instead of polling.** Subscribe to engine events rather than polling every 1 second. This reduces unnecessary serialization and network traffic.

11. **Use Fastify JSON schemas.** Replace manual input validation with Fastify `schema` definitions on each route for automatic validation, coercion, and OpenAPI spec generation.

12. **Log a warning for insecure JWT secret.** When the server starts with the default `'dev-secret'`, emit a visible warning so operators know auth is effectively disabled.

13. **Use `Promise.allSettled` in `EngineRegistry.disposeAll`.** Prevents one failing engine disposal from aborting cleanup of the others.

14. **Restrict CORS in production.** Read `ServerConfig.corsOrigins` and pass it to `@fastify/cors` instead of allowing all origins.
