import { describe, it, expect } from 'vitest';
import {
  ToolMatcher,
  createToolMatcher,
  isValidToolName,
  normalizeToolName,
} from './tool-matcher.js';

describe('ToolMatcher', () => {
  describe('isAllowed', () => {
    it('should return true for tools in allowed list', () => {
      const matcher = new ToolMatcher(['Read', 'Write', 'Edit'], [], []);

      expect(matcher.isAllowed('Read')).toBe(true);
      expect(matcher.isAllowed('Write')).toBe(true);
      expect(matcher.isAllowed('Edit')).toBe(true);
    });

    it('should return false for tools not in allowed list', () => {
      const matcher = new ToolMatcher(['Read', 'Write'], [], []);

      expect(matcher.isAllowed('Bash')).toBe(false);
      expect(matcher.isAllowed('Edit')).toBe(false);
    });

    it('should trim whitespace', () => {
      const matcher = new ToolMatcher(['Read'], [], []);

      expect(matcher.isAllowed('  Read  ')).toBe(true);
    });
  });

  describe('isDenied', () => {
    it('should return true for tools in denied list', () => {
      const matcher = new ToolMatcher([], ['Bash', 'Write'], []);

      expect(matcher.isDenied('Bash')).toBe(true);
      expect(matcher.isDenied('Write')).toBe(true);
    });

    it('should return false for tools not in denied list', () => {
      const matcher = new ToolMatcher([], ['Bash'], []);

      expect(matcher.isDenied('Read')).toBe(false);
    });
  });

  describe('requiresApproval', () => {
    it('should return true for tools requiring approval', () => {
      const matcher = new ToolMatcher([], [], ['Edit', 'Write']);

      expect(matcher.requiresApproval('Edit')).toBe(true);
      expect(matcher.requiresApproval('Write')).toBe(true);
    });

    it('should return false for tools not requiring approval', () => {
      const matcher = new ToolMatcher([], [], ['Edit']);

      expect(matcher.requiresApproval('Read')).toBe(false);
    });
  });

  describe('check', () => {
    it('should prioritize denied over other categories', () => {
      const matcher = new ToolMatcher(['Bash'], ['Bash'], ['Bash']);
      const result = matcher.check('Bash');

      expect(result.matchedIn).toBe('denied');
    });

    it('should check requireApproval before allowed', () => {
      const matcher = new ToolMatcher(['Edit'], [], ['Edit']);
      const result = matcher.check('Edit');

      expect(result.matchedIn).toBe('requireApproval');
    });

    it('should return allowed for allowed tools', () => {
      const matcher = new ToolMatcher(['Read'], [], []);
      const result = matcher.check('Read');

      expect(result.matchedIn).toBe('allowed');
    });

    it('should return none for unrecognized tools', () => {
      const matcher = new ToolMatcher(['Read'], ['Bash'], []);
      const result = matcher.check('Unknown');

      expect(result.matchedIn).toBe('none');
      expect(result.matches).toBe(false);
    });
  });

  describe('wildcard patterns', () => {
    it('should match wildcard patterns in allowed list', () => {
      const matcher = new ToolMatcher(['Read*', 'Write*'], [], []);

      expect(matcher.isAllowed('Read')).toBe(true);
      expect(matcher.isAllowed('ReadFile')).toBe(true);
      expect(matcher.isAllowed('Write')).toBe(true);
      expect(matcher.isAllowed('WriteFile')).toBe(true);
    });

    it('should match wildcard patterns in denied list', () => {
      const matcher = new ToolMatcher([], ['Bash*'], []);

      expect(matcher.isDenied('Bash')).toBe(true);
      expect(matcher.isDenied('BashCommand')).toBe(true);
    });
  });

  describe('getLists', () => {
    it('should return all tool lists', () => {
      const matcher = new ToolMatcher(['Read', 'Write'], ['Bash'], ['Edit']);
      const lists = matcher.getLists();

      expect(lists.allowed).toEqual(['Read', 'Write']);
      expect(lists.denied).toEqual(['Bash']);
      expect(lists.requireApproval).toEqual(['Edit']);
    });
  });
});

describe('createToolMatcher', () => {
  it('should create a matcher with allowed and denied lists', () => {
    const matcher = createToolMatcher(['Read', 'Glob'], ['Bash', 'Write']);

    expect(matcher.isAllowed('Read')).toBe(true);
    expect(matcher.isDenied('Bash')).toBe(true);
  });

  it('should create a matcher with requireApproval list', () => {
    const matcher = createToolMatcher(['Read'], [], ['Edit']);

    expect(matcher.requiresApproval('Edit')).toBe(true);
  });
});

describe('isValidToolName', () => {
  it('should accept valid tool names', () => {
    expect(isValidToolName('Read')).toBe(true);
    expect(isValidToolName('WebFetch')).toBe(true);
    expect(isValidToolName('glob_matcher')).toBe(true);
    expect(isValidToolName('tool-name')).toBe(true);
  });

  it('should reject invalid tool names', () => {
    expect(isValidToolName('')).toBe(false);
    expect(isValidToolName('123')).toBe(false);
    expect(isValidToolName('_underscore')).toBe(false);
    expect(isValidToolName('tool name')).toBe(false);
    expect(isValidToolName('tool.name')).toBe(false);
  });
});

describe('normalizeToolName', () => {
  it('should capitalize first letter', () => {
    expect(normalizeToolName('read')).toBe('Read');
    expect(normalizeToolName('webFetch')).toBe('WebFetch');
  });

  it('should trim whitespace', () => {
    expect(normalizeToolName('  Read  ')).toBe('Read');
  });

  it('should handle empty string', () => {
    expect(normalizeToolName('')).toBe('');
    expect(normalizeToolName('   ')).toBe('');
  });
});
