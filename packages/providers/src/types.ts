/**
 * AI Provider Interface Definitions
 *
 * This file defines the contracts for AI providers in the Tamma platform.
 * It supports multiple AI providers with a unified interface for:
 * - Message sending (streaming and synchronous)
 * - Provider capabilities discovery
 * - Error handling and retry logic
 * - Model management
 * - Configuration management
 */

/**
 * Message role in conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message in conversation
 */
export interface Message {
  role: MessageRole;
  content:
    | string
    | Array<{
        type: 'text' | 'image';
        text?: string;
        source?: {
          type: 'base64';
          media_type: string;
          data: string;
        };
      }>;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Pricing information for models
 */
export interface ModelPricing {
  inputTokens: number;
  outputTokens: number;
  currency: string;
  unit: 'perMillion' | 'perToken';
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  pricing?: ModelPricing;
  features?: {
    parallelToolUse?: boolean;
    promptCaching?: boolean;
    thinkingMode?: boolean;
    [key: string]: boolean | undefined;
  };
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  supportedModels: ModelInfo[];
  features: {
    parallelToolUse?: boolean;
    promptCaching?: boolean;
    thinkingMode?: boolean;
    [key: string]: boolean | undefined;
  };
}

// --- Provider Category Architecture ---
// These interfaces implement the documented provider hierarchy from
// docs/architecture/provider-research.md. The existing IAIProvider and
// IAgentProvider (in agent-types.ts) remain as backward-compatible aliases.

/**
 * Provider category discriminant
 */
export type ProviderCategory = 'llm-api' | 'cli-agent';

/**
 * Base provider interface — common contract for all provider types.
 * Both LLM API providers and CLI agent providers extend this.
 */
export interface IProvider {
  /** Human-readable provider name */
  readonly name: string;
  /** Provider category discriminant */
  readonly type: ProviderCategory;
  /** Initialize with configuration */
  initialize(config: ProviderConfig): Promise<void>;
  /** Release resources */
  dispose(): Promise<void>;
  /** Check if the provider is reachable / configured */
  isAvailable(): Promise<boolean>;
}

/**
 * LLM-specific capability flags
 */
export interface LLMCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

/**
 * CLI agent capability flags — describes what a headless coding agent can do
 */
export interface CLIAgentCapabilities {
  fileOperations: boolean;
  commandExecution: boolean;
  gitOperations: boolean;
  browserAutomation: boolean;
  mcpSupport: boolean;
  sessionResume: boolean;
  structuredOutput: boolean;
  streaming: boolean;
}

/**
 * LLM API provider interface — for cloud/local LLM API calls.
 * Extends IProvider with chat, completion, analysis, and review operations.
 */
export interface ILLMProvider extends IProvider {
  readonly type: 'llm-api';
  readonly capabilities: LLMCapabilities;

  /** Streaming chat */
  chat(request: MessageRequest): AsyncIterable<MessageChunk>;
  /** Single-shot completion */
  complete(request: MessageRequest): Promise<MessageResponse>;
  /** Semantic analysis of code/text */
  analyze(request: MessageRequest): Promise<MessageResponse>;
  /** Code review */
  review(request: MessageRequest): Promise<MessageResponse>;
  /** List available models */
  listModels(): Promise<ModelInfo[]>;
}

/**
 * CLI agent provider interface — for headless coding agents (Claude Code, etc.).
 * Extends IProvider with task execution and session management.
 */
export interface ICLIAgentProvider extends IProvider {
  readonly type: 'cli-agent';
  readonly capabilities: CLIAgentCapabilities;

  /** Execute an autonomous coding task */
  execute(
    config: import('./agent-types.js').AgentTaskConfig,
    onProgress?: import('./agent-types.js').AgentProgressCallback,
  ): Promise<import('@tamma/shared').AgentTaskResult>;

  /** Resume a previous session */
  resumeSession(
    sessionId: string,
    prompt: string,
    onProgress?: import('./agent-types.js').AgentProgressCallback,
  ): Promise<import('@tamma/shared').AgentTaskResult>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stream options for streaming responses
 */
export interface StreamOptions {
  onChunk: (chunk: MessageChunk) => Promise<void> | void;
  onError: (error: ProviderError) => Promise<void> | void;
  onComplete: () => Promise<void> | void;
  timeout?: number;
}

/**
 * Message request
 */
export interface MessageRequest {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  metadata?: {
    traceId?: string;
    userId?: string;
    issueId?: string;
    [key: string]: unknown;
  };
}

/**
 * Message response (non-streaming)
 */
export interface MessageResponse {
  id: string;
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  metadata?: {
    traceId?: string;
    [key: string]: unknown;
  };
}

/**
 * Message chunk (streaming)
 */
export interface MessageChunk {
  id: string;
  content?: string;
  delta?: string;
  model: string;
  usage?: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  metadata?: {
    traceId?: string;
    [key: string]: unknown;
  };
}

/**
 * Provider error
 */
export interface ProviderError extends Error {
  code: string;
  retryable: boolean;
  retryAfter?: number;
  context?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * AI Provider interface
 *
 * This interface defines the contract for all AI providers in the Tamma platform.
 * Implementations must support both streaming and synchronous message sending,
 * provide capability discovery, and handle errors appropriately.
 */
export interface IAIProvider {
  /**
   * Initialize the provider with configuration
   * @param config Provider configuration
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Send a message with streaming response
   * @param request Message request
   * @param options Stream options (optional)
   * @returns Async iterable of message chunks
   */
  sendMessage(
    request: MessageRequest,
    options?: StreamOptions
  ): Promise<AsyncIterable<MessageChunk>>;

  /**
   * Send a message with synchronous response
   * @param request Message request
   * @returns Complete message response
   */
  sendMessageSync(request: MessageRequest): Promise<MessageResponse>;

  /**
   * Get provider capabilities
   * @returns Provider capabilities
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Get available models
   * @returns Array of available models
   */
  getModels(): Promise<ModelInfo[]>;

  /**
   * Dispose of provider resources
   */
  dispose(): Promise<void>;
}

/**
 * Provider registry for managing multiple providers
 */
export interface IProviderRegistry {
  /**
   * Register a provider
   * @param name Provider name
   * @param provider Provider instance
   */
  register(name: string, provider: IAIProvider): void;

  /**
   * Get a provider by name
   * @param name Provider name
   * @returns Provider instance or undefined
   */
  getProvider(name: string): IAIProvider | undefined;

  /**
   * Get all registered providers
   * @returns Map of provider name to provider instance
   */
  getProviders(): Map<string, IAIProvider>;

  /**
   * Unregister a provider
   * @param name Provider name
   */
  unregister(name: string): void;

  /**
   * Check if a provider is registered
   * @param name Provider name
   * @returns True if provider is registered
   */
  hasProvider(name: string): boolean;
}

/**
 * Provider factory for creating provider instances
 */
export interface IProviderFactory {
  /**
   * Create a provider instance
   * @param type Provider type
   * @param config Provider configuration
   * @returns Provider instance
   */
  createProvider(type: string, config: ProviderConfig): Promise<IAIProvider>;

  /**
   * Get supported provider types
   * @returns Array of supported provider types
   */
  getSupportedTypes(): string[];
}

/**
 * Error codes for provider errors
 */
export const PROVIDER_ERROR_CODES = {
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  CONTEXT_TOO_LONG: 'CONTEXT_TOO_LONG',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * Provider type constants
 */
export const PROVIDER_TYPES = {
  ANTHROPIC_CLAUDE: 'anthropic-claude',
  OPENAI_GPT: 'openai-gpt',
  GITHUB_COPILOT: 'github-copilot',
  GOOGLE_GEMINI: 'google-gemini',
  LOCAL_LLM: 'local-llm',
  OPENCODE: 'opencode',
  Z_AI: 'z-ai',
  ZEN_MCP: 'zen-mcp',
  OPENROUTER: 'openrouter',
} as const;

/**
 * Provider type
 */
export type ProviderType = (typeof PROVIDER_TYPES)[keyof typeof PROVIDER_TYPES];
