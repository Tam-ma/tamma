/**
 * Tests for Token Counter
 */

import { describe, it, expect } from 'vitest';
import {
  TokenCounter,
  estimateTokens,
  estimateTokensSimple,
  estimateTokensApproximate,
} from '../metadata/token-counter.js';

describe('Token Counter', () => {
  describe('estimateTokensSimple', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokensSimple('')).toBe(0);
    });

    it('should count short words as 1 token', () => {
      const tokens = estimateTokensSimple('the cat sat');
      expect(tokens).toBe(3);
    });

    it('should count longer words as multiple tokens', () => {
      const tokens = estimateTokensSimple('internationalization');
      expect(tokens).toBeGreaterThan(1);
    });

    it('should handle code-like content', () => {
      const code = 'function hello() { return "world"; }';
      const tokens = estimateTokensSimple(code);

      // Should be reasonable for this short function
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(20);
    });
  });

  describe('estimateTokensApproximate', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokensApproximate('')).toBe(0);
    });

    it('should count newlines as tokens', () => {
      const tokens = estimateTokensApproximate('line1\nline2\nline3');
      expect(tokens).toBeGreaterThanOrEqual(5); // words + newlines
    });

    it('should count numbers appropriately', () => {
      const tokens = estimateTokensApproximate('const x = 12345;');
      expect(tokens).toBeGreaterThan(3);
    });

    it('should handle punctuation', () => {
      const tokens = estimateTokensApproximate('a, b, c');
      expect(tokens).toBeGreaterThan(3); // includes commas
    });

    it('should handle camelCase', () => {
      const tokens = estimateTokensApproximate('getUserById');
      // CamelCase should be split into subwords
      expect(tokens).toBeGreaterThanOrEqual(3);
    });

    it('should handle snake_case', () => {
      const tokens = estimateTokensApproximate('get_user_by_id');
      expect(tokens).toBeGreaterThanOrEqual(4);
    });
  });

  describe('estimateTokens', () => {
    it('should use approximate method by default', () => {
      const content = 'function test() {}';
      const approxTokens = estimateTokensApproximate(content);
      const defaultTokens = estimateTokens(content);

      expect(defaultTokens).toBe(approxTokens);
    });
  });

  describe('TokenCounter class', () => {
    it('should count tokens with default method', () => {
      const counter = new TokenCounter();
      const tokens = counter.count('hello world');

      expect(tokens).toBeGreaterThan(0);
    });

    it('should support simple method', () => {
      const counter = new TokenCounter('simple');
      const tokens = counter.count('hello world');

      expect(tokens).toBe(estimateTokensSimple('hello world'));
    });

    it('should support approximate method', () => {
      const counter = new TokenCounter('approximate');
      const tokens = counter.count('hello world');

      expect(tokens).toBe(estimateTokensApproximate('hello world'));
    });

    describe('exceedsLimit', () => {
      it('should return false when under limit', () => {
        const counter = new TokenCounter();
        expect(counter.exceedsLimit('hello', 100)).toBe(false);
      });

      it('should return true when over limit', () => {
        const counter = new TokenCounter();
        const longText = 'word '.repeat(1000);
        expect(counter.exceedsLimit(longText, 10)).toBe(true);
      });
    });

    describe('truncateToLimit', () => {
      it('should not truncate text under limit', () => {
        const counter = new TokenCounter();
        const text = 'short text';
        const truncated = counter.truncateToLimit(text, 100);

        expect(truncated).toBe(text);
      });

      it('should truncate text over limit', () => {
        const counter = new TokenCounter();
        const text = 'word '.repeat(100);
        const truncated = counter.truncateToLimit(text, 10);

        expect(counter.count(truncated)).toBeLessThanOrEqual(10);
        expect(truncated.length).toBeLessThan(text.length);
      });

      it('should maintain valid content after truncation', () => {
        const counter = new TokenCounter();
        const text = 'This is a longer sentence that needs to be truncated to fit within a limit.';
        const truncated = counter.truncateToLimit(text, 5);

        // Should be a prefix of the original
        expect(text.startsWith(truncated)).toBe(true);
      });
    });
  });

  describe('realistic code examples', () => {
    it('should estimate tokens for a TypeScript function', () => {
      const code = `
async function fetchUserData(userId: string): Promise<User> {
  const response = await fetch(\`/api/users/\${userId}\`);
  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }
  return response.json();
}
`;
      const tokens = estimateTokens(code);

      // This function should be approximately 50-80 tokens
      expect(tokens).toBeGreaterThan(30);
      expect(tokens).toBeLessThan(150);
    });

    it('should estimate tokens for a class', () => {
      const code = `
export class UserService {
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async getUser(id: string): Promise<User> {
    return this.apiClient.get(\`/users/\${id}\`);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return this.apiClient.patch(\`/users/\${id}\`, data);
  }
}
`;
      const tokens = estimateTokens(code);

      // This class should be approximately 80-150 tokens
      expect(tokens).toBeGreaterThan(50);
      expect(tokens).toBeLessThan(250);
    });

    it('should estimate tokens for imports', () => {
      const imports = `
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { User, UserCreateInput } from './types';
`;
      const tokens = estimateTokens(imports);

      // Import statements should be approximately 30-50 tokens
      expect(tokens).toBeGreaterThan(20);
      expect(tokens).toBeLessThan(100);
    });
  });
});
