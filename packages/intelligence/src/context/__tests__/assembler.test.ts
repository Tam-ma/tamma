import { describe, it, expect } from 'vitest';
import { ContextAssemblerAgg, createContextAssemblerAgg } from '../assembler.js';
import type { ContextChunk, ContextOptions } from '../types.js';

const makeChunk = (id: string, content: string, meta: Partial<ContextChunk['metadata']> = {}): ContextChunk => ({
  id,
  content,
  source: 'vector_db',
  relevance: 0.9,
  metadata: { filePath: 'src/test.ts', startLine: 1, endLine: 10, language: 'typescript', ...meta },
});

describe('ContextAssemblerAgg', () => {
  const assembler = createContextAssemblerAgg();

  describe('createContextAssemblerAgg', () => {
    it('should create an instance via factory', () => {
      expect(createContextAssemblerAgg()).toBeInstanceOf(ContextAssemblerAgg);
    });
  });

  describe('assemble', () => {
    it('should return empty context for no chunks', () => {
      const result = assembler.assemble([], 1000, {});
      expect(result.text).toBe('');
      expect(result.chunks).toHaveLength(0);
      expect(result.tokenCount).toBe(0);
    });

    it('should assemble chunks in XML format by default', () => {
      const chunks = [makeChunk('c1', 'const x = 1;')];
      const result = assembler.assemble(chunks, 10000, {});
      expect(result.format).toBe('xml');
      expect(result.text).toContain('<retrieved_context>');
      expect(result.text).toContain('</retrieved_context>');
      expect(result.text).toContain('<chunk');
      expect(result.text).toContain('<content>');
      expect(result.text).toContain('<location>');
    });

    it('should respect token budget', () => {
      const longContent = 'word '.repeat(500);
      const chunks = [
        makeChunk('c1', longContent),
        makeChunk('c2', longContent),
      ];
      const result = assembler.assemble(chunks, 200, {});
      expect(result.chunks.length).toBeLessThan(2);
    });

    it('should smart-truncate when compress is enabled', () => {
      const longContent = 'line\n'.repeat(500);
      const chunks = [makeChunk('c1', longContent)];
      // Budget of 200 - 50 overhead = 150 available, which is > 50
      const result = assembler.assemble(chunks, 200, { compress: true });
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      if (result.chunks.length > 0) {
        expect(result.chunks[0].content).toContain('truncated');
      }
    });
  });

  describe('format: xml', () => {
    it('should include source attribute', () => {
      const chunks = [makeChunk('c1', 'code')];
      const result = assembler.assemble(chunks, 10000, { format: 'xml' });
      expect(result.text).toContain('source="vector_db"');
    });

    it('should include relevance when includeMetadata is true', () => {
      const chunks = [makeChunk('c1', 'code')];
      const result = assembler.assemble(chunks, 10000, { format: 'xml', includeMetadata: true });
      expect(result.text).toContain('relevance=');
    });

    it('should escape XML special characters', () => {
      const chunks = [makeChunk('c1', 'if (x < 10 && y > 5) {}')];
      const result = assembler.assemble(chunks, 10000, { format: 'xml' });
      expect(result.text).toContain('&lt;');
      expect(result.text).toContain('&gt;');
      expect(result.text).toContain('&amp;');
    });
  });

  describe('format: markdown', () => {
    it('should format as markdown with code blocks', () => {
      const chunks = [makeChunk('c1', 'const x = 1;')];
      const result = assembler.assemble(chunks, 10000, { format: 'markdown' });
      expect(result.text).toContain('###');
      expect(result.text).toContain('```typescript');
      expect(result.text).toContain('```');
    });

    it('should include separators between chunks', () => {
      const chunks = [makeChunk('c1', 'first'), makeChunk('c2', 'second')];
      const result = assembler.assemble(chunks, 10000, { format: 'markdown' });
      expect(result.text).toContain('---');
    });
  });

  describe('format: plain', () => {
    it('should format as plain text', () => {
      const chunks = [makeChunk('c1', 'const x = 1;')];
      const result = assembler.assemble(chunks, 10000, { format: 'plain' });
      expect(result.text).toContain('//');
      expect(result.text).toContain('const x = 1;');
    });

    it('should separate chunks with dividers', () => {
      const chunks = [makeChunk('c1', 'first'), makeChunk('c2', 'second')];
      const result = assembler.assemble(chunks, 10000, { format: 'plain' });
      expect(result.text).toContain('---');
    });
  });

  describe('summarize option', () => {
    it('should strip comment-only lines when summarize is true', () => {
      const content = [
        '// This is a comment',
        '/* Another comment */',
        'const x = 1;',
        '// More comments',
        'const y = 2;',
      ].join('\n');
      const chunks = [makeChunk('c1', content)];
      const result = assembler.assemble(chunks, 10000, { summarize: true });
      expect(result.text).toContain('const x = 1;');
      expect(result.text).toContain('const y = 2;');
      expect(result.text).not.toContain('This is a comment');
      expect(result.text).not.toContain('Another comment');
    });

    it('should preserve TODO/FIXME comments', () => {
      const content = [
        '// TODO: fix this',
        '// FIXME: broken',
        '// Regular comment',
        'const x = 1;',
      ].join('\n');
      const chunks = [makeChunk('c1', content)];
      const result = assembler.assemble(chunks, 10000, { summarize: true });
      expect(result.text).toContain('TODO');
      expect(result.text).toContain('FIXME');
      expect(result.text).not.toContain('Regular comment');
    });

    it('should collapse multiple blank lines', () => {
      const content = 'line1\n\n\n\n\nline2';
      const chunks = [makeChunk('c1', content)];
      const result = assembler.assemble(chunks, 10000, { summarize: true });
      // The assembled chunk content should not have multiple blank lines
      const assembled = result.chunks[0];
      expect(assembled).toBeDefined();
      const blankRuns = assembled!.content.match(/\n\n\n/g);
      expect(blankRuns).toBeNull();
    });

    it('should not alter content when summarize is false', () => {
      const content = '// comment\nconst x = 1;';
      const chunks = [makeChunk('c1', content)];
      const result = assembler.assemble(chunks, 10000, { summarize: false });
      expect(result.text).toContain('// comment');
    });
  });

  describe('compress with multiple chunks', () => {
    it('should smart-truncate a chunk that overflows mid-list', () => {
      const short = makeChunk('c1', 'short', { filePath: 'a.ts' });
      short.tokenCount = 10;
      const longContent = 'line\n'.repeat(500);
      const long = makeChunk('c2', longContent, { filePath: 'b.ts' });
      // Budget tight enough that c2 alone exceeds remaining after c1
      const result = assembler.assemble([short, long], 100, { compress: true });
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('location formatting', () => {
    it('should format file path with line range', () => {
      const chunks = [makeChunk('c1', 'code', { filePath: 'src/test.ts', startLine: 10, endLine: 20 })];
      const result = assembler.assemble(chunks, 10000, {});
      expect(result.text).toContain('src/test.ts:10-20');
    });

    it('should format file path with start line only', () => {
      const chunks = [makeChunk('c1', 'code', { filePath: 'src/test.ts', startLine: 10 })];
      const result = assembler.assemble(chunks, 10000, {});
      expect(result.text).toContain('src/test.ts:10');
    });

    it('should format URL with title', () => {
      const chunk: ContextChunk = {
        id: 'c1', content: 'code', source: 'vector_db', relevance: 0.9,
        metadata: { url: 'https://example.com', title: 'Docs' },
      };
      const result = assembler.assemble([chunk], 10000, {});
      expect(result.text).toContain('Docs');
      expect(result.text).toContain('https://example.com');
    });

    it('should fall back to source:id', () => {
      const chunk: ContextChunk = {
        id: 'c1', content: 'code', source: 'vector_db', relevance: 0.9,
        metadata: {},
      };
      const result = assembler.assemble([chunk], 10000, {});
      expect(result.text).toContain('vector_db:c1');
    });
  });
});
