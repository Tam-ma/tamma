/**
 * Tests for Git Diff Detector
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  GitDiffDetector,
  createGitDiffDetector,
} from '../discovery/git-diff-detector.js';

describe('GitDiffDetector', () => {
  let tempDir: string;

  /**
   * Create a temp directory with a git repo
   */
  const createGitRepo = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-diff-test-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
    return dir;
  };

  /**
   * Create a file in the temp repo
   */
  const createFile = (name: string, content: string): void => {
    const filePath = path.join(tempDir, name);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  };

  /**
   * Stage and commit all changes
   */
  const commitAll = (message: string): void => {
    execSync('git add -A', { cwd: tempDir, stdio: 'pipe' });
    execSync(`git commit -m "${message}" --allow-empty`, {
      cwd: tempDir,
      stdio: 'pipe',
    });
  };

  beforeEach(() => {
    tempDir = createGitRepo();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('should return true for git repos', () => {
      const detector = new GitDiffDetector(tempDir);
      expect(detector.isGitRepo()).toBe(true);
    });

    it('should return false for non-git directories', () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        const detector = new GitDiffDetector(nonGitDir);
        expect(detector.isGitRepo()).toBe(false);
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('detectChanges', () => {
    it('should detect untracked files', () => {
      // Create initial commit
      createFile('initial.txt', 'initial');
      commitAll('initial commit');

      // Create an untracked file
      createFile('new-file.ts', 'const x = 1;');

      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChanges();

      const newFile = changes.find((c) => c.filePath === 'new-file.ts');
      expect(newFile).toBeDefined();
      expect(newFile!.changeType).toBe('added');
    });

    it('should detect modified files', () => {
      createFile('file.ts', 'const x = 1;');
      commitAll('initial commit');

      // Modify the file
      createFile('file.ts', 'const x = 2;');

      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChanges();

      const modified = changes.find((c) => c.filePath === 'file.ts');
      expect(modified).toBeDefined();
      expect(modified!.changeType).toBe('modified');
    });

    it('should detect deleted files', () => {
      createFile('file.ts', 'const x = 1;');
      commitAll('initial commit');

      // Delete the file
      fs.unlinkSync(path.join(tempDir, 'file.ts'));

      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChanges();

      const deleted = changes.find((c) => c.filePath === 'file.ts');
      expect(deleted).toBeDefined();
      expect(deleted!.changeType).toBe('deleted');
    });

    it('should detect staged changes', () => {
      createFile('file.ts', 'const x = 1;');
      commitAll('initial commit');

      // Stage a change
      createFile('file.ts', 'const x = 2;');
      execSync('git add file.ts', { cwd: tempDir, stdio: 'pipe' });

      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChanges({ includeStaged: true });

      const staged = changes.find((c) => c.filePath === 'file.ts');
      expect(staged).toBeDefined();
    });

    it('should detect changes from commits', () => {
      createFile('file.ts', 'const x = 1;');
      commitAll('first commit');

      createFile('file.ts', 'const x = 2;');
      createFile('new.ts', 'const y = 1;');
      commitAll('second commit');

      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChanges({ ref: 'HEAD~1' });

      expect(changes.length).toBeGreaterThanOrEqual(1);
      const modified = changes.find((c) => c.filePath === 'file.ts');
      expect(modified).toBeDefined();
    });

    it('should handle empty repos gracefully', () => {
      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChanges();

      // Should not throw, might return empty or just untracked
      expect(changes).toBeInstanceOf(Array);
    });

    it('should respect includeUntracked option', () => {
      createFile('initial.txt', 'initial');
      commitAll('initial commit');

      createFile('untracked.ts', 'const x = 1;');

      const detector = new GitDiffDetector(tempDir);

      // With untracked
      const withUntracked = detector.detectChanges({ includeUntracked: true });
      expect(withUntracked.some((c) => c.filePath === 'untracked.ts')).toBe(true);

      // Without untracked
      const withoutUntracked = detector.detectChanges({ includeUntracked: false });
      expect(withoutUntracked.some((c) => c.filePath === 'untracked.ts')).toBe(false);
    });
  });

  describe('detectChangesBetween', () => {
    it('should detect changes between two commits', () => {
      createFile('file.ts', 'const x = 1;');
      commitAll('first commit');

      // Get the first commit hash
      const firstCommit = execSync('git rev-parse HEAD', {
        cwd: tempDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

      createFile('file.ts', 'const x = 2;');
      createFile('new.ts', 'const y = 1;');
      commitAll('second commit');

      const detector = new GitDiffDetector(tempDir);
      const changes = detector.detectChangesBetween(firstCommit, 'HEAD');

      expect(changes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getChangedFiles', () => {
    it('should return only non-deleted file paths', () => {
      createFile('file1.ts', 'const x = 1;');
      createFile('file2.ts', 'const y = 1;');
      commitAll('initial commit');

      createFile('file1.ts', 'const x = 2;');
      fs.unlinkSync(path.join(tempDir, 'file2.ts'));
      createFile('file3.ts', 'const z = 1;');

      const detector = new GitDiffDetector(tempDir);
      const changed = detector.getChangedFiles();

      // file1 should be in changed (modified)
      // file3 should be in changed (added/untracked)
      // file2 should NOT be in changed (deleted)
      expect(changed).toContain('file3.ts');
      expect(changed).not.toContain('file2.ts');
    });
  });

  describe('getDeletedFiles', () => {
    it('should return only deleted file paths', () => {
      createFile('file1.ts', 'const x = 1;');
      createFile('file2.ts', 'const y = 1;');
      commitAll('initial commit');

      fs.unlinkSync(path.join(tempDir, 'file2.ts'));

      const detector = new GitDiffDetector(tempDir);
      const deleted = detector.getDeletedFiles();

      expect(deleted).toContain('file2.ts');
      expect(deleted).not.toContain('file1.ts');
    });
  });
});

describe('createGitDiffDetector', () => {
  it('should return detector for git repos', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-diff-factory-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });

      const detector = createGitDiffDetector(tempDir);
      expect(detector).not.toBeNull();
      expect(detector).toBeInstanceOf(GitDiffDetector);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return null for non-git directories', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-factory-'));
    try {
      const detector = createGitDiffDetector(tempDir);
      expect(detector).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
