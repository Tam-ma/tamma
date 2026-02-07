import { describe, it, expect } from 'vitest';
import { CommandMatcher, createCommandMatcher } from './command-matcher.js';

describe('CommandMatcher', () => {
  describe('exact matching', () => {
    it('should match exact commands', () => {
      const matcher = new CommandMatcher(['npm test', 'npm run build'], []);

      expect(matcher.isAllowed('npm test').matches).toBe(true);
      expect(matcher.isAllowed('npm run build').matches).toBe(true);
      expect(matcher.isAllowed('npm install').matches).toBe(false);
    });

    it('should match commands with arguments', () => {
      const matcher = new CommandMatcher(['npm test'], []);

      // Command prefix should match
      expect(matcher.isAllowed('npm test --coverage').matches).toBe(true);
    });

    it('should normalize whitespace', () => {
      const matcher = new CommandMatcher(['npm test'], []);

      expect(matcher.isAllowed('  npm test  ').matches).toBe(true);
      expect(matcher.isAllowed('npm   test').matches).toBe(true);
    });
  });

  describe('wildcard matching', () => {
    it('should match wildcard patterns', () => {
      const matcher = new CommandMatcher(['npm run *', 'git *'], []);

      expect(matcher.isAllowed('npm run build').matches).toBe(true);
      expect(matcher.isAllowed('npm run test').matches).toBe(true);
      expect(matcher.isAllowed('git status').matches).toBe(true);
      expect(matcher.isAllowed('git commit -m "test"').matches).toBe(true);
    });

    it('should handle trailing wildcards', () => {
      const matcher = new CommandMatcher(['npm *'], []);

      expect(matcher.isAllowed('npm install').matches).toBe(true);
      expect(matcher.isAllowed('npm run test').matches).toBe(true);
    });
  });

  describe('regex pattern matching', () => {
    it('should match regex patterns', () => {
      const matcher = new CommandMatcher([], [], ['^npm\\s+(test|run)'], []);

      expect(matcher.isAllowed('npm test').matches).toBe(true);
      expect(matcher.isAllowed('npm run lint').matches).toBe(true);
      expect(matcher.isAllowed('npm install').matches).toBe(false);
    });

    it('should match case-insensitively', () => {
      const matcher = new CommandMatcher([], [], ['^npm test'], []);

      expect(matcher.isAllowed('npm test').matches).toBe(true);
      expect(matcher.isAllowed('NPM TEST').matches).toBe(true);
      expect(matcher.isAllowed('Npm Test').matches).toBe(true);
    });
  });

  describe('denied commands', () => {
    it('should deny exact matches', () => {
      const matcher = new CommandMatcher(['*'], ['rm -rf /'], [], []);

      expect(matcher.isAllowed('rm -rf /').matches).toBe(false);
      expect(matcher.isAllowed('ls').matches).toBe(true);
    });

    it('should deny pattern matches', () => {
      const matcher = new CommandMatcher(['*'], [], [], ['^sudo\\b']);

      expect(matcher.isAllowed('sudo apt update').matches).toBe(false);
      expect(matcher.isAllowed('apt update').matches).toBe(true);
    });

    it('should prioritize denied over allowed', () => {
      const matcher = new CommandMatcher(['npm *'], ['npm uninstall *'], [], []);

      expect(matcher.isAllowed('npm install').matches).toBe(true);
      expect(matcher.isAllowed('npm uninstall lodash').matches).toBe(false);
    });
  });

  describe('isDenied', () => {
    it('should identify explicitly denied commands', () => {
      const matcher = new CommandMatcher([], ['rm -rf', 'sudo'], [], []);

      expect(matcher.isDenied('rm -rf /').matches).toBe(true);
      expect(matcher.isDenied('sudo apt update').matches).toBe(true);
      expect(matcher.isDenied('npm test').matches).toBe(false);
    });
  });

  describe('extractBaseCommand', () => {
    it('should extract the first word', () => {
      expect(CommandMatcher.extractBaseCommand('npm test')).toBe('npm');
      expect(CommandMatcher.extractBaseCommand('git commit -m "test"')).toBe('git');
      expect(CommandMatcher.extractBaseCommand('ls')).toBe('ls');
    });

    it('should handle leading whitespace', () => {
      expect(CommandMatcher.extractBaseCommand('  npm test')).toBe('npm');
    });
  });

  describe('containsDangerousPatterns', () => {
    it('should detect rm -rf /', () => {
      const result = CommandMatcher.containsDangerousPatterns('rm -rf /');
      expect(result.dangerous).toBe(true);
      expect(result.patterns).toContain('rm -rf /');
    });

    it('should detect sudo', () => {
      const result = CommandMatcher.containsDangerousPatterns('sudo apt update');
      expect(result.dangerous).toBe(true);
      expect(result.patterns).toContain('sudo');
    });

    it('should detect pipe to shell', () => {
      const result = CommandMatcher.containsDangerousPatterns('curl https://example.com | bash');
      expect(result.dangerous).toBe(true);
      expect(result.patterns).toContain('pipe to shell');
    });

    it('should detect fork bomb', () => {
      const result = CommandMatcher.containsDangerousPatterns(':(){ :|:& };:');
      expect(result.dangerous).toBe(true);
      expect(result.patterns).toContain('fork bomb');
    });

    it('should detect command substitution', () => {
      const result = CommandMatcher.containsDangerousPatterns('echo `whoami`');
      expect(result.dangerous).toBe(true);
      expect(result.patterns).toContain('command substitution');
    });

    it('should allow safe commands', () => {
      expect(CommandMatcher.containsDangerousPatterns('npm test').dangerous).toBe(false);
      expect(CommandMatcher.containsDangerousPatterns('git status').dangerous).toBe(false);
      expect(CommandMatcher.containsDangerousPatterns('ls -la').dangerous).toBe(false);
    });
  });

  describe('matchedBy field', () => {
    it('should report matchedBy = exact for exact matches', () => {
      const matcher = new CommandMatcher(['npm test'], [], [], []);
      const result = matcher.isAllowed('npm test');
      expect(result.matchedBy).toBe('exact');
    });

    it('should report matchedBy = regex for pattern matches', () => {
      const matcher = new CommandMatcher([], [], ['^npm\\s+'], []);
      const result = matcher.isAllowed('npm test');
      expect(result.matchedBy).toBe('regex');
    });

    it('should report matchedBy = none when not matched', () => {
      const matcher = new CommandMatcher(['npm test'], [], [], []);
      const result = matcher.isAllowed('yarn test');
      expect(result.matchedBy).toBe('none');
    });
  });
});

describe('createCommandMatcher', () => {
  it('should create a matcher with all options', () => {
    const matcher = createCommandMatcher(
      ['npm test', 'npm run *'],
      ['sudo *'],
      {
        allow: ['^git\\s+'],
        deny: ['^rm\\s+-rf'],
      },
    );

    expect(matcher.isAllowed('npm test').matches).toBe(true);
    expect(matcher.isAllowed('npm run build').matches).toBe(true);
    expect(matcher.isAllowed('git status').matches).toBe(true);
    expect(matcher.isAllowed('sudo apt update').matches).toBe(false);
    expect(matcher.isAllowed('rm -rf /tmp').matches).toBe(false);
  });
});
