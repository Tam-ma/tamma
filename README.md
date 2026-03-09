# Tamma

Tam-ma or Tam for short, meaning It's Done

**AI-Powered Development Orchestration Platform**

From GitHub issue to merged PR—completely autonomous.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/meywd/tamma/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.7.0-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/postgreSQL-17-blue.svg)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/tests-3864%20passing-brightgreen.svg)](#development-progress)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

---

Tamma bridges the gap between AI coding assistants and fully autonomous development by providing a structured, event-sourced workflow that turns GitHub issues into merged pull requests without human intervention.

## Why Tamma?

- **Fully Autonomous**: From issue selection to PR merge without human intervention
- **Multi-Provider**: Works with Claude Code, OpenCode, OpenRouter, Zen MCP, and any AI provider
- **Config-Driven Agent Management**: Per-role provider chains, budgets, tools, and prompts defined in configuration
- **Security-First**: Prompt injection detection, SSRF protection, action gating, and content sanitization baked in
- **Platform Agnostic**: GitHub, GitLab, and self-hosted Git support
- **Event Sourced**: Complete audit trail with time-travel debugging
- **Hybrid Architecture**: Standalone CLI or distributed orchestrator/worker setup
- **Enterprise Ready**: Secure, scalable, and observable with circuit-breaker resilience

## Quick Start

### Prerequisites

- Node.js 22 LTS or later
- pnpm 9.x or later
- PostgreSQL 17 (for orchestrator mode)

### Installation

```bash
# Install globally
npm install -g tamma

# Or run directly
npx tamma init --mode standalone
tamma run --issue "Add user authentication"
```

### Configuration

Tamma is configured through a YAML or JSON file. The `agents` section controls which AI providers handle each workflow phase:

```yaml
agents:
  defaults:
    providerChain:
      - provider: claude-code
      - provider: openrouter
        model: anthropic/claude-3-5-sonnet
        apiKeyRef: OPENROUTER_API_KEY
    maxBudgetUsd: 10
    allowedTools:
      - read
      - write
      - bash

  roles:
    implementer:
      providerChain:
        - provider: opencode
        - provider: claude-code
      maxBudgetUsd: 25
      allowedTools:
        - read
        - write
        - bash
        - search
    reviewer:
      providerChain:
        - provider: openrouter
          model: openai/gpt-4o
          apiKeyRef: OPENROUTER_API_KEY
      maxBudgetUsd: 5

security:
  sanitizeContent: true
  validateUrls: true
  gateActions: true
  maxFetchSizeBytes: 10485760
  blockedCommandPatterns:
    - "rm -rf"
    - "DROP TABLE"
```

## Features

### Autonomous Development Workflow

- **Issue Selection**: Intelligent filtering and prioritization from project management systems
- **Plan Generation**: Comprehensive development plans with approval checkpoints
- **Test-First Implementation**: Automated test writing followed by implementation
- **PR Management**: Automatic creation, monitoring, and merging of pull requests
- **CI/CD Integration**: Real-time status monitoring and error handling

### Config-Driven Multi-Agent System (Epic 9)

Tamma's agent system is fully driven by configuration. No code changes are required to swap providers, adjust budgets, or tune per-role behavior.

**Provider Chains with Automatic Fallback**: Each agent role has an ordered list of providers to try. If the primary provider is unavailable, over budget, or has an open circuit, Tamma automatically falls back to the next entry in the chain.

**Role-Based Agent Resolution**: Eight workflow phases are mapped to agent roles. The engine asks for the agent appropriate to the current phase; the resolver handles all the wiring:

| Workflow Phase | Default Agent Role |
|---|---|
| ISSUE_SELECTION | scrum_master |
| CONTEXT_ANALYSIS | analyst |
| PLAN_GENERATION | architect |
| CODE_GENERATION | implementer |
| PR_CREATION | implementer |
| CODE_REVIEW | reviewer |
| TEST_EXECUTION | tester |
| STATUS_MONITORING | scrum_master |

Phase-to-role mappings are overridable per deployment via `agents.phaseRoleMap` in configuration.

**Agent Prompt Registry**: Six-level template resolution for system prompts. Per-provider-per-role templates take highest priority, falling back through role defaults, global provider defaults, global defaults, built-in role templates, and a generic fallback. Templates support `{{variable}}` interpolation with single-pass expansion that prevents recursive injection.

**Budget Enforcement**: Per-role USD budget ceilings enforced via the cost monitor. Task-level overrides are clamped to the configured ceiling; they can never exceed it. The permission bypass mode (`bypassPermissions`) additionally requires the `TAMMA_ALLOW_BYPASS_PERMISSIONS=true` environment variable.

### Multi-Provider Architecture

- **Built-in Providers**: Claude Code (CLI agent), OpenCode (CLI agent), OpenRouter (LLM API), Zen MCP (MCP-based)
- **LLM-to-Agent Adapter**: Any `IAIProvider` LLM can be wrapped as an `IAgentProvider` via `wrapAsAgent()`, enabling OpenRouter, local LLMs, and future providers to participate in the agent chain without native agent support
- **Provider Registration**: Third-party providers register by name at startup; built-in names are locked and cannot be overridden

### Circuit-Breaker Resilience (ProviderHealthTracker)

Each provider+model combination is tracked individually with a sliding-window circuit breaker:

- **Failure threshold**: 5 failures within 60 seconds trips the circuit (configurable)
- **Open duration**: Tripped circuits remain open for 5 minutes (configurable)
- **Half-open probing**: After the open duration, one probe request is allowed through. Success closes the circuit; failure re-opens it with a fresh timer
- **Thundering herd prevention**: Only one caller can be in the half-open probe state at a time
- **Non-retryable errors**: Configuration errors and caller mistakes are not counted toward the health threshold

### Security Model (Epic 9)

Defense-in-depth security is applied at multiple layers without requiring per-provider customization.

**Content Sanitization (`ContentSanitizer`)**: Applied to every prompt going into an agent and every output coming back:

- HTML stripping via a quote-aware state machine (handles `<div title="a>b">` correctly)
- Zero-width and invisible Unicode character removal (20+ code points including bidi overrides from CVE-2021-42574 / Trojan Source)
- Prompt injection detection across five categories: instruction override, role hijacking, system prompt extraction, delimiter injection, and encoding evasion via Unicode NFKD normalization
- Output sanitization preserves content inside triple-backtick code blocks

Sanitization never throws and never blocks execution. Detected patterns are reported as warnings in the return value, giving callers full control over how to respond.

**URL Validation (`validateUrl`)**: Blocks outbound requests to private networks:

- RFC 1918 ranges validated via numeric octet parsing, not regex (eliminates regex bypass risks)
- IPv6-mapped IPv4 addresses (`::ffff:x.x.x.x`)
- Bracketed IPv6 (`[::1]`, `[fc00::]`, `[fe80::]`)
- Cloud metadata endpoints: GCP (`metadata.google.internal`), AWS/Azure (`169.254.169.254`), Alibaba Cloud (`100.100.100.200`), Docker (`host.docker.internal`)
- Protocol allowlist: only `http:`, `https:`, `ws:`, `wss:`

**Secure Fetch (`secureFetch`)**: SSRF-hardened fetch wrapper built on Node.js 22 native `globalThis.fetch`:

- Pre-request URL validation
- Manual redirect handling with Location header re-validation at each hop (max 5 redirects)
- Sensitive headers (`Authorization`, `Cookie`) stripped on cross-origin redirects
- Content-Type allowlist checked before reading the body
- Body read via `ReadableStream` with a running byte counter—size limit enforced without buffering the full response
- AbortController-based timeout (default 30 seconds)

**Action Gating (`evaluateAction`)**: Blocks destructive shell commands before agents can execute them:

- Normalized whitespace, lowercase matching, and backslash stripping prevent common evasion techniques
- Default blocklist covers: `rm -rf`, `mkfs`, `dd`, fork bombs, `shutdown/reboot/halt`, `kill -9 1`, pipe-to-shell patterns (`| sh`, `| bash`, `| eval`), command substitution (`$(`, `${`), and interpreter pipes (`| python`, `| perl`, `| node`)
- Block reason messages do not reveal which pattern matched, preventing blocklist probing
- Additional patterns configurable via `security.blockedCommandPatterns` in config

**SecureAgentProvider Decorator**: Wraps any `IAgentProvider` with input and output sanitization without modifying the underlying provider. The decorator pattern means any provider in any chain position can be security-wrapped generically.

**MCP Tool Interceptors (`ToolInterceptorChain`)**: Blocking pre/post transformation hooks on MCP tool calls:

- Pre-interceptors transform tool arguments before execution (for example, URL validation replaces blocked URLs with `[URL_BLOCKED_BY_POLICY]`)
- Post-interceptors transform results after execution (for example, content sanitization strips invisible characters from tool output)
- Prototype pollution keys (`__proto__`, `constructor`, `prototype`) are stripped from interceptor output
- Errors are isolated per interceptor and fail-open to avoid breaking valid tool calls

### Diagnostics and Observability

**Diagnostics Queue**: Bounded, timer-drained event queue for zero overhead on the hot path:

- `emit()` is synchronous, adding no async latency to agent task execution
- Timer-based drain (default 5 seconds) batches events to a processor
- Bounded at 1000 events by default; oldest events are dropped on overflow with a counter
- `dispose()` drains remaining events before shutdown (up to 10 drain iterations)
- Drain timer uses `.unref()` so it does not prevent process exit

**Diagnostics Processor**: Maps completion and error events to cost tracking records via dependency injection. Provider name and task type values are validated through mapper functions rather than unsafe casts. Per-event errors are caught and logged as warnings so a single bad event does not block the entire batch.

**Instrumented Providers**: Every provider returned from a `ProviderChain` is wrapped in `InstrumentedAgentProvider`, which emits `provider:call`, `provider:complete`, and `provider:error` events to the diagnostics queue. Token counts, latency, success/failure status, and cost data are captured automatically.

### Deployment Modes

- **Standalone**: Single-machine CLI for individual developers
- **Orchestrator**: Centralized task queue and state management
- **Worker**: Distributed execution for parallel processing
- **Cloud Native**: Container-ready with Kubernetes support

### Event Sourcing and Audit Trail

- **Complete Audit Trail**: Every decision and action recorded as an immutable event
- **Time-Travel Debugging**: Replay any development session from the event log
- **Black-Box Testing**: Reproduce issues with exact context
- **Real-time Dashboards**: Development velocity and system health

## Architecture

Tamma uses a **Dynamic Consistency Boundary (DCB)** pattern with event sourcing for deterministic replay and maximum flexibility:

```
+------------------------------------------------------------------+
|                         Orchestrator                             |
|                                                                  |
|  +-----------+    +-------------------+    +-----------------+  |
|  | Task Queue |    | RoleBasedAgent    |    |  Diagnostics    |  |
|  |           |--->| Resolver          |--->|  Queue          |  |
|  +-----------+    |                   |    +-----------------+  |
|                   | phase --> role --> |            |            |
|                   | ProviderChain --> |    +-----------------+  |
|                   | SecureAgent       |    |  Cost Monitor   |  |
|                   | Provider          |    +-----------------+  |
|                   +-------------------+                         |
+------------------------------------------------------------------+
         |                    |
         v                    v
+------------------+  +------------------+
|   AI Providers   |  |   Git Platforms  |
|                  |  |                  |
| - Claude Code    |  | - GitHub         |
| - OpenCode       |  | - GitLab         |
| - OpenRouter     |  | - Gitea          |
| - Zen MCP        |  | - Bitbucket      |
| - Local LLMs     |  | - Azure DevOps   |
+------------------+  +------------------+
         |
         v
+------------------+
|  Security Layer  |
|                  |
| - ContentSanitizer
| - UrlValidator   |
| - ActionGating   |
| - SecureFetch    |
| - MCP Interceptors
+------------------+
         |
         v
+------------------+
|   PostgreSQL     |
|  Event Store     |
| (DCB Pattern)    |
+------------------+
```

### Agent Resolution Flow

When the engine needs an agent for a workflow phase, the following resolution chain runs:

```
Engine calls getAgentForPhase(phase)
          |
          v
RoleBasedAgentResolver.getRoleForPhase(phase)
  config.phaseRoleMap[phase] ?? DEFAULT_PHASE_ROLE_MAP[phase]
          |
          v
RoleBasedAgentResolver.getAgentForRole(role)
  _getOrCreateChain(role)
    role.providerChain if non-empty, else defaults.providerChain
          |
          v
ProviderChain.getProvider(context)
  for each entry in chain:
    1. health.isHealthy(key)?          -- circuit breaker
    2. costTracker.checkLimit()?       -- budget gate
    3. factory.create(entry)?          -- instantiate provider
    4. provider.isAvailable()?         -- liveness check
    5. new InstrumentedAgentProvider() -- wrap with diagnostics
          |
          v
SecureAgentProvider(provider, sanitizer)
  -- wraps prompt input and result output with ContentSanitizer
```

### Tech Stack

- **Runtime**: Node.js 22 LTS + TypeScript 5.7 (strict mode)
- **Database**: PostgreSQL 17 (event sourcing via DCB pattern)
- **API Framework**: Fastify 5.x
- **Package Manager**: pnpm with workspaces
- **Testing**: Vitest 3.x (3864 tests passing)
- **CLI**: Ink 5.x (React for terminals)
- **Logging**: Pino (structured JSON)
- **Date/Time**: dayjs (UTC)
- **Security**: AES-256 encryption + OS keychain integration

## Repository Structure

```
tamma/
├── packages/
│   ├── shared/                # Shared types, contracts, security, telemetry
│   │   └── src/
│   │       ├── types/
│   │       │   ├── agent-config.ts    # AgentsConfig, IAgentRoleConfig,
│   │       │   │                      # IProviderChainEntry, WorkflowPhase,
│   │       │   │                      # DEFAULT_PHASE_ROLE_MAP, validation
│   │       │   └── security-config.ts # SecurityConfig interface
│   │       ├── security/
│   │       │   ├── content-sanitizer.ts  # HTML stripping, invisible char
│   │       │   │                          # removal, prompt injection detection
│   │       │   ├── url-validator.ts      # Private IP blocking, SSRF protection
│   │       │   ├── action-gating.ts      # Destructive command blocklist
│   │       │   └── secure-fetch.ts       # SSRF-hardened fetch with redirect
│   │       │                              # re-validation and size limiting
│   │       └── telemetry/
│   │           ├── diagnostics-queue.ts      # Bounded timer-drained event queue
│   │           └── diagnostics-processor.ts  # Maps events to cost tracking records
│   ├── providers/             # AI provider implementations and agent management
│   │   └── src/
│   │       ├── agent-provider-factory.ts   # Creates providers by name, wrapAsAgent
│   │       ├── provider-chain.ts           # Ordered fallback with health+budget+instrumentation
│   │       ├── provider-health.ts          # Circuit breaker with half-open probing
│   │       ├── agent-prompt-registry.ts    # 6-level template resolution + {{var}} interpolation
│   │       ├── role-based-agent-resolver.ts # Phase-to-role-to-provider mapping, top-level API
│   │       ├── secure-agent-provider.ts    # Decorator: adds sanitization to any IAgentProvider
│   │       ├── instrumented-agent-provider.ts # Decorator: emits diagnostics events
│   │       ├── claude-agent-provider.ts    # Claude Code CLI agent provider
│   │       ├── opencode-provider.ts        # OpenCode CLI agent provider
│   │       ├── openrouter-provider.ts      # OpenRouter LLM API provider
│   │       └── zen-mcp-provider.ts         # Zen MCP provider
│   ├── mcp-client/            # MCP protocol client with security hooks
│   │   └── src/
│   │       └── interceptors.ts  # ToolInterceptorChain, sanitization interceptor,
│   │                             # URL validation interceptor
│   ├── cli/                   # Ink-based CLI interface
│   ├── orchestrator/          # 14-step autonomous loop engine
│   ├── workers/               # Background job workers
│   ├── gates/                 # Quality gates (build, test, security)
│   ├── intelligence/          # Research and ambiguity detection
│   ├── events/                # DCB event sourcing
│   ├── platforms/             # Git platform abstraction
│   ├── api/                   # Fastify REST API + SSE
│   ├── dashboard/             # React observability dashboard
│   ├── observability/         # Logging and metrics (Pino)
│   ├── config/                # Configuration loading, normalization, validation
│   ├── cost-monitor/          # Token counting, cost tracking, budget enforcement
│   └── scrum-master/          # Issue selection and prioritization
├── docs/                      # Architecture, PRD, epics, stories
│   ├── architecture.md        # Complete technical architecture
│   ├── PRD.md                 # Product requirements document
│   ├── epics.md               # Epic breakdown
│   └── stories/               # Individual story implementation plans
├── .dev/                      # Development knowledge base
│   ├── spikes/                # Research and prototyping
│   ├── bugs/                  # Bug reports and resolutions
│   ├── findings/              # Pitfalls and lessons learned
│   └── decisions/             # Architecture Decision Records
└── database/                  # Database migrations
```

## Development Progress

### Current Status: Active Development

**3864 tests passing** across all packages.

### Completed

- **Product Requirements**: Comprehensive PRD with feature definitions and acceptance criteria
- **Architecture Design**: Hybrid orchestrator/worker architecture with DCB event sourcing
- **Epic 1 - Foundation**: Multi-provider AI abstraction, Git platform interfaces, hybrid architecture, CLI scaffolding, extended providers (OpenRouter, OpenCode, Zen MCP)
- **Epic 9 - Config-Driven Agent Management**:
  - Story 9-1: Configuration schema (AgentsConfig, SecurityConfig, normalize, validate, env-var merge)
  - Story 9-2: Provider diagnostics (InstrumentedAgentProvider, InstrumentedLLMProvider, cost tracking)
  - Story 9-3: ProviderHealthTracker (circuit breaker with configurable thresholds and half-open probing)
  - Story 9-4: AgentProviderFactory (creates providers by name, wrapAsAgent for LLM-to-agent adaptation)
  - Story 9-5: ProviderChain (ordered fallback with health, budget, and instrumentation)
  - Story 9-6: AgentPromptRegistry (six-level template resolution with variable interpolation)
  - Story 9-7: Content sanitization (ContentSanitizer, validateUrl, evaluateAction, secureFetch, SecureAgentProvider)
  - Story 9-8: RoleBasedAgentResolver (phase-to-role-to-provider mapping, engine-facing API)
  - Story 9-9: Engine integration (orchestrator uses resolver for phase-aware agent selection)
  - Story 9-10: CLI wiring (config-driven agent resolver with diagnostics integration)
  - Story 9-11: Diagnostics queue and MCP interceptors (ToolInterceptorChain, sanitization and URL validation interceptors)

### Roadmap

**Epic 1: Foundation and Core Infrastructure** - Complete

Multi-provider AI abstraction, multi-platform Git integration, hybrid orchestrator/worker architecture.

**Epic 2: Autonomous Development Workflow** - In Progress

Issue selection, plan generation, test-first implementation, PR creation and monitoring.

**Epic 3: Intelligence and Quality Enhancement** - Planned

Build/test automation, research capability, ambiguity detection, static analysis.

**Epic 4: Event Sourcing and Time-Travel** - Planned

Complete event capture, time-travel debugging, black-box replay.

**Epic 5: Observability and Production Readiness** - Planned

Structured logging, metrics, dashboards, integration testing, public release.

**Epic 9: Config-Driven Agent Management** - Complete

Multi-agent configuration schema, provider health tracking, prompt registry, content sanitization, role-based resolution, MCP interceptors.

## Configuration Reference

### agents

| Field | Type | Description |
|---|---|---|
| `agents.defaults` | `IAgentRoleConfig` | Base configuration applied to all roles |
| `agents.defaults.providerChain` | `IProviderChainEntry[]` | Ordered list of providers to try (required, non-empty) |
| `agents.defaults.allowedTools` | `string[]` | Tools all roles may use by default |
| `agents.defaults.maxBudgetUsd` | `number` | Default per-role budget ceiling in USD (0-100) |
| `agents.defaults.permissionMode` | `'default' \| 'bypassPermissions'` | Permission enforcement mode |
| `agents.defaults.systemPrompt` | `string` | Default system prompt (overridden by role templates) |
| `agents.defaults.providerPrompts` | `Record<string, string>` | Provider-specific default prompts |
| `agents.roles` | `Record<AgentType, Partial<IAgentRoleConfig>>` | Per-role overrides merged with defaults |
| `agents.phaseRoleMap` | `Record<WorkflowPhase, AgentType>` | Override phase-to-role mappings |

### Provider Chain Entry

| Field | Type | Description |
|---|---|---|
| `provider` | `string` | Provider identifier (`claude-code`, `opencode`, `openrouter`, `zen-mcp`) |
| `model` | `string` | Model identifier (e.g., `claude-sonnet-4-5`, `openai/gpt-4o`) |
| `apiKeyRef` | `string` | Environment variable name containing the API key (never the raw key) |
| `config` | `Record<string, unknown>` | Provider-specific options (baseUrl, timeout, etc.) |

### security

| Field | Type | Default | Description |
|---|---|---|---|
| `sanitizeContent` | `boolean` | `true` | Strip HTML, invisible chars, detect prompt injection |
| `validateUrls` | `boolean` | `true` | Block requests to private/reserved IP ranges |
| `gateActions` | `boolean` | `true` | Block destructive shell commands |
| `maxFetchSizeBytes` | `number` | `10485760` | Maximum response body size for secureFetch (0 to 1 GiB) |
| `blockedCommandPatterns` | `string[]` | `[]` | Additional substring patterns to block (max 100, each max 500 chars) |

### Environment Variables

| Variable | Description |
|---|---|
| `TAMMA_ALLOW_BYPASS_PERMISSIONS` | Set to `"true"` to allow agents to use `bypassPermissions` mode |
| `ANTHROPIC_API_KEY` | API key for Anthropic providers |
| `OPENROUTER_API_KEY` | API key for OpenRouter |
| Any `apiKeyRef` value | The variable name from `apiKeyRef` is resolved at startup |

## Development Setup

### Install Dependencies

```bash
pnpm install
```

### Build All Packages

```bash
pnpm build
```

### Run Tests

```bash
pnpm test                   # All tests
pnpm test:unit              # Unit tests only
pnpm test:integration       # Integration tests (requires credentials)
pnpm test:coverage          # Coverage report
```

### Development Mode

```bash
pnpm dev                              # All packages
pnpm dev --filter @tamma/cli         # CLI only
pnpm dev --filter @tamma/providers   # Providers only
```

### Lint and Format

```bash
pnpm lint     # ESLint
pnpm format   # Prettier
```

## Contributing

We welcome contributions of all kinds.

### Good First Issues

- [AI Provider Interface](https://github.com/meywd/tamma/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+label%3Aepic-1)
- [CLI Commands](https://github.com/meywd/tamma/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+label%3Acli)
- [Documentation](https://github.com/meywd/tamma/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+label%3Adocumentation)

### Contribution Areas

- **Core Development**: AI providers, Git platforms, event sourcing
- **Documentation**: Guides, tutorials, API docs
- **Testing**: Unit tests, integration tests, end-to-end scenarios
- **Design**: UI components, dashboards, user experience

### Development Process

Before writing any code, read:

1. `BEFORE_YOU_CODE.md` — mandatory process guide
2. `.dev/README.md` — development knowledge base
3. `CLAUDE.md` — project guidelines
4. `docs/architecture.md` — technical architecture
5. The relevant story file in `docs/stories/`

Then:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code of Conduct

Please read and follow our [Code of Conduct](docs/code-of-conduct.md) to ensure a welcoming environment for all contributors.

### Contributors

Thank you to all our contributors! Your work makes Tamma possible.

[![Contributors](https://contrib.rocks/image?repo=meywd/tamma)](https://github.com/meywd/tamma/graphs/contributors)

## Use Cases

### Enterprise Teams

- **Legacy Modernization**: Autonomous refactoring of large codebases
- **Feature Development**: Rapid prototyping and implementation
- **Code Review Automation**: Automated PR generation and review

### Solo Developers

- **Productivity Boost**: Handle routine development tasks automatically
- **Learning**: Understand best practices through AI-generated code
- **Side Projects**: Accelerate personal project development

### Startups

- **MVP Development**: Fast feature implementation and iteration
- **Technical Debt**: Automated refactoring and maintenance
- **Scaling**: Handle a growing codebase with limited resources

## Related Projects

- **[GitHub Copilot](https://github.com/features/copilot)** - AI pair programming
- **[Cursor](https://cursor.sh)** - AI-powered code editor
- **[Aider](https://github.com/paul-gauthier/aider)** - AI pair programming in terminal
- **[Continue](https://github.com/continuedev/continue)** - Open-source AI code assistant

## Community and Support

- **[GitHub Discussions](https://github.com/meywd/tamma/discussions)** - Ask questions and share ideas
- **[GitHub Issues](https://github.com/meywd/tamma/issues)** - Report bugs and request features
- **[Wiki](https://github.com/meywd/tamma/wiki)** - Extended documentation

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with inspiration from the best open-source projects
- Thanks to all AI providers making autonomous development possible
- Community feedback and contributions that shape Tamma's evolution

---

<div align="center">

Star this repository to support autonomous development!

Built with the vision of democratizing autonomous software development

[Back to top](#tamma)

</div>
