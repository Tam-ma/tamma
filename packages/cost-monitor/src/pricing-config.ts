/**
 * Default pricing configuration for LLM providers
 * Prices are in USD per 1 million tokens
 */

import type { Provider, ProviderPricing, PricingConfig, ModelPricing } from './types.js';

/**
 * Default pricing for Anthropic models
 */
const anthropicPricing: ProviderPricing = {
  defaultModel: 'claude-sonnet-4-20250514',
  models: {
    // Claude Sonnet 4 (latest)
    'claude-sonnet-4-20250514': {
      inputPer1MTokens: 3,
      outputPer1MTokens: 15,
      contextWindow: 200000,
      cacheReadPer1MTokens: 0.30,
      cacheWritePer1MTokens: 3.75,
    },
    // Claude Opus 4 (latest)
    'claude-opus-4-20250514': {
      inputPer1MTokens: 15,
      outputPer1MTokens: 75,
      contextWindow: 200000,
      cacheReadPer1MTokens: 1.50,
      cacheWritePer1MTokens: 18.75,
    },
    // Claude 3.5 Sonnet
    'claude-3-5-sonnet-20241022': {
      inputPer1MTokens: 3,
      outputPer1MTokens: 15,
      contextWindow: 200000,
      cacheReadPer1MTokens: 0.30,
      cacheWritePer1MTokens: 3.75,
    },
    // Claude 3.5 Haiku
    'claude-3-5-haiku-20241022': {
      inputPer1MTokens: 0.80,
      outputPer1MTokens: 4,
      contextWindow: 200000,
      cacheReadPer1MTokens: 0.08,
      cacheWritePer1MTokens: 1,
    },
    // Claude 3 Opus
    'claude-3-opus-20240229': {
      inputPer1MTokens: 15,
      outputPer1MTokens: 75,
      contextWindow: 200000,
      cacheReadPer1MTokens: 1.50,
      cacheWritePer1MTokens: 18.75,
    },
    // Claude 3 Sonnet
    'claude-3-sonnet-20240229': {
      inputPer1MTokens: 3,
      outputPer1MTokens: 15,
      contextWindow: 200000,
    },
    // Claude 3 Haiku
    'claude-3-haiku-20240307': {
      inputPer1MTokens: 0.25,
      outputPer1MTokens: 1.25,
      contextWindow: 200000,
      cacheReadPer1MTokens: 0.03,
      cacheWritePer1MTokens: 0.30,
    },
  },
};

/**
 * Default pricing for OpenAI models
 */
const openaiPricing: ProviderPricing = {
  defaultModel: 'gpt-4o',
  models: {
    // GPT-4o
    'gpt-4o': {
      inputPer1MTokens: 2.50,
      outputPer1MTokens: 10,
      contextWindow: 128000,
    },
    'gpt-4o-mini': {
      inputPer1MTokens: 0.15,
      outputPer1MTokens: 0.60,
      contextWindow: 128000,
    },
    // GPT-4 Turbo
    'gpt-4-turbo': {
      inputPer1MTokens: 10,
      outputPer1MTokens: 30,
      contextWindow: 128000,
    },
    // GPT-4
    'gpt-4': {
      inputPer1MTokens: 30,
      outputPer1MTokens: 60,
      contextWindow: 8192,
    },
    // GPT-3.5 Turbo
    'gpt-3.5-turbo': {
      inputPer1MTokens: 0.50,
      outputPer1MTokens: 1.50,
      contextWindow: 16385,
    },
    // o1 models
    'o1-preview': {
      inputPer1MTokens: 15,
      outputPer1MTokens: 60,
      contextWindow: 128000,
    },
    'o1-mini': {
      inputPer1MTokens: 3,
      outputPer1MTokens: 12,
      contextWindow: 128000,
    },
  },
};

/**
 * Default pricing for Google models
 */
const googlePricing: ProviderPricing = {
  defaultModel: 'gemini-1.5-pro',
  models: {
    'gemini-1.5-pro': {
      inputPer1MTokens: 1.25,
      outputPer1MTokens: 5,
      contextWindow: 2097152,
    },
    'gemini-1.5-flash': {
      inputPer1MTokens: 0.075,
      outputPer1MTokens: 0.30,
      contextWindow: 1048576,
    },
    'gemini-2.0-flash': {
      inputPer1MTokens: 0.10,
      outputPer1MTokens: 0.40,
      contextWindow: 1048576,
    },
  },
};

/**
 * Local models (free)
 */
const localPricing: ProviderPricing = {
  defaultModel: 'local',
  models: {
    local: {
      inputPer1MTokens: 0,
      outputPer1MTokens: 0,
      contextWindow: 128000,
    },
  },
};

/**
 * Claude Code pricing (same as Anthropic but may differ for API access)
 */
const claudeCodePricing: ProviderPricing = {
  defaultModel: 'claude-sonnet-4-20250514',
  models: {
    ...anthropicPricing.models,
  },
};

/**
 * OpenRouter pricing (varies based on underlying model, using common models)
 * OpenRouter adds a small markup to base model prices
 */
const openrouterPricing: ProviderPricing = {
  defaultModel: 'anthropic/claude-3.5-sonnet',
  models: {
    // Claude models via OpenRouter
    'anthropic/claude-3.5-sonnet': {
      inputPer1MTokens: 3,
      outputPer1MTokens: 15,
      contextWindow: 200000,
    },
    'anthropic/claude-3-opus': {
      inputPer1MTokens: 15,
      outputPer1MTokens: 75,
      contextWindow: 200000,
    },
    'anthropic/claude-3-haiku': {
      inputPer1MTokens: 0.25,
      outputPer1MTokens: 1.25,
      contextWindow: 200000,
    },
    // OpenAI models via OpenRouter
    'openai/gpt-4o': {
      inputPer1MTokens: 2.50,
      outputPer1MTokens: 10,
      contextWindow: 128000,
    },
    'openai/gpt-4o-mini': {
      inputPer1MTokens: 0.15,
      outputPer1MTokens: 0.60,
      contextWindow: 128000,
    },
    // Meta Llama models (often cheaper)
    'meta-llama/llama-3.1-405b-instruct': {
      inputPer1MTokens: 2.70,
      outputPer1MTokens: 2.70,
      contextWindow: 131072,
    },
    'meta-llama/llama-3.1-70b-instruct': {
      inputPer1MTokens: 0.52,
      outputPer1MTokens: 0.75,
      contextWindow: 131072,
    },
    'meta-llama/llama-3.1-8b-instruct': {
      inputPer1MTokens: 0.055,
      outputPer1MTokens: 0.055,
      contextWindow: 131072,
    },
    // Mistral models
    'mistralai/mistral-large': {
      inputPer1MTokens: 2,
      outputPer1MTokens: 6,
      contextWindow: 128000,
    },
    'mistralai/mixtral-8x7b-instruct': {
      inputPer1MTokens: 0.24,
      outputPer1MTokens: 0.24,
      contextWindow: 32768,
    },
  },
};

/**
 * Default pricing configuration
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  providers: {
    anthropic: anthropicPricing,
    openai: openaiPricing,
    google: googlePricing,
    openrouter: openrouterPricing,
    local: localPricing,
    'claude-code': claudeCodePricing,
  },
  lastUpdated: new Date('2025-01-15'),
  currency: 'USD',
};

/**
 * Get pricing for a specific model
 */
export function getModelPricing(
  config: PricingConfig,
  provider: Provider,
  model: string
): ModelPricing | undefined {
  const providerConfig = config.providers[provider];
  if (!providerConfig) {
    return undefined;
  }

  // Try exact match first
  if (providerConfig.models[model]) {
    return providerConfig.models[model];
  }

  // Try to find a matching model by prefix (for versioned models)
  const modelKeys = Object.keys(providerConfig.models);
  for (const key of modelKeys) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return providerConfig.models[key];
    }
  }

  // Return default model pricing if no match
  return providerConfig.models[providerConfig.defaultModel];
}

/**
 * Calculate cost for a given token usage
 */
export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number
): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } {
  const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputPer1MTokens;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputPer1MTokens;

  let cacheCostUsd = 0;
  if (cacheReadTokens && pricing.cacheReadPer1MTokens) {
    cacheCostUsd += (cacheReadTokens / 1_000_000) * pricing.cacheReadPer1MTokens;
  }
  if (cacheWriteTokens && pricing.cacheWritePer1MTokens) {
    cacheCostUsd += (cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1MTokens;
  }

  const totalCostUsd = inputCostUsd + outputCostUsd + cacheCostUsd;

  return {
    inputCostUsd: Number(inputCostUsd.toFixed(6)),
    outputCostUsd: Number(outputCostUsd.toFixed(6)),
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
  };
}

/**
 * Get all available models for a provider
 */
export function getAvailableModels(
  config: PricingConfig,
  provider: Provider
): string[] {
  const providerConfig = config.providers[provider];
  if (!providerConfig) {
    return [];
  }
  return Object.keys(providerConfig.models);
}

/**
 * Find cheaper model alternatives
 */
export function findCheaperAlternatives(
  config: PricingConfig,
  provider: Provider,
  currentModel: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): { model: string; provider: Provider; totalCostUsd: number; savings: number }[] {
  const currentPricing = getModelPricing(config, provider, currentModel);
  if (!currentPricing) {
    return [];
  }

  const currentCost = calculateCost(currentPricing, estimatedInputTokens, estimatedOutputTokens);
  const alternatives: { model: string; provider: Provider; totalCostUsd: number; savings: number }[] = [];

  // Check all providers and models
  for (const [providerKey, providerConfig] of Object.entries(config.providers)) {
    if (!providerConfig) continue;

    for (const [modelKey, modelPricing] of Object.entries(providerConfig.models)) {
      // Skip the current model
      if (providerKey === provider && modelKey === currentModel) {
        continue;
      }

      const altCost = calculateCost(modelPricing, estimatedInputTokens, estimatedOutputTokens);

      if (altCost.totalCostUsd < currentCost.totalCostUsd) {
        alternatives.push({
          model: modelKey,
          provider: providerKey as Provider,
          totalCostUsd: altCost.totalCostUsd,
          savings: currentCost.totalCostUsd - altCost.totalCostUsd,
        });
      }
    }
  }

  // Sort by savings (highest first)
  return alternatives.sort((a, b) => b.savings - a.savings).slice(0, 5);
}

/**
 * Currency exchange rates relative to USD (as of 2025-01)
 * These are approximate rates and should be updated periodically
 */
export const CURRENCY_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 148.5,
  CAD: 1.36,
  AUD: 1.54,
  CHF: 0.88,
  CNY: 7.24,
  INR: 83.5,
  BRL: 4.95,
};

/**
 * Supported currencies
 */
export type SupportedCurrency = keyof typeof CURRENCY_RATES;

/**
 * Convert cost from USD to another currency
 */
export function convertCurrency(
  costUsd: number,
  targetCurrency: string
): { amount: number; currency: string } {
  const rate = CURRENCY_RATES[targetCurrency];

  if (!rate) {
    // Unknown currency, return USD
    return { amount: costUsd, currency: 'USD' };
  }

  return {
    amount: Number((costUsd * rate).toFixed(2)),
    currency: targetCurrency,
  };
}

/**
 * Format cost with currency symbol
 */
export function formatCost(
  costUsd: number,
  currency = 'USD'
): string {
  const converted = convertCurrency(costUsd, currency);

  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '\u20ac',
    GBP: '\u00a3',
    JPY: '\u00a5',
    CAD: 'CA$',
    AUD: 'A$',
    CHF: 'CHF ',
    CNY: '\u00a5',
    INR: '\u20b9',
    BRL: 'R$',
  };

  const symbol = symbols[converted.currency] || `${converted.currency} `;

  // Handle different decimal places for different currencies
  const decimals = converted.currency === 'JPY' ? 0 : 2;

  return `${symbol}${converted.amount.toFixed(decimals)}`;
}

/**
 * Get list of supported currencies
 */
export function getSupportedCurrencies(): string[] {
  return Object.keys(CURRENCY_RATES);
}
