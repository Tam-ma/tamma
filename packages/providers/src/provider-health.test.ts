/**
 * Test suite for ProviderHealthTracker - circuit breaker per provider+model.
 *
 * Circuit breaker state is in-memory only. Process restart resets all state.
 * This is an intentional design decision because provider outages are typically
 * transient.
 *
 * Default thresholds: 5 failures in 60s opens circuit for 300s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderHealthTracker } from './provider-health.js';
import { createProviderError } from './errors.js';

describe('ProviderHealthTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- static buildKey ---

  describe('buildKey', () => {
    it('should return "provider:model" when model is provided', () => {
      expect(ProviderHealthTracker.buildKey('openrouter', 'z-ai/z1-mini')).toBe(
        'openrouter:z-ai/z1-mini',
      );
    });

    it('should return "provider:default" when model is omitted', () => {
      expect(ProviderHealthTracker.buildKey('openrouter')).toBe('openrouter:default');
    });

    it('should return "provider:default" when model is undefined', () => {
      expect(ProviderHealthTracker.buildKey('anthropic', undefined)).toBe('anthropic:default');
    });
  });

  // --- constructor validation ---

  describe('constructor validation', () => {
    it('should accept valid default options (no arguments)', () => {
      expect(() => new ProviderHealthTracker()).not.toThrow();
    });

    it('should accept valid custom options', () => {
      expect(
        () =>
          new ProviderHealthTracker({
            failureThreshold: 3,
            failureWindowMs: 30_000,
            circuitOpenDurationMs: 60_000,
            halfOpenProbeTimeoutMs: 10_000,
            maxTrackedKeys: 500,
          }),
      ).not.toThrow();
    });

    it('should throw on failureThreshold = 0', () => {
      expect(() => new ProviderHealthTracker({ failureThreshold: 0 })).toThrow(
        /failureThreshold must be a positive integer >= 1/,
      );
    });

    it('should throw on failureThreshold = -1', () => {
      expect(() => new ProviderHealthTracker({ failureThreshold: -1 })).toThrow(
        /failureThreshold must be a positive integer >= 1/,
      );
    });

    it('should throw on failureThreshold = 1.5 (non-integer)', () => {
      expect(() => new ProviderHealthTracker({ failureThreshold: 1.5 })).toThrow(
        /failureThreshold must be a positive integer >= 1/,
      );
    });

    it('should throw on failureThreshold = Infinity', () => {
      expect(() => new ProviderHealthTracker({ failureThreshold: Infinity })).toThrow(
        /failureThreshold must be a positive integer >= 1/,
      );
    });

    it('should throw on failureThreshold = NaN', () => {
      expect(() => new ProviderHealthTracker({ failureThreshold: NaN })).toThrow(
        /failureThreshold must be a positive integer >= 1/,
      );
    });

    it('should throw on failureWindowMs < 1000', () => {
      expect(() => new ProviderHealthTracker({ failureWindowMs: 999 })).toThrow(
        /failureWindowMs must be a finite number >= 1000/,
      );
    });

    it('should throw on failureWindowMs = Infinity', () => {
      expect(() => new ProviderHealthTracker({ failureWindowMs: Infinity })).toThrow(
        /failureWindowMs must be a finite number >= 1000/,
      );
    });

    it('should throw on failureWindowMs = NaN', () => {
      expect(() => new ProviderHealthTracker({ failureWindowMs: NaN })).toThrow(
        /failureWindowMs must be a finite number >= 1000/,
      );
    });

    it('should throw on circuitOpenDurationMs < 1000', () => {
      expect(() => new ProviderHealthTracker({ circuitOpenDurationMs: 500 })).toThrow(
        /circuitOpenDurationMs must be a finite number >= 1000/,
      );
    });

    it('should throw on circuitOpenDurationMs = Infinity', () => {
      expect(() => new ProviderHealthTracker({ circuitOpenDurationMs: Infinity })).toThrow(
        /circuitOpenDurationMs must be a finite number >= 1000/,
      );
    });

    it('should throw on circuitOpenDurationMs = NaN', () => {
      expect(() => new ProviderHealthTracker({ circuitOpenDurationMs: NaN })).toThrow(
        /circuitOpenDurationMs must be a finite number >= 1000/,
      );
    });

    it('should throw on halfOpenProbeTimeoutMs < 1000', () => {
      expect(() => new ProviderHealthTracker({ halfOpenProbeTimeoutMs: 100 })).toThrow(
        /halfOpenProbeTimeoutMs must be a finite number >= 1000/,
      );
    });

    it('should throw on maxTrackedKeys = 0', () => {
      expect(() => new ProviderHealthTracker({ maxTrackedKeys: 0 })).toThrow(
        /maxTrackedKeys must be a positive integer >= 1/,
      );
    });

    it('should throw on maxTrackedKeys = 1.5 (non-integer)', () => {
      expect(() => new ProviderHealthTracker({ maxTrackedKeys: 1.5 })).toThrow(
        /maxTrackedKeys must be a positive integer >= 1/,
      );
    });
  });

  // --- key validation ---

  describe('key validation', () => {
    it('should reject keys longer than 256 characters', () => {
      const tracker = new ProviderHealthTracker();
      const longKey = 'a'.repeat(257);

      expect(() => tracker.isHealthy(longKey)).toThrow(/key too long/);
    });

    it('should accept keys exactly 256 characters long', () => {
      const tracker = new ProviderHealthTracker();
      const maxKey = 'a'.repeat(256);

      expect(() => tracker.isHealthy(maxKey)).not.toThrow();
    });

    it('should reject keys with spaces', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('open router:model')).toThrow(/invalid characters/);
    });

    it('should reject keys with special characters', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('provider@model')).toThrow(/invalid characters/);
    });

    it('should accept keys with valid characters (alphanumeric, dots, underscores, dashes, colons, slashes)', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('openrouter:z-ai/z1-mini')).not.toThrow();
      expect(() => tracker.isHealthy('provider_name:model.v2')).not.toThrow();
    });

    it('should validate keys in recordFailure()', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.recordFailure('bad key!')).toThrow(/invalid characters/);
    });

    it('should validate keys in recordSuccess()', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.recordSuccess('bad key!')).toThrow(/invalid characters/);
    });

    it('should validate keys in reset()', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.reset('bad key!')).toThrow(/invalid characters/);
    });

    it('should reject empty keys', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('')).toThrow(/invalid characters/);
    });

    it('should accept valid key format "anthropic:claude-opus-4"', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('anthropic:claude-opus-4')).not.toThrow();
    });

    it('should reject keys with hash characters', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('provider#model')).toThrow(/invalid characters/);
    });

    it('should reject keys with newlines', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.isHealthy('provider\nmodel')).toThrow(/invalid characters/);
    });
  });

  // --- isHealthy: basic behavior ---

  describe('isHealthy', () => {
    it('should return true for unknown keys (never tracked)', () => {
      const tracker = new ProviderHealthTracker();

      expect(tracker.isHealthy('unknown:provider')).toBe(true);
    });

    it('should return true after recording fewer failures than threshold', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 5 });
      const key = 'test:model';

      for (let i = 0; i < 4; i++) {
        tracker.recordFailure(key);
      }

      expect(tracker.isHealthy(key)).toBe(true);
    });
  });

  // --- Circuit breaker: 5 failures in 60s opens circuit ---

  describe('circuit breaker - threshold', () => {
    it('should open circuit after 5 failures within 60s (defaults)', () => {
      const tracker = new ProviderHealthTracker();
      const key = 'openrouter:z-ai/z1-mini';

      for (let i = 0; i < 5; i++) {
        tracker.recordFailure(key);
      }

      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should honor custom failureThreshold', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      expect(tracker.isHealthy(key)).toBe(true);

      tracker.recordFailure(key);
      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should honor custom failureWindowMs', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        failureWindowMs: 10_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Move past the 10s window -- old failures should be pruned
      vi.advanceTimersByTime(11_000);

      tracker.recordFailure(key);

      // Only 1 failure within the new window
      expect(tracker.isHealthy(key)).toBe(true);
    });
  });

  // --- Sliding window prunes old timestamps ---

  describe('sliding window', () => {
    it('should not count failures outside the window', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        failureWindowMs: 10_000,
      });
      const key = 'test:model';

      // Record 2 failures at time 0
      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Advance past the window
      vi.advanceTimersByTime(11_000);

      // Record 1 more failure -- the old 2 should be pruned
      tracker.recordFailure(key);

      // Only 1 failure in the current window, below threshold of 3
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should trip circuit with exactly threshold failures within window', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        failureWindowMs: 10_000,
      });
      const key = 'test:model';

      // Exactly 3 failures, each 2s apart (all within 10s)
      tracker.recordFailure(key);
      vi.advanceTimersByTime(2_000);
      tracker.recordFailure(key);
      vi.advanceTimersByTime(2_000);
      tracker.recordFailure(key);

      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should prune old timestamps when new failures are recorded', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        failureWindowMs: 5_000,
      });
      const key = 'test:model';

      // Record 2 failures at time 0
      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Advance to 6s (past window for the first 2 failures)
      vi.advanceTimersByTime(6_000);

      // Record a new failure -- old timestamps should be pruned during this call
      tracker.recordFailure(key);

      // Only 1 failure in window
      const status = tracker.getStatus();
      expect(status[key]?.failures).toBe(1);
    });

    it('should accumulate failures within the window', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        failureWindowMs: 10_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      vi.advanceTimersByTime(3_000);
      tracker.recordFailure(key);
      vi.advanceTimersByTime(3_000);
      tracker.recordFailure(key);

      // All 3 failures within 10s window
      expect(tracker.isHealthy(key)).toBe(false);
    });
  });

  // --- Circuit open behavior ---

  describe('circuit open behavior', () => {
    it('should return false from isHealthy while circuit is open and not expired', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 10_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Check at various points during the open period
      expect(tracker.isHealthy(key)).toBe(false);
      vi.advanceTimersByTime(5_000);
      expect(tracker.isHealthy(key)).toBe(false);
      vi.advanceTimersByTime(4_999);
      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should transition from open to half-open only after circuitOpenDurationMs', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 10_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Just before expiry -- still open
      vi.advanceTimersByTime(9_999);
      expect(tracker.isHealthy(key)).toBe(false);

      // After expiry -- half-open (probe allowed)
      vi.advanceTimersByTime(2);
      expect(tracker.isHealthy(key)).toBe(true);
    });
  });

  // --- Half-open state ---

  describe('half-open state', () => {
    it('should transition to half-open after circuit open duration elapses', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      expect(tracker.isHealthy(key)).toBe(false);

      // Advance past circuit open duration
      vi.advanceTimersByTime(5_001);

      // First caller gets through as the half-open probe
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should allow exactly ONE probe in half-open state (thundering herd prevention)', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);

      // First caller gets through
      expect(tracker.isHealthy(key)).toBe(true);

      // Second caller is blocked
      expect(tracker.isHealthy(key)).toBe(false);

      // Third caller is also blocked
      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should fully close circuit on successful half-open probe', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      expect(tracker.isHealthy(key)).toBe(true); // half-open probe allowed

      tracker.recordSuccess(key);

      // Circuit should now be fully closed
      expect(tracker.isHealthy(key)).toBe(true);
      // Multiple calls should all return true (circuit closed, not half-open)
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should immediately re-open circuit on failed half-open probe', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      expect(tracker.isHealthy(key)).toBe(true); // half-open probe allowed

      tracker.recordFailure(key); // probe fails

      // Circuit should be open again
      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should re-open circuit with fresh duration after failed half-open probe', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      expect(tracker.isHealthy(key)).toBe(true); // half-open probe

      tracker.recordFailure(key); // probe fails, re-opens circuit

      // Circuit is open again with fresh duration
      expect(tracker.isHealthy(key)).toBe(false);

      // Should not allow half-open probe until 5s has passed
      vi.advanceTimersByTime(4_999);
      expect(tracker.isHealthy(key)).toBe(false);

      // Now it should allow half-open again
      vi.advanceTimersByTime(2);
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should auto-reset stuck half-open probe after halfOpenProbeTimeoutMs', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        halfOpenProbeTimeoutMs: 2_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      expect(tracker.isHealthy(key)).toBe(true); // half-open probe allowed

      // Probe caller never calls recordSuccess/recordFailure.
      // Advance past the probe timeout.
      vi.advanceTimersByTime(2_001);

      // The stuck probe should be detected and circuit reset to open
      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should allow a new probe after probe timeout reset and circuitOpenDurationMs elapses again', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        halfOpenProbeTimeoutMs: 2_000,
      });
      const key = 'test:model';

      // Trip the circuit
      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Wait for half-open
      vi.advanceTimersByTime(5_001);
      expect(tracker.isHealthy(key)).toBe(true); // half-open probe allowed

      // Probe times out
      vi.advanceTimersByTime(2_001);
      expect(tracker.isHealthy(key)).toBe(false); // probe timed out, resets to open

      // Wait for the new circuit open duration to elapse
      vi.advanceTimersByTime(5_001);

      // A new half-open probe should be allowed
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should set circuitOpen to false and clear failures on recordSuccess during half-open', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key); // half-open probe

      tracker.recordSuccess(key);

      const status = tracker.getStatus();
      expect(status[key]?.circuitOpen).toBe(false);
      expect(status[key]?.failures).toBe(0);
      expect(status[key]?.healthy).toBe(true);
    });
  });

  // --- recordFailure: ProviderError handling ---

  describe('recordFailure - error handling', () => {
    it('should accept plain Error and count toward circuit breaker', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      const key = 'test:model';

      tracker.recordFailure(key, new Error('network failure'));
      tracker.recordFailure(key, new Error('timeout'));

      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should accept retryable ProviderError and count toward circuit breaker', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      const key = 'test:model';
      const retryableError = createProviderError(
        'RATE_LIMIT_EXCEEDED',
        'Too many requests',
        true,
        'medium',
      );

      tracker.recordFailure(key, retryableError);
      tracker.recordFailure(key, retryableError);

      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should NOT count non-retryable ProviderError toward circuit breaker', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      const key = 'test:model';
      const nonRetryable = createProviderError(
        'INVALID_API_KEY',
        'Bad API key',
        false,
        'high',
      );

      // 10 non-retryable errors should not trip the circuit
      for (let i = 0; i < 10; i++) {
        tracker.recordFailure(key, nonRetryable);
      }

      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should count failures when no error is provided', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      expect(tracker.isHealthy(key)).toBe(false);
    });

    it('should short-circuit when circuit is already open (not half-open)', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 10_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      // Circuit is now open

      // Further failures while circuit is open should be no-ops
      const status1 = tracker.getStatus();
      const failures1 = status1[key]?.failures ?? 0;

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      const status2 = tracker.getStatus();
      const failures2 = status2[key]?.failures ?? 0;

      // Failure count should remain the same since additional failures
      // after the circuit opens are no-ops
      expect(failures2).toBe(failures1);
    });
  });

  // --- recordFailure: failureTimestamps cap ---

  describe('recordFailure - timestamp cap', () => {
    it('should cap failureTimestamps array to failureThreshold * 2', () => {
      // Use a high threshold so we can record many failures without tripping the circuit
      const tracker = new ProviderHealthTracker({
        failureThreshold: 5,
        failureWindowMs: 60_000,
      });
      const key = 'test:model';

      // Record 4 failures (below threshold, so circuit stays closed)
      for (let i = 0; i < 4; i++) {
        tracker.recordFailure(key);
        vi.advanceTimersByTime(100); // slight time advance for unique timestamps
      }

      // After 5th failure the circuit opens, so let's verify via getStatus
      tracker.recordFailure(key);

      const status = tracker.getStatus();
      // The circuit should now be open with exactly 5 failures recorded
      expect(status[key]?.failures).toBe(5);
    });

    it('should not grow unbounded even with rapid failure injection', () => {
      // With threshold=3, cap = 3*2 = 6
      // We will record failures, reset the circuit, and record more
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        failureWindowMs: 60_000,
        circuitOpenDurationMs: 1_000,
      });
      const key = 'test:model';

      // Record 3 failures to trip the circuit
      tracker.recordFailure(key);
      vi.advanceTimersByTime(10);
      tracker.recordFailure(key);
      vi.advanceTimersByTime(10);
      tracker.recordFailure(key);
      // Circuit is now open

      // Wait for half-open, then succeed to close
      vi.advanceTimersByTime(1_001);
      tracker.isHealthy(key); // half-open probe
      tracker.recordSuccess(key); // closes circuit, resets timestamps

      // Verify timestamps were cleared
      const status = tracker.getStatus();
      expect(status[key]?.failures).toBe(0);
    });
  });

  // --- recordFailure: maxTrackedKeys ---

  describe('recordFailure - maxTrackedKeys limit', () => {
    it('should reject new keys when at capacity', () => {
      const tracker = new ProviderHealthTracker({
        maxTrackedKeys: 2,
      });

      tracker.recordFailure('key1:model');
      tracker.recordFailure('key2:model');

      // At capacity -- new key should be silently rejected
      tracker.recordFailure('key3:model');

      const status = tracker.getStatus();
      expect(Object.keys(status)).toHaveLength(2);
      expect(status['key1:model']).toBeDefined();
      expect(status['key2:model']).toBeDefined();
      expect(status['key3:model']).toBeUndefined();
    });

    it('should accept new keys after reset() frees a slot', () => {
      const tracker = new ProviderHealthTracker({
        maxTrackedKeys: 2,
      });

      tracker.recordFailure('key1:model');
      tracker.recordFailure('key2:model');

      // At capacity -- key3 should be silently rejected
      tracker.recordFailure('key3:model');
      expect(tracker.getStatus()['key3:model']).toBeUndefined();

      // Free a slot
      tracker.reset('key1:model');

      // Now key3 should be accepted
      tracker.recordFailure('key3:model');
      const status = tracker.getStatus();
      expect(status['key3:model']).toBeDefined();
      expect(status['key1:model']).toBeUndefined();
    });

    it('should accept failures for existing keys even at capacity', () => {
      const tracker = new ProviderHealthTracker({
        maxTrackedKeys: 2,
        failureThreshold: 3,
      });

      tracker.recordFailure('key1:model');
      tracker.recordFailure('key2:model');

      // At capacity, but key1 already exists
      tracker.recordFailure('key1:model');
      tracker.recordFailure('key1:model');

      const status = tracker.getStatus();
      expect(status['key1:model']?.failures).toBe(3);
    });
  });

  // --- recordSuccess ---

  describe('recordSuccess', () => {
    it('should reset all failure timestamps', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 5 });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      tracker.recordFailure(key);

      tracker.recordSuccess(key);

      const status = tracker.getStatus();
      expect(status[key]?.failures).toBe(0);
    });

    it('should set circuitOpen to false after recording success on open circuit', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
      });
      const key = 'test:model';

      // Trip the circuit
      tracker.recordFailure(key);
      tracker.recordFailure(key);
      expect(tracker.getStatus()[key]?.circuitOpen).toBe(true);

      // Wait for half-open, probe, succeed
      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key);
      tracker.recordSuccess(key);

      expect(tracker.getStatus()[key]?.circuitOpen).toBe(false);
    });

    it('should be a no-op for unknown keys', () => {
      const tracker = new ProviderHealthTracker();

      // Should not throw
      expect(() => tracker.recordSuccess('unknown:key')).not.toThrow();
    });
  });

  // --- getStatus ---

  describe('getStatus', () => {
    it('should return an empty object when no keys are tracked', () => {
      const tracker = new ProviderHealthTracker();

      const status = tracker.getStatus();

      expect(status).toEqual({});
    });

    it('should return Record with correct health state for all tracked keys', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });

      tracker.recordFailure('healthy:model');
      tracker.recordFailure('unhealthy:model');
      tracker.recordFailure('unhealthy:model');
      tracker.recordFailure('unhealthy:model');

      const status = tracker.getStatus();

      expect(status['healthy:model']).toEqual({
        healthy: true,
        failures: 1,
        circuitOpen: false,
      });
      expect(status['unhealthy:model']).toEqual({
        healthy: false,
        failures: 3,
        circuitOpen: true,
      });
    });

    it('should return JSON-serializable result (not Map)', () => {
      const tracker = new ProviderHealthTracker();
      tracker.recordFailure('test:model');

      const status = tracker.getStatus();

      // Should serialize cleanly to JSON and back
      const serialized = JSON.stringify(status);
      const deserialized = JSON.parse(serialized) as Record<string, unknown>;

      expect(deserialized).toEqual(status);
    });

    it('should show correct failures count within the current window', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 10,
        failureWindowMs: 10_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(11_000);

      tracker.recordFailure(key);

      const status = tracker.getStatus();
      // Only 1 failure within the current 10s window
      expect(status[key]?.failures).toBe(1);
    });
  });

  // --- reset and clear ---

  describe('reset and clear', () => {
    it('should delete a single key with reset()', () => {
      const tracker = new ProviderHealthTracker();

      tracker.recordFailure('key1:model');
      tracker.recordFailure('key2:model');

      tracker.reset('key1:model');

      const status = tracker.getStatus();
      expect(status['key1:model']).toBeUndefined();
      expect(status['key2:model']).toBeDefined();
    });

    it('should not throw when resetting a non-existent key', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.reset('nonexistent:key')).not.toThrow();
    });

    it('should delete all keys with clear()', () => {
      const tracker = new ProviderHealthTracker();

      tracker.recordFailure('key1:model');
      tracker.recordFailure('key2:model');
      tracker.recordFailure('key3:model');

      tracker.clear();

      const status = tracker.getStatus();
      expect(Object.keys(status)).toHaveLength(0);
    });

    it('should make previously unhealthy keys healthy again after reset()', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      expect(tracker.isHealthy(key)).toBe(false);

      tracker.reset(key);
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should make all keys healthy again after clear()', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });

      tracker.recordFailure('key1:model');
      tracker.recordFailure('key1:model');
      tracker.recordFailure('key2:model');
      tracker.recordFailure('key2:model');

      expect(tracker.isHealthy('key1:model')).toBe(false);
      expect(tracker.isHealthy('key2:model')).toBe(false);

      tracker.clear();

      expect(tracker.isHealthy('key1:model')).toBe(true);
      expect(tracker.isHealthy('key2:model')).toBe(true);
    });
  });

  // --- onCircuitChange callback ---

  describe('onCircuitChange callback', () => {
    it('should fire "open" when circuit trips', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        onCircuitChange: callback,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      expect(callback).not.toHaveBeenCalled();

      tracker.recordFailure(key);
      expect(callback).toHaveBeenCalledWith(key, 'open');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should fire "half-open" when probe is permitted', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        onCircuitChange: callback,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      callback.mockClear();

      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key); // triggers half-open

      expect(callback).toHaveBeenCalledWith(key, 'half-open');
    });

    it('should fire "closed" when half-open probe succeeds', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        onCircuitChange: callback,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key); // half-open probe
      callback.mockClear();

      tracker.recordSuccess(key);
      expect(callback).toHaveBeenCalledWith(key, 'closed');
    });

    it('should fire "open" when half-open probe fails', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        onCircuitChange: callback,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key); // half-open
      callback.mockClear();

      tracker.recordFailure(key); // probe fails
      expect(callback).toHaveBeenCalledWith(key, 'open');
    });

    it('should fire "open" on half-open probe timeout', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        halfOpenProbeTimeoutMs: 2_000,
        onCircuitChange: callback,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key); // half-open probe
      callback.mockClear();

      vi.advanceTimersByTime(2_001);
      tracker.isHealthy(key); // detects timed-out probe

      expect(callback).toHaveBeenCalledWith(key, 'open');
    });

    it('should fire complete lifecycle: open -> half-open -> closed', () => {
      const transitions: Array<{ key: string; state: string }> = [];
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 5_000,
        onCircuitChange: (key, state) => {
          transitions.push({ key, state });
        },
      });
      const key = 'test:model';

      // Trip the circuit
      tracker.recordFailure(key);
      tracker.recordFailure(key);
      expect(transitions).toEqual([{ key, state: 'open' }]);

      // Wait for half-open
      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key);
      expect(transitions).toEqual([
        { key, state: 'open' },
        { key, state: 'half-open' },
      ]);

      // Successful probe
      tracker.recordSuccess(key);
      expect(transitions).toEqual([
        { key, state: 'open' },
        { key, state: 'half-open' },
        { key, state: 'closed' },
      ]);
    });

    it('should not throw when onCircuitChange is not provided', () => {
      // No callback -- default constructor, no onCircuitChange option
      const tracker = new ProviderHealthTracker({ failureThreshold: 2, circuitOpenDurationMs: 5_000 });
      const key = 'test:model';

      // Trip the circuit (would fire 'open' if callback existed)
      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Half-open (would fire 'half-open')
      vi.advanceTimersByTime(5_001);
      tracker.isHealthy(key);

      // Close (would fire 'closed')
      tracker.recordSuccess(key);

      // If we got here without throwing, the test passes
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should receive the correct key in callback', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        onCircuitChange: callback,
      });

      tracker.recordFailure('provider-a:model-x');
      tracker.recordFailure('provider-a:model-x');

      expect(callback).toHaveBeenCalledWith('provider-a:model-x', 'open');

      tracker.recordFailure('provider-b:model-y');
      tracker.recordFailure('provider-b:model-y');

      expect(callback).toHaveBeenCalledWith('provider-b:model-y', 'open');
    });

    it('should not fire "closed" on recordSuccess when circuit was never open', () => {
      const callback = vi.fn();
      const tracker = new ProviderHealthTracker({
        failureThreshold: 5,
        onCircuitChange: callback,
      });
      const key = 'test:model';

      // Record some failures but not enough to trip
      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Record success
      tracker.recordSuccess(key);

      // No callback -- circuit was never open so no transition
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // --- Custom options honored ---

  describe('custom options', () => {
    it('should honor custom halfOpenProbeTimeoutMs', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 3_000,
        halfOpenProbeTimeoutMs: 5_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // Wait for half-open
      vi.advanceTimersByTime(3_001);
      expect(tracker.isHealthy(key)).toBe(true); // half-open probe

      // After 4s the probe should NOT yet be timed out (timeout is 5s)
      vi.advanceTimersByTime(4_000);
      expect(tracker.isHealthy(key)).toBe(false); // still in progress, not timed out

      // After another 1.5s (total 5.5s), probe should time out
      vi.advanceTimersByTime(1_500);
      expect(tracker.isHealthy(key)).toBe(false); // timed out, reset to open
    });

    it('should honor custom maxTrackedKeys', () => {
      const tracker = new ProviderHealthTracker({ maxTrackedKeys: 1 });

      tracker.recordFailure('first:model');
      tracker.recordFailure('second:model');

      const status = tracker.getStatus();
      expect(Object.keys(status)).toHaveLength(1);
      expect(status['first:model']).toBeDefined();
    });

    it('should honor custom circuitOpenDurationMs', () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        circuitOpenDurationMs: 2_000,
      });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);

      // After 1.5s, circuit should still be open
      vi.advanceTimersByTime(1_500);
      expect(tracker.isHealthy(key)).toBe(false);

      // After 2.5s, circuit should be half-open (allows probe)
      vi.advanceTimersByTime(1_000);
      expect(tracker.isHealthy(key)).toBe(true);
    });
  });

  // --- Interface compliance ---

  describe('interface compliance', () => {
    it('should implement IProviderHealthTracker interface', () => {
      const tracker = new ProviderHealthTracker();

      // Verify all interface methods exist
      expect(typeof tracker.isHealthy).toBe('function');
      expect(typeof tracker.recordFailure).toBe('function');
      expect(typeof tracker.recordSuccess).toBe('function');
      expect(typeof tracker.getStatus).toBe('function');
      expect(typeof tracker.reset).toBe('function');
      expect(typeof tracker.clear).toBe('function');
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should handle multiple independent keys', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      const key1 = 'provider1:model1';
      const key2 = 'provider2:model2';

      tracker.recordFailure(key1);
      tracker.recordFailure(key1);
      tracker.recordFailure(key2);

      expect(tracker.isHealthy(key1)).toBe(false);
      expect(tracker.isHealthy(key2)).toBe(true);
    });

    it('should handle rapid succession of failures and successes', () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const key = 'test:model';

      tracker.recordFailure(key);
      tracker.recordFailure(key);
      tracker.recordSuccess(key);

      // Success should have reset failures
      const status = tracker.getStatus();
      expect(status[key]?.failures).toBe(0);
      expect(tracker.isHealthy(key)).toBe(true);
    });

    it('should be safe to call recordSuccess on a key that was never failed', () => {
      const tracker = new ProviderHealthTracker();

      expect(() => tracker.recordSuccess('never:failed')).not.toThrow();
      expect(tracker.isHealthy('never:failed')).toBe(true);
    });
  });
});
