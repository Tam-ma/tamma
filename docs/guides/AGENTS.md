# Repository Guidelines

## Project Structure & Module Organization
- `packages/` is the pnpm workspace root: `packages/orchestrator` (event store + scheduling), `packages/workers` (execution nodes), `packages/cli` (developer interface), `packages/shared` (DTOs/utilities), and `packages/config` (typed settings). Keep new services here and co-locate tests beside source files (`src/__tests__` or `feature.unit.test.ts`).
- Specs and story briefs live in `docs/` (see `docs/stories/`) with supplemental notes in `wiki/`. Marketing assets reside in `marketing-site/`, while compiled output belongs in `dist/`.

## Build, Test, and Development Commands
- `pnpm install` bootstraps all workspaces; rerun whenever the lockfile changes. `pnpm dev` starts every watcher for full-stack flows.
- `pnpm build`, `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` must succeed before review; they surface bundling, style, and type regressions early.
- `pnpm test`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:coverage` invoke Vitest. Integration runs expect a local Postgres instance for orchestrator tasks.
- Database work uses the scoped scripts: `pnpm migrate:latest` / `migrate:rollback` via `@tamma/orchestrator`.

## Coding Style & Naming Conventions
- ESLint (TypeScript strict configs) blocks implicit `any`, unused symbols, floating promises, and loose boolean checks; keep explicit return types unless writing short inline expressions.
- Prettier controls layout (2-space indent, trailing commas, LF endings). Run `pnpm format` before committing.
- Use `camelCase` for functions and fields, `PascalCase` for classes/types, and `kebab-case` for package or directory names (for example `packages/intelligence`, `docs/event-sourcing`).
- Maintain the domain/adapters/config directory split and keep `index.ts` files limited to safe re-exports.

## Testing Guidelines
- Write Vitest specs beside the code, naming them `*.unit.test.ts` or `*.integration.test.ts`. Use shared fixtures in `packages/orchestrator/test-utils` (or package-specific equivalents) rather than duplicating mocks.
- Run `pnpm test` during development and `pnpm test:coverage` before opening a PR; explain any intentional gaps.

## Commit & Pull Request Guidelines
- Follow the conventional format already in history (`feat:`, `docs:`, `chore:`) and scope by package when helpful (`feat(workers): add retry planner`).
- PR descriptions must cover intent, linked story/issue, behavioral evidence (screenshots/logs), and the commands you ran (`pnpm build && pnpm test`). Keep diffs focused; land documentation-only changes separately when possible.

## Security & Configuration Tips
- Load secrets via helpers in `packages/config` and store actual values in `.env.local`, which is already git-ignored.
- Test migrations or other privileged scripts in a disposable Postgres instance with `pnpm migrate:latest` before sharing them.

---

## Multi-Agent Configuration (Epic 9)

Epic 9 introduces the full multi-agent system: configurable provider chains, role-based agent resolution, a prompt template registry, and a security layer. This section describes every part of the system from configuration through runtime execution.

### Overview

The multi-agent system replaces the single `agent.model` setting with a structured `agents` block in `tamma.config.json`. At runtime, the engine maps each workflow phase to an agent role, then resolves the first available provider from that role's chain, applies security wrapping, and injects a rendered system prompt before executing the task.

The main packages involved are:

- `packages/shared/src/types/agent-config.ts` — `AgentsConfig`, `IAgentRoleConfig`, `IProviderChainEntry`, `WorkflowPhase`
- `packages/shared/src/types/security-config.ts` — `SecurityConfig`
- `packages/shared/src/config/normalize-agents-config.ts` — converts legacy `agent` config to `AgentsConfig`
- `packages/providers/src/provider-health.ts` — circuit breaker per provider+model
- `packages/providers/src/agent-provider-factory.ts` — creates `IAgentProvider` from chain entries
- `packages/providers/src/provider-chain.ts` — ordered fallback logic
- `packages/providers/src/agent-prompt-registry.ts` — 6-level template resolution + interpolation
- `packages/providers/src/role-based-agent-resolver.ts` — top-level resolver the engine calls
- `packages/shared/src/security/content-sanitizer.ts` — prompt injection and HTML sanitization
- `packages/shared/src/security/action-gating.ts` — command blocklist enforcement
- `packages/shared/src/security/url-validator.ts` — SSRF-safe URL validation
- `packages/shared/src/security/secure-fetch.ts` — SSRF-protected fetch wrapper

### Configuration Schema

The `agents` block is an optional top-level key in `tamma.config.json`. When absent, the system normalizes the legacy `agent` block automatically (see "Legacy Config Migration" below).

```jsonc
{
  "agents": {
    "defaults": {
      "providerChain": [
        {
          "provider": "claude-code",
          "model": "claude-sonnet-4-5",
          "apiKeyRef": "ANTHROPIC_API_KEY"
        },
        {
          "provider": "openrouter",
          "model": "anthropic/claude-3-5-sonnet",
          "apiKeyRef": "OPENROUTER_API_KEY"
        }
      ],
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "maxBudgetUsd": 2.0,
      "permissionMode": "default",
      "systemPrompt": "You are an autonomous development assistant.",
      "providerPrompts": {
        "openrouter": "You are a coding assistant using OpenRouter. Be concise."
      }
    },
    "roles": {
      "implementer": {
        "providerChain": [
          { "provider": "opencode", "model": "claude-sonnet-4-5" },
          { "provider": "claude-code", "model": "claude-sonnet-4-5" }
        ],
        "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        "maxBudgetUsd": 5.0
      },
      "reviewer": {
        "providerChain": [
          { "provider": "openrouter", "model": "openai/o3-mini", "apiKeyRef": "OPENROUTER_API_KEY" }
        ],
        "maxBudgetUsd": 1.0,
        "systemPrompt": "You are a strict code reviewer. Flag any security issues immediately."
      },
      "architect": {
        "systemPrompt": "You are a senior software architect. Design for maintainability and scale."
      }
    },
    "phaseRoleMap": {
      "CODE_REVIEW": "reviewer",
      "CODE_GENERATION": "implementer"
    }
  }
}
```

#### `defaults` (required)

The `defaults` object applies to every agent role unless a role-specific override is present.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerChain` | `IProviderChainEntry[]` | Yes | Ordered list of providers to try. Must not be empty. |
| `allowedTools` | `string[]` | No | Tools the agent is permitted to use. |
| `maxBudgetUsd` | `number` | No | Maximum spend in USD (0 to 100). |
| `permissionMode` | `'default' \| 'bypassPermissions'` | No | `bypassPermissions` requires `TAMMA_ALLOW_BYPASS_PERMISSIONS=true`. |
| `systemPrompt` | `string` | No | Global default system prompt (level 4 in resolution chain). |
| `providerPrompts` | `Record<string, string>` | No | Per-provider system prompt overrides (level 3 in resolution chain). |

#### `roles` (optional)

Each key is an `AgentType` (see "Agent Roles" below). Fields within a role entry are partial: any field that is undefined falls back to the corresponding `defaults` value at runtime.

#### `phaseRoleMap` (optional)

Overrides which role handles each workflow phase. Only the phases you want to remap need to be listed. Unmapped phases use the built-in defaults (see "Default Phase-to-Role Mapping" below).

### IProviderChainEntry Fields

```typescript
interface IProviderChainEntry {
  provider: string;    // e.g. 'claude-code', 'opencode', 'openrouter', 'zen-mcp'
  model?: string;      // e.g. 'claude-sonnet-4-5', 'anthropic/claude-3-5-sonnet'
  apiKeyRef?: string;  // environment variable name, NOT the raw key value
  config?: Record<string, unknown>; // provider-specific overrides (baseUrl, timeout)
}
```

`apiKeyRef` is the name of the environment variable that holds the actual API key. The factory resolves it at runtime via `process.env[apiKeyRef]`. Raw API key values must never appear in `tamma.config.json`.

Provider names must match the pattern `/^[a-z0-9][a-z0-9_-]{0,63}$/`. The names `__proto__`, `constructor`, and `prototype` are permanently forbidden.

### Agent Roles

The following `AgentType` values are defined:

| Role | Default Phase | Description |
|------|---------------|-------------|
| `scrum_master` | `ISSUE_SELECTION`, `STATUS_MONITORING` | Selects and coordinates issues |
| `analyst` | `CONTEXT_ANALYSIS` | Analyzes codebase structure and context |
| `architect` | `PLAN_GENERATION` | Creates development plans |
| `implementer` | `CODE_GENERATION`, `PR_CREATION` | Writes code and opens pull requests |
| `reviewer` | `CODE_REVIEW` | Reviews code for correctness and security |
| `tester` | `TEST_EXECUTION` | Writes and executes tests |
| `researcher` | (unassigned by default) | Investigates topics and gathers information |
| `planner` | (unassigned by default) | Structures work breakdowns |
| `documenter` | (unassigned by default) | Writes documentation |

### Workflow Phases and Default Phase-to-Role Mapping

The engine progresses through eight phases. Each phase maps to a role, which determines the provider chain, budget, tools, and prompt used for that phase.

| Workflow Phase | Default Role |
|----------------|--------------|
| `ISSUE_SELECTION` | `scrum_master` |
| `CONTEXT_ANALYSIS` | `analyst` |
| `PLAN_GENERATION` | `architect` |
| `CODE_GENERATION` | `implementer` |
| `PR_CREATION` | `implementer` |
| `CODE_REVIEW` | `reviewer` |
| `TEST_EXECUTION` | `tester` |
| `STATUS_MONITORING` | `scrum_master` |

Use `phaseRoleMap` in the `agents` block to override specific phases.

### Provider Chain with Health Tracking and Fallback

`ProviderChain` (in `packages/providers/src/provider-chain.ts`) implements the fallback logic. For each call to `getProvider()`, it iterates through entries in order and applies four skip conditions:

1. **Circuit open** — `ProviderHealthTracker.isHealthy(key)` returns false. The provider has exceeded the failure threshold within the sliding window.
2. **Budget exceeded** — `ICostTracker.checkLimit()` says the provider is over budget. This check is fail-closed: if the check itself throws, the provider is skipped.
3. **Factory creation failure** — `AgentProviderFactory.create(entry)` throws.
4. **Not available** — `provider.isAvailable()` returns false.

On any skip, `ProviderHealthTracker.recordFailure(key)` is called, which updates the sliding failure window. If the failure count reaches the threshold within the window, the circuit opens and the provider is skipped for the open duration.

The returned provider is always wrapped with `InstrumentedAgentProvider`, which emits diagnostics events for every task execution.

#### ProviderHealthTracker Circuit Breaker

`ProviderHealthTracker` (in `packages/providers/src/provider-health.ts`) maintains per-key health state entirely in memory. Process restart resets all state, which is intentional because provider outages are typically transient.

Default settings:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `failureThreshold` | 5 | Failures within the window before opening |
| `failureWindowMs` | 60 000 (1 min) | Sliding window for counting failures |
| `circuitOpenDurationMs` | 300 000 (5 min) | How long the circuit stays open |
| `halfOpenProbeTimeoutMs` | 30 000 (30 sec) | Timeout for a half-open probe attempt |
| `maxTrackedKeys` | 1000 | Memory cap on number of tracked provider+model keys |

Circuit states:

- **Closed** — provider is healthy; requests proceed normally.
- **Open** — too many recent failures; all requests skipped until `circuitOpenUntil`.
- **Half-open** — the open duration has elapsed; exactly one probe attempt is allowed. A successful probe closes the circuit; a failed probe reopens it.

Non-retryable `ProviderError` instances (those with `retryable === false`) are not counted toward the failure threshold because they indicate configuration or caller problems rather than provider health issues.

Keys are formatted as `"provider:model"` (e.g., `"openrouter:anthropic/claude-3-5-sonnet"`). Use `ProviderHealthTracker.buildKey(provider, model)` to construct them consistently.

### AgentProviderFactory and Built-in Providers

`AgentProviderFactory` (in `packages/providers/src/agent-provider-factory.ts`) creates `IAgentProvider` instances from `ProviderChainEntry` objects. It is registered with four built-in providers at construction time and then locked to prevent overriding them:

| Provider Name | Implementation | Notes |
|---------------|----------------|-------|
| `claude-code` | `ClaudeAgentProvider` | CLI agent via Claude Code. Manages its own auth; ignores `apiKeyRef`. |
| `opencode` | `OpenCodeProvider` | CLI agent via OpenCode SDK. Requires OpenCode running locally. |
| `openrouter` | `OpenRouterProvider` | LLM API provider. Wrapped via `wrapAsAgent()`. Requires `OPENROUTER_API_KEY`. |
| `zen-mcp` | `ZenMCPProvider` | LLM API provider via Zen MCP. Wrapped via `wrapAsAgent()`. |

Custom providers can be registered after construction (before the factory is used) with `factory.register(name, creatorFn)`. Attempting to register a name that collides with a built-in throws an error.

LLM providers (those implementing `IAIProvider` with `sendMessageSync`) are automatically wrapped via `wrapAsAgent()`, which converts the prompt-response interface into the `IAgentProvider` interface. The wrapper does not support tool-use loops, streaming progress callbacks, or file tracking; those capabilities require a native agent provider.

API key resolution always goes through `resolveApiKey(entry)`. This function reads `process.env[entry.apiKeyRef]` and throws if the variable is not set. It validates that `apiKeyRef` contains only alphanumeric and underscore characters before the lookup to prevent environment variable injection.

### Role-Based Agent Resolver

`RoleBasedAgentResolver` (in `packages/providers/src/role-based-agent-resolver.ts`) is the object the engine calls to get a provider for any workflow step. It wraps `ProviderChain`, `AgentPromptRegistry`, and optional security components into a single interface.

Methods available on `IRoleBasedAgentResolver`:

```typescript
interface IRoleBasedAgentResolver {
  // Map a workflow phase to a role, then get the provider for that role
  getAgentForPhase(phase: WorkflowPhase, context: { projectId: string; engineId: string }): Promise<IAgentProvider>;

  // Get the provider for a specific role directly
  getAgentForRole(role: AgentType, context: { projectId: string; engineId: string }): Promise<IAgentProvider>;

  // 3-level merged task config with budget/permission/tool clamping
  getTaskConfig(role: AgentType, taskOverrides?: Partial<AgentTaskConfig>): Partial<AgentTaskConfig>;

  // Rendered prompt for a role+provider, with sanitized variable interpolation
  getPrompt(role: AgentType, providerName: string, vars?: Record<string, string>): string;

  // Synchronous phase-to-role lookup
  getRoleForPhase(phase: WorkflowPhase): AgentType;

  // Release cached chain references
  dispose(): Promise<void>;
}
```

`ProviderChain` instances are created lazily per role and cached. A role's chain uses the role-specific `providerChain` if it is defined and non-empty; otherwise it falls back to `defaults.providerChain`.

#### Task Config 3-Level Merge and Clamping

`getTaskConfig(role, taskOverrides)` merges three layers in order:

1. **Defaults layer** — `config.defaults.allowedTools`, `maxBudgetUsd`, `permissionMode`
2. **Role layer** — `config.roles[role]` overrides (undefined fields do not clobber layer 1)
3. **Task layer** — caller-provided `taskOverrides` with clamping:
   - `maxBudgetUsd`: clamped to `Math.min(override, ceiling)` where the ceiling is the merged value from layers 1 and 2
   - `permissionMode: 'bypassPermissions'`: only allowed when `TAMMA_ALLOW_BYPASS_PERMISSIONS=true` in the environment; silently ignored otherwise
   - `allowedTools`: intersection only — task overrides can restrict but never expand the tool set

### Prompt Template System

`AgentPromptRegistry` (in `packages/providers/src/agent-prompt-registry.ts`) resolves and renders system prompts via a 6-level fallback chain. The first non-undefined value wins:

| Level | Source |
|-------|--------|
| 1 | `config.roles[role].providerPrompts[providerName]` |
| 2 | `config.roles[role].systemPrompt` |
| 3 | `config.defaults.providerPrompts[providerName]` |
| 4 | `config.defaults.systemPrompt` |
| 5 | Built-in template for the role (see below) |
| 6 | Generic fallback: `"You are an AI assistant working on a software development task."` |

#### Built-in Templates

Each role has a built-in template that ships with the platform:

| Role | Built-in Template |
|------|------------------|
| `architect` | `"You are analyzing a GitHub issue to create a development plan.\n\n{{context}}"` |
| `implementer` | `"You are an autonomous coding agent. Implement the following plan for issue #{{issueNumber}}."` |
| `reviewer` | `"You are a code reviewer. Review the changes for correctness, style, and security."` |
| `tester` | `"You are a testing agent. Write and run tests for the described changes."` |
| `analyst` | `"You are analyzing project context to understand codebase structure and conventions."` |
| `scrum_master` | `"You are a project coordinator. Select the most appropriate issue to work on next."` |
| `researcher` | `"You are a research agent. Investigate and gather information about the topic at hand."` |
| `planner` | `"You are a planning agent. Create structured plans and organize work breakdown."` |
| `documenter` | `"You are a documentation agent. Write clear, comprehensive documentation for the codebase."` |

#### Variable Interpolation

Templates support `{{variableName}}` placeholders. The engine passes a `vars` map to `registry.render(role, providerName, vars)`, which replaces each `{{key}}` with the corresponding value in a single pass.

Single-pass replacement prevents recursive template injection: if variable `A`'s value contains `{{B}}`, `B` is not expanded. Variable values exceeding 100 000 characters are silently skipped. Rendered templates are truncated at 1 000 000 characters.

The `RoleBasedAgentResolver.getPrompt()` method additionally sanitizes variable values by stripping `{{` and `}}` characters before passing them to the registry. This prevents template injection from user-controlled content.

Custom or plugin-provided templates can be registered via `registry.registerBuiltin(role, template)`. Overriding built-in templates logs a warning. Specific roles can be marked immutable by passing an `immutableRoles` set to the registry constructor.

### Security Features

Epic 9 adds three cooperating security components. All are in `packages/shared/src/security/`.

#### Content Sanitizer

`ContentSanitizer` (in `content-sanitizer.ts`) processes text both before it reaches the LLM (inputs) and after it comes back (outputs).

Input pipeline (`sanitize(input)`):
1. Null byte removal (always applied, even when sanitizer is disabled)
2. HTML stripping via a quote-aware state machine (handles `<div title="a>b">` correctly)
3. Zero-width and invisible Unicode character removal (covers 20+ code points including bidi overrides from CVE-2021-42574)
4. Prompt injection detection (heuristic, returns warnings — does not block execution)

Output pipeline (`sanitizeOutput(output)`):
1. Null byte removal
2. Zero-width character removal
3. HTML stripping with code block preservation (content inside ` ``` ` fences is left untouched)

Prompt injection detection covers five categories:

| Category | Example Patterns |
|----------|-----------------|
| `instruction_override` | "ignore previous instructions", "disregard above", "forget your instructions" |
| `role_hijacking` | "you are now", "act as", "pretend to be", "roleplay as" |
| `system_prompt_extraction` | "repeat your system prompt", "what are your instructions", "show me your prompt" |
| `delimiter_injection` | ` ```system `, `###system###`, `[INST]`, `<\|im_start\|>` |
| `encoding_evasion` | Unicode NFKD normalization detects fullwidth Latin bypass (e.g., ｉｇｎｏｒｅ) |

Detection is heuristic. Warnings are returned in the result but do not block execution. The caller decides how to handle warnings (log, alert, or reject).

Additional injection patterns can be added per-instance via `ContentSanitizerOptions.extraInjectionPatterns`. These are additive to the built-in patterns; they do not replace them.

Configuration:

```typescript
interface ContentSanitizerOptions {
  enabled?: boolean;               // Default: true. When false, only null bytes are removed.
  extraInjectionPatterns?: string[]; // Additional patterns to detect
  logger?: ILogger;                // Logs warnings at WARN level
}
```

#### URL Validator

`validateUrl(url)` (in `url-validator.ts`) validates a URL for safe outbound use:

1. Parses with `new URL()` — unparseable URLs are rejected
2. Protocol must be `http:`, `https:`, `ws:`, or `wss:`
3. Hostname must not be a private/reserved address

Private address detection uses integer arithmetic on IPv4 octets (not regex) for RFC 1918 ranges. IPv6-mapped IPv4 (`::ffff:x.x.x.x`), bracketed IPv6 (`[::1]`), cloud metadata endpoints, and Docker host access are all blocked.

Blocked hosts include: `localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.169.254` (AWS/Azure metadata), `100.100.100.200` (Alibaba Cloud metadata), `metadata.google.internal` (GCP metadata), `host.docker.internal`.

The function never throws. It returns `{ valid: boolean; warnings: string[] }`. URL text in error messages is truncated to 200 characters to avoid leaking sensitive URL content.

#### Secure Fetch

`secureFetch(url, options)` (in `secure-fetch.ts`) wraps `globalThis.fetch` with SSRF protections:

1. Pre-request URL validation via `validateUrl()`
2. Manual redirect handling — each `Location` header is re-validated before following
3. Sensitive headers (`Authorization`, `Cookie`, `Proxy-Authorization`) are stripped on cross-origin redirects
4. `Content-Type` allowlist check before reading the body (default: `text/`, `application/json`, `application/xml`)
5. Streaming body read via `ReadableStream` with a running byte counter
6. `AbortController`-based size limit (default: 10 MB) and timeout (default: 30 s) enforcement
7. Maximum 5 redirect hops (configurable)

```typescript
interface SecureFetchOptions {
  maxSizeBytes?: number;          // Default: 10 485 760 (10 MB)
  timeoutMs?: number;             // Default: 30 000 ms
  allowedProtocols?: string[];    // Default: ['http:', 'https:']
  allowedContentTypes?: string[]; // Default: ['text/', 'application/json', 'application/xml']
  maxRedirects?: number;          // Default: 5
  headers?: Record<string, string>;
}
```

#### Action Gating

`evaluateAction(command, options)` (in `action-gating.ts`) checks proposed shell commands against a blocklist before the agent executes them.

Matching uses case-insensitive substring matching (not regex) to eliminate ReDoS risk. Before matching, the command is normalized: trimmed, lowercased, backslashes stripped, empty quote pairs (`""`, `''`) removed, and multiple spaces collapsed.

Default blocked patterns include:

- Destructive filesystem operations: `rm -rf /`, `rm -rf ~`, `rm -rf *`, `mkfs`, `dd if=`, `format c:`
- System control: `shutdown`, `reboot`, `halt`, `poweroff`, `init 0`, `init 6`
- Process killing: `kill -9 1`, `killall`, `pkill -9`
- Dangerous permissions: `chmod -r 777 /`, `chown -r`
- Remote code execution: `wget | sh`, `curl | bash`
- Shell metacharacter bypass patterns: `| sh`, `| bash`, `| eval`, `| /bin/sh`, `base64 -d |`, `$(`, `${`
- Interpreter pipes: `| python`, `| perl`, `| ruby`, `| node`
- Fork bomb: `:(){:|:&};:`
- Backtick execution (checked separately)

Blocking reason messages are generic (`"Command blocked by security policy"`) and do not reveal which pattern matched, preventing attackers from probing the blocklist.

Custom patterns can be appended via `ActionGateOptions.extraPatterns`. To replace the defaults entirely (use with caution), set `replaceDefaults: true`.

The function never throws. On any internal error, it returns `{ allowed: false }` as a fail-closed safety measure.

#### SecureAgentProvider

`SecureAgentProvider` (in `packages/providers/src/secure-agent-provider.ts`) is a decorator that wraps any `IAgentProvider`. When a `sanitizer` is configured on the `RoleBasedAgentResolver`, it wraps every resolved provider automatically.

The decorator applies `ContentSanitizer.sanitize()` to the task prompt before forwarding to the inner provider, and `ContentSanitizer.sanitizeOutput()` to the response output before returning it to the engine. Any sanitization warnings are passed through in the result.

### Environment Variable Overrides for API Keys

All API keys must be stored in environment variables, never in config files. Provider chain entries reference the environment variable name via `apiKeyRef`:

```jsonc
{
  "provider": "openrouter",
  "model": "anthropic/claude-3-5-sonnet",
  "apiKeyRef": "OPENROUTER_API_KEY"
}
```

At startup, `AgentProviderFactory.create()` calls `resolveApiKey(entry)`, which reads `process.env["OPENROUTER_API_KEY"]`. If the variable is not set, factory creation fails and the chain moves to the next entry.

Known `apiKeyRef` values by provider:

| Provider | Typical `apiKeyRef` |
|----------|---------------------|
| `claude-code` | Not required (manages own auth via Claude subscription) |
| `opencode` | Not required (connects to local OpenCode process) |
| `openrouter` | `OPENROUTER_API_KEY` |
| `zen-mcp` | `ZEN_MCP_API_KEY` or similar |

Security constraints on `apiKeyRef`:
- Must match `/^[A-Za-z0-9_]+$/` (alphanumeric and underscore only)
- This prevents shell injection and path traversal via the environment variable name itself

### Security Configuration Schema

The `security` block is an optional top-level key in `tamma.config.json`. All fields are optional.

```jsonc
{
  "security": {
    "sanitizeContent": true,
    "validateUrls": true,
    "gateActions": true,
    "maxFetchSizeBytes": 10485760,
    "blockedCommandPatterns": [
      "git push --force",
      "npm publish"
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sanitizeContent` | `boolean` | unset | Enable `ContentSanitizer` on all agent I/O |
| `validateUrls` | `boolean` | unset | Enable `validateUrl()` before outbound requests |
| `gateActions` | `boolean` | unset | Enable `evaluateAction()` on agent shell commands |
| `maxFetchSizeBytes` | `number` | 10 485 760 | Maximum response body size for `secureFetch()` |
| `blockedCommandPatterns` | `string[]` | [] | Additional patterns appended to `DEFAULT_BLOCKED_COMMANDS` |

Validation constraints:
- `blockedCommandPatterns`: maximum 100 patterns, each at most 500 characters, each must be a valid regex string (validated at startup with `new RegExp(pattern)`)
- `maxFetchSizeBytes`: must be between 0 and 1 073 741 824 (1 GiB)

### Legacy Config Migration

If `tamma.config.json` has an `agent` block but no `agents` block, the system calls `normalizeAgentsConfig(config)` automatically at startup. This function converts the legacy single-agent format into an `AgentsConfig` object without throwing on any input.

The legacy `agent.provider` field maps to provider names as follows:

| Legacy `agent.provider` | Normalized `defaults.providerChain[0].provider` |
|-------------------------|-------------------------------------------------|
| `anthropic` | `claude-code` |
| `openai` | `openrouter` |
| `local` | `local` |

Example: a legacy config of `{ "agent": { "model": "claude-sonnet-4-5", "maxBudgetUsd": 1.0 } }` becomes:

```json
{
  "defaults": {
    "providerChain": [{ "provider": "claude-code", "model": "claude-sonnet-4-5" }],
    "maxBudgetUsd": 1.0,
    "permissionMode": "default"
  }
}
```

When neither `agent` nor `agents` is present, the system uses the hardcoded safe default: `claude-code` with `claude-sonnet-4-5` and a `1.0` USD budget.

### Full tamma.yaml Example

The following example shows a production-like `agents` configuration with multiple roles, fallbacks, and security settings:

```jsonc
{
  "mode": "standalone",
  "logLevel": "info",
  "github": {
    "owner": "your-org",
    "repo": "your-repo",
    "issueLabels": ["tamma"],
    "excludeLabels": ["wontfix"],
    "botUsername": "tamma-bot"
  },
  "engine": {
    "pollIntervalMs": 300000,
    "workingDirectory": ".",
    "approvalMode": "cli",
    "ciPollIntervalMs": 30000,
    "ciMonitorTimeoutMs": 3600000
  },
  "agents": {
    "defaults": {
      "providerChain": [
        {
          "provider": "claude-code",
          "model": "claude-sonnet-4-5"
        },
        {
          "provider": "openrouter",
          "model": "anthropic/claude-3-5-sonnet",
          "apiKeyRef": "OPENROUTER_API_KEY"
        }
      ],
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "maxBudgetUsd": 2.0,
      "permissionMode": "default"
    },
    "roles": {
      "implementer": {
        "providerChain": [
          { "provider": "opencode", "model": "claude-sonnet-4-5" },
          { "provider": "claude-code", "model": "claude-sonnet-4-5" },
          {
            "provider": "openrouter",
            "model": "anthropic/claude-3-5-sonnet",
            "apiKeyRef": "OPENROUTER_API_KEY"
          }
        ],
        "maxBudgetUsd": 5.0,
        "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
      },
      "reviewer": {
        "providerChain": [
          {
            "provider": "openrouter",
            "model": "openai/o3-mini",
            "apiKeyRef": "OPENROUTER_API_KEY"
          }
        ],
        "maxBudgetUsd": 1.0,
        "systemPrompt": "You are a strict code reviewer. Flag any security issues, performance regressions, or breaking changes immediately."
      },
      "architect": {
        "maxBudgetUsd": 1.5
      }
    },
    "phaseRoleMap": {
      "CODE_GENERATION": "implementer",
      "CODE_REVIEW": "reviewer",
      "PLAN_GENERATION": "architect"
    }
  },
  "security": {
    "sanitizeContent": true,
    "validateUrls": true,
    "gateActions": true,
    "maxFetchSizeBytes": 10485760
  }
}
```

### Diagnostics and Telemetry

Every task executed through a provider chain is wrapped in `InstrumentedAgentProvider`, which emits structured events to the `DiagnosticsQueue` before and after each `executeTask()` call. These events capture the provider name, model, agent type, project ID, engine ID, task ID, task type, duration, token usage, and success/failure status.

The `DiagnosticsQueue` (in `packages/shared/src/telemetry/diagnostics-queue.ts`) is a bounded in-memory queue. Events are processed asynchronously by `DiagnosticsProcessor` and can be forwarded to the event store for the DCB audit trail.

Provider health state is also exposed via `ProviderHealthTracker.getStatus()`, which returns a `Record<string, HealthStatusEntry>` with the current failure count, circuit state, and health status for every tracked provider+model key.
