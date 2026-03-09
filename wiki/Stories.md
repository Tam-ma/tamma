# User Stories Index

This page provides an index of all user stories across all epics. Each story links to its GitHub issue and detailed story documentation.

## Story Structure

Each story includes:
- **Status:** ready-for-dev, in-progress, review, done
- **Acceptance Criteria:** Measurable success conditions
- **Tasks/Subtasks:** Detailed checklist of work items
- **Dev Notes:** Context, architecture patterns, references
- **GitHub Issues:** Linked tasks in GitHub project

---

## Epic 1: Foundation & Core Infrastructure

### Story 1-0: AI Provider Strategy Research
**Status:** done | **Tasks:** 6

Research AI provider options across cost models, capabilities, and workflow fit.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-0-ai-provider-strategy-research.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-0)

---

### Story 1-1: AI Provider Interface Definition
**Status:** done | **Tasks:** 5

Define abstract interface contracts for AI provider operations.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-1-ai-provider-interface-definition.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-1)

---

### Story 1-2: Claude Code Provider Implementation
**Status:** done | **Tasks:** 6

Implement Anthropic Claude API as the first AI provider (reference implementation).

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-2-claude-code-provider-implementation.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-2)

---

### Story 1-3: Provider Configuration Management
**Status:** done | **Tasks:** 7

Centralized configuration for AI provider settings.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-3-provider-configuration-management.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-3)

---

### Story 1-4: Git Platform Interface Definition
**Status:** done | **Tasks:** 6

Define abstract interface contracts for Git platform operations.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-4-git-platform-interface-definition.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-4)

---

### Story 1-5: GitHub Platform Implementation
**Status:** done | **Tasks:** 8

Implement GitHub as the first Git platform (reference implementation).

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-5-github-platform-implementation.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-5)

---

### Story 1-6: GitLab Platform Implementation
**Status:** done | **Tasks:** 6

Implement GitLab as second Git platform.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-6-gitlab-platform-implementation.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-6)

---

### Story 1-7: Git Platform Configuration Management
**Status:** done | **Tasks:** 5

Centralized configuration for Git platform settings.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-7-git-platform-configuration-management.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-7)

---

### Story 1-8: Hybrid Orchestrator/Worker Architecture Design
**Status:** done | **Tasks:** 7

Document architecture for orchestrator mode and worker mode.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-8-hybrid-orchestrator-worker-architecture-design.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-8)

---

### Story 1-9: Basic CLI Scaffolding with Mode Selection
**Status:** done | **Tasks:** 5

Build basic CLI entry point supporting orchestrator and worker modes.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-9-basic-cli-scaffolding-with-mode-selection.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-9)

---

### Story 1-10: Additional AI Provider Implementations
**Status:** done | **Tasks:** 10

Support for multiple AI providers (OpenAI, GitHub Copilot, Google Gemini, OpenRouter, OpenCode, Zen MCP, local LLMs).

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-10-additional-ai-provider-implementations.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-10)

---

### Story 1-11: Additional Git Platform Implementations
**Status:** done | **Tasks:** 7

Support for multiple Git platforms (Gitea, Forgejo, Bitbucket, Azure DevOps, Plain Git).

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-11-additional-git-platform-implementations.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-11)

---

### Story 1-12: Initial Marketing Website
**Status:** done | **Tasks:** 8

Deploy initial marketing website on Cloudflare Workers.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/1-12-initial-marketing-website.md)
- [GitHub Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+label%3Astory-1-12)

---

## Epic 9: Config-Driven Multi-Agent Management

### Story 9-1: Configuration Schema
**Status:** done | **Tasks:** 5 | **Priority:** P0 | **Package:** `@tamma/shared`, `@tamma/cli`

Define `IAgentsConfig`, `IAgentRoleConfig`, `IProviderChainEntry`, and `WorkflowPhase` types. Implement `validateAgentsConfig()`, `validateSecurityConfig()`, and `validateProviderName()`. Define `SecurityConfig` type for content sanitization, URL validation, and action gating settings.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-1/9-1-configuration-schema.md)

---

### Story 9-2: Provider Diagnostics
**Status:** done | **Tasks:** 5 | **Priority:** P0 | **Package:** `@tamma/shared`, `@tamma/providers`

Define `DiagnosticsEvent` types (`provider:call`, `provider:complete`, `provider:error`) with typed `DiagnosticsErrorCode`. Implement `sanitizeErrorMessage()` to strip API keys from error messages before they reach diagnostics. Wire diagnostics events into the provider layer.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-2/9-2-provider-diagnostics.md)

---

### Story 9-3: Provider Health Tracker
**Status:** done | **Tasks:** 4 | **Priority:** P0 | **Package:** `@tamma/providers`

Implement `ProviderHealthTracker` with three-state circuit breaker (CLOSED, OPEN, HALF-OPEN) per provider+model key. Sliding window failure counting, half-open probe with timeout, `onCircuitChange` callback for diagnostics integration. `ProviderHealthTracker.buildKey(provider, model)` produces canonical keys.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-3/9-3-provider-health-tracker.md)

---

### Story 9-4: Agent Provider Factory
**Status:** done | **Tasks:** 3 | **Priority:** P0 | **Package:** `@tamma/providers`

Implement `AgentProviderFactory` with built-in registrations for `claude-code`, `opencode`, `openrouter`, and `zen-mcp`. Implement `wrapAsAgent()` to adapt `IAIProvider` into `IAgentProvider`. Implement `resolveApiKey()` for secure API key lookup from environment variables. Provider name validation and prototype pollution guard.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-4/9-4-agent-provider-factory.md)

---

### Story 9-5: Provider Chain
**Status:** done | **Tasks:** 4 | **Priority:** P0 | **Package:** `@tamma/providers`

Implement `ProviderChain` with ordered fallback: health check, budget check (fail-closed), factory creation, availability check. Wraps every successfully obtained provider with `InstrumentedAgentProvider`. Throws `EMPTY_PROVIDER_CHAIN` or `NO_AVAILABLE_PROVIDER` when appropriate. Budget check is fail-closed: exceptions from `ICostTracker.checkLimit()` are treated as "budget exceeded".

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-5/9-5-provider-chain.md)

---

### Story 9-6: Agent Prompt Registry
**Status:** done | **Tasks:** 3 | **Priority:** P1 | **Package:** `@tamma/providers`

Implement `AgentPromptRegistry` with 6-level resolution chain and `{{variable}}` template interpolation. Single-pass substitution to prevent recursive template injection. Built-in preambles for 9 agent roles. `registerBuiltin()` with immutable role protection. Template and variable length limits with warnings.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-6/9-6-agent-prompt-registry.md)

---

### Story 9-7: Content Sanitization
**Status:** done | **Tasks:** 5 | **Priority:** P1 | **Package:** `@tamma/shared`

Implement `ContentSanitizer` with HTML stripping (quote-aware state machine), zero-width character removal (20+ code points including CVE-2021-42574 bidi overrides), and prompt injection detection (4 categories, NFKD normalization for encoding evasion). Implement `validateUrl()` with numeric octet parsing for RFC 1918 ranges, IPv6 support. Implement `evaluateAction()` for shell command gating. Implement `secureFetch()` with SSRF protection, redirect re-validation, size limits, and timeout.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-7/9-7-content-sanitization.md)

---

### Story 9-8: Role-Based Agent Resolver
**Status:** done | **Tasks:** 5 | **Priority:** P0 | **Package:** `@tamma/providers`

Implement `RoleBasedAgentResolver` integrating ProviderChain, PromptRegistry, ContentSanitizer, health tracker, cost tracker, and diagnostics queue. Implements `IRoleBasedAgentResolver` interface. Three-level config merge with clamping for `getTaskConfig()`. Template injection prevention in `getPrompt()`. Per-role ProviderChain caching.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-8/9-8-role-based-agent-resolver.md)

---

### Story 9-9: Engine Integration
**Status:** done | **Tasks:** 5 | **Priority:** P0 | **Package:** `@tamma/orchestrator`

Wire `RoleBasedAgentResolver` into the autonomous engine. Engine calls `getAgentForPhase()` at each loop step. Maps `EngineState` values to `WorkflowPhase` via `ENGINE_STATE_TO_PHASE`. Integrates diagnostics queue and cost tracker. Engine calls `getTaskConfig()` and `getPrompt()` before executing tasks. Graceful dispose on shutdown.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-9/9-9-engine-integration.md)

---

### Story 9-10: CLI Wiring
**Status:** done | **Tasks:** 4 | **Priority:** P0 | **Package:** `@tamma/cli`

Load and validate `agents` config section from the CLI config file. Validate `security` config section. Construct and wire `ContentSanitizer`, `ProviderHealthTracker`, `AgentProviderFactory`, `AgentPromptRegistry`, `DiagnosticsQueue`, and `RoleBasedAgentResolver`. Pass resolver to engine. Surface validation errors and provider chain warnings to the user via Ink UI.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-10/9-10-cli-wiring.md)

---

### Story 9-11: Diagnostics Queue and MCP Interceptors
**Status:** done | **Tasks:** 6 | **Priority:** P0 | **Package:** `@tamma/shared`, `@tamma/mcp-client`

Implement `DiagnosticsQueue` with synchronous `emit()`, timer-based batch drain, overflow dropping (oldest first), and `dispose()` with flush loop. Implement `ToolInterceptorChain` with pre/post interceptor pipeline. Implement `createSanitizationInterceptor()` and `createUrlValidationInterceptor()` built-in interceptors. Prototype pollution key stripping from interceptor outputs.

- [Story Document](https://github.com/meywd/tamma/blob/main/docs/stories/epic-9/story-9-11/9-11-diagnostics-queue-mcp-interceptors.md)

---

## Epic 2: Autonomous Development Loop

_Coming soon - Epic 2 stories will be created after foundational epics complete._

---

## Epic 3: Quality Gates & Intelligence

_Coming soon - Epic 3 stories will be created after Epic 2 completion._

---

## Epic 4: Event Sourcing & Audit Trail

_Coming soon - Epic 4 stories will be created after Epic 3 completion._

---

## Epic 5: Observability & Production Readiness

_Coming soon - Epic 5 stories will be created after Epic 4 completion._

---

## Story Workflow

Stories progress through the following stages:

1. **drafted** - Story created, not yet ready for development
2. **ready-for-dev** - Story refined, ready to be picked up
3. **in-progress** - Developer actively working on story
4. **review** - Code review in progress
5. **done** - All acceptance criteria met, merged to main

---

## Creating New Stories

Stories are created following the BMAD (Bob's Managed Agile Development) methodology:

1. Product Manager defines user story with acceptance criteria
2. Scrum Master (Bob) breaks down into tasks/subtasks
3. Team estimates and prioritizes stories
4. Stories added to sprint backlog
5. Developers implement following TDD workflow

For more details, see [Contributing Guidelines](Contributing).
