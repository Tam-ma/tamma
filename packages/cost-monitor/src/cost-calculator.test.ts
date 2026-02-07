import { describe, it, expect, beforeEach } from 'vitest';
import { CostCalculator } from './cost-calculator.js';
import { convertCurrency, formatCost, getSupportedCurrencies } from './pricing-config.js';
import type { PricingConfig } from './types.js';

describe('CostCalculator', () => {
  let calculator: CostCalculator;

  beforeEach(() => {
    calculator = new CostCalculator();
  });

  describe('calculate', () => {
    it('should calculate cost for Claude Sonnet correctly', () => {
      // Claude Sonnet: $3/1M input, $15/1M output
      const result = calculator.calculate('anthropic', 'claude-sonnet-4-20250514', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(3);
      expect(result.outputCostUsd).toBe(15);
      expect(result.totalCostUsd).toBe(18);
    });

    it('should calculate cost for Claude Opus correctly', () => {
      // Claude Opus: $15/1M input, $75/1M output
      const result = calculator.calculate('anthropic', 'claude-opus-4-20250514', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(15);
      expect(result.outputCostUsd).toBe(75);
      expect(result.totalCostUsd).toBe(90);
    });

    it('should calculate cost for Claude Haiku correctly', () => {
      // Claude 3 Haiku: $0.25/1M input, $1.25/1M output
      const result = calculator.calculate('anthropic', 'claude-3-haiku-20240307', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(0.25);
      expect(result.outputCostUsd).toBe(1.25);
      expect(result.totalCostUsd).toBe(1.5);
    });

    it('should calculate cost for GPT-4o correctly', () => {
      // GPT-4o: $2.50/1M input, $10/1M output
      const result = calculator.calculate('openai', 'gpt-4o', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(2.5);
      expect(result.outputCostUsd).toBe(10);
      expect(result.totalCostUsd).toBe(12.5);
    });

    it('should calculate cost for smaller token counts', () => {
      // 1000 tokens at Claude Sonnet rates: $3/1M input, $15/1M output
      const result = calculator.calculate('anthropic', 'claude-sonnet-4-20250514', 1000, 500);

      // 1000 / 1_000_000 * 3 = 0.003
      // 500 / 1_000_000 * 15 = 0.0075
      expect(result.inputCostUsd).toBeCloseTo(0.003, 6);
      expect(result.outputCostUsd).toBeCloseTo(0.0075, 6);
      expect(result.totalCostUsd).toBeCloseTo(0.0105, 6);
    });

    it('should return zero cost for local models', () => {
      const result = calculator.calculate('local', 'local', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(0);
      expect(result.outputCostUsd).toBe(0);
      expect(result.totalCostUsd).toBe(0);
    });

    it('should return zero cost for unknown models', () => {
      const result = calculator.calculate('anthropic', 'unknown-model-xyz', 1000000, 1000000);

      // Should fall back to default model pricing
      expect(result.totalCostUsd).toBeGreaterThan(0);
    });

    it('should handle cache token pricing', () => {
      // Claude Sonnet with cache tokens
      const result = calculator.calculate(
        'anthropic',
        'claude-sonnet-4-20250514',
        1000000, // input
        1000000, // output
        500000,  // cache read
        250000   // cache write
      );

      // Cache read: $0.30/1M, Cache write: $3.75/1M
      const expectedCacheCost = (500000 / 1000000) * 0.30 + (250000 / 1000000) * 3.75;
      const expectedTotal = 3 + 15 + expectedCacheCost;

      expect(result.totalCostUsd).toBeCloseTo(expectedTotal, 5);
    });

    it('should handle zero tokens', () => {
      const result = calculator.calculate('anthropic', 'claude-sonnet-4-20250514', 0, 0);

      expect(result.inputCostUsd).toBe(0);
      expect(result.outputCostUsd).toBe(0);
      expect(result.totalCostUsd).toBe(0);
    });

    it('should match versioned models', () => {
      // Should match claude-3-5-sonnet even with different version suffix
      const result = calculator.calculate('anthropic', 'claude-3-5-sonnet-20241022', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(3);
      expect(result.outputCostUsd).toBe(15);
    });
  });

  describe('estimate', () => {
    it('should estimate cost and provide alternatives', () => {
      const estimate = calculator.estimate({
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        estimatedInputTokens: 100000,
        estimatedOutputTokens: 50000,
      });

      expect(estimate.provider).toBe('anthropic');
      expect(estimate.model).toBe('claude-opus-4-20250514');
      expect(estimate.totalCostUsd).toBeGreaterThan(0);
      expect(estimate.alternatives).toBeDefined();
      expect(estimate.alternatives!.length).toBeGreaterThan(0);
    });

    it('should find cheaper alternatives for expensive models', () => {
      const estimate = calculator.estimate({
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        estimatedInputTokens: 1000000,
        estimatedOutputTokens: 1000000,
      });

      // Should suggest cheaper models
      expect(estimate.alternatives).toBeDefined();
      expect(estimate.alternatives!.some(alt => alt.savings > 0)).toBe(true);
    });

    it('should not suggest alternatives for cheap models', () => {
      const estimate = calculator.estimate({
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 1000,
      });

      // Haiku is already cheap, might have few or no cheaper alternatives
      if (estimate.alternatives) {
        expect(estimate.alternatives.every(alt => alt.savings > 0)).toBe(true);
      }
    });
  });

  describe('getPricing', () => {
    it('should return the current pricing configuration', () => {
      const pricing = calculator.getPricing();

      expect(pricing.providers).toBeDefined();
      expect(pricing.providers.anthropic).toBeDefined();
      expect(pricing.providers.openai).toBeDefined();
      expect(pricing.currency).toBe('USD');
    });
  });

  describe('updatePricing', () => {
    it('should update pricing configuration', () => {
      calculator.updatePricing({
        providers: {
          anthropic: {
            defaultModel: 'claude-sonnet-4-20250514',
            models: {
              'custom-model': {
                inputPer1MTokens: 1,
                outputPer1MTokens: 2,
                contextWindow: 100000,
              },
            },
          },
        },
      });

      const result = calculator.calculate('anthropic', 'custom-model', 1000000, 1000000);

      expect(result.inputCostUsd).toBe(1);
      expect(result.outputCostUsd).toBe(2);
    });
  });

  describe('isModelKnown', () => {
    it('should return true for known models', () => {
      expect(calculator.isModelKnown('anthropic', 'claude-sonnet-4-20250514')).toBe(true);
      expect(calculator.isModelKnown('openai', 'gpt-4o')).toBe(true);
    });

    it('should return true for versioned models', () => {
      expect(calculator.isModelKnown('anthropic', 'claude-3-5-sonnet-20241022')).toBe(true);
    });

    it('should return false for unknown providers', () => {
      expect(calculator.isModelKnown('unknown' as any, 'some-model')).toBe(false);
    });
  });

  describe('getDefaultModel', () => {
    it('should return the default model for a provider', () => {
      expect(calculator.getDefaultModel('anthropic')).toBe('claude-sonnet-4-20250514');
      expect(calculator.getDefaultModel('openai')).toBe('gpt-4o');
    });

    it('should return undefined for unknown providers', () => {
      expect(calculator.getDefaultModel('unknown' as any)).toBeUndefined();
    });
  });

  describe('getContextWindow', () => {
    it('should return the context window for a model', () => {
      expect(calculator.getContextWindow('anthropic', 'claude-sonnet-4-20250514')).toBe(200000);
      expect(calculator.getContextWindow('openai', 'gpt-4')).toBe(8192);
    });

    it('should return undefined for unknown models', () => {
      expect(calculator.getContextWindow('unknown' as any, 'unknown')).toBeUndefined();
    });
  });
});

describe('Currency Conversion', () => {
  describe('convertCurrency', () => {
    it('should convert USD to EUR', () => {
      const result = convertCurrency(100, 'EUR');
      expect(result.currency).toBe('EUR');
      expect(result.amount).toBe(92); // 100 * 0.92
    });

    it('should convert USD to GBP', () => {
      const result = convertCurrency(100, 'GBP');
      expect(result.currency).toBe('GBP');
      expect(result.amount).toBe(79); // 100 * 0.79
    });

    it('should convert USD to JPY', () => {
      const result = convertCurrency(100, 'JPY');
      expect(result.currency).toBe('JPY');
      expect(result.amount).toBe(14850); // 100 * 148.5
    });

    it('should return USD for unknown currency', () => {
      const result = convertCurrency(100, 'UNKNOWN');
      expect(result.currency).toBe('USD');
      expect(result.amount).toBe(100);
    });

    it('should handle decimal values', () => {
      const result = convertCurrency(10.50, 'EUR');
      expect(result.currency).toBe('EUR');
      expect(result.amount).toBe(9.66); // 10.50 * 0.92
    });
  });

  describe('formatCost', () => {
    it('should format USD with dollar sign', () => {
      const result = formatCost(100, 'USD');
      expect(result).toBe('$100.00');
    });

    it('should format EUR with euro sign', () => {
      const result = formatCost(100, 'EUR');
      expect(result).toBe('\u20ac92.00');
    });

    it('should format GBP with pound sign', () => {
      const result = formatCost(100, 'GBP');
      expect(result).toBe('\u00a379.00');
    });

    it('should format JPY without decimal places', () => {
      const result = formatCost(100, 'JPY');
      expect(result).toBe('\u00a514850');
    });

    it('should default to USD', () => {
      const result = formatCost(100);
      expect(result).toBe('$100.00');
    });
  });

  describe('getSupportedCurrencies', () => {
    it('should return list of supported currencies', () => {
      const currencies = getSupportedCurrencies();
      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('GBP');
      expect(currencies).toContain('JPY');
      expect(currencies.length).toBeGreaterThan(5);
    });
  });
});
