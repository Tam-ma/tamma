/**
 * Normalizes legacy single-agent configuration to the multi-agent AgentsConfig format.
 *
 * This module lives in @tamma/shared (not the CLI) so that any package
 * (orchestrator, workers, etc.) can normalize legacy config without depending on the CLI.
 *
 * The function never throws -- it returns valid defaults for any input.
 */

import type { TammaConfig, AIProviderType } from '../types/index.js';
import type { AgentsConfig, IProviderChainEntry } from '../types/agent-config.js';

/**
 * Map legacy AIProviderType to provider chain name.
 *
 * - 'anthropic' -> 'claude-code': Anthropic models go through Claude Code agent
 * - 'openai' -> 'openrouter': OpenAI models go through OpenRouter gateway
 * - 'local' -> 'local': Local providers keep their identity; the factory handles
 *   Ollama/llama.cpp/vLLM routing
 */
const LEGACY_PROVIDER_MAP: Readonly<Record<AIProviderType, string>> = Object.freeze({
  anthropic: 'claude-code',
  openai: 'openrouter',
  local: 'local',
});

/** Default provider chain entry when no configuration is available at all. */
const DEFAULT_AGENTS_CONFIG: AgentsConfig = {
  defaults: {
    providerChain: [{ provider: 'claude-code', model: 'claude-sonnet-4-5' }],
    maxBudgetUsd: 1.0,
    permissionMode: 'default',
  },
};

/**
 * Normalizes a TammaConfig into an AgentsConfig.
 *
 * Three code paths:
 * 1. `config.agents` exists -- returns a deep clone (via structuredClone)
 * 2. Only legacy `config.agent` exists -- converts to single-entry provider chain
 *    using LEGACY_PROVIDER_MAP
 * 3. Neither exists -- returns sensible defaults
 *
 * This function NEVER throws. For any input, it returns a valid AgentsConfig.
 * The input config object is NEVER mutated.
 */
export function normalizeAgentsConfig(config: TammaConfig): AgentsConfig {
  // Path 1: New multi-agent config already set
  if (config.agents) {
    return structuredClone(config.agents);
  }

  // Path 2: Legacy single-agent config
  if (config.agent) {
    const legacy = config.agent;
    const providerType: AIProviderType = legacy.provider ?? 'anthropic';
    const providerName = LEGACY_PROVIDER_MAP[providerType];

    const chainEntry: IProviderChainEntry = { provider: providerName };
    if (legacy.model !== undefined) {
      chainEntry.model = legacy.model;
    }

    const result: AgentsConfig = {
      defaults: {
        providerChain: [chainEntry],
      },
    };

    // Only set optional fields if they are defined on the legacy config
    // (respects exactOptionalPropertyTypes)
    if (legacy.allowedTools !== undefined) {
      result.defaults.allowedTools = [...legacy.allowedTools];
    }
    if (legacy.maxBudgetUsd !== undefined) {
      result.defaults.maxBudgetUsd = legacy.maxBudgetUsd;
    }
    if (legacy.permissionMode !== undefined) {
      result.defaults.permissionMode = legacy.permissionMode;
    }

    return result;
  }

  // Path 3: Neither exists -- return sensible defaults
  return structuredClone(DEFAULT_AGENTS_CONFIG);
}
