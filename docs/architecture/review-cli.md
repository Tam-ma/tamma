# CLI Package Code Review (`packages/cli/`)

**Branch:** `feat/engine-mvp`
**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-12
**Files reviewed:** 28 (14 source, 7 test, 2 config, 5 component)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [File-by-File Review](#file-by-file-review)
   - [Configuration & Build](#configuration--build)
   - [Entrypoint & Commands](#entrypoint--commands)
   - [Core Infrastructure](#core-infrastructure)
   - [React/Ink Components](#reactink-components)
   - [Test Files](#test-files)
4. [Cross-Cutting Concerns](#cross-cutting-concerns)
5. [Prioritized Issue List](#prioritized-issue-list)
6. [Summary of Quality](#summary-of-quality)

---

## Executive Summary

The CLI package is a well-structured Ink-based terminal UI for the Tamma engine. It provides an interactive session with engine status display, log streaming, slash commands, plan approval, and an `init` wizard. The code demonstrates solid TypeScript practices, thoughtful architecture (e.g., LogEmitter pub/sub, StateEmitter bridge), and reasonable test coverage for utility modules. However, there are several security concerns around credential handling, potential bugs in the run loop, missing cleanup paths, and a few architectural decisions that warrant attention before production use.

**Overall quality: Good for MVP.** The codebase is well-organized with clear separation of concerns. The most pressing issues are around security (hardcoded JWT secret fallback, credential echo risk), resource management (uncancellable sleep in the run loop, potential memory growth in LogArea), and test coverage gaps (no unit tests for React components, init command, or server command).

---

## Architecture Overview

```
index.tsx (Commander entrypoint)
  |-- commands/start.tsx    (interactive engine loop + dry-run)
  |-- commands/init.tsx     (wizard with preflight + post-config)
  |-- commands/status.tsx   (lockfile-based status check)
  |-- commands/server.ts    (Fastify HTTP server mode)
  |-- commands/registry.ts  (slash command dispatch)
  |
  |-- components/
  |     |-- SessionLayout.tsx  (main TUI shell)
  |     |-- EngineStatus.tsx   (status bar)
  |     |-- LogArea.tsx        (scrolling log viewer)
  |     |-- CommandInput.tsx   (slash command input)
  |     |-- PlanApproval.tsx   (plan review + approve/reject)
  |     |-- IssueSelector.tsx  (issue picker)
  |     |-- Banner.tsx         (ASCII art header)
  |
  |-- config.ts       (3-layer config: defaults < file < env < CLI flags)
  |-- state.ts        (lockfile management)
  |-- log-emitter.ts  (pub/sub log routing)
  |-- file-logger.ts  (debug log file writer)
  |-- error-handler.ts (error classification + suggestions)
  |-- preflight.ts    (environment checks)
  |-- colors.ts       (NO_COLOR-aware color helper)
  |-- types.ts        (shared CLI types)
```

---

## File-by-File Review

### Configuration & Build

#### `packages/cli/package.json`

**Observations:**
- Clean dependency list with all workspace references properly using `workspace:*`.
- Missing `vitest` in devDependencies -- tests are likely running via workspace root config, but explicit declaration is preferred for clarity.
- No `"test"` script defined. The test runner must be invoked from the workspace root.
- `"type": "module"` correctly set for ESM.
- `"bin"` entry points to `./dist/index.js` -- correct.
- No `"exports"` field, which is fine since this is a CLI binary, not a library.

**Issues:**
1. **Missing test script** -- Should include `"test": "vitest run"` for standalone execution.
2. **No `"engines"` field** -- Given `preflight.ts` requires Node >= 22, the package.json should declare `"engines": { "node": ">=22" }`.

---

#### `packages/cli/tsconfig.json`

**Observations:**
- Correctly extends root tsconfig with `jsx: "react"` for Ink components.
- `composite: true` for project references -- good for incremental builds.
- All workspace dependencies properly listed in `references`.
- Test files correctly excluded from compilation.

**Issue:**
- `jsx: "react"` emits `React.createElement()`. Ink 5 with React 18 supports `"jsx": "react-jsx"` which avoids the need for `import React from 'react'` in every file. Not a bug, but a modernization opportunity.

---

### Entrypoint & Commands

#### `packages/cli/src/index.tsx`

**Observations:**
- Clean Commander setup with three commands: `start`, `status`, `init`.
- `dotenv/config` imported at top-level -- loads `.env` before anything else. Good.
- The `server` command defined in `server.ts` is **not registered** in `index.tsx`. This is likely dead code or planned for a future story.
- Version is hardcoded as `'0.1.0'` rather than read from `package.json`. These can drift apart.

**Issues:**
1. **P2 - `server` command not wired up.** `commands/server.ts` exists but is never registered in the CLI entrypoint.
2. **P3 - Hardcoded version.** Should read from `package.json` to stay in sync: `const VERSION = (await import('../package.json', { assert: { type: 'json' } })).default.version` or use a build-time replacement.
3. **P3 - Commander type assertions.** `opts.config as string | undefined` and `opts.approval as 'cli' | 'auto' | undefined` are unsafe type assertions. Commander's `.option()` does not guarantee these types.

---

#### `packages/cli/src/commands/start.tsx`

**Observations:**
- The core command that runs the engine in either dry-run or interactive mode.
- `createStateEmitter()` is a clean bridge between imperative engine callbacks and React state.
- `selectIssueInteractively()` properly unmounts the temporary Ink render before resolving.
- The run loop at line 270 correctly handles pause/resume with a polling sleep.
- Error handling uses `formatErrorWithSuggestions` consistently.

**Issues:**
1. **P1 - Monkey-patching `platform.listIssues` (lines 277-288).** This is a brittle pattern to force the engine to pick a specific issue. If the platform API changes, this silently breaks. A cleaner approach would be to pass the selected issue number into the engine configuration or use a dedicated engine method. The one-shot interception (`intercepted` flag) is also fragile -- if `listIssues` is called zero times in `processOneIssue`, the override persists to the next cycle.
2. **P2 - `sleep()` in the run loop is not cancellable (line 308).** When `shutdown()` is called, the process calls `process.exit(0)` in the shutdown handler while `sleep(config.engine.pollIntervalMs)` may still be running. This works because `process.exit()` is forceful, but it means the engine's `dispose()` may not complete if the sleep is long (default 5 minutes). A proper `AbortController`-backed sleep would allow graceful cancellation.
3. **P2 - Fire-and-forget async IIFE (line 270).** `void (async () => { ... })()` means unhandled promise rejections from the run loop are swallowed by the `try/catch` inside, but if the `catch` itself throws, the error is lost. This is mitigated by the inner try/catch, but it is fragile.
4. **P3 - `skipResolve` is never set.** The `skipResolve` variable (line 214) is declared but never assigned a value anywhere in the code. The `skipIssue()` function on `commandContext` (line 231) checks it, but it will always be null. This means `/skip` will always log "No issue to skip."
5. **P3 - Shutdown calls `process.exit(0)` (line 127).** This prevents any cleanup registered via `waitUntilExit()` from completing. The Ink render's exit handler is bypassed.
6. **P3 - Missing cleanup of `platform` in the interactive path.** In dry-run mode, `platform.dispose()` is called. In interactive mode, only `engine.dispose()` is called (which may or may not dispose the platform).

---

#### `packages/cli/src/commands/server.ts`

**Observations:**
- Starts a Fastify server with engine, auth, workflow store, and engine registry.
- Clean structure following the same config loading pattern as `start.tsx`.
- Uses `InMemoryEventStore` and `InMemoryWorkflowStore` -- appropriate for MVP but not production.

**Issues:**
1. **P1 - Hardcoded JWT secret fallback (line 80).** `process.env['TAMMA_JWT_SECRET'] ?? 'dev-secret'` means that if the environment variable is not set, the server uses a well-known secret. This is a **security vulnerability** in any non-development deployment. The code should either require the secret when `enableAuth` is true, or at minimum log a prominent warning.
2. **P2 - Default listen on `0.0.0.0` (line 45).** The default host is `0.0.0.0`, which binds to all network interfaces. For a development tool, `127.0.0.1` (localhost only) would be a safer default to avoid accidental exposure.
3. **P2 - Not registered in CLI entrypoint.** As noted above, this command is dead code.
4. **P3 - No graceful drain.** The shutdown handler calls `app.close()` but does not wait for in-flight requests to complete.

---

#### `packages/cli/src/commands/registry.ts`

**Observations:**
- Clean Map-based registry pattern for slash commands.
- Case-insensitive command matching via `.toLowerCase()`.
- `executeSlashCommand` handles unknown commands and non-slash input gracefully.
- `formatDuration` is duplicated here (also in `EngineStatus.tsx` and `status.tsx`).

**Issues:**
1. **P3 - `formatDuration` is duplicated three times** across `registry.ts`, `EngineStatus.tsx`, and `status.tsx`. Should be extracted to a shared utility.
2. **P3 - `/logs` command reads `ctx.showDebug` but then toggles it.** The toggle uses `!ctx.showDebug`, but `ctx.showDebug` may be stale relative to the React state in `SessionLayout`. The `handleCommand` callback in `SessionLayout` does sync `commandContext.showDebug = showDebug` before executing, so this works, but the indirection is fragile.

---

#### `packages/cli/src/commands/init.tsx`

**Observations:**
- Multi-phase wizard: preflight -> wizard -> postconfig -> done.
- Detects git remote to pre-fill owner/repo -- excellent UX.
- Writes `.env` with `mode: 0o600` (owner read/write only) -- good security practice.
- Merges into existing `.env` files rather than overwriting -- good.
- Post-config checks verify GitHub API access, Claude CLI, label creation, and .gitignore updates.
- `dotenv.config({ path: envDest, override: false })` immediately loads written credentials for post-config checks.

**Issues:**
1. **P2 - Shell injection in `gh label create` (line 401).** The `answers.owner` and `answers.repo` values are user-provided text input interpolated directly into a shell command: `gh label create tamma ... --repo ${answers.owner}/${answers.repo}`. A malicious owner/repo value like `; rm -rf /` would be executed. The values should be validated or the command should use `execFileSync` with argument arrays instead of `execSync` with string concatenation. Same issue with `gh api repos/${target}` on line 367.
2. **P2 - `runPostConfigChecks` mutates the `checks` array directly** and calls `setPostChecks([...checks])`. This is technically correct (spread creates a new reference) but fragile -- React may batch updates and miss intermediate states. Using functional state updates would be more robust.
3. **P3 - Preflight exits with `setTimeout(exit, 100)` when checks fail (line 316).** This arbitrary delay is a race condition -- if the component re-renders slowly, the exit may fire before the error display is rendered. A better approach would be to use a "press any key to exit" prompt.
4. **P3 - Config overwrite guard is at the command level only.** `initCommand()` checks if `tamma.config.json` exists and returns early, but `handleWizardComplete` unconditionally writes the file. If two init processes run simultaneously, the second would overwrite.
5. **P3 - Token values are visible in terminal during input** only if `mask` prop is not used. The token and anthropicKey fields correctly use `mask="*"` -- good. However, the token is briefly stored in React state as plain text and could be captured by React DevTools or error boundaries.
6. **P3 - `.gitignore` pattern matching (lines 424-425).** The regex `^\.tamma\/\s*$/m` requires `.tamma/` to be on its own line with optional trailing whitespace. If the gitignore has `.tamma` (without trailing slash) or `.tamma/**`, the check would add a duplicate entry.

---

#### `packages/cli/src/commands/status.tsx`

**Observations:**
- Simple lockfile-based status command that works cross-process.
- Properly checks if the PID is still running to detect stale lockfiles.
- Clean output formatting.

**Issues:**
1. **P3 - Does not clean up stale lockfiles.** When a stale lockfile is detected (PID not running), the command reports it but does not offer to remove it. This means subsequent `status` calls will always show the stale lockfile until someone manually deletes it or starts a new engine.

---

### Core Infrastructure

#### `packages/cli/src/config.ts`

**Observations:**
- Three-layer config merging (defaults < file < env < CLI) is a solid pattern.
- Environment variable parsing is thorough and covers all config fields.
- `validateConfig` only checks for required fields (token, owner, repo).
- `generateConfigFile` intentionally sets `token: ''` to keep credentials out of the config file.
- `mergeIntoEnvFile` handles existing files, commented-out keys, and new keys.
- `generateEnvExample` provides a complete template.

**Issues:**
1. **P2 - Unsafe `JSON.parse` in `loadConfigFile` (line 53).** If `tamma.config.json` contains invalid JSON, the error propagates up with an unhelpful message. Should be wrapped in a try/catch with a user-friendly error message.
2. **P2 - Shallow merge for nested objects (line 159).** `mergeConfig` does `{ ...base.github, ...override.github }`. This means if `override.github` is set (even partially via env vars), it will override ALL github fields with whatever `override.github` contains, which might be a partial object cast to `GitHubConfig`. The `as GitHubConfig` cast on line 81 hides this. For example, if only `GITHUB_TOKEN` is set, `override.github` will be `{ token: 'xxx' }` cast as `GitHubConfig`, and the spread will correctly merge... but the cast is still misleading. The current implementation works correctly due to the spread, but the type assertion masks a partial type.
3. **P3 - `GITHUB_TOKEN` takes precedence over `TAMMA_GITHUB_TOKEN` (line 65).** The `??` operator gives first-match precedence to `GITHUB_TOKEN`. This is documented in tests and intentional, but the precedence is arguably backwards -- the more specific `TAMMA_GITHUB_TOKEN` should arguably override the generic `GITHUB_TOKEN`. This is a design choice, not a bug, but worth noting.
4. **P3 - No validation of `TAMMA_MAX_BUDGET_USD` or `TAMMA_POLL_INTERVAL_MS` numeric values.** `parseFloat('abc')` returns `NaN`, and `parseInt('abc', 10)` returns `NaN`. These NaN values would silently propagate into the config.
5. **P3 - `generateEnvFile` does not quote values with special characters.** If a token contains characters like `=`, `#`, or spaces, the `.env` file would be malformed. While GitHub tokens typically don't contain these, it is a defensive coding gap.

---

#### `packages/cli/src/state.ts`

**Observations:**
- Simple lockfile-based state persistence at `~/.tamma/engine.lock`.
- Uses `process.kill(pid, 0)` to check if a process is running -- correct POSIX technique.
- Gracefully handles missing/corrupt lockfiles.
- `mkdirSync` with `recursive: true` on every write is safe but redundant after the first call.

**Issues:**
1. **P3 - No file locking.** `writeFileSync` does not acquire an exclusive lock. If two engine instances start simultaneously, they will overwrite each other's lockfile without detection. The `isProcessRunning` check in `status.tsx` mitigates this for status queries, but the lockfile is not used as a mutual exclusion mechanism.
2. **P3 - Lockfile is not cleaned up on crash.** If the process crashes (e.g., `SIGKILL`, unhandled exception before the signal handler is registered), the lockfile persists. The `status` command detects this via PID check, but the lockfile is never automatically cleaned.

---

#### `packages/cli/src/log-emitter.ts`

**Observations:**
- Clean pub/sub implementation with bounded history buffer.
- `createLoggerBridge` adapts the emitter to the `ILogger` interface -- elegant.
- Unsubscribe function returned from `subscribe` -- follows the standard pattern.

**Issues:**
1. **P3 - History buffer uses `shift()` for eviction (line 30).** On arrays, `shift()` is O(n) because it re-indexes all elements. For a 1000-element buffer, this is negligible, but a circular buffer would be O(1). Not an issue at this scale.
2. **P3 - No error isolation for listeners.** If a listener throws, the `for...of` loop on line 34 will stop notifying subsequent listeners. A `try/catch` around each listener invocation would be more robust.

---

#### `packages/cli/src/file-logger.ts`

**Observations:**
- Writes to `~/.tamma/logs/tamma-YYYY-MM-DD.log`.
- Uses `appendFileSync` for each entry -- simple but blocks the event loop.
- Creates the log directory on initialization.

**Issues:**
1. **P2 - `appendFileSync` blocks the event loop (line 30).** In a TUI application with frequent log entries, synchronous file writes can cause visible UI stutter. Should use `fs.appendFile` (async) or better, a write stream with buffering (`fs.createWriteStream` in append mode).
2. **P3 - No log rotation.** Files accumulate indefinitely in `~/.tamma/logs/`. Should either document this or add a basic rotation mechanism.
3. **P3 - File descriptor leak on error.** If `appendFileSync` throws (e.g., disk full), the error propagates to the subscriber, which may cause the LogEmitter to stop (see listener error isolation issue above).

---

#### `packages/cli/src/error-handler.ts`

**Observations:**
- Clean error classification based on `TammaError.code`.
- Suggestions are contextually relevant and actionable.
- Handles non-Error thrown values via `String(error)`.

**Issues:**
1. **P3 - Placeholder URL in default suggestions (line 34).** `'Report issues at https://github.com/your-org/tamma/issues'` -- this is a placeholder that should be updated to the actual repository URL.
2. **P3 - No stack trace preservation.** The `formatErrorWithSuggestions` function only extracts the message. In verbose/debug mode, the stack trace should be preserved for troubleshooting.

---

#### `packages/cli/src/preflight.ts`

**Observations:**
- Comprehensive environment checks: Node version, git, git repo, Claude CLI, ANTHROPIC_API_KEY, gh CLI.
- Clean separation of individual checks from the aggregate `runPreflight`.
- Git remote detection supports both HTTPS and SSH URLs with or without `.git` suffix.
- Appropriate timeout values (5000ms) for all shell commands.

**Issues:**
1. **P3 - `checkNodeVersion` hardcodes `>= 22` (line 20).** This requirement should be documented or configurable. If the project later supports Node 20 LTS, this check would need updating in code.
2. **P3 - `checkClaudeCli` runs `claude --version` (line 110).** If a different `claude` binary is on the PATH (unlikely but possible), this would give a false positive. Could additionally check the output format.
3. **P3 - `checkGitInstalled` does not suppress stderr on line 33.** Unlike the other checks, `checkGitInstalled` does not set `stdio: ['pipe', 'pipe', 'pipe']`, so if git outputs to stderr, it will appear in the terminal. This is inconsistent with the other checks.

---

#### `packages/cli/src/colors.ts`

**Observations:**
- Simple and effective `NO_COLOR` compliance (see https://no-color.org/).
- Returns a spread-friendly object for Ink `<Text>` components.

**Issues:**
1. **P3 - `NO_COLOR` is evaluated once at module load time (line 1).** If the environment variable is set after the module is loaded, the change is not reflected. This is standard behavior and unlikely to be a problem in practice, but worth noting.

---

#### `packages/cli/src/types.ts`

**Observations:**
- Clean type definitions for all CLI-specific concepts.
- `SlashCommand` interface is well-designed with `name`, `description`, and `execute`.
- `CommandContext` provides a comprehensive interface for command execution.
- `StateEmitter` is a simple but effective bridge pattern.

**Issues:**
- No issues found. This file is well-structured.

---

### React/Ink Components

#### `packages/cli/src/components/SessionLayout.tsx`

**Observations:**
- Main shell component that composes EngineStatus, LogArea/PlanApproval, and CommandInput.
- Subscribes to `stateEmitter` via `useEffect` -- correct cleanup on unmount.
- Syncs `commandContext` with React state in the effect.
- Dynamic log height based on terminal rows.

**Issues:**
1. **P2 - Stale closure in `handleCommand` (line 76).** The `handleCommand` callback captures `showDebug` from the render when it was created. If `showDebug` changes between renders, the `commandContext.showDebug = showDebug` line uses the captured value. The dependency array `[registry, commandContext, showDebug]` mitigates this by recreating the callback when `showDebug` changes, but there is a brief window where the closure is stale.
2. **P2 - `approvalRef` is typed as `React.MutableRefObject` but is actually a plain object `{ current: ... }`.** This works because `MutableRefObject` has the same shape, but it is semantically incorrect since it was not created by `useRef`.
3. **P3 - `process.stdout.rows` and `process.stdout.columns` (lines 82, 91).** These can be `undefined` if stdout is not a TTY (e.g., piped output). The `?? 24` and `?? 80` fallbacks handle this, but the component will render incorrectly in a non-TTY context. Ink itself handles this, but the hardcoded heights could cause layout issues.
4. **P3 - `stateEmitter.listener = ...` replaces a single listener.** If multiple components subscribe to the same `stateEmitter`, only the last one receives events. This is by design (only `SessionLayout` subscribes), but the single-listener pattern limits future extensibility.

---

#### `packages/cli/src/components/EngineStatus.tsx`

**Observations:**
- Clean status bar with spinner for active states.
- Uptime timer updates every second via `setInterval`.
- Compact and expanded modes -- good for different layout contexts.
- Proper cleanup of interval in `useEffect` return.

**Issues:**
1. **P3 - `colorProp(c)` where `c` is from `STATE_COLORS` returns `string`.** Ink's `<Text color>` prop accepts a specific set of color names. The `STATE_COLORS` values like `'gray'` are valid Ink color names, but there is no type-level guarantee.
2. **P3 - Uptime accuracy.** The 1-second interval drift is acceptable for a status display, but `setInterval` is not guaranteed to fire exactly every 1000ms, especially under load.

---

#### `packages/cli/src/components/LogArea.tsx`

**Observations:**
- Subscribes to `logEmitter` and maintains local state of log entries.
- Filters debug entries based on `showDebug` prop.
- Slices to the last `height` entries for display.
- Clean timestamp formatting.

**Issues:**
1. **P2 - Unbounded state growth (line 40).** Every log entry is appended to the `entries` state array: `setEntries((prev) => [...prev, entry])`. Over a long-running session, this array grows without bound. The `logEmitter` has a bounded history (1000 entries), but the React state does not. After hours of operation with frequent logging, this could consume significant memory. Should apply the same max-history bound in the component, or periodically trim old entries.
2. **P3 - `key={i}` on log entries (line 57).** Using array index as React key causes unnecessary re-renders when entries are added. Since entries are append-only and never reordered, this is functionally correct, but a unique ID (e.g., `entry.timestamp + Math.random()`) would be more semantically correct.
3. **P3 - `getHistory()` is called in `useState` initializer (line 36).** This correctly seeds the component with existing history, but if the emitter fires events between initialization and the `useEffect` subscription, those events are lost. This is a very narrow race condition.

---

#### `packages/cli/src/components/PlanApproval.tsx`

**Observations:**
- Clean plan display with color-coded file change actions.
- Keyboard-driven approval: y/n/s/q.
- Feedback mode for rejection with text input.
- Proper guard against double-submission via `decided` state.

**Issues:**
1. **P3 - `useApp()` imported but `exit` is only used in the `q` handler.** If the user presses `q`, the entire Ink app exits, which in `start.tsx` means `waitUntilExit()` resolves -- but the engine is not properly shut down. The `q` handler should call `commandContext.shutdown()` instead of `exit()`.
2. **P3 - `useInput` handler checks `decided || feedbackMode` but does not prevent key events during the brief period between `setDecided(true)` and React re-render.** This could allow a double-submission if the user presses a key very quickly after approval. The `decided` guard makes this unlikely but not impossible.

---

#### `packages/cli/src/components/CommandInput.tsx`

**Observations:**
- Minimal text input with prompt character.
- Clears input after submission.
- `useCallback` correctly depends on `onSubmit`.

**Issues:**
- No significant issues found. Clean, minimal component.

---

#### `packages/cli/src/components/IssueSelector.tsx`

**Observations:**
- Truncates to 10 issues with a "Skip" option.
- Formats creation time as relative time.
- Clean label display.

**Issues:**
1. **P3 - `parseInt(item.value, 10)` on line 39.** If `item.value` is somehow not a valid number string, `parseInt` returns `NaN`, and `issues.find()` returns `undefined`, which is safely handled (the `onSelect` is not called). But the error is silently swallowed.
2. **P3 - Issue truncation to 10 items is hardcoded.** Should be configurable or at least documented. If a repo has 50 tamma-labeled issues, the user only sees the first 10.

---

#### `packages/cli/src/components/Banner.tsx`

**Observations:**
- ASCII art logo with Ink component and plain-text `printBanner` for non-Ink contexts.
- `NO_COLOR` compliance in `printBanner` via manual ANSI code conditionals.

**Issues:**
1. **P3 - `printBanner` duplicates `NO_COLOR` logic from `colors.ts`.** Should reuse the `colorProp` approach or a shared helper.
2. **P3 - ANSI escape codes are hardcoded.** If the terminal does not support ANSI (rare in 2026), the output will contain escape sequences. The `NO_COLOR` check handles the explicit opt-out, but `process.stdout.isTTY` is not checked.

---

### Test Files

#### `packages/cli/src/log-emitter.test.ts`

**Coverage:** Excellent. Tests cover emit/subscribe, history, bounded history, unsubscribe, multiple listeners, context, and the logger bridge. All 8 tests exercise meaningful behavior.

**Missing coverage:** No test for error handling when a listener throws.

---

#### `packages/cli/src/error-handler.test.ts`

**Coverage:** Good. Tests cover all four error types (Engine, Workflow, Configuration, Platform), generic errors, non-Error values, and unknown TammaError codes. 7 tests.

**Missing coverage:** No tests for errors with additional properties (e.g., `cause`).

---

#### `packages/cli/src/file-logger.test.ts`

**Coverage:** Good. Tests cover file creation, entry writing, ISO timestamps, empty context handling, nested directory creation, and date-based filenames. 6 tests.

**Missing coverage:** No test for concurrent writes or disk-full scenarios.

---

#### `packages/cli/src/preflight.test.ts`

**Coverage:** Good. Tests cover all individual checks (positive and negative), both git remote URL formats (HTTPS and SSH), and the aggregate `runPreflight`. 16 tests.

**Issues:**
1. `checkNodeVersion` test is environment-dependent -- it asserts based on the actual running Node version rather than mocking it. This means the test passes or fails depending on the test runner's Node version.

---

#### `packages/cli/src/commands/registry.test.ts`

**Coverage:** Excellent. Tests cover all 10 slash commands, unknown commands, non-slash input, case insensitivity, and argument passing. 13 tests. The `createMockContext` helper is well-structured.

---

#### `packages/cli/src/config.test.ts`

**Coverage:** Excellent. Tests cover all config loading paths (defaults, file, env, CLI overrides), config generation, env file generation, env file merging, and validation. 22 tests with thorough edge cases.

---

#### `packages/cli/src/state.test.ts`

**Coverage:** Good. Tests cover lockfile write/read/remove, stale detection, and the `isProcessRunning` utility. 8 tests with proper mocking.

---

#### `packages/cli/src/cli.integration.test.ts`

**Coverage:** Adequate for integration. Tests cover help, version, status, start validation, and option listing. Gated by `INTEGRATION_TEST_CLI` environment variable. 6 tests.

**Issues:**
1. **P3 - `CLI_PATH` points to `src/index.tsx` (line 9).** This is correct for development (runs via `npx tsx`) but would fail against the compiled distribution. A more robust test would test the actual built binary.

---

### Missing Test Coverage

The following files have **no unit tests**:
- `components/SessionLayout.tsx` -- Complex component with state management
- `components/EngineStatus.tsx` -- Simpler but still untested
- `components/PlanApproval.tsx` -- User interaction logic
- `components/LogArea.tsx` -- State management and filtering
- `components/CommandInput.tsx` -- Minimal, low risk
- `components/IssueSelector.tsx` -- Selection logic
- `components/Banner.tsx` -- Minimal, low risk
- `commands/start.tsx` -- Complex orchestration (hard to unit test)
- `commands/init.tsx` -- Multi-phase wizard (hard to unit test)
- `commands/server.ts` -- Server setup
- `commands/status.tsx` -- Simple lockfile check (partially covered by state.test.ts)

For React/Ink components, consider using `ink-testing-library` which provides `render` and `lastFrame()` for snapshot testing.

---

## Cross-Cutting Concerns

### Security

| Issue | Severity | Location |
|-------|----------|----------|
| Hardcoded JWT secret fallback `'dev-secret'` | **P1** | `server.ts:80` |
| Shell injection via user-provided owner/repo in `gh` commands | **P2** | `init.tsx:367,401` |
| Default server bind on `0.0.0.0` (all interfaces) | **P2** | `server.ts:45` |
| `.env` file written with `0o600` permissions | **Good** | `init.tsx:340` |
| Tokens masked in wizard input | **Good** | `init.tsx:170,177` |
| Config file does not store tokens | **Good** | `config.ts:187` |

### Error Handling

- Error handling is generally good with consistent use of `formatErrorWithSuggestions`.
- The `start.tsx` run loop properly catches errors per-iteration and continues.
- Dry-run mode has a proper try/catch with cleanup.
- Missing: error boundaries for React components. If a component throws during render, the entire Ink app crashes.

### Resource Management

- Signal handlers (SIGINT, SIGTERM) are registered in both `start.tsx` and `server.ts`.
- Engine disposal is called in shutdown handlers.
- **Missing:** AbortController for cancellable operations (sleep, HTTP requests).
- **Missing:** Lockfile cleanup on unhandled exceptions.

### Code Duplication

- `formatDuration` is implemented three times (registry.ts, EngineStatus.tsx, status.tsx).
- `NO_COLOR` check is done in both `colors.ts` and `Banner.tsx`.
- Config validation logic could be shared with a schema validation library (e.g., Zod).

---

## Prioritized Issue List

### P1 - Critical (should fix before merge)

| # | Issue | File | Description |
|---|-------|------|-------------|
| 1 | Hardcoded JWT secret | `server.ts:80` | `'dev-secret'` fallback when `TAMMA_JWT_SECRET` is unset. Should require the secret when auth is enabled or emit a prominent warning. |
| 2 | Monkey-patching `platform.listIssues` | `start.tsx:277-288` | Brittle interception of platform method for interactive issue selection. Should use a proper engine API. |

### P2 - Important (should fix soon after merge)

| # | Issue | File | Description |
|---|-------|------|-------------|
| 3 | Shell injection in `gh` commands | `init.tsx:367,401` | User-provided owner/repo interpolated into shell commands. Use `execFileSync` with argument arrays. |
| 4 | Unbounded LogArea state growth | `LogArea.tsx:40` | Log entries accumulate without limit in React state. Apply max-history bound. |
| 5 | `appendFileSync` blocks event loop | `file-logger.ts:30` | Synchronous file I/O in the TUI context. Use async writes or a write stream. |
| 6 | `sleep()` not cancellable in run loop | `start.tsx:308` | 5-minute sleep cannot be interrupted for graceful shutdown. Use AbortController-backed sleep. |
| 7 | Server binds to `0.0.0.0` by default | `server.ts:45` | Should default to `127.0.0.1` for security. |
| 8 | Unsafe `JSON.parse` in config loading | `config.ts:53` | No error handling for invalid JSON in config file. |
| 9 | `server` command not wired up | `index.tsx` | `commands/server.ts` exists but is not registered in the CLI. |
| 10 | Direct mutation of `checks` array in post-config | `init.tsx:363-439` | Mutating and then spreading is fragile with React batching. |

### P3 - Minor (can address later)

| # | Issue | File | Description |
|---|-------|------|-------------|
| 11 | `/skip` never works (skipResolve is never set) | `start.tsx:214,231-238` | `skipResolve` is always null, so `/skip` always warns "No issue to skip." |
| 12 | `formatDuration` duplicated 3 times | Multiple | Extract to shared utility. |
| 13 | Hardcoded version string | `index.tsx:14` | Should read from package.json. |
| 14 | Placeholder URL in error suggestions | `error-handler.ts:34` | `your-org` should be the actual org. |
| 15 | No `"engines"` field in package.json | `package.json` | Should declare `node >= 22`. |
| 16 | No log rotation in file-logger | `file-logger.ts` | Logs accumulate indefinitely. |
| 17 | `.gitignore` pattern matching is overly strict | `init.tsx:424-425` | Won't detect `.tamma` without trailing slash. |
| 18 | NaN propagation for numeric env vars | `config.ts:91,106` | `parseFloat('abc')` produces `NaN` without validation. |
| 19 | `PlanApproval` `q` handler exits Ink without engine shutdown | `PlanApproval.tsx:36` | Should call `shutdown()` instead of `exit()`. |
| 20 | No stale lockfile cleanup in `status` command | `status.tsx` | Detects but does not remove stale lockfiles. |
| 21 | No error isolation for LogEmitter listeners | `log-emitter.ts:34` | A throwing listener stops notification of subsequent listeners. |
| 22 | No React/Ink component tests | Multiple | Consider `ink-testing-library` for component tests. |
| 23 | Missing test script in package.json | `package.json` | Should include `"test": "vitest run"`. |
| 24 | `checkGitInstalled` does not suppress stderr | `preflight.ts:33` | Inconsistent with other checks that use `stdio: ['pipe', 'pipe', 'pipe']`. |
| 25 | `IssueSelector` hardcoded to 10 items | `IssueSelector.tsx:27` | Should be configurable or paginated. |

---

## Summary of Quality

**Strengths:**
- Well-organized package structure with clear separation between commands, components, and infrastructure.
- The `LogEmitter` / `StateEmitter` bridge pattern is elegant and solves the React/imperative boundary cleanly.
- Config system with 3-layer merging (file < env < CLI) is thorough and well-tested.
- Good credential hygiene: tokens stay in `.env` (not config file), `.env` written with restrictive permissions, and wizard masks token input.
- Error handler provides contextual, actionable suggestions -- excellent DX.
- Test coverage is strong for utility modules (config, state, log-emitter, error-handler, preflight, registry) with 80+ unit tests.
- `NO_COLOR` support throughout.

**Weaknesses:**
- No React/Ink component tests (6 components untested).
- Security issues in `server.ts` (JWT secret fallback) and `init.tsx` (shell injection).
- Resource management gaps: unbounded LogArea state, synchronous file I/O in TUI, non-cancellable sleep.
- Dead code (`server.ts` not wired up, `skipResolve` never set).
- Code duplication (`formatDuration` x3, `NO_COLOR` check x2).
- Monkey-patching `platform.listIssues` is architecturally fragile.

**Overall Assessment:**
The CLI package is solid MVP-quality code with a well-designed architecture and good test coverage where it matters most. The security issues (P1/P2) should be addressed before any production or public deployment. The resource management issues (P2) should be addressed before long-running sessions are expected. The remaining P3 items are polish and can be deferred.
