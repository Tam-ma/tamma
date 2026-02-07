/**
 * Tests for Context Assembler
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextAssembler, createContextAssembler } from '../assembler.js';
import type { RetrievedChunk, AssemblyConfig } from '../types.js';

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;
  let defaultConfig: AssemblyConfig;

  beforeEach(() => {
    assembler = createContextAssembler();
    defaultConfig = {
      maxTokens: 1000,
      format: 'xml',
      includeScores: false,
      deduplicationThreshold: 0.85,
    };
  });

  const createChunk = (
    id: string,
    content: string,
    metadata: Partial<RetrievedChunk['metadata']> = {}
  ): RetrievedChunk => ({
    id,
    content,
    source: 'vector_db',
    score: 0.9,
    fusedScore: 0.9,
    metadata: {
      filePath: 'src/test.ts',
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      ...metadata,
    },
  });

  describe('assemble', () => {
    it('should assemble chunks into context', () => {
      const chunks = [
        createChunk('c1', 'function hello() {}'),
        createChunk('c2', 'function world() {}'),
      ];

      const result = assembler.assemble(chunks, defaultConfig);

      expect(result.chunks).toHaveLength(2);
      expect(result.text).toContain('hello');
      expect(result.text).toContain('world');
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(result.truncated).toBe(false);
    });

    it('should respect token budget', () => {
      const longContent = 'x '.repeat(500); // Many tokens
      const chunks = [
        createChunk('c1', longContent),
        createChunk('c2', longContent),
        createChunk('c3', longContent),
      ];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        maxTokens: 200,
      });

      expect(result.tokenCount).toBeLessThanOrEqual(200);
      expect(result.truncated).toBe(true);
      expect(result.chunks.length).toBeLessThan(3);
    });

    it('should handle empty input', () => {
      const result = assembler.assemble([], defaultConfig);

      expect(result.chunks).toHaveLength(0);
      expect(result.text).toBe('');
      expect(result.tokenCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('should truncate content when at token limit', () => {
      const longContent = 'word '.repeat(200);
      const chunks = [createChunk('c1', longContent)];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        maxTokens: 50,
      });

      expect(result.text).toContain('truncated');
    });
  });

  describe('format: xml', () => {
    it('should format as XML', () => {
      const chunks = [createChunk('c1', 'const x = 1;')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'xml',
      });

      expect(result.text).toContain('<retrieved_context>');
      expect(result.text).toContain('</retrieved_context>');
      expect(result.text).toContain('<chunk');
      expect(result.text).toContain('<content>');
      expect(result.text).toContain('<location>');
    });

    it('should include source attribute', () => {
      const chunks = [createChunk('c1', 'const x = 1;')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'xml',
      });

      expect(result.text).toContain('source="vector_db"');
    });

    it('should include scores when enabled', () => {
      const chunks = [createChunk('c1', 'const x = 1;')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'xml',
        includeScores: true,
      });

      expect(result.text).toContain('score="');
    });

    it('should escape XML special characters', () => {
      const chunks = [createChunk('c1', 'if (x < 10 && y > 5) {}')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'xml',
      });

      expect(result.text).toContain('&lt;');
      expect(result.text).toContain('&gt;');
      expect(result.text).toContain('&amp;');
    });
  });

  describe('format: markdown', () => {
    it('should format as Markdown', () => {
      const chunks = [createChunk('c1', 'const x = 1;')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'markdown',
      });

      expect(result.text).toContain('###');
      expect(result.text).toContain('```typescript');
      expect(result.text).toContain('```');
    });

    it('should include file path in header', () => {
      const chunks = [createChunk('c1', 'const x = 1;', { filePath: 'src/test.ts' })];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'markdown',
      });

      expect(result.text).toContain('src/test.ts');
    });

    it('should separate chunks with dividers', () => {
      const chunks = [
        createChunk('c1', 'first'),
        createChunk('c2', 'second'),
      ];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'markdown',
      });

      expect(result.text).toContain('---');
    });
  });

  describe('format: json', () => {
    it('should format as JSON', () => {
      const chunks = [createChunk('c1', 'const x = 1;')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'json',
      });

      const parsed = JSON.parse(result.text);
      expect(parsed.context).toBeDefined();
      expect(parsed.context).toHaveLength(1);
      expect(parsed.context[0].content).toBe('const x = 1;');
    });

    it('should include metadata', () => {
      const chunks = [createChunk('c1', 'const x = 1;', { language: 'typescript' })];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'json',
      });

      const parsed = JSON.parse(result.text);
      expect(parsed.context[0].metadata.language).toBe('typescript');
    });
  });

  describe('format: plain', () => {
    it('should format as plain text', () => {
      const chunks = [createChunk('c1', 'const x = 1;')];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'plain',
      });

      expect(result.text).toContain('//');
      expect(result.text).toContain('const x = 1;');
    });

    it('should separate chunks with dividers', () => {
      const chunks = [
        createChunk('c1', 'first'),
        createChunk('c2', 'second'),
      ];

      const result = assembler.assemble(chunks, {
        ...defaultConfig,
        format: 'plain',
      });

      expect(result.text).toContain('---');
    });
  });

  describe('countTokens', () => {
    it('should estimate token count', () => {
      const count = assembler.countTokens('Hello world');

      expect(count).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
      const count = assembler.countTokens('');

      expect(count).toBe(0);
    });

    it('should scale with content length', () => {
      const short = assembler.countTokens('Hello');
      const long = assembler.countTokens('Hello '.repeat(100));

      expect(long).toBeGreaterThan(short);
    });
  });

  describe('location formatting', () => {
    it('should format file path with line numbers', () => {
      const chunks = [
        createChunk('c1', 'code', {
          filePath: 'src/test.ts',
          startLine: 10,
          endLine: 20,
        }),
      ];

      const result = assembler.assemble(chunks, defaultConfig);

      expect(result.text).toContain('src/test.ts:10-20');
    });

    it('should format URL with title', () => {
      const chunks = [
        createChunk('c1', 'code', {
          filePath: undefined,
          url: 'https://example.com/docs',
          title: 'Documentation',
        }),
      ];

      const result = assembler.assemble(chunks, defaultConfig);

      expect(result.text).toContain('Documentation');
      expect(result.text).toContain('https://example.com/docs');
    });

    it('should fall back to source:id', () => {
      const chunks = [
        createChunk('c1', 'code', {
          filePath: undefined,
        }),
      ];

      const result = assembler.assemble(chunks, defaultConfig);

      expect(result.text).toContain('vector_db:c1');
    });
  });
});
