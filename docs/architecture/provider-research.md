# Provider Architecture Research

## CLI Agents with Headless Support

| Tool | Headless Flag | Output Format | Auth | Status |
|------|---------------|---------------|------|--------|
| **[Claude Code](https://claude.ai/code)** | `-p` | `--output-format stream-json` | Subscription or API key | ✅ Production |
| **[OpenCode](https://github.com/opencode-ai/opencode)** | Server mode | `-f json` | API keys | ✅ Production |
| **[Aider](https://github.com/Aider-AI/aider)** | `--yes` / scripting | Text | API keys | ✅ Production |
| **[Cline CLI](https://docs.cline.bot/cline-cli/overview)** | `-y` / `--yolo` | `--json` | API keys | ⚠️ Preview (macOS/Linux) |
| **[Continue CLI](https://github.com/continuedev/continue)** | `-p` | JSON | API key | ✅ Production |
| **[Codex CLI](https://github.com/openai/codex)** | `codex exec` | Structured events | OAuth or API key | ✅ Production |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | `--non-interactive` | `--output-format json` | API key or Service Account | ✅ Production |
| **[Goose](https://github.com/block/goose)** | `goose run -t` | JSON | API keys | ✅ Production |

## Two Provider Categories

### 1. LLM API Providers (Direct API calls)
- Anthropic Claude API
- OpenAI API
- OpenRouter (100+ models)
- Google Gemini API
- Local LLMs (Ollama, vLLM, LM Studio)

### 2. CLI Agent Providers (Subprocess execution)
- Claude Code CLI (`claude -p`)
- OpenCode CLI (`opencode -f json`)
- Cline CLI (`cline -y`)
- Continue CLI (`cn -p`)
- Codex CLI (`codex exec`)
- Gemini CLI (`gemini --non-interactive`)
- Goose (`goose run -t`)
- Aider (`aider --yes`)

## Provider Interface Hierarchy

```typescript
/**
 * Base interface for all providers (LLM API and CLI Agent)
 */
export interface IProvider {
  readonly name: string;
  readonly type: 'llm-api' | 'cli-agent';

  initialize(config: ProviderConfig): Promise<void>;
  dispose(): Promise<void>;
  isAvailable(): Promise<boolean>;
}

/**
 * LLM API Provider - Direct API calls to LLM services
 * Use for: analysis, review, simple generation, chat
 */
export interface ILLMProvider extends IProvider {
  readonly type: 'llm-api';
  readonly capabilities: LLMCapabilities;

  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  analyze(request: AnalysisRequest): Promise<AnalysisResponse>;
  review(request: ReviewRequest): Promise<ReviewResponse>;
  listModels(): Promise<ModelInfo[]>;
}

/**
 * CLI Agent Provider - Subprocess execution of coding agents
 * Use for: autonomous code implementation, complex multi-file changes
 */
export interface ICLIAgentProvider extends IProvider {
  readonly type: 'cli-agent';
  readonly capabilities: CLIAgentCapabilities;

  execute(config: AgentTaskConfig, onProgress?: ProgressCallback): Promise<AgentTaskResult>;
  resumeSession(sessionId: string, prompt: string): Promise<AgentTaskResult>;
}
```

## Capabilities

### LLM API Capabilities
```typescript
export interface LLMCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}
```

### CLI Agent Capabilities
```typescript
export interface CLIAgentCapabilities {
  fileOperations: boolean;      // Can read/write files
  commandExecution: boolean;    // Can run shell commands
  gitOperations: boolean;       // Can commit/push
  browserAutomation: boolean;   // Can use browser (Cline)
  mcpSupport: boolean;          // Model Context Protocol
  sessionResume: boolean;       // Can resume sessions
  structuredOutput: boolean;    // JSON schema output
  streaming: boolean;           // Progress streaming
}
```

## CLI Agent Implementations

### Claude Code
```typescript
export class ClaudeCodeAgent implements ICLIAgentProvider {
  readonly name = 'claude-code';
  readonly capabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: false,
    mcpSupport: true,
    sessionResume: true,
    structuredOutput: true,
    streaming: true,
  };

  // Flags: -p, --output-format stream-json, --model, --max-budget-usd
  // --dangerously-skip-permissions, --json-schema, --resume
}
```

### OpenCode
```typescript
export class OpenCodeAgent implements ICLIAgentProvider {
  readonly name = 'opencode';
  readonly capabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: false,
    mcpSupport: true,
    sessionResume: false,
    structuredOutput: true,
    streaming: true,
  };

  // Flags: -p, -f json, --model
  // Server mode available for HTTP API access
}
```

### Cline
```typescript
export class ClineAgent implements ICLIAgentProvider {
  readonly name = 'cline';
  readonly capabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: true,  // Unique to Cline
    mcpSupport: true,
    sessionResume: false,
    structuredOutput: true,
    streaming: true,
  };

  // Flags: -y (yolo mode), --json
  // Preview: macOS/Linux only
}
```

### Goose (Block)
```typescript
export class GooseAgent implements ICLIAgentProvider {
  readonly name = 'goose';
  readonly capabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: false,
    mcpSupport: true,
    sessionResume: true,
    structuredOutput: false,
    streaming: true,
  };

  // Flags: run -t "instructions", --no-session
  // Env: GOOSE_MODE=auto for auto-approval
}
```

### Gemini CLI
```typescript
export class GeminiCLIAgent implements ICLIAgentProvider {
  readonly name = 'gemini-cli';
  readonly capabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: false,
    mcpSupport: false,
    sessionResume: false,
    structuredOutput: true,
    streaming: true,
  };

  // Flags: --non-interactive, --yolo, --output-format json
  // Auth: GOOGLE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS
}
```

## OpenRouter Integration

OpenRouter provides access to 100+ models through a single API:

```typescript
export class OpenRouterProvider implements ILLMProvider {
  readonly name = 'openrouter';

  // Uses OpenAI-compatible API
  // Base URL: https://openrouter.ai/api/v1

  // Available models include:
  // - anthropic/claude-3.5-sonnet
  // - openai/gpt-4o
  // - google/gemini-pro-1.5
  // - meta-llama/llama-3.1-70b-instruct
  // - mistralai/mistral-large
  // - And 100+ more
}
```

## Task Routing Configuration

```yaml
routing:
  issue_analysis:
    type: llm-api
    provider: openrouter
    model: anthropic/claude-3.5-sonnet
    fallback:
      provider: gemini
      model: gemini-1.5-pro

  plan_generation:
    type: llm-api
    provider: anthropic
    model: claude-3-5-sonnet-20241022

  code_implementation:
    type: cli-agent
    provider: claude-code
    model: sonnet
    maxBudgetUsd: 5.0
    fallback:
      provider: opencode

  code_review:
    type: llm-api
    provider: openrouter
    model: openai/gpt-4o

  test_generation:
    type: cli-agent
    provider: claude-code

  documentation:
    type: llm-api
    provider: gemini
    model: gemini-1.5-flash
```

## MVP Implementation Plan

### Phase 1: LLM API Providers
- Anthropic (direct API)
- OpenRouter (100+ models access)

### Phase 2: CLI Agent Providers
- Claude Code (primary)
- OpenCode (fallback)

### Future Phases
- Cline (when stable)
- Goose
- Gemini CLI
- Local LLMs (Ollama)

## Sources

- [OpenCode CLI](https://github.com/opencode-ai/opencode)
- [Aider](https://github.com/Aider-AI/aider)
- [Cline CLI](https://docs.cline.bot/cline-cli/overview)
- [Continue CLI](https://github.com/continuedev/continue)
- [Codex CLI](https://github.com/openai/codex)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Goose](https://github.com/block/goose)
- [OpenRouter](https://openrouter.ai/)
