/**
 * Tests for File Discovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileDiscovery,
  createFileDiscovery,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
} from '../discovery/file-discovery.js';

describe('FileDiscovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'file-discovery-test-'),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const createFile = async (relativePath: string, content: string = ''): Promise<void> => {
    const fullPath = path.join(tempDir, relativePath);
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  };

  const createDir = async (relativePath: string): Promise<void> => {
    const fullPath = path.join(tempDir, relativePath);
    await fs.promises.mkdir(fullPath, { recursive: true });
  };

  describe('DEFAULT_INCLUDE_PATTERNS', () => {
    it('should include TypeScript patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.ts');
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.tsx');
    });

    it('should include JavaScript patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.js');
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.jsx');
    });

    it('should include Python patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.py');
    });

    it('should include Go patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.go');
    });

    it('should include Rust patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.rs');
    });

    it('should include Java patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toContain('**/*.java');
    });
  });

  describe('DEFAULT_EXCLUDE_PATTERNS', () => {
    it('should exclude node_modules', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('**/node_modules/**');
    });

    it('should exclude build directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('**/dist/**');
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('**/build/**');
    });

    it('should exclude test files', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('**/*.test.ts');
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('**/*.spec.ts');
    });
  });

  describe('discover', () => {
    it('should find files matching include patterns', async () => {
      await createFile('src/app.ts', 'const x = 1;');
      await createFile('src/utils.ts', 'export function util() {}');
      await createFile('src/index.js', 'module.exports = {}');

      const discovery = await createFileDiscovery(tempDir);
      const files = await discovery.discover();

      expect(files.length).toBe(3);
      expect(files.map((f) => f.relativePath)).toContain('src/app.ts');
      expect(files.map((f) => f.relativePath)).toContain('src/utils.ts');
      expect(files.map((f) => f.relativePath)).toContain('src/index.js');
    });

    it('should exclude files matching exclude patterns', async () => {
      await createFile('src/app.ts', 'const x = 1;');
      await createFile('src/app.test.ts', 'test("x", () => {});');
      await createFile('node_modules/pkg/index.ts', 'export const x = 1;');
      await createFile('dist/app.js', 'var x = 1;');

      const discovery = await createFileDiscovery(tempDir);
      const files = await discovery.discover();

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should handle nested directories', async () => {
      await createFile('src/a/b/c/deep.ts', 'const deep = 1;');

      const discovery = await createFileDiscovery(tempDir);
      const files = await discovery.discover();

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('src/a/b/c/deep.ts');
    });

    it('should return correct file metadata', async () => {
      const content = 'const x = "hello world";';
      await createFile('src/test.ts', content);

      const discovery = await createFileDiscovery(tempDir);
      const files = await discovery.discover();

      expect(files.length).toBe(1);
      expect(files[0].absolutePath).toBe(path.join(tempDir, 'src/test.ts'));
      expect(files[0].relativePath).toBe('src/test.ts');
      expect(files[0].language).toBe('typescript');
      expect(files[0].sizeBytes).toBe(content.length);
      expect(files[0].lastModified).toBeInstanceOf(Date);
    });

    it('should detect correct language', async () => {
      await createFile('a.ts', '');
      await createFile('b.tsx', '');
      await createFile('c.js', '');
      await createFile('d.jsx', '');
      await createFile('e.py', '');
      await createFile('f.go', '');
      await createFile('g.rs', '');
      await createFile('h.java', '');

      const discovery = await createFileDiscovery(tempDir);
      const files = await discovery.discover();

      const byPath = Object.fromEntries(files.map((f) => [f.relativePath, f]));

      expect(byPath['a.ts'].language).toBe('typescript');
      expect(byPath['b.tsx'].language).toBe('typescript');
      expect(byPath['c.js'].language).toBe('javascript');
      expect(byPath['d.jsx'].language).toBe('javascript');
      expect(byPath['e.py'].language).toBe('python');
      expect(byPath['f.go'].language).toBe('go');
      expect(byPath['g.rs'].language).toBe('rust');
      expect(byPath['h.java'].language).toBe('java');
    });

    it('should respect .gitignore', async () => {
      await createFile('.gitignore', 'ignored/\n*.log');
      await createFile('src/app.ts', 'const x = 1;');
      await createFile('ignored/secret.ts', 'const secret = 1;');
      await createFile('debug.log', 'log content');

      const discovery = await createFileDiscovery(tempDir, {
        respectGitignore: true,
      });
      const files = await discovery.discover();

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should ignore .gitignore when disabled', async () => {
      await createFile('.gitignore', 'ignored/');
      await createFile('src/app.ts', 'const x = 1;');
      await createFile('ignored/secret.ts', 'const secret = 1;');

      const discovery = await createFileDiscovery(tempDir, {
        respectGitignore: false,
        excludePatterns: [], // Don't use default excludes
      });
      const files = await discovery.discover();

      expect(files.length).toBe(2);
    });

    it('should handle custom include patterns', async () => {
      await createFile('src/app.ts', '');
      await createFile('src/app.py', '');
      await createFile('src/app.go', '');

      const discovery = await createFileDiscovery(tempDir, {
        includePatterns: ['**/*.py'],
      });
      const files = await discovery.discover();

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('src/app.py');
    });

    it('should handle custom exclude patterns', async () => {
      await createFile('src/app.ts', '');
      await createFile('src/internal/secret.ts', '');

      const discovery = await createFileDiscovery(tempDir, {
        excludePatterns: ['**/internal/**'],
      });
      const files = await discovery.discover();

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should handle empty directories', async () => {
      await createDir('empty');

      const discovery = await createFileDiscovery(tempDir);
      const files = await discovery.discover();

      expect(files.length).toBe(0);
    });

    it('should handle maxDepth option', async () => {
      await createFile('a.ts', '');
      await createFile('level1/b.ts', '');
      await createFile('level1/level2/c.ts', '');
      await createFile('level1/level2/level3/d.ts', '');

      const discovery = await createFileDiscovery(tempDir, {
        maxDepth: 2,
      });
      const files = await discovery.discover();

      expect(files.length).toBe(3);
      expect(files.map((f) => f.relativePath)).not.toContain('level1/level2/level3/d.ts');
    });
  });

  describe('getProjectRoot', () => {
    it('should return the project root path', () => {
      const discovery = new FileDiscovery(tempDir);
      expect(discovery.getProjectRoot()).toBe(path.resolve(tempDir));
    });
  });

  describe('static detectLanguage', () => {
    it('should detect TypeScript', () => {
      expect(FileDiscovery.detectLanguage('file.ts')).toBe('typescript');
      expect(FileDiscovery.detectLanguage('file.tsx')).toBe('typescript');
      expect(FileDiscovery.detectLanguage('/path/to/file.ts')).toBe('typescript');
    });

    it('should detect JavaScript', () => {
      expect(FileDiscovery.detectLanguage('file.js')).toBe('javascript');
      expect(FileDiscovery.detectLanguage('file.jsx')).toBe('javascript');
      expect(FileDiscovery.detectLanguage('file.mjs')).toBe('javascript');
    });

    it('should detect Python', () => {
      expect(FileDiscovery.detectLanguage('file.py')).toBe('python');
    });

    it('should return unknown for unsupported extensions', () => {
      expect(FileDiscovery.detectLanguage('file.txt')).toBe('unknown');
      expect(FileDiscovery.detectLanguage('file.md')).toBe('unknown');
    });
  });
});

describe('createFileDiscovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'create-discovery-test-'),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('should create and initialize a FileDiscovery instance', async () => {
    const discovery = await createFileDiscovery(tempDir);

    expect(discovery).toBeInstanceOf(FileDiscovery);
    expect(discovery.getProjectRoot()).toBe(path.resolve(tempDir));
  });

  it('should accept options', async () => {
    const discovery = await createFileDiscovery(tempDir, {
      includePatterns: ['**/*.py'],
      respectGitignore: false,
    });

    expect(discovery).toBeInstanceOf(FileDiscovery);
  });
});
