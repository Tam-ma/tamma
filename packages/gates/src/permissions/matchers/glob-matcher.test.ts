import { describe, it, expect } from 'vitest';
import {
  GlobMatcher,
  createFileGlobMatcher,
  matchesAnyPattern,
  findMatchingPatterns,
} from './glob-matcher.js';

describe('GlobMatcher', () => {
  describe('matchPattern', () => {
    it('should match simple patterns', () => {
      const matcher = new GlobMatcher();
      expect(matcher.matchPattern('src/index.ts', '**/*.ts')).toBe(true);
      expect(matcher.matchPattern('src/index.ts', '**/*.js')).toBe(false);
    });

    it('should match exact file names', () => {
      const matcher = new GlobMatcher();
      expect(matcher.matchPattern('package.json', 'package.json')).toBe(true);
      expect(matcher.matchPattern('package-lock.json', 'package.json')).toBe(false);
    });

    it('should match directory patterns', () => {
      const matcher = new GlobMatcher();
      expect(matcher.matchPattern('src/components/Button.tsx', 'src/**/*')).toBe(true);
      expect(matcher.matchPattern('lib/utils.ts', 'src/**/*')).toBe(false);
    });

    it('should handle dotfiles', () => {
      const matcher = new GlobMatcher();
      expect(matcher.matchPattern('.env', '.*')).toBe(true);
      expect(matcher.matchPattern('.gitignore', '.*')).toBe(true);
      expect(matcher.matchPattern('.env.local', '.env*')).toBe(true);
    });

    it('should handle brace expansion', () => {
      const matcher = new GlobMatcher();
      expect(matcher.matchPattern('file.ts', '*.{ts,tsx}')).toBe(true);
      expect(matcher.matchPattern('file.tsx', '*.{ts,tsx}')).toBe(true);
      expect(matcher.matchPattern('file.js', '*.{ts,tsx}')).toBe(false);
    });

    it('should handle negation patterns', () => {
      const matcher = new GlobMatcher(['**/*.ts'], ['**/*.test.ts']);
      expect(matcher.isAllowed('src/index.ts').matches).toBe(true);
      expect(matcher.isAllowed('src/index.test.ts').matches).toBe(false);
    });
  });

  describe('matchAny', () => {
    it('should match any of multiple patterns', () => {
      const matcher = new GlobMatcher();
      const patterns = ['**/*.ts', '**/*.tsx', '**/*.js'];

      expect(matcher.matchAny('file.ts', patterns).matches).toBe(true);
      expect(matcher.matchAny('file.tsx', patterns).matches).toBe(true);
      expect(matcher.matchAny('file.js', patterns).matches).toBe(true);
      expect(matcher.matchAny('file.css', patterns).matches).toBe(false);
    });

    it('should return the matched pattern', () => {
      const matcher = new GlobMatcher();
      const patterns = ['src/**/*.ts', 'lib/**/*.ts'];

      const result = matcher.matchAny('src/index.ts', patterns);
      expect(result.matches).toBe(true);
      expect(result.matchedPattern).toBe('src/**/*.ts');
    });
  });

  describe('isAllowed', () => {
    it('should allow paths matching allowed patterns', () => {
      const matcher = new GlobMatcher(['src/**/*.ts', 'lib/**/*.ts'], []);
      expect(matcher.isAllowed('src/index.ts').matches).toBe(true);
      expect(matcher.isAllowed('lib/utils.ts').matches).toBe(true);
      expect(matcher.isAllowed('tests/index.ts').matches).toBe(false);
    });

    it('should deny paths matching denied patterns', () => {
      const matcher = new GlobMatcher(['**/*.ts'], ['**/.env*', '**/secrets/**']);

      expect(matcher.isAllowed('src/index.ts').matches).toBe(true);
      expect(matcher.isAllowed('.env').matches).toBe(false);
      expect(matcher.isAllowed('config/secrets/api.ts').matches).toBe(false);
    });

    it('should prioritize denied patterns over allowed', () => {
      const matcher = new GlobMatcher(['**/*'], ['**/node_modules/**']);

      expect(matcher.isAllowed('src/index.ts').matches).toBe(true);
      expect(matcher.isAllowed('node_modules/lodash/index.js').matches).toBe(false);
    });
  });

  describe('isDenied', () => {
    it('should identify denied paths', () => {
      const matcher = new GlobMatcher([], ['**/.env', '**/secrets/**']);

      expect(matcher.isDenied('.env').matches).toBe(true);
      expect(matcher.isDenied('secrets/api-key.txt').matches).toBe(true);
      expect(matcher.isDenied('src/index.ts').matches).toBe(false);
    });
  });

  describe('extend', () => {
    it('should create a new matcher with additional patterns', () => {
      const base = new GlobMatcher(['src/**/*.ts'], ['**/.env']);
      const extended = base.extend(['lib/**/*.ts'], ['**/secrets/**']);

      const patterns = extended.getPatterns();
      expect(patterns.allowed).toContain('src/**/*.ts');
      expect(patterns.allowed).toContain('lib/**/*.ts');
      expect(patterns.denied).toContain('**/.env');
      expect(patterns.denied).toContain('**/secrets/**');
    });
  });

  describe('normalization', () => {
    it('should normalize paths with leading ./', () => {
      const matcher = new GlobMatcher(['src/**/*.ts'], []);
      expect(matcher.isAllowed('./src/index.ts').matches).toBe(true);
    });

    it('should normalize paths with leading /', () => {
      const matcher = new GlobMatcher(['src/**/*.ts'], []);
      expect(matcher.isAllowed('/src/index.ts').matches).toBe(true);
    });
  });
});

describe('createFileGlobMatcher', () => {
  it('should create a matcher with allowed and denied patterns', () => {
    const matcher = createFileGlobMatcher(['**/*.ts'], ['**/*.test.ts']);

    expect(matcher.isAllowed('index.ts').matches).toBe(true);
    expect(matcher.isAllowed('index.test.ts').matches).toBe(false);
  });
});

describe('matchesAnyPattern', () => {
  it('should return true if path matches any pattern', () => {
    const patterns = ['**/*.ts', '**/*.tsx'];

    expect(matchesAnyPattern('file.ts', patterns)).toBe(true);
    expect(matchesAnyPattern('file.tsx', patterns)).toBe(true);
    expect(matchesAnyPattern('file.js', patterns)).toBe(false);
  });
});

describe('findMatchingPatterns', () => {
  it('should return all patterns that match a path', () => {
    const patterns = ['**/*.ts', 'src/**/*', '**/*'];
    const matching = findMatchingPatterns('src/index.ts', patterns);

    expect(matching).toContain('**/*.ts');
    expect(matching).toContain('src/**/*');
    expect(matching).toContain('**/*');
  });

  it('should return empty array if no patterns match', () => {
    const patterns = ['**/*.js', 'lib/**/*'];
    const matching = findMatchingPatterns('src/index.ts', patterns);

    expect(matching).toHaveLength(0);
  });
});
