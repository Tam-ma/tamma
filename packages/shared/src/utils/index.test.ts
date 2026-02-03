import { describe, it, expect } from 'vitest';
import { sleep, slugify, extractIssueReferences } from './index.js';

describe('Utility Functions', () => {
  describe('sleep', () => {
    it('should resolve after the specified delay', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe('slugify', () => {
    it('should convert text to lowercase', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should replace non-alphanumeric characters with hyphens', () => {
      expect(slugify('fix: bug in auth!')).toBe('fix-bug-in-auth');
    });

    it('should collapse multiple hyphens', () => {
      expect(slugify('hello---world')).toBe('hello-world');
    });

    it('should trim leading and trailing hyphens', () => {
      expect(slugify('--hello--')).toBe('hello');
    });

    it('should limit to 50 characters', () => {
      const long = 'a'.repeat(60);
      expect(slugify(long).length).toBeLessThanOrEqual(50);
    });

    it('should not end with a trailing hyphen after truncation', () => {
      const text = 'a'.repeat(45) + ' bbbbbbbbbb';
      const result = slugify(text);
      expect(result.endsWith('-')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('should handle special characters only', () => {
      expect(slugify('!!@@##')).toBe('');
    });
  });

  describe('extractIssueReferences', () => {
    it('should extract single issue reference', () => {
      expect(extractIssueReferences('Fixes #42')).toEqual([42]);
    });

    it('should extract multiple issue references', () => {
      const result = extractIssueReferences('Related to #10 and #20');
      expect(result).toEqual([10, 20]);
    });

    it('should return unique references', () => {
      const result = extractIssueReferences('#5 is related to #5');
      expect(result).toEqual([5]);
    });

    it('should return empty array when no references found', () => {
      expect(extractIssueReferences('No issues here')).toEqual([]);
    });

    it('should handle references in different contexts', () => {
      const text = 'Closes #1\nSee also #2, #3\nDuplicate of #4';
      const result = extractIssueReferences(text);
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it('should ignore #0', () => {
      expect(extractIssueReferences('#0')).toEqual([]);
    });
  });
});
