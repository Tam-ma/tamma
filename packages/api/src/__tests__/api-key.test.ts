/**
 * API Key Utility Tests
 *
 * Tests for key generation, hashing, and prefix extraction.
 */

import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, getApiKeyPrefix } from '../auth/api-key.js';

describe('generateApiKey', () => {
  it('generates a key starting with tamma_sk_ prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('tamma_sk_')).toBe(true);
  });

  it('generates keys with sufficient length', () => {
    const key = generateApiKey();
    // tamma_sk_ is 9 chars, 32 random bytes base64url is ~43 chars
    expect(key.length).toBeGreaterThan(40);
  });

  it('generates unique keys each time', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateApiKey());
    }
    expect(keys.size).toBe(100);
  });

  it('generates keys using only base64url-safe characters after prefix', () => {
    const key = generateApiKey();
    const randomPart = key.slice('tamma_sk_'.length);
    // base64url uses A-Z, a-z, 0-9, -, _
    expect(randomPart).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashApiKey', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for the same key', () => {
    const key = generateApiKey();
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(hashApiKey(key1)).not.toBe(hashApiKey(key2));
  });
});

describe('getApiKeyPrefix', () => {
  it('returns the first 12 characters of the key', () => {
    const key = generateApiKey();
    const prefix = getApiKeyPrefix(key);
    expect(prefix.length).toBe(12);
    expect(key.startsWith(prefix)).toBe(true);
  });

  it('starts with tamma_sk_ (within the 12-char window)', () => {
    const key = generateApiKey();
    const prefix = getApiKeyPrefix(key);
    expect(prefix.startsWith('tamma_sk_')).toBe(true);
  });
});
