/**
 * Sandbox utilities unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OutputCollector,
  PathValidator,
  createSandboxEnv,
  DEFAULT_SANDBOX_OPTIONS,
} from '../../src/security/sandbox.js';

describe('OutputCollector', () => {
  let collector: OutputCollector;

  beforeEach(() => {
    collector = new OutputCollector(100); // 100 byte limit
  });

  describe('add', () => {
    it('should add data', () => {
      const result = collector.add('Hello');

      expect(result).toBe(true);
      expect(collector.getSize()).toBe(5);
    });

    it('should add buffer data', () => {
      const result = collector.add(Buffer.from('Hello'));

      expect(result).toBe(true);
      expect(collector.getSize()).toBe(5);
    });

    it('should return false when limit exceeded', () => {
      collector.add('x'.repeat(90));
      const result = collector.add('x'.repeat(20));

      expect(result).toBe(false);
      expect(collector.wasTruncated()).toBe(true);
    });

    it('should partially add data at limit', () => {
      collector.add('x'.repeat(90));
      collector.add('y'.repeat(20));

      // Should have added 10 bytes of 'y'
      expect(collector.getSize()).toBe(100);
      expect(collector.toString()).toContain('x'.repeat(90));
      expect(collector.toString()).toContain('y'.repeat(10));
    });
  });

  describe('toString', () => {
    it('should return collected data as string', () => {
      collector.add('Hello, ');
      collector.add('World!');

      expect(collector.toString()).toBe('Hello, World!');
    });
  });

  describe('toBuffer', () => {
    it('should return collected data as buffer', () => {
      collector.add('Hello');

      const buffer = collector.toBuffer();

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString()).toBe('Hello');
    });
  });

  describe('wasTruncated', () => {
    it('should return false when not truncated', () => {
      collector.add('Hello');

      expect(collector.wasTruncated()).toBe(false);
    });

    it('should return true when truncated', () => {
      collector.add('x'.repeat(150));

      expect(collector.wasTruncated()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      collector.add('x'.repeat(150));
      collector.reset();

      expect(collector.getSize()).toBe(0);
      expect(collector.wasTruncated()).toBe(false);
      expect(collector.toString()).toBe('');
    });
  });
});

describe('PathValidator', () => {
  describe('with allowed paths', () => {
    let validator: PathValidator;

    beforeEach(() => {
      validator = new PathValidator(['/workspace', '/home/user/projects']);
    });

    it('should allow exact match', () => {
      expect(validator.isAllowed('/workspace')).toBe(true);
      expect(validator.isAllowed('/home/user/projects')).toBe(true);
    });

    it('should allow subpaths', () => {
      expect(validator.isAllowed('/workspace/src/file.ts')).toBe(true);
      expect(validator.isAllowed('/home/user/projects/myapp/index.js')).toBe(true);
    });

    it('should reject paths outside allowed', () => {
      expect(validator.isAllowed('/etc/passwd')).toBe(false);
      expect(validator.isAllowed('/home/user/secret')).toBe(false);
    });

    it('should reject partial matches', () => {
      expect(validator.isAllowed('/workspace2')).toBe(false);
      expect(validator.isAllowed('/home/user/projectsmore')).toBe(false);
    });

    it('should normalize paths', () => {
      expect(validator.isAllowed('/workspace/')).toBe(true);
      expect(validator.isAllowed('/workspace//src')).toBe(true);
    });
  });

  describe('validate', () => {
    it('should throw for disallowed path', () => {
      const validator = new PathValidator(['/workspace']);

      expect(() => validator.validate('/etc/passwd')).toThrow();
    });

    it('should not throw for allowed path', () => {
      const validator = new PathValidator(['/workspace']);

      expect(() => validator.validate('/workspace/file.ts')).not.toThrow();
    });
  });

  describe('without allowed paths', () => {
    it('should allow any path', () => {
      const validator = new PathValidator();

      expect(validator.isAllowed('/any/path')).toBe(true);
      expect(validator.isAllowed('/etc/passwd')).toBe(true);
    });
  });
});

describe('createSandboxEnv', () => {
  it('should include CI=true', () => {
    const env = createSandboxEnv();

    expect(env['CI']).toBe('true');
  });

  it('should disable browser', () => {
    const env = createSandboxEnv();

    expect(env['BROWSER']).toBe('none');
  });

  it('should disable colors', () => {
    const env = createSandboxEnv();

    expect(env['NO_COLOR']).toBe('1');
    expect(env['FORCE_COLOR']).toBe('0');
  });

  it('should disable telemetry', () => {
    const env = createSandboxEnv();

    expect(env['DO_NOT_TRACK']).toBe('1');
  });

  it('should merge with base env', () => {
    const env = createSandboxEnv({
      MY_VAR: 'value',
      PATH: '/usr/bin',
    });

    expect(env['MY_VAR']).toBe('value');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['CI']).toBe('true');
  });
});

describe('DEFAULT_SANDBOX_OPTIONS', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_SANDBOX_OPTIONS.maxCpuTime).toBe(60);
    expect(DEFAULT_SANDBOX_OPTIONS.maxMemory).toBe(512 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_OPTIONS.maxOutputSize).toBe(10 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_OPTIONS.killTimeout).toBe(5000);
  });
});
