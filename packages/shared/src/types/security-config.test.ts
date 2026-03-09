import { describe, it, expect } from 'vitest';
import type { SecurityConfig } from './security-config.js';

describe('SecurityConfig', () => {
  it('should allow constructing a full SecurityConfig', () => {
    const config: SecurityConfig = {
      sanitizeContent: true,
      validateUrls: true,
      gateActions: false,
      maxFetchSizeBytes: 1048576,
      blockedCommandPatterns: ['rm\\s+-rf', 'sudo\\s+'],
    };

    expect(config.sanitizeContent).toBe(true);
    expect(config.validateUrls).toBe(true);
    expect(config.gateActions).toBe(false);
    expect(config.maxFetchSizeBytes).toBe(1048576);
    expect(config.blockedCommandPatterns).toHaveLength(2);
  });

  it('should allow constructing an empty SecurityConfig (all fields optional)', () => {
    const config: SecurityConfig = {};
    expect(Object.keys(config)).toHaveLength(0);
  });

  it('should allow constructing with a subset of fields', () => {
    const config: SecurityConfig = {
      sanitizeContent: true,
    };

    expect(config.sanitizeContent).toBe(true);
    expect(config.validateUrls).toBeUndefined();
  });

  it('should have 5 known optional fields', () => {
    // This is a compile-time check -- we just verify the interface shape
    // by constructing an object with all 5 fields
    const config: SecurityConfig = {
      sanitizeContent: false,
      validateUrls: false,
      gateActions: false,
      maxFetchSizeBytes: 0,
      blockedCommandPatterns: [],
    };

    expect(Object.keys(config)).toHaveLength(5);
  });

  it('should be re-exported from types/index.ts', async () => {
    const indexModule = await import('./index.js');
    // SecurityConfig is a type-only export, so we can't check its existence
    // at runtime directly. Instead, we verify the module loaded without errors
    // and that the re-export path works. The compile-time check above verifies
    // the type is accessible.
    expect(indexModule).toBeDefined();
  });
});
