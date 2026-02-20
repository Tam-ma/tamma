/**
 * Tests for Git Hook Installer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  GitHookInstaller,
  createGitHookInstaller,
} from '../triggers/git-hook-installer.js';

describe('GitHookInstaller', () => {
  let tempDir: string;

  const createGitRepo = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    return dir;
  };

  beforeEach(() => {
    tempDir = createGitRepo();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('should return true for git repos', () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      expect(installer.isGitRepo()).toBe(true);
    });

    it('should return false for non-git directories', () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-hook-'));
      try {
        const installer = new GitHookInstaller({ projectRoot: nonGitDir });
        expect(installer.isGitRepo()).toBe(false);
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('install', () => {
    it('should install post-commit and post-merge hooks', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      const result = await installer.install();

      expect(result.success).toBe(true);
      expect(result.installedHooks).toContain('post-commit');
      expect(result.installedHooks).toContain('post-merge');

      // Check files exist
      const hooksDir = path.join(tempDir, '.git', 'hooks');
      expect(fs.existsSync(path.join(hooksDir, 'post-commit'))).toBe(true);
      expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
    });

    it('should install executable hooks', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      await installer.install();

      const hookPath = path.join(tempDir, '.git', 'hooks', 'post-commit');
      const stat = fs.statSync(hookPath);

      // Check hook is executable (on unix)
      if (process.platform !== 'win32') {
        expect(stat.mode & 0o111).toBeGreaterThan(0);
      }
    });

    it('should include shebang and marker in hook content', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      await installer.install();

      const hookPath = path.join(tempDir, '.git', 'hooks', 'post-commit');
      const content = fs.readFileSync(hookPath, 'utf-8');

      expect(content).toContain('#!/bin/sh');
      expect(content).toContain('TAMMA_INDEXER_HOOK');
    });

    it('should use custom trigger command', async () => {
      const installer = new GitHookInstaller({
        projectRoot: tempDir,
        triggerCommand: 'echo "custom command"',
      });
      await installer.install();

      const hookPath = path.join(tempDir, '.git', 'hooks', 'post-commit');
      const content = fs.readFileSync(hookPath, 'utf-8');

      expect(content).toContain('echo "custom command"');
    });

    it('should install custom hooks list', async () => {
      const installer = new GitHookInstaller({
        projectRoot: tempDir,
        hooks: ['post-commit'],
      });
      const result = await installer.install();

      expect(result.installedHooks).toContain('post-commit');
      expect(result.installedHooks).not.toContain('post-merge');
    });

    it('should not overwrite existing Tamma hooks', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });

      // Install twice
      await installer.install();
      const result = await installer.install();

      // Should report installed (idempotent)
      expect(result.success).toBe(true);
      expect(result.installedHooks).toContain('post-commit');

      // Content should not be duplicated
      const hookPath = path.join(tempDir, '.git', 'hooks', 'post-commit');
      const content = fs.readFileSync(hookPath, 'utf-8');
      const markerCount = (content.match(/TAMMA_INDEXER_HOOK/g) || []).length;
      expect(markerCount).toBe(1);
    });

    it('should append to existing non-Tamma hooks', async () => {
      // Create a pre-existing hook
      const hooksDir = path.join(tempDir, '.git', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const existingContent = '#!/bin/sh\necho "existing hook"';
      fs.writeFileSync(
        path.join(hooksDir, 'post-commit'),
        existingContent,
        { mode: 0o755 },
      );

      const installer = new GitHookInstaller({ projectRoot: tempDir });
      await installer.install();

      const content = fs.readFileSync(
        path.join(hooksDir, 'post-commit'),
        'utf-8',
      );

      // Should contain both the existing content and Tamma content
      expect(content).toContain('echo "existing hook"');
      expect(content).toContain('TAMMA_INDEXER_HOOK');
    });

    it('should fail for non-git repos', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-hook-'));
      try {
        const installer = new GitHookInstaller({ projectRoot: nonGitDir });
        const result = await installer.install();

        expect(result.success).toBe(false);
        expect(result.errors).toContain('Not a git repository');
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('uninstall', () => {
    it('should remove Tamma-created hooks', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });

      await installer.install();
      const result = await installer.uninstall();

      expect(result.success).toBe(true);
      expect(result.installedHooks).toContain('post-commit');
      expect(result.installedHooks).toContain('post-merge');

      // Hook files should be removed
      const hooksDir = path.join(tempDir, '.git', 'hooks');
      expect(fs.existsSync(path.join(hooksDir, 'post-commit'))).toBe(false);
      expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(false);
    });

    it('should remove only Tamma section from existing hooks', async () => {
      // Create a pre-existing hook
      const hooksDir = path.join(tempDir, '.git', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const existingContent = '#!/bin/sh\necho "existing hook"';
      fs.writeFileSync(
        path.join(hooksDir, 'post-commit'),
        existingContent,
        { mode: 0o755 },
      );

      const installer = new GitHookInstaller({ projectRoot: tempDir });

      // Install then uninstall
      await installer.install();
      await installer.uninstall();

      // The existing hook content should still be there
      const content = fs.readFileSync(
        path.join(hooksDir, 'post-commit'),
        'utf-8',
      );
      expect(content).toContain('echo "existing hook"');
      expect(content).not.toContain('TAMMA_INDEXER_HOOK');
    });

    it('should handle uninstall when no hooks are installed', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      const result = await installer.uninstall();

      expect(result.success).toBe(true);
      expect(result.installedHooks).toHaveLength(0);
    });

    it('should fail for non-git repos', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-hook-'));
      try {
        const installer = new GitHookInstaller({ projectRoot: nonGitDir });
        const result = await installer.uninstall();

        expect(result.success).toBe(false);
        expect(result.errors).toContain('Not a git repository');
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('getInstalledHooks', () => {
    it('should return empty for fresh repo', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      const hooks = await installer.getInstalledHooks();

      expect(hooks).toHaveLength(0);
    });

    it('should return installed hooks', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      await installer.install();

      const hooks = await installer.getInstalledHooks();

      expect(hooks).toContain('post-commit');
      expect(hooks).toContain('post-merge');
    });

    it('should not return hooks after uninstall', async () => {
      const installer = new GitHookInstaller({ projectRoot: tempDir });
      await installer.install();
      await installer.uninstall();

      const hooks = await installer.getInstalledHooks();

      expect(hooks).toHaveLength(0);
    });
  });
});

describe('createGitHookInstaller', () => {
  it('should create installer instance', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-factory-'));
    try {
      const installer = createGitHookInstaller({ projectRoot: tempDir });
      expect(installer).toBeInstanceOf(GitHookInstaller);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
