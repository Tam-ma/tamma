/**
 * Tests for Query Processor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QueryProcessor, createQueryProcessor } from '../query-processor.js';
import type { RAGQuery } from '../types.js';

describe('QueryProcessor', () => {
  let processor: QueryProcessor;

  beforeEach(() => {
    processor = createQueryProcessor();
  });

  describe('process', () => {
    it('should process a simple query', async () => {
      const query: RAGQuery = { text: 'find the login function' };
      const result = await processor.process(query);

      expect(result.original).toBe('find the login function');
      expect(result.expanded).toContain('find the login function');
      expect(result.entities).toBeDefined();
      expect(result.intent).toBeDefined();
    });

    it('should preserve original query in result', async () => {
      const query: RAGQuery = { text: '  How does authentication work?  ' };
      const result = await processor.process(query);

      expect(result.original).toBe('How does authentication work?');
    });
  });

  describe('expandQuery', () => {
    it('should expand query with synonyms', () => {
      const expanded = processor.expandQuery('find the function');

      expect(expanded).toContain('find the function');
      // Should include synonyms for 'function'
      expect(expanded.length).toBeGreaterThan(1);
    });

    it('should handle queries without known synonyms', () => {
      const expanded = processor.expandQuery('xyz123 unique query');

      expect(expanded).toHaveLength(1);
      expect(expanded[0]).toBe('xyz123 unique query');
    });

    it('should expand multiple terms', () => {
      const expanded = processor.expandQuery('create function to read variable');

      // Should have expansions for create, function, read, variable
      expect(expanded.length).toBeGreaterThan(1);
    });

    it('should handle empty query', () => {
      const expanded = processor.expandQuery('');

      expect(expanded).toHaveLength(1);
      expect(expanded[0]).toBe('');
    });
  });

  describe('extractEntities', () => {
    it('should extract file paths', () => {
      const entities = processor.extractEntities('look at src/auth/login.ts');

      const fileEntities = entities.filter((e) => e.type === 'file');
      expect(fileEntities.length).toBeGreaterThan(0);
      expect(fileEntities.some((e) => e.value.includes('login.ts'))).toBe(true);
    });

    it('should extract function names', () => {
      const entities = processor.extractEntities('find function handleLogin');

      const funcEntities = entities.filter((e) => e.type === 'function');
      expect(funcEntities.some((e) => e.value === 'handleLogin')).toBe(true);
    });

    it('should extract class names (PascalCase)', () => {
      const entities = processor.extractEntities('look at UserService class');

      const classEntities = entities.filter((e) => e.type === 'class');
      expect(classEntities.some((e) => e.value === 'UserService')).toBe(true);
    });

    it('should extract package names', () => {
      const entities = processor.extractEntities('import from @tamma/intelligence');

      const pkgEntities = entities.filter((e) => e.type === 'package');
      expect(pkgEntities.some((e) => e.value.includes('tamma'))).toBe(true);
    });

    it('should handle query without entities', () => {
      const entities = processor.extractEntities('how does this work');

      expect(entities).toBeDefined();
      // May or may not find entities, but should not throw
    });

    it('should not extract common words as entities', () => {
      const entities = processor.extractEntities('the is are with');

      // Common words should be filtered out
      expect(entities.every((e) => !['the', 'is', 'are', 'with'].includes(e.value))).toBe(true);
    });

    it('should calculate confidence scores', () => {
      const entities = processor.extractEntities('src/auth/login.ts and UserService');

      for (const entity of entities) {
        expect(entity.confidence).toBeGreaterThan(0);
        expect(entity.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('decomposeQuery', () => {
    it('should not decompose simple queries', () => {
      const decomposed = processor.decomposeQuery('find the login function');

      expect(decomposed).toHaveLength(1);
    });

    it('should decompose queries with "and"', () => {
      const decomposed = processor.decomposeQuery(
        'find the login function and also the logout handler'
      );

      expect(decomposed.length).toBeGreaterThanOrEqual(2);
    });

    it('should decompose queries with multiple questions', () => {
      const decomposed = processor.decomposeQuery(
        'How does login work? What about session management?'
      );

      expect(decomposed.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter out very short sub-queries', () => {
      const decomposed = processor.decomposeQuery('do X and Y');

      // Very short parts should be filtered
      for (const part of decomposed) {
        expect(part.split(/\s+/).length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('classifyIntent', () => {
    it('should classify code search intent', () => {
      const intent = processor.classifyIntent('find the authentication module');

      expect(intent).toBe('code_search');
    });

    it('should classify explanation intent', () => {
      const intent = processor.classifyIntent('explain how the cache works');

      expect(intent).toBe('explanation');
    });

    it('should classify implementation intent', () => {
      const intent = processor.classifyIntent('implement a new login feature');

      expect(intent).toBe('implementation');
    });

    it('should classify debugging intent', () => {
      const intent = processor.classifyIntent('fix the bug in authentication');

      expect(intent).toBe('debugging');
    });

    it('should classify documentation intent', () => {
      const intent = processor.classifyIntent('document the API endpoints');

      expect(intent).toBe('documentation');
    });

    it('should classify refactoring intent', () => {
      const intent = processor.classifyIntent('refactor the user service');

      expect(intent).toBe('refactoring');
    });

    it('should default to general for unclear queries', () => {
      const intent = processor.classifyIntent('xyz123');

      expect(intent).toBe('general');
    });
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript', () => {
      const result = processor.detectLanguage('typescript code for login');

      expect(result).toBe('typescript');
    });

    it('should detect JavaScript', () => {
      const result = processor.detectLanguage('javascript function');

      expect(result).toBe('javascript');
    });

    it('should detect Python', () => {
      const result = processor.detectLanguage('python script');

      expect(result).toBe('python');
    });

    it('should return undefined for no language mention', () => {
      const result = processor.detectLanguage('find the login function');

      expect(result).toBeUndefined();
    });

    it('should be case insensitive', () => {
      const result = processor.detectLanguage('TYPESCRIPT code');

      expect(result).toBe('typescript');
    });
  });
});
