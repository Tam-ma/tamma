/**
 * Tests for Gitignore Parser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GitignoreParser } from '../discovery/gitignore-parser.js';

describe('GitignoreParser', () => {
  let parser: GitignoreParser;

  beforeEach(() => {
    parser = new GitignoreParser('/project');
  });

  describe('parseContent', () => {
    it('should parse simple patterns', () => {
      parser.parseContent('node_modules\ndist');

      expect(parser.isIgnored('node_modules', true)).toBe(true);
      expect(parser.isIgnored('dist', true)).toBe(true);
      expect(parser.isIgnored('src', true)).toBe(false);
    });

    it('should skip empty lines', () => {
      parser.parseContent('node_modules\n\ndist\n\n');

      expect(parser.getRuleCount()).toBe(2);
    });

    it('should skip comments', () => {
      parser.parseContent('# This is a comment\nnode_modules\n# Another comment\ndist');

      expect(parser.getRuleCount()).toBe(2);
    });
  });

  describe('isIgnored', () => {
    describe('basic patterns', () => {
      it('should match exact file names', () => {
        parser.parseContent('.env\n.DS_Store');

        expect(parser.isIgnored('.env', false)).toBe(true);
        expect(parser.isIgnored('.DS_Store', false)).toBe(true);
        expect(parser.isIgnored('.gitignore', false)).toBe(false);
      });

      it('should match directory names', () => {
        parser.parseContent('node_modules\nbuild');

        expect(parser.isIgnored('node_modules', true)).toBe(true);
        expect(parser.isIgnored('build', true)).toBe(true);
      });

      it('should match files in any directory without slash', () => {
        parser.parseContent('*.log');

        expect(parser.isIgnored('app.log', false)).toBe(true);
        expect(parser.isIgnored('logs/app.log', false)).toBe(true);
        expect(parser.isIgnored('deep/nested/app.log', false)).toBe(true);
      });
    });

    describe('wildcards', () => {
      it('should match single asterisk', () => {
        parser.parseContent('*.js');

        expect(parser.isIgnored('app.js', false)).toBe(true);
        expect(parser.isIgnored('test.js', false)).toBe(true);
        expect(parser.isIgnored('app.ts', false)).toBe(false);
      });

      it('should match double asterisk for directories', () => {
        parser.parseContent('**/node_modules');

        expect(parser.isIgnored('node_modules', true)).toBe(true);
        expect(parser.isIgnored('packages/node_modules', true)).toBe(true);
        expect(parser.isIgnored('deep/nested/node_modules', true)).toBe(true);
      });

      it('should match double asterisk in middle', () => {
        parser.parseContent('src/**/test');

        expect(parser.isIgnored('src/test', true)).toBe(true);
        expect(parser.isIgnored('src/utils/test', true)).toBe(true);
        expect(parser.isIgnored('src/a/b/c/test', true)).toBe(true);
      });

      it('should match question mark for single character', () => {
        parser.parseContent('file?.txt');

        expect(parser.isIgnored('file1.txt', false)).toBe(true);
        expect(parser.isIgnored('fileA.txt', false)).toBe(true);
        expect(parser.isIgnored('file.txt', false)).toBe(false);
        expect(parser.isIgnored('file12.txt', false)).toBe(false);
      });
    });

    describe('directory-only patterns', () => {
      it('should only match directories with trailing slash', () => {
        parser.parseContent('logs/');

        expect(parser.isIgnored('logs', true)).toBe(true);
        expect(parser.isIgnored('logs', false)).toBe(false);
      });
    });

    describe('negation', () => {
      it('should handle negation patterns', () => {
        parser.parseContent('*.log\n!important.log');

        expect(parser.isIgnored('app.log', false)).toBe(true);
        expect(parser.isIgnored('error.log', false)).toBe(true);
        expect(parser.isIgnored('important.log', false)).toBe(false);
      });

      it('should handle negation order correctly', () => {
        // Later rules override earlier ones
        parser.parseContent('!keep.txt\n*.txt');

        expect(parser.isIgnored('keep.txt', false)).toBe(true);
      });
    });

    describe('rooted patterns', () => {
      it('should match from root with leading slash', () => {
        parser.parseContent('/src/temp');

        expect(parser.isIgnored('src/temp', true)).toBe(true);
        expect(parser.isIgnored('other/src/temp', true)).toBe(false);
      });
    });

    describe('common gitignore patterns', () => {
      it('should handle typical Node.js patterns', () => {
        parser.parseContent(`
node_modules/
dist/
coverage/
*.log
.env
.env.local
`);

        expect(parser.isIgnored('node_modules', true)).toBe(true);
        expect(parser.isIgnored('dist', true)).toBe(true);
        expect(parser.isIgnored('coverage', true)).toBe(true);
        expect(parser.isIgnored('npm-debug.log', false)).toBe(true);
        expect(parser.isIgnored('.env', false)).toBe(true);
        expect(parser.isIgnored('.env.local', false)).toBe(true);
        expect(parser.isIgnored('src', true)).toBe(false);
        expect(parser.isIgnored('index.ts', false)).toBe(false);
      });

      it('should handle test file patterns', () => {
        parser.parseContent(`
**/*.test.ts
**/*.spec.ts
__tests__/
`);

        expect(parser.isIgnored('src/utils.test.ts', false)).toBe(true);
        expect(parser.isIgnored('src/utils.spec.ts', false)).toBe(true);
        expect(parser.isIgnored('__tests__', true)).toBe(true);
        expect(parser.isIgnored('src/__tests__', true)).toBe(true);
        expect(parser.isIgnored('src/utils.ts', false)).toBe(false);
      });
    });
  });

  describe('addPatterns', () => {
    it('should add additional patterns', () => {
      parser.parseContent('*.log');
      parser.addPatterns(['*.tmp', '*.bak']);

      expect(parser.isIgnored('app.log', false)).toBe(true);
      expect(parser.isIgnored('data.tmp', false)).toBe(true);
      expect(parser.isIgnored('file.bak', false)).toBe(true);
      expect(parser.getRuleCount()).toBe(3);
    });
  });

  describe('getRuleCount', () => {
    it('should return correct rule count', () => {
      parser.parseContent('rule1\nrule2\n# comment\nrule3');

      expect(parser.getRuleCount()).toBe(3);
    });
  });

  describe('clear', () => {
    it('should clear all rules', () => {
      parser.parseContent('rule1\nrule2');

      expect(parser.getRuleCount()).toBe(2);

      parser.clear();

      expect(parser.getRuleCount()).toBe(0);
      expect(parser.isIgnored('rule1', false)).toBe(false);
    });
  });
});
