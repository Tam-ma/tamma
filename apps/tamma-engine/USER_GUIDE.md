# Tamma Engine User Guide

Tamma Engine is an autonomous development agent that monitors a GitHub repository for labeled issues, generates implementation plans, writes code via headless Claude Code, and opens pull requests — all without manual intervention.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Engine](#running-the-engine)
- [How It Works](#how-it-works)
- [Approval Modes](#approval-modes)
- [Environment Variables Reference](#environment-variables-reference)
- [State Machine](#state-machine)
- [Audit Trail & Event Store](#audit-trail--event-store)
- [Safety Controls](#safety-controls)
- [Integration Tests](#integration-tests)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **Claude Code CLI** installed and authenticated (`claude --version` must work)
  - Install: `npm install -g @anthropic-ai/claude-code` or `curl -fsSL https://claude.ai/install.sh | bash`
  - Authenticate: run `claude` once interactively and log in with your Claude subscription
  - Works with **Claude Pro, Team, or Enterprise subscriptions** — no separate API key needed
- **GitHub Personal Access Token (PAT)** with `repo` scope
- A GitHub account for the bot (or your own account) to assign issues and create PRs

## Installation

From the repository root:

```bash
pnpm install
pnpm -r run build
```

This builds all workspace packages that the engine depends on (`@tamma/shared`, `@tamma/observability`, `@tamma/providers`, `@tamma/platforms`, `@tamma/orchestrator`).

## Configuration

The engine is configured entirely through environment variables. Create a `.env` file in `apps/tamma-engine/` or export them in your shell.

### Minimal Setup

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export GITHUB_OWNER="your-org"
export GITHUB_REPO="your-repo"
export BOT_USERNAME="your-bot-account"
```

That's it — no API key needed. The engine uses your authenticated Claude Code CLI session.

### Full Configuration

```bash
# --- Required ---
GITHUB_TOKEN="ghp_..."       # GitHub PAT with repo scope
GITHUB_OWNER="your-org"      # Repository owner
GITHUB_REPO="your-repo"      # Repository name
BOT_USERNAME="tamma-bot"     # GitHub username the engine operates as

# --- Optional ---
ISSUE_LABELS="tamma"          # Comma-separated labels to filter issues (default: "tamma")
EXCLUDE_LABELS="wontfix,duplicate" # Comma-separated labels to skip (default: none)
AGENT_MODEL="sonnet"          # Claude model: "sonnet", "opus", "haiku" (default: "sonnet")
MAX_BUDGET_USD="5.0"          # Max spend per agent task in USD (default: 5.0)
ALLOWED_TOOLS="Read,Write,Edit,Bash,Glob,Grep" # Tools the agent may use (default: all listed)
PERMISSION_MODE="bypassPermissions" # "bypassPermissions" or "default" (default: "bypassPermissions")
POLL_INTERVAL_MS="300000"     # Delay between issue polls in ms (default: 300000 / 5 min)
WORKING_DIR="/path/to/repo"   # Repo checkout path (default: current directory)
MAX_RETRIES="3"               # Retries for transient failures (default: 3)
APPROVAL_MODE="cli"           # "cli" for human-in-the-loop, "auto" for unattended (default: "cli")
CI_POLL_INTERVAL_MS="30000"   # Delay between CI status checks in ms (default: 30000 / 30s)
CI_MONITOR_TIMEOUT_MS="3600000" # Max time to wait for CI before giving up (default: 3600000 / 1h)
MERGE_STRATEGY="squash"       # Merge method: "squash", "merge", or "rebase" (default: "squash")
LOG_LEVEL="info"              # "debug", "info", "warn", or "error" (default: "info")
```

## Running the Engine

```bash
# From the repository root
cd apps/tamma-engine
pnpm start
```

Or directly:

```bash
node apps/tamma-engine/dist/index.js
```

The engine will:

1. Validate configuration and verify `claude` CLI is installed
2. Start the polling loop
3. Log startup info (owner, repo, model, approval mode)

Stop the engine with `Ctrl+C` (SIGINT) or `SIGTERM`. It shuts down gracefully, finishing any in-progress cleanup.

## How It Works

The engine invokes Claude Code in headless mode (`claude -p`) as a subprocess for each AI task. This means it uses your existing Claude subscription — the same authentication you use when running `claude` interactively.

Each polling cycle executes an 8-step pipeline:

### 1. Issue Selection

The engine queries GitHub for open issues matching your configured labels (`ISSUE_LABELS`), sorted oldest-first. Issues with any `EXCLUDE_LABELS` are skipped. The oldest eligible issue is selected, assigned to the bot account, and a pickup comment is posted.

### 2. Issue Analysis

The full issue is fetched including all comments. Related issues referenced via `#N` syntax in the body or comments are also retrieved. The 10 most recent commits on the repository are also loaded to provide recent change context. All of this is assembled into a structured markdown document.

### 3. Plan Generation

The context document is sent to Claude Code with `--json-schema` for structured output. It produces a development plan containing:

- **Summary** — what needs to be done
- **Approach** — how to implement it
- **File changes** — which files to create, modify, or delete
- **Testing strategy** — how to verify the changes
- **Complexity estimate** — low, medium, or high
- **Risks** — potential concerns or ambiguities

### 4. Approval Gate

In `cli` mode, the plan is printed to the terminal and the engine waits for you to type `y` to approve or anything else to reject. In `auto` mode this step is skipped entirely.

### 5. Branch Creation

A feature branch is created from the repository's default branch. The naming convention is:

```
feature/{issue-number}-{slugified-title}
```

If the branch already exists (e.g. from a previous attempt), a numeric suffix is appended automatically (up to 5 attempts). After creation, the engine validates the branch exists via the GitHub API before proceeding.

### 6. Code Implementation

Claude Code receives the plan and is instructed to:

- Implement all file changes
- Write or update tests
- Verify TypeScript compilation
- Run the test suite
- Commit and push to the feature branch

The engine streams progress from Claude Code's `--output-format stream-json` output to the debug log, including tool usage and cost tracking. Transient errors (network timeouts, rate limits, 503/529 responses) are automatically retried up to 2 times with exponential backoff.

### 7. Pull Request Creation

A PR is opened from the feature branch to the default branch with:

- A descriptive body (summary, approach, changes, testing, risks)
- The label `tamma-automated`
- A `Closes #N` footer for automatic issue linking
- A comment posted on the original issue linking to the PR

After creation, the engine validates the PR exists and is in the expected state via the GitHub API.

### 8. Monitor and Merge

The engine polls CI status on the PR branch:

- **CI passes** — merge the PR (using the configured `MERGE_STRATEGY`), optionally delete the feature branch, close the issue with a completion comment
- **CI fails** — throw an error and move on to the next issue
- **Timeout** — if CI neither passes nor fails within `CI_MONITOR_TIMEOUT_MS` (default 1 hour), the engine gives up on this issue

After completion (or failure), the engine returns to step 1 and polls for the next issue.

## Approval Modes

| Mode | Env Value | Behavior |
|------|-----------|----------|
| **CLI** | `APPROVAL_MODE=cli` | Prints the plan and waits for `y`/`n` input. Use for supervised operation. |
| **Auto** | `APPROVAL_MODE=auto` | Skips approval entirely. Use for CI/CD or fully autonomous operation. |

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | Yes | — | GitHub PAT with `repo` scope |
| `GITHUB_OWNER` | Yes | — | Repository owner (org or user) |
| `GITHUB_REPO` | Yes | — | Repository name |
| `BOT_USERNAME` | Yes | — | GitHub username the engine assigns issues to |
| `ISSUE_LABELS` | No | `tamma` | Comma-separated inclusion labels |
| `EXCLUDE_LABELS` | No | *(empty)* | Comma-separated exclusion labels |
| `AGENT_MODEL` | No | `sonnet` | Claude model (`sonnet`, `opus`, `haiku`, or full ID) |
| `MAX_BUDGET_USD` | No | `5.0` | Per-task spending cap in USD |
| `ALLOWED_TOOLS` | No | `Read,Write,Edit,Bash,Glob,Grep` | Agent tool allowlist |
| `PERMISSION_MODE` | No | `bypassPermissions` | Agent permission mode |
| `POLL_INTERVAL_MS` | No | `300000` | Issue poll interval (ms) |
| `WORKING_DIR` | No | `process.cwd()` | Repo checkout path |
| `MAX_RETRIES` | No | `3` | Retry count for transient errors |
| `APPROVAL_MODE` | No | `cli` | `cli` or `auto` |
| `CI_POLL_INTERVAL_MS` | No | `30000` | CI status poll interval (ms) |
| `CI_MONITOR_TIMEOUT_MS` | No | `3600000` | CI monitoring timeout (ms) |
| `MERGE_STRATEGY` | No | `squash` | PR merge method: `squash`, `merge`, or `rebase` |
| `LOG_LEVEL` | No | `info` | Log verbosity |

## Authentication

The engine uses **headless Claude Code** (`claude -p`) rather than a direct API key. This means:

1. **Claude subscription required** — You need an active Claude Pro, Team, or Enterprise subscription
2. **No API key needed** — Authentication is handled by the Claude Code CLI's login session
3. **One-time setup** — Run `claude` interactively once to authenticate, then the engine reuses that session
4. **API key also works** — If you have `ANTHROPIC_API_KEY` set in your environment, Claude Code will use that instead

To verify your setup:

```bash
claude --version          # Should print version number
claude -p "Hello world"   # Should produce a response
```

## State Machine

The engine transitions through these states during each issue cycle:

```
IDLE → SELECTING_ISSUE → ANALYZING → PLANNING → AWAITING_APPROVAL
  → IMPLEMENTING → CREATING_PR → MONITORING → MERGING → (back to IDLE)
```

On any failure, the state moves to `ERROR` and stays there until the run loop resets it to `IDLE` for the next cycle. This preserves diagnostic information — you can call `engine.getState()` programmatically to detect failures.

```
┌──────────────────────────────────────────────────────────────────┐
│                         IDLE                                     │
│  (waiting for next poll cycle)                                   │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────┐     no issues     ┌──────┐
│ SELECTING_ISSUE  │ ────────────────► │ IDLE │
└──────┬───────────┘                   └──────┘
       │ issue found
       ▼
┌──────────────────┐
│   ANALYZING      │  fetch issue context, related issues
└──────┬───────────┘
       ▼
┌──────────────────┐
│   PLANNING       │  claude -p generates development plan
└──────┬───────────┘
       ▼
┌──────────────────┐     rejected      ┌───────┐
│ AWAITING_APPROVAL│ ────────────────► │ ERROR │
└──────┬───────────┘                   └───────┘
       │ approved
       ▼
┌──────────────────┐
│ IMPLEMENTING     │  claude -p writes code, tests, pushes
└──────┬───────────┘
       ▼
┌──────────────────┐
│  CREATING_PR     │  open PR with description
└──────┬───────────┘
       ▼
┌──────────────────┐     CI fails      ┌───────┐
│  MONITORING      │ ────────────────► │ ERROR │
└──────┬───────────┘   or timeout      └───────┘
       │ CI passes
       ▼
┌──────────────────┐
│   MERGING        │  squash-merge, cleanup branch, close issue
└──────┬───────────┘
       │
       ▼
     (IDLE)  ← run loop resets state
```

## Audit Trail & Event Store

The engine records structured events for every significant action during the pipeline. Events are stored in an in-memory event store and can be queried programmatically via `engine.getEventStore()`.

### Event Types

| Event | When |
|-------|------|
| `STATE_TRANSITION` | Engine moves between states |
| `ISSUE_SELECTED` | An issue is picked up for processing |
| `ISSUE_ANALYZED` | Issue context analysis completes |
| `PLAN_GENERATED` | Development plan is produced |
| `PLAN_APPROVED` | Plan passes approval gate |
| `PLAN_REJECTED` | Plan is rejected by reviewer |
| `BRANCH_CREATED` | Feature branch is created |
| `IMPLEMENTATION_STARTED` | Code generation begins |
| `IMPLEMENTATION_COMPLETED` | Code generation succeeds |
| `IMPLEMENTATION_FAILED` | Code generation fails |
| `PR_CREATED` | Pull request is opened |
| `PR_MERGED` | Pull request is merged |
| `BRANCH_DELETED` | Feature branch is cleaned up |
| `ISSUE_CLOSED` | Issue is closed with completion comment |
| `ERROR_OCCURRED` | An error is recorded |

### Querying Events

```typescript
const store = engine.getEventStore();

// All events
const all = store.getEvents();

// Events for a specific issue
const issueEvents = store.getEvents(42);

// Last event of a given type
const lastMerge = store.getLastEvent('PR_MERGED');
```

Each event includes an `id`, `timestamp`, optional `issueNumber`, and a `data` object with context-specific details (cost, branch name, PR number, error message, etc.).

## Safety Controls

### Budget Cap

`MAX_BUDGET_USD` limits how much each individual agent task (plan generation or implementation) can spend. Passed to Claude Code via `--max-budget-usd`. If the agent exceeds this budget, the task stops gracefully.

### CI Monitor Timeout

`CI_MONITOR_TIMEOUT_MS` prevents the engine from waiting indefinitely when CI is stuck. After the timeout (default 1 hour), the engine throws an error and moves to the next issue.

### Approval Gate

In `cli` mode, no code is generated until a human reviews and approves the plan. This is the recommended mode for initial use.

### Label Filtering

Only issues with the configured inclusion labels are picked up. Use `EXCLUDE_LABELS` to protect issues tagged `wontfix`, `duplicate`, `do-not-automate`, etc.

### Graceful Shutdown

`Ctrl+C` or `SIGTERM` triggers a clean shutdown — the engine stops polling, disposes of the agent and platform connections, and exits cleanly.

### Automatic Retry

The Claude Code provider automatically retries transient failures (network resets, timeouts, rate limits, 503/529 errors) up to 2 times with exponential backoff and jitter. Non-transient errors (e.g. invalid prompts, permission errors) fail immediately without retry.

### Permission Mode

`PERMISSION_MODE=default` restricts Claude Code to ask for confirmation before running potentially destructive operations. `bypassPermissions` (passed as `--dangerously-skip-permissions`) gives the agent full autonomy within its allowed tools.

### Creation Validation

After creating branches and pull requests, the engine performs a validation read-back via the GitHub API to confirm the resource was created successfully before proceeding to the next pipeline step.

## Integration Tests

The engine includes integration tests that run against real services. These are skipped by default and enabled via environment variables.

### Claude Code Provider

```bash
INTEGRATION_TEST_CLAUDE=true pnpm --filter @tamma/providers test
```

Tests: CLI availability check, simple task execution, progress event streaming, structured JSON output.

### GitHub Platform

```bash
INTEGRATION_TEST_GITHUB_TOKEN="ghp_..."  \
INTEGRATION_TEST_GITHUB_OWNER="your-org" \
INTEGRATION_TEST_GITHUB_REPO="your-repo" \
pnpm --filter @tamma/platforms test
```

Tests: repository info retrieval, issue listing, CI status checks, commit history, specific issue fetch.

### Engine (Full Lifecycle)

```bash
INTEGRATION_TEST_ENGINE=true pnpm --filter @tamma/orchestrator test
```

Tests the full issue-to-merge pipeline using mocked dependencies with an event store to verify all events are recorded in order.

## Troubleshooting

### "Agent provider is not available"

The `claude` CLI is not installed or not in your PATH. Verify with:

```bash
claude --version
```

If not installed, see [Prerequisites](#prerequisites).

If installed but still failing, ensure you've authenticated by running `claude` interactively at least once.

### "Missing required environment variable: GITHUB_TOKEN"

One of the required env vars isn't set. Check the [required variables](#environment-variables-reference).

### Engine picks up wrong issues

Check your `ISSUE_LABELS` and `EXCLUDE_LABELS` configuration. The engine only selects open issues that have at least one of the inclusion labels and none of the exclusion labels.

### CI monitoring times out

Increase `CI_MONITOR_TIMEOUT_MS` if your CI pipeline legitimately takes longer than 1 hour. Or investigate why CI is stuck — the engine logs the CI status at debug level on each poll.

### Plan keeps getting rejected

In `cli` mode, typing anything other than `y` rejects the plan. If the agent consistently produces poor plans, try:

- Providing more detail in the issue description
- Using a more capable model (`AGENT_MODEL=opus`)
- Increasing the budget (`MAX_BUDGET_USD`)

### Rate limiting from GitHub

The platform layer has built-in rate limit handling with exponential backoff and jitter. If you're consistently hitting limits, increase `POLL_INTERVAL_MS` and `CI_POLL_INTERVAL_MS`.

### Debug logging

Set `LOG_LEVEL=debug` to see state transitions, CI poll results, agent progress events, and full error context.
