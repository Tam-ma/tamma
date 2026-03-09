/**
 * Unit tests for bridge wiring utilities: truncateArgs() and redactSensitiveKeys().
 *
 * Tests cover:
 * - redactSensitiveKeys: redaction of known sensitive keys (password, token, apiKey, secret, authorization)
 * - redactSensitiveKeys: case-insensitive key matching
 * - redactSensitiveKeys: non-sensitive keys are left unchanged
 * - redactSensitiveKeys: does not mutate input
 * - redactSensitiveKeys: custom sensitive key list
 * - redactSensitiveKeys: empty args
 * - truncateArgs: args within limit returned as-is
 * - truncateArgs: args exceeding limit returned as truncation marker
 * - truncateArgs: circular reference handling
 * - truncateArgs: custom maxSize parameter
 * - truncateArgs: empty args
 */

import { describe, it, expect } from 'vitest';
import {
  truncateArgs,
  redactSensitiveKeys,
  MAX_DIAGNOSTICS_ARG_SIZE,
  DEFAULT_SENSITIVE_KEYS,
} from './utils.js';

// --- redactSensitiveKeys tests ---

describe('redactSensitiveKeys', () => {
  it('redacts "password" key', () => {
    const args = { password: 'my-secret-pass', user: 'admin' };
    const result = redactSensitiveKeys(args);

    expect(result['password']).toBe('[REDACTED]');
    expect(result['user']).toBe('admin');
  });

  it('redacts "token" key', () => {
    const args = { token: 'abc123', action: 'deploy' };
    const result = redactSensitiveKeys(args);

    expect(result['token']).toBe('[REDACTED]');
    expect(result['action']).toBe('deploy');
  });

  it('redacts "apiKey" key', () => {
    const args = { apiKey: 'sk-1234567890', endpoint: 'https://api.example.com' };
    const result = redactSensitiveKeys(args);

    expect(result['apiKey']).toBe('[REDACTED]');
    expect(result['endpoint']).toBe('https://api.example.com');
  });

  it('redacts "secret" key', () => {
    const args = { secret: 'top-secret-value', name: 'test' };
    const result = redactSensitiveKeys(args);

    expect(result['secret']).toBe('[REDACTED]');
    expect(result['name']).toBe('test');
  });

  it('redacts "authorization" key', () => {
    const args = { authorization: 'Bearer eyJhbGci...', url: '/api/data' };
    const result = redactSensitiveKeys(args);

    expect(result['authorization']).toBe('[REDACTED]');
    expect(result['url']).toBe('/api/data');
  });

  it('redacts multiple sensitive keys at once', () => {
    const args = {
      password: 'pass123',
      token: 'tok456',
      apiKey: 'key789',
      name: 'safe',
    };
    const result = redactSensitiveKeys(args);

    expect(result['password']).toBe('[REDACTED]');
    expect(result['token']).toBe('[REDACTED]');
    expect(result['apiKey']).toBe('[REDACTED]');
    expect(result['name']).toBe('safe');
  });

  it('performs case-insensitive matching', () => {
    const args = {
      PASSWORD: 'secret',
      Token: 'abc',
      APIKEY: 'key',
      Authorization: 'Bearer xxx',
      SECRET: 'shh',
    };
    const result = redactSensitiveKeys(args);

    expect(result['PASSWORD']).toBe('[REDACTED]');
    expect(result['Token']).toBe('[REDACTED]');
    expect(result['APIKEY']).toBe('[REDACTED]');
    expect(result['Authorization']).toBe('[REDACTED]');
    expect(result['SECRET']).toBe('[REDACTED]');
  });

  it('leaves non-sensitive keys unchanged', () => {
    const args = {
      url: 'https://example.com',
      method: 'POST',
      body: '{ "data": 1 }',
      count: 42,
      enabled: true,
    };
    const result = redactSensitiveKeys(args);

    expect(result).toEqual(args);
  });

  it('does not mutate the input object', () => {
    const original = { password: 'secret', name: 'test' };
    const originalCopy = { ...original };

    redactSensitiveKeys(original);

    expect(original).toEqual(originalCopy);
  });

  it('returns a new object (not the same reference)', () => {
    const args = { url: 'https://example.com' };
    const result = redactSensitiveKeys(args);

    expect(result).not.toBe(args);
    expect(result).toEqual(args);
  });

  it('handles empty args object', () => {
    const result = redactSensitiveKeys({});
    expect(result).toEqual({});
  });

  it('accepts custom sensitive key list', () => {
    const args = {
      customSecret: 'hidden',
      myKey: 'visible',
    };
    const result = redactSensitiveKeys(args, ['customSecret']);

    expect(result['customSecret']).toBe('[REDACTED]');
    expect(result['myKey']).toBe('visible');
  });

  it('custom key list overrides defaults', () => {
    const args = {
      password: 'should-be-visible',
      customField: 'should-be-redacted',
    };
    // Only 'customField' in the list -- 'password' is NOT redacted
    const result = redactSensitiveKeys(args, ['customField']);

    expect(result['password']).toBe('should-be-visible');
    expect(result['customField']).toBe('[REDACTED]');
  });

  it('handles non-string values for sensitive keys', () => {
    const args = {
      token: 12345,
      secret: { nested: true },
      password: ['array', 'value'],
    };
    const result = redactSensitiveKeys(args);

    // All sensitive keys should be redacted regardless of value type
    expect(result['token']).toBe('[REDACTED]');
    expect(result['secret']).toBe('[REDACTED]');
    expect(result['password']).toBe('[REDACTED]');
  });

  it('DEFAULT_SENSITIVE_KEYS includes all 5 required keys', () => {
    expect(DEFAULT_SENSITIVE_KEYS).toContain('password');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('token');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('apiKey');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('secret');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('authorization');
    expect(DEFAULT_SENSITIVE_KEYS).toHaveLength(5);
  });
});

// --- truncateArgs tests ---

describe('truncateArgs', () => {
  it('returns original args when within size limit', () => {
    const args = { key: 'value', num: 42 };
    const result = truncateArgs(args);

    // Same reference since no truncation needed
    expect(result).toBe(args);
  });

  it('returns truncation marker when args exceed size limit', () => {
    // Create args that exceed 10KB
    const largeValue = 'x'.repeat(15_000);
    const args = { data: largeValue };
    const result = truncateArgs(args);

    expect(result).not.toBe(args);
    expect(result['_truncated']).toBe(true);
    expect(typeof result['_originalSize']).toBe('number');
    expect(result['_maxSize']).toBe(MAX_DIAGNOSTICS_ARG_SIZE);
    // _preview removed for security (could leak sensitive data from args)
    expect(result['_preview']).toBeUndefined();
  });

  it('respects custom maxSize parameter', () => {
    const args = { data: 'x'.repeat(100) };

    // With a very small limit
    const result = truncateArgs(args, 50);
    expect(result['_truncated']).toBe(true);
    expect(result['_maxSize']).toBe(50);
  });

  it('allows args exactly at the size limit', () => {
    // Need to find a string size that results in JSON.stringify exactly at a limit
    const customLimit = 50;
    // {"a":"b"} is 9 chars, so we need something that hits exactly 50
    const shortArgs = { d: 'x'.repeat(42) }; // {"d":"xxx..."} = 8 + 42 = 50
    const serialized = JSON.stringify(shortArgs);
    expect(serialized.length).toBe(50);

    const result = truncateArgs(shortArgs, customLimit);
    // Should NOT truncate at exactly the limit
    expect(result).toBe(shortArgs);
  });

  it('handles empty args object', () => {
    const args = {};
    const result = truncateArgs(args);
    expect(result).toBe(args); // {} is 2 chars, well within limit
  });

  it('handles circular reference gracefully', () => {
    const args: Record<string, unknown> = { key: 'value' };
    args['self'] = args; // circular reference

    const result = truncateArgs(args);

    expect(result['_truncated']).toBe(true);
    expect(result['_reason']).toBe('serialization_failed');
  });

  it('MAX_DIAGNOSTICS_ARG_SIZE is 10240 (10KB)', () => {
    expect(MAX_DIAGNOSTICS_ARG_SIZE).toBe(10_240);
  });

  it('truncation marker does not include _preview (security: prevents leaking sensitive data)', () => {
    const largeArgs = { data: 'y'.repeat(20_000) };
    const result = truncateArgs(largeArgs, 100);

    expect(result['_truncated']).toBe(true);
    expect(result['_preview']).toBeUndefined();
  });

  it('preserves original args when under limit (nested objects)', () => {
    const args = {
      config: { nested: { deep: 'value' } },
      items: [1, 2, 3],
      name: 'test',
    };
    const result = truncateArgs(args);
    expect(result).toBe(args);
  });

  it('reports correct originalSize in truncation marker', () => {
    const data = 'z'.repeat(15_000);
    const args = { data };
    const expectedSize = JSON.stringify(args).length;

    const result = truncateArgs(args, 100);
    expect(result['_originalSize']).toBe(expectedSize);
  });
});
