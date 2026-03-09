/**
 * Unit tests for validate-diagnostics.ts value validation utilities.
 *
 * Tests cover:
 * - validateCostUsd: undefined passthrough, negative clamping, positive passthrough
 * - validateTokenCount: negative clamping, in-range passthrough, over-max clamping
 * - validateErrorCode: undefined passthrough, short string passthrough, long string truncation
 */

import { describe, it, expect } from 'vitest';
import {
  validateCostUsd,
  validateTokenCount,
  validateErrorCode,
  MAX_TOKEN_COUNT,
  MAX_ERROR_CODE_LENGTH,
} from './validate-diagnostics.js';

describe('validateCostUsd', () => {
  it('returns undefined when value is undefined', () => {
    expect(validateCostUsd(undefined)).toBeUndefined();
  });

  it('returns 0 when value is negative', () => {
    expect(validateCostUsd(-1)).toBe(0);
    expect(validateCostUsd(-0.5)).toBe(0);
    expect(validateCostUsd(-100)).toBe(0);
  });

  it('returns the value when it is zero', () => {
    expect(validateCostUsd(0)).toBe(0);
  });

  it('returns the value when it is positive', () => {
    expect(validateCostUsd(5.5)).toBe(5.5);
    expect(validateCostUsd(0.001)).toBe(0.001);
    expect(validateCostUsd(100)).toBe(100);
  });
});

describe('validateTokenCount', () => {
  it('returns 0 when value is negative', () => {
    expect(validateTokenCount(-1)).toBe(0);
    expect(validateTokenCount(-1000)).toBe(0);
  });

  it('returns the value when it is zero', () => {
    expect(validateTokenCount(0)).toBe(0);
  });

  it('returns the value when it is within range', () => {
    expect(validateTokenCount(5000)).toBe(5000);
    expect(validateTokenCount(1)).toBe(1);
    expect(validateTokenCount(MAX_TOKEN_COUNT)).toBe(MAX_TOKEN_COUNT);
  });

  it('clamps to MAX_TOKEN_COUNT when value exceeds maximum', () => {
    expect(validateTokenCount(20_000_000)).toBe(MAX_TOKEN_COUNT);
    expect(validateTokenCount(MAX_TOKEN_COUNT + 1)).toBe(MAX_TOKEN_COUNT);
  });

  it('MAX_TOKEN_COUNT is 10_000_000', () => {
    expect(MAX_TOKEN_COUNT).toBe(10_000_000);
  });
});

describe('validateErrorCode', () => {
  it('returns undefined when value is undefined', () => {
    expect(validateErrorCode(undefined)).toBeUndefined();
  });

  it('returns the value when it is short', () => {
    expect(validateErrorCode('SHORT')).toBe('SHORT');
    expect(validateErrorCode('RATE_LIMIT_EXCEEDED')).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('returns the value when it is exactly MAX_ERROR_CODE_LENGTH', () => {
    const exact = 'a'.repeat(MAX_ERROR_CODE_LENGTH);
    expect(validateErrorCode(exact)).toBe(exact);
  });

  it('truncates values exceeding MAX_ERROR_CODE_LENGTH', () => {
    const longCode = 'x'.repeat(200);
    const result = validateErrorCode(longCode);
    expect(result).toHaveLength(MAX_ERROR_CODE_LENGTH);
    expect(result).toBe('x'.repeat(MAX_ERROR_CODE_LENGTH));
  });

  it('returns empty string unchanged', () => {
    expect(validateErrorCode('')).toBe('');
  });

  it('MAX_ERROR_CODE_LENGTH is 100', () => {
    expect(MAX_ERROR_CODE_LENGTH).toBe(100);
  });
});
