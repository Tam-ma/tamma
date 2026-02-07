import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCRUM_MASTER_CONFIG,
  mergeConfig,
  getRiskLevelFromConfig,
} from './config.js';
import type { ScrumMasterConfig } from './config.js';

describe('DEFAULT_SCRUM_MASTER_CONFIG', () => {
  it('should have all required fields', () => {
    expect(DEFAULT_SCRUM_MASTER_CONFIG.taskLoop).toBeDefined();
    expect(DEFAULT_SCRUM_MASTER_CONFIG.riskThresholds).toBeDefined();
    expect(DEFAULT_SCRUM_MASTER_CONFIG.learningCapture).toBeDefined();
    expect(DEFAULT_SCRUM_MASTER_CONFIG.alerts).toBeDefined();
    expect(DEFAULT_SCRUM_MASTER_CONFIG.userInteraction).toBeDefined();
    expect(DEFAULT_SCRUM_MASTER_CONFIG.cost).toBeDefined();
    expect(DEFAULT_SCRUM_MASTER_CONFIG.escalation).toBeDefined();
  });

  it('should have reasonable default values', () => {
    expect(DEFAULT_SCRUM_MASTER_CONFIG.taskLoop.maxRetries).toBe(3);
    expect(DEFAULT_SCRUM_MASTER_CONFIG.taskLoop.autoApproveLowRisk).toBe(true);
    expect(DEFAULT_SCRUM_MASTER_CONFIG.taskLoop.timeoutMs).toBe(3600000); // 1 hour
  });

  it('should have risk thresholds defined', () => {
    expect(DEFAULT_SCRUM_MASTER_CONFIG.riskThresholds.low.maxFiles).toBe(5);
    expect(DEFAULT_SCRUM_MASTER_CONFIG.riskThresholds.medium.maxFiles).toBe(10);
  });

  it('should have at least one alert channel', () => {
    expect(DEFAULT_SCRUM_MASTER_CONFIG.alerts.channels.length).toBeGreaterThan(0);
    expect(DEFAULT_SCRUM_MASTER_CONFIG.alerts.channels[0]?.type).toBe('cli');
  });
});

describe('mergeConfig', () => {
  it('should return default config when no partial provided', () => {
    const config = mergeConfig();
    expect(config).toEqual(DEFAULT_SCRUM_MASTER_CONFIG);
  });

  it('should merge partial taskLoop config', () => {
    const config = mergeConfig({
      taskLoop: {
        maxRetries: 5,
        autoApproveLowRisk: false,
        requireApprovalHighRisk: true,
        timeoutMs: 1800000,
        progressUpdateIntervalMs: 10000,
        stallDetectionThresholdMs: 60000,
      },
    });

    expect(config.taskLoop.maxRetries).toBe(5);
    expect(config.taskLoop.autoApproveLowRisk).toBe(false);
    expect(config.taskLoop.timeoutMs).toBe(1800000);
  });

  it('should merge partial riskThresholds config', () => {
    const config = mergeConfig({
      riskThresholds: {
        low: {
          maxFiles: 3,
          maxComplexity: 'low',
          maxEstimatedCostUsd: 0.5,
          maxLinesChanged: 100,
        },
      },
    });

    expect(config.riskThresholds.low.maxFiles).toBe(3);
    // Should keep medium defaults
    expect(config.riskThresholds.medium.maxFiles).toBe(
      DEFAULT_SCRUM_MASTER_CONFIG.riskThresholds.medium.maxFiles
    );
  });

  it('should merge partial learningCapture config', () => {
    const config = mergeConfig({
      learningCapture: {
        captureSuccess: false,
        captureFailure: true,
        requireApproval: false,
        minRelevanceScore: 0.5,
      },
    });

    expect(config.learningCapture.captureSuccess).toBe(false);
    expect(config.learningCapture.requireApproval).toBe(false);
  });

  it('should merge partial alerts config', () => {
    const config = mergeConfig({
      alerts: {
        onBlock: false,
        onMaxRetries: true,
        onApprovalNeeded: true,
        onReviewFailed: true,
        onCostLimitWarning: false,
        channels: [
          { type: 'webhook', enabled: true, config: { url: 'https://example.com' } },
        ],
      },
    });

    expect(config.alerts.onBlock).toBe(false);
    expect(config.alerts.channels.length).toBe(1);
    expect(config.alerts.channels[0]?.type).toBe('webhook');
  });

  it('should merge partial userInteraction config', () => {
    const config = mergeConfig({
      userInteraction: {
        proactiveUpdates: false,
        updateIntervalSeconds: 60,
        autoTimeoutMinutes: 30,
      },
    });

    expect(config.userInteraction.proactiveUpdates).toBe(false);
    expect(config.userInteraction.updateIntervalSeconds).toBe(60);
  });

  it('should merge partial cost config', () => {
    const config = mergeConfig({
      cost: {
        defaultTaskBudgetUsd: 5.0,
        warningThresholdPercent: 70,
      },
    });

    expect(config.cost.defaultTaskBudgetUsd).toBe(5.0);
    expect(config.cost.warningThresholdPercent).toBe(70);
  });

  it('should merge partial escalation config', () => {
    const config = mergeConfig({
      escalation: {
        escalateAfterFailures: 5,
        escalateAfterBlockers: 3,
        escalateAfterTimeoutMs: 900000,
      },
    });

    expect(config.escalation.escalateAfterFailures).toBe(5);
    expect(config.escalation.escalateAfterBlockers).toBe(3);
  });

  it('should handle undefined nested values', () => {
    const config = mergeConfig({
      taskLoop: undefined,
    });

    expect(config.taskLoop).toEqual(DEFAULT_SCRUM_MASTER_CONFIG.taskLoop);
  });
});

describe('getRiskLevelFromConfig', () => {
  const config: ScrumMasterConfig = {
    ...DEFAULT_SCRUM_MASTER_CONFIG,
    riskThresholds: {
      low: {
        maxFiles: 5,
        maxComplexity: 'low',
        maxEstimatedCostUsd: 1.0,
        maxLinesChanged: 200,
      },
      medium: {
        maxFiles: 10,
        maxComplexity: 'medium',
        maxEstimatedCostUsd: 5.0,
        maxLinesChanged: 500,
      },
    },
  };

  it('should return low risk for simple changes', () => {
    const level = getRiskLevelFromConfig(config, 2, 'low', 0.5, 100);
    expect(level).toBe('low');
  });

  it('should return medium risk for moderate changes', () => {
    const level = getRiskLevelFromConfig(config, 7, 'medium', 2.0, 300);
    expect(level).toBe('medium');
  });

  it('should return high risk for complex changes', () => {
    const level = getRiskLevelFromConfig(config, 15, 'high', 10.0, 1000);
    expect(level).toBe('high');
  });

  it('should return high risk when any threshold exceeded significantly', () => {
    // Even with few files, high cost should be high risk
    const level = getRiskLevelFromConfig(config, 2, 'low', 20.0, 100);
    expect(level).toBe('high');
  });

  it('should return medium when at boundary', () => {
    // At the boundary of medium thresholds
    const level = getRiskLevelFromConfig(config, 10, 'medium', 5.0, 500);
    expect(level).toBe('medium');
  });

  it('should consider complexity in risk assessment', () => {
    // High complexity should push to high risk
    const level = getRiskLevelFromConfig(config, 5, 'high', 1.0, 200);
    expect(level).toBe('high');
  });

  it('should consider all factors together', () => {
    // Multiple factors at medium level
    const level = getRiskLevelFromConfig(config, 6, 'medium', 2.0, 300);
    expect(level).toBe('medium');

    // Same files but high complexity
    const levelHigh = getRiskLevelFromConfig(config, 6, 'high', 2.0, 300);
    expect(levelHigh).toBe('high');
  });
});
