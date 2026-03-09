# Tamma Architecture Overview

Tamma's architecture is designed for **autonomous operation**, **multi-provider flexibility**, and **production-grade quality gates**.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Tamma Platform                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────┐              ┌─────────────────┐            │
│  │  Orchestrator   │◄────────────►│  Worker Pool    │            │
│  │  (Coordinator)  │              │  (Executors)    │            │
│  └────────┬────────┘              └────────┬────────┘            │
│           │                                │                      │
│           ▼                                ▼                      │
│  ┌─────────────────────────────────────────────────────┐         │
│  │         Development Context Bus (DCB)               │         │
│  │         Event Sourcing & Audit Trail               │         │
│  └─────────────────────────────────────────────────────┘         │
│           │                                │                      │
│  ┌────────▼────────┐              ┌────────▼────────┐            │
│  │  Role-Based     │              │  Git Platform   │            │
│  │  Agent Resolver │              │  Abstraction    │            │
│  └────────┬────────┘              └────────┬────────┘            │
│           │                                │                      │
│  ┌────────▼────────────────────┐   ┌───────▼───────┐            │
│  │  Provider Chain             │   │ GitHub/GitLab │            │
│  │  (fallback + circuit break) │   │ Gitea/Forgejo │            │
│  └────────┬────────────────────┘   └───────────────┘            │
│           │                                                       │
│  ┌────────▼──────────────────────────────────────────┐          │
│  │  Security Layer                                    │          │
│  │  (content sanitization, URL validation,            │          │
│  │   action gating, secure fetch)                     │          │
│  └────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Hybrid Orchestrator/Worker Architecture

**Orchestrator Mode** (Stateful Coordinator):
- Manages task queue and worker pool
- Coordinates autonomous development loop
- Tracks in-flight tasks and state
- Exposes REST API and WebSocket for monitoring
- Persists state for graceful restart

**Worker Mode** (Stateless Executor):
- Executes single tasks (issue analysis, code generation, test generation, PR creation)
- Reports progress and results to orchestrator
- Can run in CI/CD pipelines or as background workers
- No state persistence required

**Standalone Mode** (Direct Execution):
- CLI-driven execution without orchestrator
- Single-issue processing
- Local development and testing

[Detailed Architecture Doc](https://github.com/meywd/tamma/blob/main/docs/architecture.md)

---

### 2. AI Provider Abstraction (`@tamma/providers`)

**Interface-Based Design:**
- `IAIProvider` interface defines standard LLM operations (synchronous and streaming messages)
- `IAgentProvider` interface defines task-based agent operations (tool-calling CLI agents)
- `ICLIAgentProvider` for providers that manage their own subprocess execution

**Supported Providers:**
- **Anthropic Claude** (claude-code CLI agent - reference implementation)
- OpenCode (open-source CLI agent)
- OpenAI GPT-4 / GPT-3.5-turbo
- Google Gemini Pro
- GitHub Copilot
- OpenRouter (aggregator for 100+ models)
- Local LLMs (Ollama, LM Studio, vLLM)
- Zen MCP (Model Context Protocol gateway)

**Provider Capabilities Discovery:**
- Dynamic capability query (streaming, models, token limits)
- Automatic provider selection based on task requirements
- Cost-aware routing (use cheaper models for simple tasks)

---

### 3. Config-Driven Multi-Agent System (Epic 9)

The multi-agent system is the central mechanism by which the engine assigns appropriately-specialized AI agents to each phase of the autonomous development loop.

#### 3.1 Multi-Agent Configuration Schema

The `IAgentsConfig` type (in `packages/shared/src/types/agent-config.ts`) is the top-level configuration object:

```typescript
interface IAgentsConfig {
  // Default configuration for all roles (required, must have non-empty providerChain)
  defaults: IAgentRoleConfig;
  // Per-role overrides (partial, merged with defaults at runtime)
  roles?: Partial<Record<AgentType, Partial<IAgentRoleConfig>>>;
  // Override the default workflow-phase-to-role mapping
  phaseRoleMap?: Partial<Record<WorkflowPhase, AgentType>>;
}

interface IAgentRoleConfig {
  // Ordered list of providers to try (first = primary, rest = fallbacks)
  providerChain: IProviderChainEntry[];
  // Tools this role is allowed to use
  allowedTools?: string[];
  // Maximum budget in USD for this role's operations
  maxBudgetUsd?: number;
  // Permission mode ('default' or 'bypassPermissions')
  permissionMode?: PermissionMode;
  // System prompt override
  systemPrompt?: string;
  // Per-provider prompt overrides (key = provider name)
  providerPrompts?: Record<string, string>;
}

interface IProviderChainEntry {
  // Provider identifier (e.g., 'claude-code', 'openrouter')
  provider: string;
  // Model identifier (e.g., 'claude-sonnet-4-5')
  model?: string;
  // Environment variable name containing the API key (NOT a raw key)
  apiKeyRef?: string;
  // Provider-specific config (baseUrl, timeout, etc.)
  config?: Record<string, unknown>;
}
```

**Example configuration:**

```json
{
  "agents": {
    "defaults": {
      "providerChain": [
        { "provider": "claude-code", "model": "claude-sonnet-4-5" },
        { "provider": "openrouter", "model": "z-ai/z1-mini", "apiKeyRef": "OPENROUTER_API_KEY" }
      ],
      "allowedTools": ["Read", "Write", "Bash"],
      "maxBudgetUsd": 5.0
    },
    "roles": {
      "implementer": {
        "providerChain": [
          { "provider": "claude-code", "model": "claude-opus-4-6" }
        ],
        "maxBudgetUsd": 20.0
      },
      "reviewer": {
        "systemPrompt": "You are a strict code reviewer focused on security and correctness."
      }
    }
  }
}
```

**Validation rules enforced at config load time:**
- `defaults.providerChain` must be non-empty
- Provider names must match `/^[a-z0-9][a-z0-9_-]{0,63}$/`
- Prototype pollution targets (`__proto__`, `constructor`, `prototype`) are rejected
- `maxBudgetUsd` must be a finite number between 0 and 100
- `blockedCommandPatterns` must be valid regexes, maximum 100 entries

#### 3.2 Workflow Phase to Role Mapping

The autonomous development loop has 8 workflow phases. Each phase maps to an agent role:

```
ISSUE_SELECTION   → scrum_master
CONTEXT_ANALYSIS  → analyst
PLAN_GENERATION   → architect
CODE_GENERATION   → implementer
PR_CREATION       → implementer
CODE_REVIEW       → reviewer
TEST_EXECUTION    → tester
STATUS_MONITORING → scrum_master
```

Operators can override any mapping via `phaseRoleMap` in configuration. The `RoleBasedAgentResolver.getRoleForPhase()` method enforces the precedence: custom map first, then built-in defaults.

#### 3.3 Role-Based Agent Resolver

`RoleBasedAgentResolver` (in `packages/providers/src/role-based-agent-resolver.ts`) is the top-level facade used by the engine. It integrates all Epic 9 subsystems:

```
WorkflowPhase
    |
    v
getRoleForPhase()        -- phaseRoleMap config → DEFAULT_PHASE_ROLE_MAP
    |
    v
getAgentForRole()        -- validates role name, gets/creates ProviderChain
    |
    v
ProviderChain.getProvider()   -- iterates entries with health + budget checks
    |
    v
AgentProviderFactory.create() -- constructs IAgentProvider from chain entry
    |
    v
InstrumentedAgentProvider     -- wraps with diagnostics events
    |
    v (if sanitizer configured)
SecureAgentProvider           -- wraps with content sanitization
```

Key security properties enforced by the resolver:
- **Budget clamping**: task-level `maxBudgetUsd` cannot exceed the configured ceiling
- **Permission clamping**: `bypassPermissions` requires `TAMMA_ALLOW_BYPASS_PERMISSIONS=true` env var
- **Tool clamping**: task-level `allowedTools` can only restrict, never expand beyond the configured set
- **Template injection prevention**: variable values passed to `getPrompt()` have `{{` and `}}` stripped before rendering

#### 3.4 Provider Chain with Circuit Breaker Health Tracking

`ProviderChain` (in `packages/providers/src/provider-chain.ts`) implements ordered fallback with four skip conditions:

```
For each entry in chain:
  1. Health check (circuit open?) → skip
  2. Budget check (limit exceeded?) → skip (fail-closed)
  3. Factory.create() + isAvailable() → skip on failure
  4. Wrap with InstrumentedAgentProvider
  → Return first successful provider
If all exhausted → throw NO_AVAILABLE_PROVIDER
```

`ProviderHealthTracker` (in `packages/providers/src/provider-health.ts`) maintains an in-memory circuit breaker per `provider:model` key:

```
Circuit States:
  CLOSED  → healthy, accepting requests
  OPEN    → unhealthy, blocking requests until circuitOpenDurationMs elapses
  HALF-OPEN → one probe request allowed; success → CLOSED, failure → OPEN

Default thresholds:
  failureThreshold:     5 failures
  failureWindowMs:      60,000 ms (1 minute)
  circuitOpenDurationMs: 300,000 ms (5 minutes)
  halfOpenProbeTimeoutMs: 30,000 ms (30 seconds)
  maxTrackedKeys:        1,000
```

Non-retryable `ProviderError` objects are excluded from the failure count because they represent configuration or caller mistakes, not provider health issues.

#### 3.5 Agent Provider Factory

`AgentProviderFactory` (in `packages/providers/src/agent-provider-factory.ts`) constructs `IAgentProvider` instances from chain entries. Built-in providers registered at construction:

| Provider Name | Class | Type |
|---------------|-------|------|
| `claude-code` | `ClaudeAgentProvider` | CLI agent (IAgentProvider) |
| `opencode` | `OpenCodeProvider` | CLI agent (IAgentProvider) |
| `openrouter` | `OpenRouterProvider` | LLM provider (IAIProvider, auto-wrapped) |
| `zen-mcp` | `ZenMCPProvider` | LLM provider (IAIProvider, auto-wrapped) |

LLM providers (`IAIProvider`) are duck-typed at creation time: if the provider has `sendMessageSync`, it is wrapped via `wrapAsAgent()` which adapts the single-turn `sendMessageSync` call into the `executeTask()` contract required by `IAgentProvider`.

API keys are resolved from environment variables via `apiKeyRef` — raw keys are never stored in configuration files.

#### 3.6 Prompt Template Registry

`AgentPromptRegistry` (in `packages/providers/src/agent-prompt-registry.ts`) resolves system prompt templates with a 6-level resolution chain (first non-undefined wins):

```
1. roles[role].providerPrompts?.[providerName]   -- per-role, per-provider
2. roles[role].systemPrompt                       -- per-role default
3. defaults.providerPrompts?.[providerName]       -- global per-provider
4. defaults.systemPrompt                          -- global default
5. builtinTemplates[role]                         -- built-in role preamble
6. GENERIC_FALLBACK                               -- "You are an AI assistant..."
```

Built-in role preambles are provided for: `architect`, `implementer`, `reviewer`, `tester`, `analyst`, `scrum_master`, `researcher`, `planner`, `documenter`.

Template rendering uses `{{variable}}` syntax with single-pass substitution. Single-pass expansion prevents recursive injection: if variable `A`'s value contains `{{B}}`, `B` is not expanded. Variables exceeding 100KB are skipped with a warning. Rendered templates exceeding 1MB are truncated.

---

### 4. Security Layer

All agent interactions pass through a multi-component security layer designed as defense-in-depth. No single component is expected to catch all attacks; they work together.

#### 4.1 Content Sanitization

`ContentSanitizer` (in `packages/shared/src/security/content-sanitizer.ts`) implements `IContentSanitizer`:

**Input sanitization pipeline (`sanitize()`):**
1. Null byte removal (always applied, even when sanitizer is disabled)
2. HTML stripping using a quote-aware state machine (not regex) to handle attributes like `title="a>b"`
3. Zero-width and invisible Unicode character removal (20+ code points including CVE-2021-42574 bidi overrides: U+202A–U+202E)
4. Prompt injection detection across 4 categories:
   - Instruction override: "ignore previous instructions", "disregard above"
   - Role hijacking: "you are now", "act as", "pretend to be"
   - System prompt extraction: "repeat your system prompt", "show me your prompt"
   - Delimiter injection: ` ```system `, `[INST]`, `<|im_start|>`
5. NFKD Unicode normalization before pattern matching to defeat encoding evasion (fullwidth Latin characters)

**Output sanitization pipeline (`sanitizeOutput()`):**
1. Null byte removal (always applied)
2. Zero-width character removal
3. HTML stripping outside code blocks (code block content is preserved verbatim)

Injection detection is heuristic (not a guarantee). Detected patterns produce warnings in the return value but do not block execution. This is intentional: blocking on false positives would break legitimate prompts that happen to contain matched phrases.

`SecureAgentProvider` (in `packages/providers/src/secure-agent-provider.ts`) wraps any `IAgentProvider` and applies sanitization:
- Pre-call: `sanitize(config.prompt)`
- Post-call: `sanitizeOutput(taskResult.output)` and `sanitizeOutput(taskResult.error)`
- New config and result objects are created; originals are never mutated

#### 4.2 URL Validation

`validateUrl()` (in `packages/shared/src/security/url-validator.ts`) checks URLs before any outbound request:

- Protocol allowlist: `http:`, `https:`, `ws:`, `wss:`
- Private host blocking using **numeric octet parsing** (not regex) for RFC 1918 ranges
- Blocked hosts: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local)
- Blocked literals: `localhost`, `0.0.0.0`, `[::]`, `[::1]`, cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, `host.docker.internal`, `100.100.100.200`)
- IPv6 private ranges: `fc00::/7` (unique local), `fe80::/10` (link-local)
- IPv6-mapped IPv4: `[::ffff:x.x.x.x]` handled recursively
- URL truncated to 200 chars in error messages to prevent information leakage

#### 4.3 Action Gating

`evaluateAction()` (in `packages/shared/src/security/action-gating.ts`) gates autonomous shell commands:

- Matches against a default blocklist of destructive patterns using case-insensitive substring matching (not regex, eliminating ReDoS risk)
- Normalization before matching: trim, lowercase, strip backslashes, strip empty quote pairs (`""`, `''`), collapse whitespace
- Default blocked patterns cover: `rm -rf /`, `mkfs`, `dd if=`, fork bombs, `chmod -R 777 /`, `shutdown`, `reboot`, pipe-to-shell patterns (`| sh`, `| bash`, `base64 -d |`), command substitution (`$(`, `${`), backtick execution
- Reason messages never reveal which pattern matched (prevents blocklist probing)
- Operators can extend patterns via `extraPatterns` or replace defaults via `replaceDefaults: true`

#### 4.4 Secure Fetch

`secureFetch()` (in `packages/shared/src/security/secure-fetch.ts`) provides SSRF-protected outbound HTTP:

1. Pre-request URL validation via `validateUrl()`
2. Manual redirect handling with `Location` header re-validation on each hop (max 5 redirects)
3. Sensitive header stripping (`Authorization`, `Cookie`, `Proxy-Authorization`) on cross-origin redirects
4. Content-Type allowlist before reading body (`text/`, `application/json`, `application/xml`)
5. Streaming body read via `ReadableStream` with running byte counter (default max 10 MB)
6. `AbortController`-based timeout enforcement (default 30 seconds)

Uses `globalThis.fetch` (Node.js 22 LTS built-in) — no polyfills required.

---

### 5. Diagnostics Pipeline

The diagnostics pipeline collects per-provider telemetry without blocking execution.

#### 5.1 Instrumented Agent Provider

`InstrumentedAgentProvider` (in `packages/providers/src/instrumented-agent-provider.ts`) wraps any `IAgentProvider` and emits three event types to the `DiagnosticsQueue`:

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `provider:call` | Before inner `executeTask()` | providerName, model, agentType, projectId, engineId, taskId, taskType |
| `provider:complete` | After success | + latencyMs, success, costUsd, tokens (input/output), errorCode (on task failure) |
| `provider:error` | On exception | + latencyMs, success: false, errorCode, errorMessage (sanitized) |

Error messages are sanitized before emission to strip API keys and other sensitive values. Error codes are typed as `DiagnosticsErrorCode` (typed union, not arbitrary strings).

The `updateContext()` method allows updating `taskId` and `taskType` between calls without creating a new wrapper instance.

#### 5.2 Diagnostics Queue

`DiagnosticsQueue` (in `packages/shared/src/telemetry/diagnostics-queue.ts`) decouples synchronous event emission from asynchronous processing:

```
emit() [synchronous, hot path]
  → push to internal queue (FIFO)
  → if queue >= maxQueueSize: drop oldest event, increment droppedCount

Timer drain [async, every drainIntervalMs]
  → splice all events from queue
  → call processor(batch)
  → guard against concurrent drains (drainPromise)
  → log processor errors via logger.warn()

dispose() [flush and stop]
  → clear drain timer
  → re-drain loop (max 10 iterations) until queue empty
```

Default configuration: `drainIntervalMs: 5000`, `maxQueueSize: 1000`. The drain timer uses `.unref()` so it does not keep the Node.js process alive.

#### 5.3 MCP Tool Interceptor Chain

`ToolInterceptorChain` (in `packages/mcp-client/src/interceptors.ts`) provides blocking pre/post hooks for MCP tool calls:

- **Pre-interceptors**: transform tool arguments before execution (run in registration order, piping output)
- **Post-interceptors**: transform tool results after execution (run in registration order, piping output)
- Errors are isolated per-interceptor with fail-open behavior (chain continues with unmodified args/result)
- Prototype pollution keys (`__proto__`, `constructor`, `prototype`) are stripped from returned args

Built-in interceptor factories:
- `createSanitizationInterceptor(sanitizer)`: post-interceptor that sanitizes text content in tool results using `IContentSanitizer`
- `createUrlValidationInterceptor(validateUrlFn)`: pre-interceptor that validates URL-like values in tool args, replacing blocked URLs with `[URL_BLOCKED_BY_POLICY]` (fail-closed)

---

### 6. Git Platform Abstraction (`@tamma/platforms`)

**Interface-Based Design:**
- `IGitPlatform` interface defines standard operations:
  - `createPR()` - Pull request creation
  - `commentOnPR()` - Add PR comments
  - `mergePR()` - Merge pull requests
  - `getIssue()` - Fetch issue details
  - `createBranch()` - Create git branches
  - `triggerCI()` - Trigger CI/CD pipelines

**Supported Platforms:**
- **GitHub** (reference implementation)
- GitLab (self-hosted and cloud)
- Gitea (self-hosted)
- Forgejo (Gitea fork, self-hosted)
- Bitbucket (Cloud and Server)
- Azure DevOps (Services and Server)
- Plain Git (local repositories, no platform features)

**Platform Normalization:**
- Unified data models for PRs, issues, branches, CI status
- Abstraction over platform differences (GitHub PRs vs GitLab Merge Requests)
- Pagination and rate limit handling

---

### 7. Development Context Bus (DCB)

**Event Sourcing Architecture:**
- All state mutations emitted as events
- Complete audit trail for debugging and transparency
- Event replay for testing and rollback
- PostgreSQL + event store for persistence

**Event Types:**
- IssueAnalyzed
- CodeGenerated
- TestsGenerated
- ReviewCompleted
- PRCreated
- QualityGatePassed/Failed
- EscalationTriggered

---

### 8. Autonomous Development Loop

```
┌──────────────────────────────────────────────────────┐
│                Autonomous Loop                       │
├──────────────────────────────────────────────────────┤
│                                                       │
│  1. Issue Selection     ──►  scrum_master agent      │
│  2. Context Analysis    ──►  analyst agent           │
│  3. Plan Generation     ──►  architect agent         │
│  4. Code Generation     ──►  implementer agent       │
│  5. Test Execution      ──►  tester agent            │
│  6. Code Review         ──►  reviewer agent          │
│  7. PR Creation         ──►  implementer agent       │
│  8. Status Monitoring   ──►  scrum_master agent      │
│  9. Decision Point      ──►  Merge or Escalate       │
│                                                       │
└──────────────────────────────────────────────────────┘
```

Each step uses `RoleBasedAgentResolver.getAgentForPhase()` to get the appropriate provider for that phase's role. The engine calls `getTaskConfig()` to merge configuration constraints and `getPrompt()` to render the role-appropriate system prompt before executing the task.

**Quality Gates (Mandatory):**
- Test coverage >= 80%
- Security scanning (SAST, dependency scan)
- Performance regression detection
- Code review approval (AI + optional human)
- CI/CD pipeline success

**Escalation Triggers:**
- Ambiguous requirements detected
- Test coverage below threshold
- Security vulnerabilities found
- Breaking changes detected
- CI/CD pipeline failures

---

## Technology Stack

### Backend
- **Runtime:** Node.js 22 LTS
- **Language:** TypeScript 5.7+ (strict mode)
- **Framework:** Fastify (HTTP server, WebSocket)
- **Database:** PostgreSQL 17 (state, queue, events)
- **Event Store:** PostgreSQL + event sourcing library

### AI & ML
- **AI SDKs:**
  - `@anthropic-ai/sdk` - Claude API
  - `openai` - GPT-4 API
  - `@google/generative-ai` - Gemini API
  - `@modelcontextprotocol/sdk` - MCP integration
- **Tool Integration:** Native function calling / tool use

### Git & Platform Integration
- **GitHub:** `@octokit/rest` (REST API v4 + GraphQL)
- **GitLab:** `@gitbeaker/node` (GitLab SDK)
- **Bitbucket:** REST API v2 (Cloud), REST API (Server)
- **Azure DevOps:** `azure-devops-node-api` (official SDK)
- **Local Git:** `simple-git` (local operations)

### Observability
- **Metrics:** Prometheus + Grafana
- **Tracing:** OpenTelemetry
- **Logging:** Pino (structured JSON logs)
- **Diagnostics:** DiagnosticsQueue + per-provider cost/latency tracking
- **Health Checks:** `/health`, `/ready`, `/metrics` endpoints

### Deployment
- **Containers:** Docker multi-stage builds
- **Orchestration:** Kubernetes (Helm charts)
- **CI/CD:** GitHub Actions, GitLab CI
- **Package Management:** pnpm workspaces (monorepo)

---

## Security & Quality

### Authentication & Authorization
- API token-based authentication (GitHub PAT, GitLab PAT, etc.)
- OAuth2 support for user-facing flows
- Secure credential storage (OS keychain integration)
- API keys stored only as environment variable references — never in config files

### Input Validation
- JSON Schema validation for all inputs
- Rate limiting and throttling
- Injection attack prevention via content sanitization
- URL validation with private IP blocking
- Action gating for shell command execution

### Quality Assurance
- **Test Coverage:** 80% line, 75% branch, 85% function
- **Linting:** ESLint + Prettier
- **Type Safety:** TypeScript strict mode (`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`)
- **CI/CD:** Automated testing on all PRs

---

## Deployment Modes

### 1. Orchestrator Mode (Production)
```bash
tamma --mode orchestrator --config ~/.tamma/config.json
```
- Runs as HTTP server with REST API
- Manages worker pool
- Persists state in PostgreSQL
- Suitable for multi-user, production deployments

### 2. Worker Mode (Distributed)
```bash
tamma --mode worker --orchestrator-url http://orchestrator:3000
```
- Stateless executor
- Polls orchestrator for tasks
- Can run in CI/CD or as background worker
- Horizontally scalable

### 3. Standalone Mode (Development)
```bash
tamma --mode standalone --issue 123
```
- Direct CLI execution
- No orchestrator required
- Suitable for local development and testing

---

## Monitoring & Observability

### Metrics (Prometheus)
- `tamma_tasks_completed_total` - Total tasks completed
- `tamma_tasks_duration_seconds` - Task execution time
- `tamma_quality_gate_failures_total` - Quality gate failures
- `tamma_escalations_total` - Human escalations triggered
- `tamma_ai_provider_requests_total` - AI provider API calls
- `tamma_ai_provider_tokens_total` - Token usage by provider
- `tamma_provider_circuit_breaker_state` - Circuit breaker open/closed per provider

### Diagnostics Events
- `provider:call` - Provider invocation start
- `provider:complete` - Provider invocation success (with latency, cost, tokens)
- `provider:error` - Provider invocation failure (with error code, sanitized message)

### Distributed Tracing (OpenTelemetry)
- End-to-end request tracing
- Service-to-service call visibility
- Performance bottleneck identification

### Logging (Pino)
- Structured JSON logs
- Context propagation (trace ID, span ID)
- Log aggregation (Elasticsearch, Loki)

---

## For More Details

- [Full Architecture Document](https://github.com/meywd/tamma/blob/main/docs/architecture.md)
- [Epic 9: Agent Management](Epic-9-Agent-Management)
- [Tech Spec Epic 1](https://github.com/meywd/tamma/blob/main/docs/tech-spec-epic-1.md)
- [Tech Spec Epic 2](https://github.com/meywd/tamma/blob/main/docs/tech-spec-epic-2.md)
- [PRD](https://github.com/meywd/tamma/blob/main/docs/PRD.md)
