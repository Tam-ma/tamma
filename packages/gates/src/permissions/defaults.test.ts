import { describe, it, expect } from 'vitest';
import {
  getDefaultPermissions,
  getAllDefaultPermissions,
  getAllAgentTypes,
  READ_ONLY_TOOLS,
  ALL_TOOLS,
  BLOCKED_FILE_PATTERNS,
  BLOCKED_COMMANDS,
  PROTECTED_BRANCHES,
} from './defaults.js';
import type { AgentType } from './types.js';

describe('Default Permissions', () => {
  describe('getDefaultPermissions', () => {
    it('should return permissions for implementer', () => {
      const perms = getDefaultPermissions('implementer');

      expect(perms.agentType).toBe('implementer');
      expect(perms.scope).toBe('global');
      expect(perms.tools.allowed).toContain('Write');
      expect(perms.tools.allowed).toContain('Bash');
      expect(perms.git.canCommit).toBe(true);
      expect(perms.git.canPush).toBe(true);
    });

    it('should return permissions for researcher', () => {
      const perms = getDefaultPermissions('researcher');

      expect(perms.agentType).toBe('researcher');
      expect(perms.tools.allowed).toContain('Read');
      expect(perms.tools.denied).toContain('Write');
      expect(perms.git.canCommit).toBe(false);
    });

    it('should return permissions for tester', () => {
      const perms = getDefaultPermissions('tester');

      expect(perms.agentType).toBe('tester');
      expect(perms.tools.allowed).toContain('Bash');
      expect(perms.files.write.allowed.some((p) => p.includes('test'))).toBe(true);
    });

    it('should return permissions for documenter', () => {
      const perms = getDefaultPermissions('documenter');

      expect(perms.agentType).toBe('documenter');
      expect(perms.tools.allowed).toContain('Write');
      expect(perms.tools.denied).toContain('Bash');
      expect(perms.files.write.allowed.some((p) => p.includes('doc') || p.includes('md'))).toBe(
        true,
      );
    });

    it('should return permissions for architect', () => {
      const perms = getDefaultPermissions('architect');

      expect(perms.agentType).toBe('architect');
      expect(perms.tools.allowed).toContain('Write');
      expect(perms.tools.denied).toContain('Bash');
    });

    it('should return permissions for reviewer', () => {
      const perms = getDefaultPermissions('reviewer');

      expect(perms.agentType).toBe('reviewer');
      expect(perms.tools.denied).toContain('Write');
      expect(perms.git.canCommit).toBe(false);
    });

    it('should return permissions for scrum_master', () => {
      const perms = getDefaultPermissions('scrum_master');

      expect(perms.agentType).toBe('scrum_master');
      expect(perms.tools.denied).toContain('Write');
    });

    it('should return permissions for analyst', () => {
      const perms = getDefaultPermissions('analyst');

      expect(perms.agentType).toBe('analyst');
      expect(perms.tools.allowed).toContain('Read');
    });

    it('should return permissions for planner', () => {
      const perms = getDefaultPermissions('planner');

      expect(perms.agentType).toBe('planner');
      expect(perms.tools.allowed).toContain('Read');
    });

    it('should throw for unknown agent type', () => {
      expect(() => getDefaultPermissions('unknown' as AgentType)).toThrow(
        'Unknown agent type',
      );
    });
  });

  describe('getAllDefaultPermissions', () => {
    it('should return permissions for all agent types', () => {
      const allPerms = getAllDefaultPermissions();

      expect(allPerms.size).toBe(9);
      expect(allPerms.has('implementer')).toBe(true);
      expect(allPerms.has('researcher')).toBe(true);
      expect(allPerms.has('tester')).toBe(true);
    });
  });

  describe('getAllAgentTypes', () => {
    it('should return all agent types', () => {
      const types = getAllAgentTypes();

      expect(types).toContain('scrum_master');
      expect(types).toContain('architect');
      expect(types).toContain('researcher');
      expect(types).toContain('analyst');
      expect(types).toContain('planner');
      expect(types).toContain('implementer');
      expect(types).toContain('reviewer');
      expect(types).toContain('tester');
      expect(types).toContain('documenter');
      expect(types.length).toBe(9);
    });
  });

  describe('Constants', () => {
    it('should export READ_ONLY_TOOLS', () => {
      expect(READ_ONLY_TOOLS).toContain('Read');
      expect(READ_ONLY_TOOLS).toContain('Glob');
      expect(READ_ONLY_TOOLS).toContain('Grep');
    });

    it('should export ALL_TOOLS', () => {
      expect(ALL_TOOLS).toContain('Read');
      expect(ALL_TOOLS).toContain('Write');
      expect(ALL_TOOLS).toContain('Bash');
    });

    it('should export BLOCKED_FILE_PATTERNS', () => {
      expect(BLOCKED_FILE_PATTERNS).toContain('**/.env');
      expect(BLOCKED_FILE_PATTERNS.some((p) => p.includes('secrets'))).toBe(true);
      expect(BLOCKED_FILE_PATTERNS.some((p) => p.includes('.pem'))).toBe(true);
    });

    it('should export BLOCKED_COMMANDS', () => {
      expect(BLOCKED_COMMANDS).toContain('rm -rf /');
      expect(BLOCKED_COMMANDS).toContain('sudo');
    });

    it('should export PROTECTED_BRANCHES', () => {
      expect(PROTECTED_BRANCHES).toContain('main');
      expect(PROTECTED_BRANCHES).toContain('master');
    });
  });

  describe('Permission Consistency', () => {
    const allTypes = getAllAgentTypes();

    for (const agentType of allTypes) {
      describe(`${agentType}`, () => {
        const perms = getDefaultPermissions(agentType);

        it('should have required structure', () => {
          expect(perms.tools).toBeDefined();
          expect(perms.tools.allowed).toBeDefined();
          expect(perms.tools.denied).toBeDefined();
          expect(perms.tools.requireApproval).toBeDefined();

          expect(perms.files).toBeDefined();
          expect(perms.files.read).toBeDefined();
          expect(perms.files.write).toBeDefined();

          expect(perms.commands).toBeDefined();
          expect(perms.commands.allowed).toBeDefined();
          expect(perms.commands.denied).toBeDefined();
          expect(perms.commands.patterns).toBeDefined();

          expect(perms.git).toBeDefined();
          expect(perms.resources).toBeDefined();
        });

        it('should always deny dangerous file patterns', () => {
          expect(perms.files.read.denied).toContain('**/.env');
          expect(perms.files.read.denied.some((p) => p.includes('secrets'))).toBe(true);
        });

        it('should have resource limits', () => {
          expect(perms.resources.maxTokensPerTask).toBeGreaterThan(0);
          expect(perms.resources.maxBudgetPerTask).toBeGreaterThan(0);
          expect(perms.resources.maxDurationMinutes).toBeGreaterThan(0);
          expect(perms.resources.maxFilesModified).toBeGreaterThan(0);
        });

        it('should have protected branches configured', () => {
          expect(perms.git.protectedBranches).toContain('main');
          expect(perms.git.protectedBranches).toContain('master');
        });
      });
    }
  });

  describe('Role-based Permission Differences', () => {
    it('implementer should have more permissions than researcher', () => {
      const impl = getDefaultPermissions('implementer');
      const res = getDefaultPermissions('researcher');

      expect(impl.tools.allowed.length).toBeGreaterThan(res.tools.allowed.length);
      expect(impl.git.canCommit).toBe(true);
      expect(res.git.canCommit).toBe(false);
    });

    it('tester should have limited command permissions', () => {
      const tester = getDefaultPermissions('tester');
      const impl = getDefaultPermissions('implementer');

      // Tester should not be able to install packages
      expect(tester.commands.denied.some((c) => c.includes('install'))).toBe(true);

      // But should be able to run tests
      expect(tester.commands.allowed.some((c) => c.includes('test'))).toBe(true);
    });

    it('documenter should only write to docs', () => {
      const doc = getDefaultPermissions('documenter');

      expect(doc.files.write.allowed.some((p) => p.includes('doc') || p.includes('.md'))).toBe(
        true,
      );
    });

    it('reviewer should be read-only', () => {
      const reviewer = getDefaultPermissions('reviewer');

      expect(reviewer.tools.denied).toContain('Write');
      expect(reviewer.tools.denied).toContain('Edit');
      expect(reviewer.tools.denied).toContain('Bash');
      expect(reviewer.files.write.allowed.length).toBe(0);
    });
  });
});
