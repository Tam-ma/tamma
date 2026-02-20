# Code Review: Platforms & Shared Packages (feat/engine-mvp)

**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-12
**Branch:** `feat/engine-mvp`
**Scope:** All modified/new files in `packages/platforms/` and `packages/shared/`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Platforms Package](#platforms-package)
   - [IGitPlatform Interface](#igitplatform-interface)
   - [GitHubPlatform Implementation](#githubplatform-implementation)
   - [Type Definitions (options.ts, models.ts, index.ts)](#type-definitions)
   - [Supporting Modules (mappers, rate-limiter, error-mapper)](#supporting-modules)
   - [Test Coverage Assessment](#platforms-test-coverage)
3. [Shared Package](#shared-package)
   - [Types (types/index.ts)](#shared-types)
   - [Contracts (contracts/index.ts)](#shared-contracts)
   - [Engine Transport Contract (engine-transport.ts)](#engine-transport-contract)
   - [Test Coverage Assessment](#shared-test-coverage)
4. [Cross-Package Concerns](#cross-package-concerns)
5. [Prioritized Issue List](#prioritized-issue-list)
6. [Overall Quality Assessment](#overall-quality-assessment)

---

## Executive Summary

The platforms and shared packages represent well-structured foundational code for the Tamma engine MVP. The platforms package introduces a clean `IGitPlatform` abstraction with a solid GitHub implementation. The shared package expands from a minimal placeholder to a comprehensive type system covering engine state machines, configuration, events, and a new transport contract.

**Overall quality:** Good. The code demonstrates consistent patterns, proper TypeScript usage, and thoughtful error handling. The main concerns are: (1) type duplication and divergence between packages, (2) an `EngineCommand` type mismatch between shared and API packages, (3) missing test coverage for the new shared types, and (4) several `any`-typed mapper functions that should be tightened.

---

## Platforms Package

### IGitPlatform Interface

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/types/git-platform.interface.ts`

**Strengths:**
- Clean separation of concerns with clear section comments (Repository, Branch, Pull Request, Issue, Commits, CI Status).
- All methods return `Promise<T>`, correctly modelling async I/O.
- `initialize` / `dispose` lifecycle methods enforce explicit setup and teardown.
- The `readonly platformName: string` property enables runtime identification without downcasting.
- Good use of option objects (`CreatePROptions`, `MergePROptions`, etc.) instead of long parameter lists for methods with optional fields.

**Issues:**

1. **[Medium] Repetitive `owner`/`repo` parameters.** Every method takes `owner: string, repo: string`. This suggests the interface should either accept a repository context at initialization time or provide a bound sub-interface. As-is, callers must thread these values through every call. This is a design choice but adds boilerplate in the engine.

2. **[Low] Missing `listPRs` method.** The interface has `listIssues` but no `listPRs`. If the engine ever needs to list open PRs (e.g., to detect existing Tamma PRs), a new method will need to be added. Not blocking for MVP, but worth noting.

3. **[Low] No method-level JSDoc.** While the section comments help, individual methods lack documentation for edge cases (e.g., what happens if `deleteBranch` is called on a protected branch?).

### GitHubPlatform Implementation

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/github/github-platform.ts`

**Strengths:**
- The `wrap<T>()` private method is an elegant pattern that centrally applies rate limiting and error mapping to every API call. This avoids duplicating try/catch in every method.
- Lazy initialization with `getClient()` throws a descriptive error if `initialize()` was not called.
- `dispose()` nulls the client, preventing use-after-dispose.
- `getCIStatus` uses `Promise.all` to parallelize the status and checks API calls -- good performance optimization.
- `listIssues` correctly filters out pull requests from the GitHub issues API response, which is a known GitHub API quirk.
- Label application after PR creation is correctly handled as a separate call.

**Issues:**

4. **[Medium] `createPR` returns stale data after label addition.** On line 137, `mapPullRequest(data)` is returned, but `data` was fetched before labels were added. The returned `PullRequest` object will have an empty labels array even though labels were successfully applied. The fix is to either re-fetch the PR after adding labels, or manually append the labels to the mapped result.

5. **[Medium] `listIssues` `totalCount` reflects filtered count, not actual total.** On line 282, `totalCount: issues.length` reports the count of issues on the current page after filtering out PRs, not the total count from the API. This is misleading for pagination consumers that expect `totalCount` to represent the full dataset size. Consider renaming to `pageCount` or documenting this behavior.

6. **[Low] `getIssue` hard-codes `per_page: 100` for comments.** On line 248, issues with more than 100 comments will be truncated silently. For an MVP this is acceptable, but a pagination loop or configurable limit would be more robust.

7. **[Low] `dispose()` has no re-initialization guard.** After calling `dispose()`, calling `initialize()` again works (creates a new Octokit), which could be surprising. Consider adding a `disposed` flag or documenting the intended lifecycle.

### Type Definitions

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/types/options.ts`

**Strengths:**
- Clean, focused interfaces with appropriate optionality.
- String literal unions for `state`, `sort`, `direction`, and `mergeMethod` provide good type safety.
- `CreatePROptions` correctly requires `title`, `body`, `head`, `base` while making `labels` optional.

**Issues:**

8. **[Low] `CreatePROptions` lacks `reviewers` and `draft` fields.** These are common GitHub PR creation options. Not needed for MVP but would be useful.

9. **[Low] `ListIssuesOptions` lacks `assignee` filter.** The engine may want to filter issues assigned to the bot.

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/types/models.ts`

**Strengths:**
- Well-typed models with appropriate field types.
- `CIStatusState` is a proper union type rather than `string`.
- `PullRequest.mergeable` is correctly typed as `boolean | null` (GitHub returns null when not yet computed).

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/types/index.ts`

**Strengths:**
- Clean barrel export with `export type` for interfaces and value exports for error classes.
- All platform types are accessible from a single import path.

**Issues:**

10. **[Low] No re-export of `GitHubPlatform` class.** The implementation class is exported from `../github/index.js` separately. Consumers must import from two paths: `@tamma/platforms` for types and the implementation. This is intentional (the main `src/index.ts` handles it), but worth noting.

### Supporting Modules

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/github/github-mappers.ts`

**Strengths:**
- Each mapper is a pure function, easy to test in isolation.
- `mapCIStatus` correctly handles the GitHub combined status + check runs model with `normalizeState` and `normalizeConclusion` helpers.
- `normalizeConclusion` maps `'skipped'` and `'neutral'` to `'success'`, which is the correct semantic for CI pass/fail decisions.
- `mapIssue` handles both string labels and label objects.

**Issues:**

11. **[High] All mapper functions use `any` parameter types.** While the `eslint-disable` comment acknowledges this, using `any` for all GitHub API responses bypasses TypeScript safety entirely. The Octokit library provides response types (e.g., `RestEndpointMethodTypes["repos"]["get"]["response"]["data"]`) that could be used. At minimum, define lightweight interfaces for the expected shapes.

12. **[Medium] `mapBranch` fallback chain may produce empty SHA.** On line 19, `data.object?.sha ?? data.commit?.sha ?? ''` returns empty string when neither path exists. An empty SHA is a valid but dangerous return value that could lead to silent failures downstream (e.g., creating a branch from an empty ref).

13. **[Low] `mapCIStatus` treats no checks as success.** On line 102-103, `totalCount === 0` maps to `state: 'success'`. This is a design choice, but it means repos with no CI configuration will always appear to pass. The engine's `monitorAndMerge` should be aware of this.

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/github/github-rate-limiter.ts`

**Strengths:**
- Exponential backoff with jitter is implemented correctly.
- Respects both `retry-after` and `x-ratelimit-reset` headers.
- `MAX_RETRIES = 3` is a sensible default.
- Non-retryable errors are immediately re-thrown without delay.

**Issues:**

14. **[Low] `withRateLimit` only retries on 429 and 403+rate-limit.** 5xx errors (502, 503) are also commonly transient for GitHub API calls but are not retried here. The `mapGitHubError` function marks them as `retryable: true`, but the rate limiter does not act on this property.

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/platforms/src/github/github-error-mapper.ts`

**Strengths:**
- Comprehensive HTTP status code mapping with specific error subclasses.
- Preserves the original error as `cause` when the input is an `Error` instance.
- `extractRetryAfter` gracefully handles missing/malformed headers with a sensible 60-second default.

**Issues:**

15. **[Low] Redundant `instanceof` checks in guard clause.** On lines 11-17, checking `instanceof RateLimitError`, `NotFoundError`, etc. is redundant because all extend `PlatformError`. The first check `err instanceof PlatformError` would catch all subclasses. However, this is a readability choice and correctness is not affected.

### Platforms Test Coverage

**Test Files:**
- `github-platform.test.ts` -- 10 test cases covering all major API methods
- `github-mappers.test.ts` -- 10 test cases covering all mapper functions
- `github-rate-limiter.test.ts` -- 4 test cases covering retry logic
- `github-error-mapper.test.ts` -- 25 test cases with comprehensive status code coverage
- `github-platform.integration.test.ts` -- 5 integration tests (env-gated)
- `github-platform.e2e.test.ts` -- 8 E2E tests (env-gated)

**Strengths:**
- Excellent error mapper coverage with edge cases (null, undefined, non-object errors, cause preservation).
- Integration and E2E tests are properly gated behind environment variables.
- E2E tests include cleanup functions in `afterEach`.
- Good use of shared test fixtures.

**Gaps:**

16. **[Medium] No tests for `createIssue` method.** The `github-platform.test.ts` file does not test the `createIssue` method that was added to the interface.

17. **[Medium] No tests for `updatePR` method.** Neither the unit nor the E2E tests cover `updatePR` directly (the E2E test uses it for cleanup but does not assert behavior).

18. **[Low] No tests for `deleteBranch` method (unit level).** It is covered in E2E but not in the unit test file.

19. **[Low] No negative tests for `createBranch` when source ref does not exist.** The error mapper is tested, but the integration of error mapping through `wrap()` for specific scenarios is not.

20. **[Low] E2E test file has a stale comment.** On lines 48-53 of `github-platform.e2e.test.ts`, the comment says "GitHubPlatform doesn't have createIssue" but it does now. The test body was updated but the comment was not.

---

## Shared Package

### Shared Types

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/shared/src/types/index.ts`

This file expanded from a 4-line placeholder to a comprehensive 243-line type system. It is the canonical type definition file for the Tamma engine.

**Strengths:**
- Clear section organization with comments and story references (e.g., "Story 1.5-1", "Story 2.3").
- `EngineState` and `EngineEventType` are proper enums with string values, making them both serializable and debuggable.
- `TammaConfig` is comprehensive with appropriate optionality (e.g., `elsa?`, `server?`, `aiProviders?`).
- `EngineConfig` has excellent JSDoc comments explaining defaults and behavior.
- `DevelopmentPlan` captures the right level of detail for the plan approval workflow.
- `IEventStore` interface is well-designed with `Omit<EngineEvent, 'id' | 'timestamp'>` for the `record` parameter.
- `LaunchContext` cleanly captures the runtime context needed to start the engine.

**Issues:**

21. **[High] `TammaConfig` has many required fields without defaults.** `github`, `agent`, and `engine` are required (not optional) properties. This means constructing a valid `TammaConfig` requires a large amount of boilerplate. A `DeepPartial<TammaConfig>` or builder pattern would help, especially in tests. The `EngineConfig` sub-config has 6 required fields (`pollIntervalMs`, `workingDirectory`, `maxRetries`, `approvalMode`, `ciPollIntervalMs`, `ciMonitorTimeoutMs`).

22. **[High] Type duplication between packages: `PullRequestInfo` vs `PullRequest`, `IssueComment` vs `Comment`, `IssueData` vs `Issue`.** The shared package defines `PullRequestInfo`, `IssueData`, and `IssueComment` types that overlap with but differ from the platforms package's `PullRequest`, `Issue`, and `Comment` types. For example:
    - `PullRequestInfo.status` uses `'open' | 'closed' | 'merged'` while `PullRequest.state` uses the same union -- but they have different field shapes.
    - `IssueData` has `relatedIssueNumbers` and `comments: IssueComment[]` while platforms `Issue` has `comments: Comment[]` and `assignees`, `updatedAt`.
    - `IssueComment` (shared) matches `Comment` (platforms) closely but has a different name.

    This creates a mapping layer in the engine (`engine.ts` lines 255-268) that converts `platforms.Issue` to `shared.IssueData`. While some divergence is expected (engine-level types vs platform-level types), the naming overlap is confusing and the duplication is a maintenance risk.

23. **[Medium] `EngineConfig.mergeStrategy` vs `MergePROptions.mergeMethod`.** The config uses `mergeStrategy` while the platform uses `mergeMethod`. This naming inconsistency could cause confusion. They also share the same `'squash' | 'merge' | 'rebase'` union, which should be a named type.

24. **[Medium] `AgentConfig.permissionMode` has unclear semantics.** The value `'bypassPermissions'` suggests a dangerous mode that could be accidentally enabled. The `'default'` alternative does not describe what permissions are applied. This should be better documented.

25. **[Low] `AIProviderType` is limited to three values.** The memory document mentions 9 LLM provider stubs in factory.ts. The type `'anthropic' | 'openai' | 'local'` may need expansion, though this is fine for MVP.

26. **[Low] `temperature` has no type-level constraint.** The JSDoc says "(0-1)" but there is no branded type or validation. A `number` allows negative values or values > 1.

27. **[Low] `ServerConfig.jwtSecret` is a plain string.** This is a sensitive value that should ideally be loaded from environment variables. The type definition itself is fine, but the configuration loading should enforce this.

### Shared Contracts

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/shared/src/contracts/index.ts`

**Strengths:**
- `ILogger` is minimal and appropriate for the platform's needs.
- Clean barrel re-exports for knowledge-base and engine-transport sub-modules.

**Issues:**

28. **[Low] `ILogger` lacks structured logging support.** The `context?: Record<string, unknown>` parameter is a good start, but there is no `child(context)` method for creating scoped loggers. This is fine for MVP but will be needed when multiple concurrent engine instances log simultaneously.

### Engine Transport Contract

**File:** `/Users/mahmouddarwish/Code/Tamma/packages/shared/src/contracts/engine-transport.ts`

This is a new file that defines the communication protocol between UI layers and the engine.

**Strengths:**
- Excellent JSDoc header explaining the two transport implementations.
- `EngineCommand` as a discriminated union with `type` field is idiomatic TypeScript.
- `IEngineTransport` is well-designed with command/subscription/lifecycle sections.
- `onStateUpdate`, `onLog`, `onApprovalRequest`, `onEvent` all return unsubscribe functions (`() => void`), which is a clean pattern for managing listeners.
- `EngineStateUpdate.stats` is a focused subset (3 fields) rather than exposing the full stats object.
- `EngineLogEntry` is self-contained with timestamp, making it serializable for remote transport.
- `dispose()` is async to allow cleanup of network connections.

**Issues:**

29. **[High] `EngineCommand` type diverges from the API routes version.** The shared `EngineCommand` uses `{ type: 'start' }` while the API routes version (`packages/api/src/routes/engine/index.ts` line 27) uses `{ action: 'start' }`. These are two different discriminated unions for the same concept. The API routes also lack `'pause'`, `'resume'`, `'process-issue'`, and `'describe-work'` variants. The API routes also lack `{ type: 'skip' }` but has `{ action: 'skip' }`. This divergence will cause bugs when the remote transport sends commands to the API.

    The `RemoteTransport.sendCommand()` serializes `{ type: 'start' }` and posts it to `/api/engine/command`, but the API route expects `{ action: 'start' }`. The property name mismatch means the API will reject all commands from the remote transport with "Missing or invalid action".

30. **[Medium] `EngineStateUpdate.stats` shape is hard-coded.** The `stats` field has inline type `{ issuesProcessed: number; totalCostUsd: number; startedAt: number }`. This should be extracted to a named interface (e.g., `EngineStatsSummary`) so that both the transport and the engine can reference the same type.

31. **[Medium] No error/result feedback for `sendCommand`.** `sendCommand` returns `Promise<void>`, providing no mechanism to report whether the command was accepted, rejected, or resulted in an error. The `InProcessTransport` silently swallows errors from `engine.run()`. Consider returning a result object or emitting error events.

32. **[Low] `EngineCommand` `'describe-work'` variant is undocumented.** The `{ type: 'describe-work'; description: string }` command has no clear consumer. Neither transport implementation handles it.

33. **[Low] `EngineCommand` `'process-issue'` variant is also unhandled.** The `InProcessTransport` falls through to the default case for this command, logging a warning. This is fine for now but the contract implies it should work.

### Shared Test Coverage

**Test Files:**
- `errors.test.ts` -- 10 test cases covering the error class hierarchy
- `event-store.test.ts` -- 10 test cases covering the InMemoryEventStore
- `utils/index.test.ts` -- 13 test cases covering sleep, slugify, extractIssueReferences

**Strengths:**
- Thorough coverage of the error hierarchy including inheritance and option handling.
- Event store tests cover ordering, filtering, copy semantics, and edge cases.
- Utility tests cover edge cases (empty strings, truncation, duplicate references).

**Gaps:**

34. **[High] No tests for the engine transport contract.** `engine-transport.ts` defines `IEngineTransport`, `EngineCommand`, `EngineStateUpdate`, and `EngineLogEntry` but has no tests in the shared package. The implementations (`InProcessTransport`, `RemoteTransport`) live in the orchestrator package, but the contract types themselves should have at least type-level tests (assertion utilities that verify the discriminated union covers all cases).

35. **[Medium] No tests for the expanded shared types.** The `types/index.ts` file grew from 4 lines to 243 lines, adding enums (`EngineState`, `EngineEventType`), complex interfaces (`TammaConfig`, `DevelopmentPlan`), and a state machine contract (`IEventStore`). While type definitions do not need runtime tests per se, the enums are used at runtime (in switch statements) and the `IEventStore` contract is tested only through the `InMemoryEventStore` implementation.

36. **[Low] `monotonicNow` is tested indirectly through event-store tests but has no direct tests.** This utility is critical for event ordering correctness and deserves explicit tests (e.g., verifying monotonicity under rapid successive calls).

---

## Cross-Package Concerns

### Type Duplication and Mapping Burden

The most significant cross-package concern is the proliferation of similar-but-different types:

| Concept | Platforms Package | Shared Package |
|---------|------------------|----------------|
| Issue | `Issue` | `IssueData` |
| Issue Comment | `Comment` | `IssueComment` |
| Pull Request | `PullRequest` | `PullRequestInfo` |
| CI State | `CIStatusState` | Not mirrored |
| Merge Method | `MergePROptions.mergeMethod` | `EngineConfig.mergeStrategy` |

The engine must convert between these representations, which is error-prone. Consider:
- Having `IssueData` extend or reference the platforms `Issue` type.
- Using a single `MergeMethod = 'squash' | 'merge' | 'rebase'` type alias shared between packages.
- Documenting the rationale for separate types in the shared package (if intentional, e.g., to decouple shared from platforms).

### Error Class Naming Collision

Both `packages/shared/src/errors.ts` and `packages/platforms/src/types/errors.ts` export a class named `PlatformError`, but they are **different classes**:
- **Shared:** `PlatformError extends TammaError` (with `code`, `retryable`, `context` properties)
- **Platforms:** `PlatformError extends Error` (with `statusCode`, `retryable` properties)

Since both packages are dependencies of the orchestrator, this creates an ambiguity. The shared package re-exports its `PlatformError` from `@tamma/shared`, while the platforms package re-exports its `PlatformError` from `@tamma/platforms`. Consumers must be careful about which `PlatformError` they import. A consumer writing `import { PlatformError } from '@tamma/shared'` gets a fundamentally different class than `import { PlatformError } from '@tamma/platforms'`.

**Recommendation:** Rename the platforms error to `GitPlatformError` or have it extend the shared `PlatformError`.

### Contract Consistency

The `IEngineTransport` contract (shared) uses `type`-discriminated commands while the API engine routes use `action`-discriminated commands. This is a **breaking mismatch** that will prevent the `RemoteTransport` from working with the current API routes. One of the two must be updated to match the other.

---

## Prioritized Issue List

### Critical (must fix before merge)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 29 | `EngineCommand` property mismatch | `engine-transport.ts` vs `api/routes/engine/index.ts` | `type` vs `action` discriminant will break remote transport |

### High (should fix before merge)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 11 | `any`-typed mapper parameters | `github-mappers.ts` | Bypasses TypeScript safety for all API responses |
| 21 | `TammaConfig` requires too many nested fields | `shared/types/index.ts` | Makes test setup and partial configuration painful |
| 22 | Type duplication across packages | `shared/types` vs `platforms/types` | `PullRequestInfo`/`PullRequest`, `IssueData`/`Issue`, `IssueComment`/`Comment` overlap |
| 34 | No tests for engine transport contract | `engine-transport.ts` | New contract has zero test coverage |
| 37 | `PlatformError` naming collision | `shared/errors.ts` vs `platforms/types/errors.ts` | Two unrelated classes with the same name |

### Medium (should fix soon after merge)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 4 | `createPR` returns stale label data | `github-platform.ts:137` | Labels not reflected in return value |
| 5 | `totalCount` is misleading in `listIssues` | `github-platform.ts:282` | Reports page count after filtering, not total |
| 12 | `mapBranch` can return empty SHA | `github-mappers.ts:19` | Silent failure risk |
| 16 | No tests for `createIssue` | `github-platform.test.ts` | New method untested |
| 17 | No tests for `updatePR` | `github-platform.test.ts` | Method untested at unit level |
| 23 | `mergeStrategy` vs `mergeMethod` naming | `shared/types` vs `platforms/types` | Inconsistent naming for same concept |
| 24 | `permissionMode` semantics unclear | `shared/types/index.ts` | `'bypassPermissions'` is dangerous, `'default'` is vague |
| 30 | Inline stats type in `EngineStateUpdate` | `engine-transport.ts:26` | Should be a named interface |
| 31 | No error feedback from `sendCommand` | `engine-transport.ts:37` | Void return hides failures |
| 35 | No tests for expanded shared types | `shared/types/index.ts` | 239 new lines with zero direct tests |

### Low (nice to have)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| 1 | Repetitive `owner`/`repo` parameters | `git-platform.interface.ts` | Every method requires threading context |
| 2 | Missing `listPRs` method | `git-platform.interface.ts` | May be needed for PR deduplication |
| 3 | No method-level JSDoc | `git-platform.interface.ts` | Edge cases undocumented |
| 6 | Hard-coded 100 comment limit | `github-platform.ts:248` | Silently truncates long discussions |
| 7 | No re-initialization guard | `github-platform.ts` | `dispose()` then `initialize()` works silently |
| 8 | Missing `reviewers`/`draft` in `CreatePROptions` | `options.ts` | Common PR creation fields absent |
| 9 | Missing `assignee` filter in `ListIssuesOptions` | `options.ts` | Useful for bot-specific queries |
| 10 | Split export paths | `platforms/src/index.ts` | Types and implementation use different import paths |
| 13 | No checks = success | `github-mappers.ts:102` | Repos with no CI appear to always pass |
| 14 | No retry for 5xx errors | `github-rate-limiter.ts` | Transient server errors not retried |
| 15 | Redundant instanceof checks | `github-error-mapper.ts:11-17` | All subclasses caught by base check |
| 18 | No unit test for `deleteBranch` | `github-platform.test.ts` | Only covered in E2E |
| 19 | No error path tests for `createBranch` | `github-platform.test.ts` | Missing ref scenario untested |
| 20 | Stale E2E comment | `github-platform.e2e.test.ts:48-53` | Comment says createIssue missing but it exists |
| 25 | `AIProviderType` may need expansion | `shared/types/index.ts` | Only 3 providers vs 9 stubs |
| 26 | No type-level temperature constraint | `shared/types/index.ts` | `number` allows invalid values |
| 27 | `jwtSecret` as plain string | `shared/types/index.ts` | Should be loaded from env |
| 28 | `ILogger` lacks `child()` method | `shared/contracts/index.ts` | No scoped logger support |
| 32 | Unhandled `describe-work` command | `engine-transport.ts` | No consumer implements this |
| 33 | Unhandled `process-issue` command | `engine-transport.ts` | Falls through to warning |
| 36 | No direct tests for `monotonicNow` | `shared/utils/index.ts` | Critical utility tested only indirectly |

---

## Overall Quality Assessment

**Platforms Package: 8/10**

The platforms package is well-crafted. The `IGitPlatform` interface is clean and the `GitHubPlatform` implementation is thorough with proper error handling, rate limiting, and CI status aggregation. The test suite is strong with 57 test cases across unit, integration, and E2E tiers. The main weaknesses are the `any`-typed mappers and a few missing unit tests for newer methods.

**Shared Package: 7/10**

The shared package provides the type system backbone for the entire engine. The type definitions are well-structured and the engine transport contract is a thoughtful abstraction. However, the rapid expansion from 4 lines to 243+ lines of type definitions without accompanying tests is a risk. The `EngineCommand` type mismatch with the API routes is a functional bug that will break the remote transport. The type duplication with the platforms package adds unnecessary complexity.

**Cross-Package Integration: 6/10**

The integration between packages has notable friction: duplicate type names, a `PlatformError` naming collision, and a command schema mismatch. These are not blockers for the MVP (the CLI uses `InProcessTransport` which does not go through the API routes), but they represent technical debt that will slow down the dashboard and remote transport features.

**Recommendation:** Fix the critical `EngineCommand` mismatch and the `PlatformError` naming collision before merge. The remaining issues can be addressed incrementally in subsequent stories.
