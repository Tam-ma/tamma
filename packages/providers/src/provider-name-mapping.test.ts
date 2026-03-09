/**
 * Provider Name Mapping Unit Tests
 *
 * Tests the mapProviderName() utility that safely maps provider name
 * strings to the Provider type. Covers:
 * - All known provider names return themselves
 * - Unknown provider names return the default ('claude-code')
 * - undefined input returns the default
 * - Empty string returns the default
 * - Case sensitivity (uppercase not recognized)
 */

import { describe, it, expect } from 'vitest';
import type { Provider } from '@tamma/cost-monitor';
import { mapProviderName } from './provider-name-mapping.js';

describe('mapProviderName', () => {
  describe('known providers', () => {
    it('should return "anthropic" for "anthropic"', () => {
      expect(mapProviderName('anthropic')).toBe('anthropic');
    });

    it('should return "openai" for "openai"', () => {
      expect(mapProviderName('openai')).toBe('openai');
    });

    it('should return "openrouter" for "openrouter"', () => {
      expect(mapProviderName('openrouter')).toBe('openrouter');
    });

    it('should return "google" for "google"', () => {
      expect(mapProviderName('google')).toBe('google');
    });

    it('should return "local" for "local"', () => {
      expect(mapProviderName('local')).toBe('local');
    });

    it('should return "claude-code" for "claude-code"', () => {
      expect(mapProviderName('claude-code')).toBe('claude-code');
    });

    it('should return "opencode" for "opencode"', () => {
      expect(mapProviderName('opencode')).toBe('opencode');
    });

    it('should return "z-ai" for "z-ai"', () => {
      expect(mapProviderName('z-ai')).toBe('z-ai');
    });

    it('should return "zen-mcp" for "zen-mcp"', () => {
      expect(mapProviderName('zen-mcp')).toBe('zen-mcp');
    });
  });

  describe('unknown and invalid inputs', () => {
    it('should return "claude-code" for unknown provider name', () => {
      expect(mapProviderName('unknown-provider')).toBe('claude-code');
    });

    it('should return "claude-code" for undefined', () => {
      expect(mapProviderName(undefined)).toBe('claude-code');
    });

    it('should return "claude-code" for empty string', () => {
      expect(mapProviderName('')).toBe('claude-code');
    });

    it('should return "claude-code" for uppercase (case-sensitive)', () => {
      expect(mapProviderName('ANTHROPIC')).toBe('claude-code');
    });

    it('should return "claude-code" for mixed case', () => {
      expect(mapProviderName('OpenAI')).toBe('claude-code');
    });

    it('should return "claude-code" for provider name with extra whitespace', () => {
      expect(mapProviderName(' anthropic ')).toBe('claude-code');
    });
  });

  describe('type safety', () => {
    it('should return a value assignable to Provider type', () => {
      const result: Provider = mapProviderName('anthropic');
      expect(result).toBe('anthropic');
    });

    it('should return a value assignable to Provider type for unknown input', () => {
      const result: Provider = mapProviderName('xyz');
      expect(result).toBe('claude-code');
    });
  });
});
