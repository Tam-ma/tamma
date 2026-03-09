/**
 * Provider Health Tracker - Circuit breaker per provider+model.
 *
 * Tracks failures in a sliding window and marks unhealthy providers so
 * the fallback chain (Story 9-5 ProviderChain) can skip them. Feeds
 * failure data into diagnostics via onCircuitChange callback.
 *
 * Circuit breaker state is in-memory only. Process restart resets all
 * state. This is an intentional design decision because provider outages
 * are typically transient.
 */

import type { ProviderError, IProviderHealthTracker, HealthStatusEntry } from './types.js';
import { isProviderError } from './errors.js';

/**
 * Internal health entry per provider+model key.
 */
interface HealthEntry {
  failureTimestamps: number[];
  circuitOpen: boolean;
  circuitOpenUntil: number;
  halfOpenInProgress: boolean;
  halfOpenStartedAt: number;
}

const KEY_PATTERN = /^[a-zA-Z0-9._\-:/]+$/;
const MAX_KEY_LENGTH = 256;

export class ProviderHealthTracker implements IProviderHealthTracker {
  private health = new Map<string, HealthEntry>();

  private failureThreshold: number;
  private failureWindowMs: number;
  private circuitOpenDurationMs: number;
  private halfOpenProbeTimeoutMs: number;
  private maxTrackedKeys: number;
  private onCircuitChange?: (key: string, state: 'open' | 'half-open' | 'closed') => void;

  constructor(options?: {
    failureThreshold?: number;
    failureWindowMs?: number;
    circuitOpenDurationMs?: number;
    halfOpenProbeTimeoutMs?: number;
    maxTrackedKeys?: number;
    onCircuitChange?: (key: string, state: 'open' | 'half-open' | 'closed') => void;
  }) {
    const threshold = options?.failureThreshold ?? 5;
    const windowMs = options?.failureWindowMs ?? 60_000;
    const openMs = options?.circuitOpenDurationMs ?? 300_000;
    const probeMs = options?.halfOpenProbeTimeoutMs ?? 30_000;
    const maxKeys = options?.maxTrackedKeys ?? 1000;

    // Validate constructor inputs
    if (!Number.isFinite(threshold) || !Number.isInteger(threshold) || threshold < 1) {
      throw new Error(`failureThreshold must be a positive integer >= 1, got ${threshold}`);
    }
    if (!Number.isFinite(windowMs) || windowMs < 1000) {
      throw new Error(`failureWindowMs must be a finite number >= 1000, got ${windowMs}`);
    }
    if (!Number.isFinite(openMs) || openMs < 1000) {
      throw new Error(`circuitOpenDurationMs must be a finite number >= 1000, got ${openMs}`);
    }
    if (!Number.isFinite(probeMs) || probeMs < 1000) {
      throw new Error(`halfOpenProbeTimeoutMs must be a finite number >= 1000, got ${probeMs}`);
    }
    if (!Number.isFinite(maxKeys) || !Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new Error(`maxTrackedKeys must be a positive integer >= 1, got ${maxKeys}`);
    }

    this.failureThreshold = threshold;
    this.failureWindowMs = windowMs;
    this.circuitOpenDurationMs = openMs;
    this.halfOpenProbeTimeoutMs = probeMs;
    this.maxTrackedKeys = maxKeys;
    if (options?.onCircuitChange !== undefined) {
      this.onCircuitChange = options.onCircuitChange;
    }
  }

  /**
   * Build a standardized health key from provider and optional model.
   * Returns "provider:model" or "provider:default".
   */
  static buildKey(provider: string, model?: string): string {
    return `${provider}:${model ?? 'default'}`;
  }

  /**
   * Validate key format: max 256 chars, alphanumeric with . _ - : /
   */
  private validateKey(key: string): void {
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`Health tracker key too long (max ${MAX_KEY_LENGTH}): ${key.slice(0, 50)}...`);
    }
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`Health tracker key contains invalid characters: ${key.slice(0, 50)}`);
    }
  }

  /**
   * Check if a provider+model key is healthy.
   *
   * key = "provider:model" e.g. "openrouter:z-ai/z1-mini"
   * Use ProviderHealthTracker.buildKey() to construct keys.
   *
   * Returns true if:
   * - The key has never been tracked (unknown keys are healthy)
   * - The circuit is closed
   * - The circuit has been open long enough and the caller is the
   *   first to attempt a half-open probe
   *
   * Returns false if:
   * - The circuit is open and the open duration has not elapsed
   * - Another caller is already probing in half-open state
   * - A half-open probe timed out (auto-resets to open)
   */
  isHealthy(key: string): boolean {
    this.validateKey(key);
    const entry = this.health.get(key);
    if (!entry) return true;

    if (!entry.circuitOpen) return true;

    if (Date.now() < entry.circuitOpenUntil) return false;

    // Half-open probe timeout: if the probe caller crashed or forgot to
    // call recordSuccess/recordFailure, auto-reset to open state.
    if (entry.halfOpenInProgress) {
      if (Date.now() - entry.halfOpenStartedAt > this.halfOpenProbeTimeoutMs) {
        // Probe timed out -- reset to open and allow a new probe
        entry.halfOpenInProgress = false;
        entry.circuitOpen = true;
        entry.circuitOpenUntil = Date.now() + this.circuitOpenDurationMs;
        this.onCircuitChange?.(key, 'open');
        return false;
      }
      // Another caller is already probing; block to prevent thundering herd
      return false;
    }

    entry.halfOpenInProgress = true;
    entry.halfOpenStartedAt = Date.now();
    this.onCircuitChange?.(key, 'half-open');
    return true;
  }

  /**
   * Record a failure. Accepts Error | ProviderError.
   *
   * If the error is a ProviderError with retryable === false, it is NOT
   * counted toward the circuit breaker. Non-retryable errors indicate
   * configuration or caller problems, not provider health issues.
   */
  recordFailure(key: string, error?: Error | ProviderError): void {
    this.validateKey(key);

    // Non-retryable ProviderErrors are config/caller problems, not health issues.
    // Do not count them toward the circuit breaker threshold.
    if (error && isProviderError(error) && error.retryable === false) {
      return;
    }

    const now = Date.now();
    let entry = this.health.get(key);

    if (!entry) {
      // Enforce maxTrackedKeys limit to prevent unbounded memory growth
      if (this.health.size >= this.maxTrackedKeys) {
        return; // Silently reject new keys when at capacity
      }
      entry = {
        failureTimestamps: [],
        circuitOpen: false,
        circuitOpenUntil: 0,
        halfOpenInProgress: false,
        halfOpenStartedAt: 0,
      };
      this.health.set(key, entry);
    }

    // If we were in half-open and the probe failed, re-open immediately
    if (entry.halfOpenInProgress) {
      entry.halfOpenInProgress = false;
      entry.circuitOpen = true;
      entry.circuitOpenUntil = now + this.circuitOpenDurationMs;
      this.onCircuitChange?.(key, 'open');
      return;
    }

    // Short-circuit: if circuit is already open (not half-open), no need
    // to track more failures. The circuit is already tripped.
    if (entry.circuitOpen && now < entry.circuitOpenUntil) {
      return;
    }

    // Add to sliding window, prune old entries
    entry.failureTimestamps.push(now);
    const windowStart = now - this.failureWindowMs;
    entry.failureTimestamps = entry.failureTimestamps.filter(t => t >= windowStart);

    // Cap the array to prevent O(N^2) degradation from rapid failure injection
    const maxTimestamps = this.failureThreshold * 2;
    if (entry.failureTimestamps.length > maxTimestamps) {
      entry.failureTimestamps = entry.failureTimestamps.slice(-maxTimestamps);
    }

    // Check threshold
    if (entry.failureTimestamps.length >= this.failureThreshold) {
      entry.circuitOpen = true;
      entry.circuitOpenUntil = now + this.circuitOpenDurationMs;
      this.onCircuitChange?.(key, 'open');
    }
  }

  /**
   * Record a success for a provider+model key.
   * If in half-open state, fully closes the circuit and resets failures.
   */
  recordSuccess(key: string): void {
    this.validateKey(key);
    const entry = this.health.get(key);
    if (!entry) return;

    const wasOpen = entry.circuitOpen;

    // If half-open probe succeeded, fully close circuit
    entry.halfOpenInProgress = false;
    entry.halfOpenStartedAt = 0;
    entry.circuitOpen = false;
    entry.circuitOpenUntil = 0;
    entry.failureTimestamps = [];

    if (wasOpen) {
      this.onCircuitChange?.(key, 'closed');
    }
  }

  /**
   * Returns a JSON-serializable Record (not Map) with health status for
   * all tracked provider+model keys within the current window.
   */
  getStatus(): Record<string, HealthStatusEntry> {
    const result: Record<string, HealthStatusEntry> = {};
    const now = Date.now();

    for (const [key, entry] of this.health) {
      const windowStart = now - this.failureWindowMs;
      const recentFailures = entry.failureTimestamps.filter(t => t >= windowStart).length;
      const isOpen = entry.circuitOpen && now < entry.circuitOpenUntil;

      result[key] = {
        healthy: !isOpen,
        failures: recentFailures,
        circuitOpen: isOpen,
      };
    }

    return result;
  }

  /** Delete health state for a single key. Useful for operational recovery. */
  reset(key: string): void {
    this.validateKey(key);
    this.health.delete(key);
  }

  /** Clear all health state. Useful for operational recovery and testing. */
  clear(): void {
    this.health.clear();
  }
}
