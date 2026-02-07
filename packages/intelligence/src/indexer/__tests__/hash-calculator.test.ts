/**
 * Tests for Hash Calculator
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHash,
  generateContentId,
  generateFileId,
  generateChunkId,
  hashesEqual,
  calculateFileHash,
} from '../metadata/hash-calculator.js';

describe('Hash Calculator', () => {
  describe('calculateHash', () => {
    it('should return a consistent hash for the same content', () => {
      const content = 'function hello() { return "world"; }';
      const hash1 = calculateHash(content);
      const hash2 = calculateHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different content', () => {
      const hash1 = calculateHash('function hello() {}');
      const hash2 = calculateHash('function world() {}');

      expect(hash1).not.toBe(hash2);
    });

    it('should return a 64-character hex string', () => {
      const hash = calculateHash('test content');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle empty strings', () => {
      const hash = calculateHash('');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle unicode content', () => {
      const hash = calculateHash('const emoji = "😀🎉";');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('generateContentId', () => {
    it('should generate an ID from content', () => {
      const content = 'function test() {}';
      const id = generateContentId(content);

      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should include prefix if provided', () => {
      const content = 'function test() {}';
      const id = generateContentId(content, 'chunk');

      expect(id).toMatch(/^chunk-[a-f0-9]{16}$/);
    });

    it('should generate consistent IDs', () => {
      const content = 'test content';
      const id1 = generateContentId(content);
      const id2 = generateContentId(content);

      expect(id1).toBe(id2);
    });
  });

  describe('generateFileId', () => {
    it('should generate a file ID from path', () => {
      const filePath = 'src/utils/helpers.ts';
      const id = generateFileId(filePath);

      expect(id).toMatch(/^file-[a-f0-9]{12}$/);
    });

    it('should generate consistent IDs for same path', () => {
      const filePath = 'src/index.ts';
      const id1 = generateFileId(filePath);
      const id2 = generateFileId(filePath);

      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different paths', () => {
      const id1 = generateFileId('src/a.ts');
      const id2 = generateFileId('src/b.ts');

      expect(id1).not.toBe(id2);
    });
  });

  describe('generateChunkId', () => {
    it('should generate a chunk ID', () => {
      const fileId = 'file-abc123';
      const chunkIndex = 0;
      const content = 'function test() {}';

      const id = generateChunkId(fileId, chunkIndex, content);

      expect(id).toMatch(/^file-abc123-chunk-0-[a-f0-9]{8}$/);
    });

    it('should include chunk index in ID', () => {
      const fileId = 'file-abc123';
      const content = 'function test() {}';

      const id0 = generateChunkId(fileId, 0, content);
      const id1 = generateChunkId(fileId, 1, content);

      expect(id0).toContain('-chunk-0-');
      expect(id1).toContain('-chunk-1-');
    });

    it('should include content hash in ID', () => {
      const fileId = 'file-abc123';
      const id1 = generateChunkId(fileId, 0, 'content A');
      const id2 = generateChunkId(fileId, 0, 'content B');

      // The last part (content hash) should differ
      expect(id1.split('-').pop()).not.toBe(id2.split('-').pop());
    });
  });

  describe('hashesEqual', () => {
    it('should return true for equal hashes', () => {
      const content = 'test content';
      const hash1 = calculateHash(content);
      const hash2 = calculateHash(content);

      expect(hashesEqual(hash1, hash2)).toBe(true);
    });

    it('should return false for different hashes', () => {
      const hash1 = calculateHash('content A');
      const hash2 = calculateHash('content B');

      expect(hashesEqual(hash1, hash2)).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(hashesEqual('abc', 'abcd')).toBe(false);
    });

    it('should handle non-hex strings gracefully', () => {
      expect(hashesEqual('not-hex', 'not-hex')).toBe(true);
      expect(hashesEqual('not-hex', 'different')).toBe(false);
    });
  });

  describe('calculateFileHash', () => {
    it('should combine file path and content in hash', () => {
      const content = 'function test() {}';
      const path1 = 'src/a.ts';
      const path2 = 'src/b.ts';

      const hash1 = calculateFileHash(content, path1);
      const hash2 = calculateFileHash(content, path2);

      // Same content, different paths should have different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('should be consistent for same inputs', () => {
      const content = 'test';
      const path = 'test.ts';

      const hash1 = calculateFileHash(content, path);
      const hash2 = calculateFileHash(content, path);

      expect(hash1).toBe(hash2);
    });
  });
});
