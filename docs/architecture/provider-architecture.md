# Provider Architecture — Unified Baseline

> This document describes the **current state** of the provider system as of the
> `feat/engine-mvp` PR. It supersedes the aspirational design in
> `provider-research.md` where they diverge, and serves as the canonical
> reference for future implementation work.

## Interface Hierarchy

```
IProvider (base)                         packages/providers/src/types.ts
├── ILLMProvider extends IProvider       packages/providers/src/types.ts
│   Methods: chat, complete, analyze, review, listModels
│   Capabilities: LLMCapabilities
│
└── ICLIAgentProvider extends IProvider  packages/providers/src/types.ts
    Methods: execute, resumeSession
    Capabilities: CLIAgentCapabilities

Backward-compatible aliases:
  IAIProvider                            packages/providers/src/types.ts   (LLM chat/message interface)
  IAgentProvider                         packages/providers/src/agent-types.ts (CLI agent shorthand)
```

### IProvider (base)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable provider name (e.g., `'claude-code'`) |
| `type` | `'llm-api' \| 'cli-agent'` | Category discriminant |
| `initialize(config)` | `Promise<void>` | Provider setup |
| `dispose()` | `Promise<void>` | Release resources |
| `isAvailable()` | `Promise<boolean>` | Reachability check |

### ILLMProvider

Extends `IProvider` with `type: 'llm-api'`.

| Method | Signature | Notes |
|--------|-----------|-------|
| `chat` | `(request: MessageRequest) => AsyncIterable<MessageChunk>` | Streaming |
| `complete` | `(request: MessageRequest) => Promise<MessageResponse>` | Single-shot |
| `analyze` | `(request: MessageRequest) => Promise<MessageResponse>` | Semantic analysis |
| `review` | `(request: MessageRequest) => Promise<MessageResponse>` | Code review |
| `listModels` | `() => Promise<ModelInfo[]>` | Available models |

**LLMCapabilities**: `streaming`, `functionCalling`, `vision`, `jsonMode`,
`maxContextTokens`, `maxOutputTokens`.

### ICLIAgentProvider

Extends `IProvider` with `type: 'cli-agent'`.

| Method | Signature | Notes |
|--------|-----------|-------|
| `execute` | `(config: AgentTaskConfig, onProgress?) => Promise<AgentTaskResult>` | Run autonomous task |
| `resumeSession` | `(sessionId, prompt, onProgress?) => Promise<AgentTaskResult>` | Continue previous session |

**CLIAgentCapabilities**: `fileOperations`, `commandExecution`, `gitOperations`,
`browserAutomation`, `mcpSupport`, `sessionResume`, `structuredOutput`, `streaming`.

---

## Implementations

### Implemented

| Provider | Class | Category | Package | Status |
|----------|-------|----------|---------|--------|
| Claude Code CLI | `ClaudeAgentProvider` | `cli-agent` | `@tamma/providers` | Production |

`ClaudeAgentProvider` implements **both** `IAgentProvider` and `ICLIAgentProvider`.

Capabilities:
- `fileOperations: true`, `commandExecution: true`, `gitOperations: true`
- `browserAutomation: false`, `mcpSupport: true`, `sessionResume: true`
- `structuredOutput: true`, `streaming: true`

### Stub / Placeholder

| Provider | Story | Factory Key | Status |
|----------|-------|-------------|--------|
| Anthropic Claude (LLM API) | 1-2 (LLM variant) | `anthropic-claude` | Throws "not yet implemented" |
| OpenAI GPT | 1-10 | `openai-gpt` | Throws "not yet implemented" |
| GitHub Copilot | 1-10 | `github-copilot` | Throws "not yet implemented" |
| Google Gemini | 1-10 | `google-gemini` | Throws "not yet implemented" |
| Local LLM | 1-10 | `local-llm` | Throws "not yet implemented" |
| OpenCode | 1-10 | `opencode` | Throws "not yet implemented" |
| Z.AI | 1-10 | `z-ai` | Throws "not yet implemented" |
| Zen MCP | 1-10 | `zen-mcp` | Throws "not yet implemented" |
| OpenRouter | 1-10 | `openrouter` | Throws "not yet implemented" |

### Not Started (No stub)

| Provider | Category | Documented in |
|----------|----------|---------------|
| OpenCode CLI | `cli-agent` | provider-research.md |
| Cline CLI | `cli-agent` | provider-research.md |
| Goose | `cli-agent` | provider-research.md |
| Gemini CLI | `cli-agent` | provider-research.md |
| Aider | `cli-agent` | provider-research.md |

---

## Supporting Infrastructure

| Component | File | Status |
|-----------|------|--------|
| `ProviderRegistry` | `registry.ts` | Implemented, unused by engine |
| `ProviderFactory` | `factory.ts` | Implemented, all creators are stubs |
| Error codes | `PROVIDER_ERROR_CODES` in `types.ts` | 10 codes defined |
| Provider types | `PROVIDER_TYPES` in `types.ts` | 9 types defined |

---

## How the Engine Consumes Providers

`TammaEngine` in `packages/orchestrator/src/engine.ts` uses **only** `IAgentProvider`:

```typescript
interface EngineContext {
  agent: IAgentProvider;  // ClaudeAgentProvider in practice
  platform: IGitPlatform;
  // ...
}
```

Methods called: `isAvailable()`, `executeTask()`, `dispose()`.

No `IAIProvider` / `ILLMProvider` is consumed yet. When future stories add LLM-based
analysis (story 2-12, 3-x), they will use `ILLMProvider`.

---

## Backward Compatibility

| Old Interface | New Interface | Migration |
|---------------|---------------|-----------|
| `IAIProvider` | `ILLMProvider` | `IAIProvider` remains; `ILLMProvider` is the documented target |
| `IAgentProvider` | `ICLIAgentProvider` | `IAgentProvider` remains as shorthand; `ICLIAgentProvider` adds `name`, `type`, `capabilities`, `resumeSession` |

Both old interfaces are **not deprecated** — they remain valid for consumers that
don't need the full hierarchy.

---

## Test Coverage

| File | Tests | Status |
|------|-------|--------|
| `claude-agent-provider.test.ts` | 24 tests (19 core + 5 ICLIAgentProvider compliance) | Pass |
| `factory.test.ts` | 8 tests | Pass |
| `registry.test.ts` | 10 tests | Pass |
| `types.test.ts` | 12 tests | Pass |
| `github-error-mapper.test.ts` | 34 tests | Pass |

---

## What's Missing for Full Provider Story Coverage

| Gap | Story | In PR? | Effort |
|-----|-------|--------|--------|
| Task routing config (per-task provider selection) | 2-12 | No | Medium |
| Fallback chains (provider failover) | 2-12 | No | Medium |
| Any `ILLMProvider` implementation | 1-10 | No | High |
| Additional `ICLIAgentProvider` implementations | 1-10 | No | Medium each |
| Provider capability querying in engine | 3-12 | No | Low |
| Multi-provider orchestration | 2-12 | No | High |
