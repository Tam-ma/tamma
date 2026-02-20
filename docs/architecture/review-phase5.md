# Phase 5 Review: Conversational CLI

**Reviewer:** Claude Opus 4.6 (automated review)
**Date:** 2026-02-12
**Branch:** `feat/engine-mvp`

## 1. Phase Overview

Phase 5 ("Conversational CLI") was designed to let a user type natural language
into the CLI -- for example, "fix the typo in README" -- and have Tamma
automatically:

1. Use the agent to structure the description into `{ title, body, labels }`.
2. Create a GitHub issue via a new `createIssue` method on `IGitPlatform`.
3. Process that issue through the existing engine pipeline (plan, approve,
   implement, PR, merge).

The plan had four concrete deliverables:

| # | Deliverable | Description |
|---|-------------|-------------|
| A | `createIssue` on `IGitPlatform` | New interface method + `CreateIssueOptions` type |
| B | `createIssue` on `GitHubPlatform` | Octokit implementation |
| C | `createAndProcessIssue` on `TammaEngine` | Orchestration: agent structures description, creates issue, runs pipeline |
| D | CLI wiring in `CommandInput` | Non-slash input sends `describe-work` command via transport |

---

## 2. File-by-File Review

### 2.1 `packages/platforms/src/types/options.ts` -- CreateIssueOptions

**Status: IMPLEMENTED**

```typescript
export interface CreateIssueOptions {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}
```

**Assessment:** Well-designed. Covers the two required fields (`title`, `body`)
and the two optional fields from the plan (`labels`, `assignees`). Uses
optional arrays with `?` rather than defaulting to empty arrays, which is the
correct approach since Octokit differentiates between "not sent" and "empty
array".

One minor omission: there is no `milestone` field. Not required by the plan,
but would be useful for teams that track work by milestone. Not a blocker.

### 2.2 `packages/platforms/src/types/git-platform.interface.ts` -- IGitPlatform

**Status: IMPLEMENTED**

```typescript
createIssue(
  owner: string,
  repo: string,
  options: CreateIssueOptions,
): Promise<Issue>;
```

Added at line 87-91, alongside the existing issue methods (`getIssue`,
`listIssues`, `updateIssue`, `addIssueComment`, `assignIssue`). The import of
`CreateIssueOptions` is present at line 19.

**Assessment:** Clean addition. The method signature follows the existing
pattern of `(owner, repo, ...)` used by every other method on the interface.
Returns `Promise<Issue>` which gives callers access to the created issue number,
URL, etc.

### 2.3 `packages/platforms/src/types/index.ts` -- Re-exports

**Status: IMPLEMENTED**

`CreateIssueOptions` is re-exported from `index.ts` at line 22, alongside the
other options types. Consumers can import it via `@tamma/platforms`.

### 2.4 `packages/platforms/src/github/github-platform.ts` -- GitHubPlatform.createIssue

**Status: IMPLEMENTED**

```typescript
async createIssue(
  owner: string,
  repo: string,
  options: CreateIssueOptions,
): Promise<Issue> {
  return this.wrap(async () => {
    const { data } = await this.getClient().rest.issues.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      ...(options.labels !== undefined && options.labels.length > 0
        ? { labels: options.labels }
        : {}),
      ...(options.assignees !== undefined && options.assignees.length > 0
        ? { assignees: options.assignees }
        : {}),
    });
    return mapIssue(data);
  });
}
```

**Assessment:** Correct Octokit usage. Uses `this.getClient().rest.issues.create`
which is the correct endpoint. Optional fields (`labels`, `assignees`) are only
sent when non-empty, which avoids sending empty arrays to GitHub's API. The
result is passed through `mapIssue` for consistent model mapping. Error handling
is delegated to the `wrap()` helper, which applies rate-limiting and error
mapping -- consistent with every other method in the class.

One concern: unlike `createPR` (which calls `addLabels` as a separate API call
after creation), `createIssue` passes labels directly in the create call. This
is actually the better approach since `issues.create` natively supports labels,
so the implementation is correct.

### 2.5 `packages/orchestrator/src/engine.ts` -- TammaEngine.createAndProcessIssue

**Status: NOT IMPLEMENTED**

The `TammaEngine` class (980 lines) has no `createAndProcessIssue` method. The
method was specified in the plan as the orchestration layer that would:

1. Accept a natural language description string.
2. Use the agent provider to structure it into `{ title, body, labels }`.
3. Call `platform.createIssue(...)`.
4. Feed the resulting `IssueData` into the existing pipeline
   (`analyzeIssue` -> `generatePlan` -> ...).

This method does not exist. There is no code anywhere in the orchestrator
package that converts a natural language description into an issue.

### 2.6 `packages/cli/src/components/CommandInput.tsx` -- describe-work wiring

**Status: NOT IMPLEMENTED**

The `CommandInput` component is a minimal text input wrapper:

```typescript
export default function CommandInput({ onSubmit }: CommandInputProps) {
  // ... just calls onSubmit(input.trim()) on enter
}
```

It passes all input to `onSubmit`, which in `SessionLayout.tsx` routes to
`executeSlashCommand`. The `executeSlashCommand` function in `registry.ts`
explicitly rejects non-slash input:

```typescript
if (!input.startsWith('/')) {
  ctx.logEmitter.emit('warn', `Unknown input. Type /help for commands.`);
  return;
}
```

There is no handling of natural language input. The plan required non-slash
input to be intercepted and sent as
`transport.sendCommand({ type: 'describe-work', description: input })`. This
was not implemented.

### 2.7 Transport Layer -- `describe-work` command handling

**Status: STUB ONLY**

The transport contract in `packages/shared/src/contracts/engine-transport.ts`
does include the `describe-work` command type in the union:

```typescript
export type EngineCommand =
  | { type: 'start'; options?: { once?: boolean } }
  // ... other commands ...
  | { type: 'describe-work'; description: string };
```

However, the `InProcessTransport` in
`packages/orchestrator/src/transports/in-process.ts` handles it as an
unsupported stub:

```typescript
default:
  // Other commands (pause, resume, process-issue, describe-work) are
  // stubs for future use when the engine supports them natively.
  this.emitLog('warn', `Command '${command.type}' is not yet supported...`);
  break;
```

The command type is defined but never wired to any engine method.

---

## 3. Test Coverage

### 3.1 Platform Unit Tests (`github-platform.test.ts`)

The Octokit mock at the top of the test file includes `issues.create` in the
mock... **wait, no** -- it does NOT. The mock defines:

```typescript
issues: {
  get: vi.fn(),
  listForRepo: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  update: vi.fn(),
  addAssignees: vi.fn(),
  addLabels: vi.fn(),
},
```

There is no `create: vi.fn()` in the issues mock. The `createIssue`
implementation calls `this.getClient().rest.issues.create(...)`, but the unit
test mock does not define `issues.create`. This means:

- **There is no unit test for `GitHubPlatform.createIssue`.**
- If a test tried to call it, it would throw `TypeError: issues.create is not a function`.

### 3.2 Platform E2E Tests (`github-platform.e2e.test.ts`)

The E2E test file contains stale comments that predate the `createIssue`
implementation:

```typescript
// GitHubPlatform doesn't have createIssue, but we can use updateIssue after listing
// ...
// The platform interface doesn't expose createIssue directly.
```

These comments are now incorrect. The E2E tests do not exercise `createIssue`.

### 3.3 Engine Unit Tests (`engine.test.ts`)

The mock platform in the engine tests does not include `createIssue` in its
mock object. No engine tests reference `createAndProcessIssue` because the
method does not exist.

### 3.4 Engine E2E Tests (`engine.e2e.test.ts`)

Contains a comment at line 190-192 that reads:

```typescript
// But GitHubPlatform doesn't have createIssue... use gh CLI approach or
// just test with existing issues
```

This is also stale -- the method now exists but is not used in the E2E test.

---

## 4. Summary Table

| Requirement | Status | Files | Notes |
|-------------|--------|-------|-------|
| `CreateIssueOptions` interface | DONE | `options.ts` | Well-designed, covers title/body/labels/assignees |
| `createIssue` on `IGitPlatform` | DONE | `git-platform.interface.ts` | Follows existing patterns |
| Re-export from barrel | DONE | `types/index.ts` | `CreateIssueOptions` exported |
| `createIssue` on `GitHubPlatform` | DONE | `github-platform.ts` | Correct Octokit usage, rate-limit wrapped |
| Unit test for `createIssue` | MISSING | `github-platform.test.ts` | No test, mock missing `issues.create` |
| E2E test for `createIssue` | MISSING | `github-platform.e2e.test.ts` | Stale comments, not exercised |
| `createAndProcessIssue` on `TammaEngine` | NOT IMPLEMENTED | `engine.ts` | Method does not exist |
| CLI `describe-work` wiring | NOT IMPLEMENTED | `CommandInput.tsx`, `registry.ts` | Non-slash input rejected with warning |
| `describe-work` command type | DONE (type only) | `engine-transport.ts` | Union member exists |
| `describe-work` transport handler | STUB | `in-process.ts` | Logs "not yet supported" warning |

---

## 5. Gap Analysis

### What works today

The **platform layer** (deliverables A and B) is complete. A user of
`@tamma/platforms` can call:

```typescript
const issue = await platform.createIssue('owner', 'repo', {
  title: 'Fix the typo in README',
  body: 'The word "teh" should be "the" on line 42.',
  labels: ['bug', 'tamma'],
});
```

This is a clean, well-integrated addition that follows all existing patterns.

### What is missing for end-to-end conversational flow

Three pieces are missing, forming a clear dependency chain:

```
User types "fix the typo in README"
        |
        v
[1] CommandInput / registry.ts must route non-slash input
    as a describe-work command
        |
        v
[2] InProcessTransport must handle describe-work
    by calling engine.createAndProcessIssue(description)
        |
        v
[3] TammaEngine.createAndProcessIssue(description) must:
    a. Use agent to structure description -> { title, body, labels }
    b. Call platform.createIssue(...)
    c. Build IssueData from the created issue
    d. Run analyzeIssue -> generatePlan -> ... pipeline
```

All three layers (CLI routing, transport dispatch, engine method) are missing.

### Specific items to implement

**1. `TammaEngine.createAndProcessIssue(description: string): Promise<void>`**

This is the core missing piece. Suggested implementation outline:

```typescript
async createAndProcessIssue(description: string): Promise<void> {
  // Step 1: Use agent to structure the description
  const structurePrompt = `Given the following work description, produce a
  structured GitHub issue as JSON: { title, body, labels }. ...`;

  const result = await this.agent.executeTask({ prompt: structurePrompt, ... });
  const { title, body, labels } = JSON.parse(result.output);

  // Step 2: Create the issue on GitHub
  const created = await this.platform.createIssue(owner, repo, { title, body, labels });

  // Step 3: Build IssueData and run existing pipeline
  const issueData: IssueData = { number: created.number, title, body, ... };
  const context = await this.analyzeIssue(issueData);
  const plan = await this.generatePlan(issueData, context);
  await this.awaitApproval(plan);
  // ... rest of pipeline
}
```

**2. `InProcessTransport.sendCommand` -- handle `describe-work`**

The `default` case in the switch statement needs a dedicated `case 'describe-work'`
block that calls `this.engine.createAndProcessIssue(command.description)`.

**3. `CommandInput` / `registry.ts` -- route non-slash input**

Replace the current "Unknown input" warning with a call to the transport:

```typescript
if (!input.startsWith('/')) {
  // Conversational mode: treat as work description
  ctx.transport.sendCommand({ type: 'describe-work', description: input });
  return;
}
```

This requires either:
- Adding `transport: IEngineTransport` to `CommandContext`, or
- Adding a `describeWork(description: string)` callback to `CommandContext`
  (matching the pattern of `shutdown()`, `skipIssue()`, etc.)

**4. Unit tests for `GitHubPlatform.createIssue`**

Add `create: vi.fn()` to the `issues` mock and write test cases covering:
- Successful creation with labels and assignees
- Successful creation without optional fields
- Error propagation through the `wrap()` helper

**5. Stale comment cleanup**

Update comments in `github-platform.e2e.test.ts` (lines 49, 53) and
`engine.e2e.test.ts` (line 190) that incorrectly state `createIssue` does not
exist.

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| No unit test for `createIssue` -- regressions could slip in | Medium | Add test with Octokit mock |
| `createAndProcessIssue` missing -- conversational flow is a dead end | High | Implement the engine method |
| CLI rejects all non-slash input -- users cannot discover conversational mode | High | Wire CommandInput to transport |
| Agent structuring prompt not designed -- unclear what quality to expect | Medium | Design prompt carefully with examples, validate JSON schema |
| Cost of two agent calls per conversational input (structure + plan) | Low | Structure call should be small/cheap; consider caching or combining |
| `describe-work` in transport union but not handled -- misleading API | Low | Either implement or remove from union to avoid confusion |

---

## 7. Conclusion

Phase 5 is **approximately 40% complete**. The platform layer (interface +
implementation) is done and done well. However, the three layers needed to
connect user input to issue creation -- engine method, transport dispatch, and
CLI routing -- are all missing. The feature is not functional from an end-user
perspective: typing natural language into the CLI produces a warning message
telling the user to use slash commands.

The `describe-work` command type exists in the transport contract, which shows
the design was planned, but execution stopped at the platform layer. To
complete Phase 5, the three missing pieces (engine method, transport handler,
CLI routing) need to be implemented along with unit tests for the existing
`createIssue` platform method.
