/**
 * Unit tests for sanitizeErrorMessage() utility.
 *
 * Tests cover:
 * - Bearer token stripping
 * - sk-* key pattern stripping
 * - key-* pattern stripping
 * - Long alphanumeric string stripping
 * - Message truncation at 500 chars with '...' suffix
 * - Clean messages left unchanged
 * - Empty string handling
 * - Multiple key patterns in a single message
 */

import { describe, it, expect } from 'vitest';
import { sanitizeErrorMessage, MAX_ERROR_MESSAGE_LENGTH } from './sanitize-error.js';

describe('sanitizeErrorMessage', () => {
  it('strips Bearer tokens from error messages', () => {
    const message = 'Auth failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw token';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('strips sk-* keys from error messages', () => {
    const message = 'Invalid API key: sk-abcdefghij1234567890abcdefghij was rejected';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).not.toContain('sk-abcdefghij1234567890abcdefghij');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('strips key-* patterns from error messages', () => {
    const message = 'API error with key-abc123def456ghi789jkl012mno: unauthorized';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).not.toContain('key-abc123def456ghi789jkl012mno');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('strips long alphanumeric strings (potential keys)', () => {
    const longKey = 'a'.repeat(40);
    const message = `Failed to authenticate with token ${longKey} on server`;
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).not.toContain(longKey);
    expect(sanitized).toContain('[REDACTED]');
  });

  it('truncates messages over 500 chars with "..." suffix', () => {
    const longMessage = 'x'.repeat(600);
    const sanitized = sanitizeErrorMessage(longMessage);
    // After redaction of the 600-char run, the message gets replaced with [REDACTED]
    // which is shorter. Let's use a message that won't be caught by the long-alpha pattern.
    const mixedMessage = 'Error: '.repeat(100); // 700 chars, short repeated words
    const result = sanitizeErrorMessage(mixedMessage);
    expect(result.length).toBeLessThanOrEqual(MAX_ERROR_MESSAGE_LENGTH + 3); // +3 for '...'
  });

  it('truncates a long message that has no key patterns', () => {
    // Use characters that won't match any key pattern (mix of lowercase and spaces)
    const longMessage = 'error occurred at step '.repeat(30); // ~690 chars
    const sanitized = sanitizeErrorMessage(longMessage);
    expect(sanitized.length).toBe(MAX_ERROR_MESSAGE_LENGTH + 3); // 500 + '...'
    expect(sanitized.endsWith('...')).toBe(true);
  });

  it('leaves clean short messages unchanged', () => {
    const message = 'Connection refused on port 8080';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).toBe(message);
  });

  it('handles empty string', () => {
    const sanitized = sanitizeErrorMessage('');
    expect(sanitized).toBe('');
  });

  it('handles message with multiple key patterns', () => {
    const message =
      'Auth error: Bearer tok123abc tried sk-longkey01234567890123 and key-another01234567890123';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).not.toContain('tok123abc');
    expect(sanitized).not.toContain('sk-longkey01234567890123');
    expect(sanitized).not.toContain('key-another01234567890123');
    // Should have multiple [REDACTED] markers
    const redactedCount = (sanitized.match(/\[REDACTED\]/g) ?? []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(2);
  });

  it('preserves message structure around redacted tokens', () => {
    const message = 'Provider "anthropic" rejected request with Bearer abc123def456ghi789jkl012';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).toContain('Provider "anthropic" rejected request with');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('handles message at exactly MAX_ERROR_MESSAGE_LENGTH', () => {
    // Use non-alphanumeric chars so no key patterns match
    const exactMessage = 'e '.repeat(250); // exactly 500 chars
    expect(exactMessage.length).toBe(500);
    const sanitized = sanitizeErrorMessage(exactMessage);
    expect(sanitized).toBe(exactMessage);
    expect(sanitized.endsWith('...')).toBe(false);
  });

  it('MAX_ERROR_MESSAGE_LENGTH is 500', () => {
    expect(MAX_ERROR_MESSAGE_LENGTH).toBe(500);
  });
});
