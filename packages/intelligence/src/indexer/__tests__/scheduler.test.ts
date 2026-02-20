/**
 * Tests for Scheduler Trigger
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Scheduler,
  createScheduler,
  parseInterval,
} from '../triggers/scheduler.js';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
    }
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      scheduler = new Scheduler();

      expect(scheduler.isRunning()).toBe(false);
      expect(scheduler.getIntervalMs()).toBe(30 * 60 * 1000);
      expect(scheduler.getLastRunAt()).toBeNull();
    });

    it('should accept custom interval', () => {
      scheduler = new Scheduler({ intervalMs: 5000 });

      expect(scheduler.getIntervalMs()).toBe(5000);
    });
  });

  describe('start/stop', () => {
    it('should start and stop', () => {
      scheduler = new Scheduler({ intervalMs: 60000 });
      const callback = vi.fn();

      scheduler.start(callback);
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      scheduler = new Scheduler({ intervalMs: 60000 });
      const callback = vi.fn();

      scheduler.start(callback);
      scheduler.start(callback); // No-op

      expect(scheduler.isRunning()).toBe(true);
      scheduler.stop();
    });

    it('should handle stop when not running', () => {
      scheduler = new Scheduler();

      // Should not throw
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('callback execution', () => {
    it('should execute callback at intervals', async () => {
      const callback = vi.fn();
      scheduler = new Scheduler({ intervalMs: 50 });

      scheduler.start(callback);

      // Wait for at least 2 intervals
      await new Promise((resolve) => setTimeout(resolve, 150));

      scheduler.stop();

      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should execute immediately when configured', () => {
      const callback = vi.fn();
      scheduler = new Scheduler({
        intervalMs: 60000,
        runImmediately: true,
      });

      scheduler.start(callback);

      // Should have been called once immediately
      expect(callback).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it('should not execute immediately by default', () => {
      const callback = vi.fn();
      scheduler = new Scheduler({ intervalMs: 60000 });

      scheduler.start(callback);

      // Should not have been called yet
      expect(callback).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('should track last run time', async () => {
      const callback = vi.fn();
      scheduler = new Scheduler({
        intervalMs: 50,
        runImmediately: true,
      });

      const before = new Date();
      scheduler.start(callback);

      expect(scheduler.getLastRunAt()).not.toBeNull();
      expect(scheduler.getLastRunAt()!.getTime()).toBeGreaterThanOrEqual(before.getTime());

      scheduler.stop();
    });

    it('should not call after stop', async () => {
      const callback = vi.fn();
      scheduler = new Scheduler({ intervalMs: 50 });

      scheduler.start(callback);
      scheduler.stop();

      callback.mockClear();

      // Wait to make sure no more calls happen
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle sync callback errors gracefully', async () => {
      const callback = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      scheduler = new Scheduler({ intervalMs: 50 });
      scheduler.start(callback);

      // Wait for a few intervals
      await new Promise((resolve) => setTimeout(resolve, 150));

      scheduler.stop();

      // Should have continued running despite errors
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle async callback errors gracefully', async () => {
      const callback = vi.fn().mockImplementation(async () => {
        throw new Error('async callback error');
      });

      scheduler = new Scheduler({ intervalMs: 50 });
      scheduler.start(callback);

      // Wait for a few intervals
      await new Promise((resolve) => setTimeout(resolve, 150));

      scheduler.stop();

      // Should have continued running despite errors
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('setIntervalMs', () => {
    it('should update the interval', () => {
      scheduler = new Scheduler({ intervalMs: 60000 });

      scheduler.setIntervalMs(5000);
      expect(scheduler.getIntervalMs()).toBe(5000);
    });

    it('should reject non-positive intervals', () => {
      scheduler = new Scheduler();

      expect(() => scheduler.setIntervalMs(0)).toThrow('positive');
      expect(() => scheduler.setIntervalMs(-1)).toThrow('positive');
    });

    it('should restart with new interval if running', async () => {
      const callback = vi.fn();
      scheduler = new Scheduler({ intervalMs: 100000 });

      scheduler.start(callback);
      expect(scheduler.isRunning()).toBe(true);

      scheduler.setIntervalMs(50);
      expect(scheduler.isRunning()).toBe(true);
      expect(scheduler.getIntervalMs()).toBe(50);

      // Wait for the shorter interval to fire
      await new Promise((resolve) => setTimeout(resolve, 150));

      scheduler.stop();

      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('createScheduler', () => {
  it('should create a scheduler instance', () => {
    const scheduler = createScheduler();
    expect(scheduler).toBeInstanceOf(Scheduler);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should accept config', () => {
    const scheduler = createScheduler({ intervalMs: 5000 });
    expect(scheduler.getIntervalMs()).toBe(5000);
  });
});

describe('parseInterval', () => {
  it('should parse minutes', () => {
    expect(parseInterval('30m')).toBe(30 * 60 * 1000);
  });

  it('should parse hours', () => {
    expect(parseInterval('2h')).toBe(2 * 60 * 60 * 1000);
  });

  it('should parse days', () => {
    expect(parseInterval('1d')).toBe(24 * 60 * 60 * 1000);
  });

  it('should parse seconds', () => {
    expect(parseInterval('60s')).toBe(60 * 1000);
  });

  it('should parse combined formats', () => {
    expect(parseInterval('2h30m')).toBe(2 * 60 * 60 * 1000 + 30 * 60 * 1000);
  });

  it('should parse full combined format', () => {
    expect(parseInterval('1d2h30m15s')).toBe(
      24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000 + 30 * 60 * 1000 + 15 * 1000,
    );
  });

  it('should handle whitespace', () => {
    expect(parseInterval('  30m  ')).toBe(30 * 60 * 1000);
  });

  it('should throw on invalid format', () => {
    expect(() => parseInterval('invalid')).toThrow('Invalid interval format');
    expect(() => parseInterval('')).toThrow('Invalid interval format');
    expect(() => parseInterval('abc')).toThrow('Invalid interval format');
  });
});
