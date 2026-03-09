/**
 * @tamma/providers
 * AI provider abstraction layer for Tamma platform
 * Supports: Anthropic Claude, OpenAI, GitHub Copilot, Gemini, and more
 */

export * from './types.js';

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
