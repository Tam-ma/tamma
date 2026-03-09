/**
 * @tamma/providers
 * AI provider abstraction layer for Tamma platform
 * Supports: Anthropic Claude, OpenAI, GitHub Copilot, Gemini, and more
 */

export * from './types.js';

export { createProviderError, isProviderError } from './errors.js';
export { ProviderHealthTracker } from './provider-health.js';

export { ProviderRegistry } from './registry.js';
export { ProviderFactory } from './factory.js';

export * from './agent-types.js';
export { ClaudeAgentProvider } from './claude-agent-provider.js';
export { OpenRouterProvider } from './openrouter-provider.js';
export { OpenCodeProvider } from './opencode-provider.js';
export { ZenMCPProvider } from './zen-mcp-provider.js';

export {
  AgentProviderFactory,
  wrapAsAgent,
  resolveApiKey,
  BUILTIN_PROVIDER_NAMES,
} from './agent-provider-factory.js';
export type {
  IAgentProviderFactory,
  ProviderChainEntry,
} from './agent-provider-factory.js';

export { AgentPromptRegistry } from './agent-prompt-registry.js';
export type {
  IAgentPromptRegistry,
  AgentPromptRegistryOptions,
} from './agent-prompt-registry.js';

export { SecureAgentProvider } from './secure-agent-provider.js';

export { InstrumentedAgentProvider } from './instrumented-agent-provider.js';
export type { InstrumentedAgentContext } from './instrumented-agent-provider.js';

export { mapProviderName } from './provider-name-mapping.js';

export { createDiagnosticsProcessor } from './diagnostics-processor.js';
