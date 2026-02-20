/**
 * Cost Calculator Service
 * Handles real-time cost calculation for LLM API calls
 */

import type {
  Provider,
  PricingConfig,
  CostEstimate,
  CostEstimateRequest,
} from './types.js';
import {
  DEFAULT_PRICING_CONFIG,
  getModelPricing,
  calculateCost,
  findCheaperAlternatives,
} from './pricing-config.js';

/**
 * Cost Calculator for computing LLM usage costs
 */
export class CostCalculator {
  private pricingConfig: PricingConfig;

  constructor(pricingConfig?: Partial<PricingConfig>) {
    this.pricingConfig = {
      ...DEFAULT_PRICING_CONFIG,
      ...pricingConfig,
      providers: {
        ...DEFAULT_PRICING_CONFIG.providers,
        ...pricingConfig?.providers,
      },
    };
  }

  /**
   * Calculate cost for a specific usage
   */
  calculate(
    provider: Provider,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
    cacheWriteTokens?: number
  ): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } {
    const pricing = getModelPricing(this.pricingConfig, provider, model);

    if (!pricing) {
      // Return zero cost for unknown models (e.g., local models)
      return {
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: 0,
      };
    }

    return calculateCost(pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
  }

  /**
   * Estimate cost before making an API call
   */
  estimate(request: CostEstimateRequest): CostEstimate {
    const { provider, model, estimatedInputTokens, estimatedOutputTokens } = request;

    const cost = this.calculate(provider, model, estimatedInputTokens, estimatedOutputTokens);
    const alternatives = findCheaperAlternatives(
      this.pricingConfig,
      provider,
      model,
      estimatedInputTokens,
      estimatedOutputTokens
    );

    const estimate: CostEstimate = {
      provider,
      model,
      inputCostUsd: cost.inputCostUsd,
      outputCostUsd: cost.outputCostUsd,
      totalCostUsd: cost.totalCostUsd,
    };

    if (alternatives.length > 0) {
      estimate.alternatives = alternatives;
    }

    return estimate;
  }

  /**
   * Get current pricing configuration
   */
  getPricing(): PricingConfig {
    return this.pricingConfig;
  }

  /**
   * Update pricing configuration
   */
  updatePricing(updates: Partial<PricingConfig>): void {
    if (updates.providers) {
      this.pricingConfig.providers = {
        ...this.pricingConfig.providers,
        ...updates.providers,
      };
    }
    if (updates.lastUpdated) {
      this.pricingConfig.lastUpdated = updates.lastUpdated;
    }
    if (updates.currency) {
      this.pricingConfig.currency = updates.currency;
    }
  }

  /**
   * Check if a model is known (has pricing)
   */
  isModelKnown(provider: Provider, model: string): boolean {
    return getModelPricing(this.pricingConfig, provider, model) !== undefined;
  }

  /**
   * Get the default model for a provider
   */
  getDefaultModel(provider: Provider): string | undefined {
    return this.pricingConfig.providers[provider]?.defaultModel;
  }

  /**
   * Get context window size for a model
   */
  getContextWindow(provider: Provider, model: string): number | undefined {
    const pricing = getModelPricing(this.pricingConfig, provider, model);
    return pricing?.contextWindow;
  }
}
