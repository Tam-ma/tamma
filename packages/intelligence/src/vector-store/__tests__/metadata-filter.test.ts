/**
 * Tests for Metadata Filter Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateMetadataFilter,
  isEmptyFilter,
  toChromaDBFilter,
  toPgVectorFilter,
  mergeFilters,
  whereEquals,
  whereIn,
  whereRange,
} from '../utils/metadata-filter.js';
import { VectorStoreErrorCode } from '../errors.js';
import type { MetadataFilter } from '../interfaces.js';

describe('validateMetadataFilter', () => {
  it('should accept valid filter', () => {
    const filter: MetadataFilter = {
      where: { language: 'typescript' },
      whereGt: { startLine: 10 },
      whereLte: { endLine: 100 },
    };

    expect(() => validateMetadataFilter(filter)).not.toThrow();
  });

  it('should reject non-numeric values in numeric filters', () => {
    const filter: MetadataFilter = {
      whereGt: { startLine: 'not a number' as unknown as number },
    };

    expect(() => validateMetadataFilter(filter)).toThrow();
  });

  it('should reject non-array values in whereIn', () => {
    const filter: MetadataFilter = {
      whereIn: { language: 'typescript' as unknown as unknown[] },
    };

    expect(() => validateMetadataFilter(filter)).toThrow();
  });

  it('should reject non-string values in whereContains', () => {
    const filter: MetadataFilter = {
      whereContains: { name: 123 as unknown as string },
    };

    expect(() => validateMetadataFilter(filter)).toThrow();
  });

  it('should validate nested filters', () => {
    const filter: MetadataFilter = {
      and: [
        { where: { language: 'typescript' } },
        { whereGt: { startLine: 'invalid' as unknown as number } },
      ],
    };

    expect(() => validateMetadataFilter(filter)).toThrow();
  });
});

describe('isEmptyFilter', () => {
  it('should return true for undefined', () => {
    expect(isEmptyFilter(undefined)).toBe(true);
  });

  it('should return true for empty object', () => {
    expect(isEmptyFilter({})).toBe(true);
  });

  it('should return true for filter with empty properties', () => {
    const filter: MetadataFilter = {
      where: {},
      whereIn: {},
      and: [],
    };
    expect(isEmptyFilter(filter)).toBe(true);
  });

  it('should return false for filter with conditions', () => {
    expect(isEmptyFilter({ where: { language: 'typescript' } })).toBe(false);
    expect(isEmptyFilter({ whereIn: { types: ['a', 'b'] } })).toBe(false);
    expect(isEmptyFilter({ whereGt: { line: 10 } })).toBe(false);
  });

  it('should return false for nested filters', () => {
    const filter: MetadataFilter = {
      and: [{ where: { language: 'typescript' } }],
    };
    expect(isEmptyFilter(filter)).toBe(false);
  });
});

describe('toChromaDBFilter', () => {
  it('should convert simple where clause', () => {
    const filter: MetadataFilter = {
      where: { language: 'typescript' },
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({ language: { $eq: 'typescript' } });
  });

  it('should convert whereIn clause', () => {
    const filter: MetadataFilter = {
      whereIn: { language: ['typescript', 'javascript'] },
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({ language: { $in: ['typescript', 'javascript'] } });
  });

  it('should convert whereNotIn clause', () => {
    const filter: MetadataFilter = {
      whereNotIn: { language: ['python', 'ruby'] },
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({ language: { $nin: ['python', 'ruby'] } });
  });

  it('should convert numeric comparison clauses', () => {
    const filter: MetadataFilter = {
      whereGt: { startLine: 10 },
      whereLte: { endLine: 100 },
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({
      $and: [{ startLine: { $gt: 10 } }, { endLine: { $lte: 100 } }],
    });
  });

  it('should convert whereContains clause', () => {
    const filter: MetadataFilter = {
      whereContains: { name: 'auth' },
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({ name: { $contains: 'auth' } });
  });

  it('should handle nested AND conditions', () => {
    const filter: MetadataFilter = {
      and: [{ where: { language: 'typescript' } }, { where: { chunkType: 'function' } }],
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({
      $and: [{ language: { $eq: 'typescript' } }, { chunkType: { $eq: 'function' } }],
    });
  });

  it('should handle nested OR conditions', () => {
    const filter: MetadataFilter = {
      or: [{ where: { chunkType: 'function' } }, { where: { chunkType: 'class' } }],
    };

    const result = toChromaDBFilter(filter);
    expect(result).toEqual({
      $or: [{ chunkType: { $eq: 'function' } }, { chunkType: { $eq: 'class' } }],
    });
  });

  it('should return empty object for empty filter', () => {
    expect(toChromaDBFilter({})).toEqual({});
  });
});

describe('toPgVectorFilter', () => {
  it('should convert simple where clause', () => {
    const filter: MetadataFilter = {
      where: { language: 'typescript' },
    };

    const result = toPgVectorFilter(filter);
    expect(result.sql).toBe("metadata->>'language' = $1");
    expect(result.params).toEqual(['typescript']);
  });

  it('should convert whereIn clause', () => {
    const filter: MetadataFilter = {
      whereIn: { language: ['typescript', 'javascript'] },
    };

    const result = toPgVectorFilter(filter);
    expect(result.sql).toBe("metadata->>'language' IN ($1, $2)");
    expect(result.params).toEqual(['typescript', 'javascript']);
  });

  it('should convert numeric comparison clauses', () => {
    const filter: MetadataFilter = {
      whereGt: { startLine: 10 },
    };

    const result = toPgVectorFilter(filter);
    expect(result.sql).toBe("(metadata->>'startLine')::numeric > $1");
    expect(result.params).toEqual([10]);
  });

  it('should convert whereContains with LIKE', () => {
    const filter: MetadataFilter = {
      whereContains: { name: 'auth' },
    };

    const result = toPgVectorFilter(filter);
    expect(result.sql).toBe("metadata->>'name' LIKE $1");
    expect(result.params).toEqual(['%auth%']);
  });

  it('should handle parameter offset', () => {
    const filter: MetadataFilter = {
      where: { language: 'typescript' },
    };

    const result = toPgVectorFilter(filter, 5);
    expect(result.sql).toBe("metadata->>'language' = $5");
  });

  it('should combine multiple conditions with AND', () => {
    const filter: MetadataFilter = {
      where: { language: 'typescript' },
      whereGt: { startLine: 10 },
    };

    const result = toPgVectorFilter(filter);
    expect(result.sql).toContain(' AND ');
    expect(result.params.length).toBe(2);
  });

  it('should escape special characters in identifiers', () => {
    const filter: MetadataFilter = {
      where: { 'field.with.dots': 'value' },
    };

    const result = toPgVectorFilter(filter);
    // Dots should be removed
    expect(result.sql).toBe("metadata->>'fieldwithdots' = $1");
  });

  it('should escape special characters in LIKE patterns', () => {
    const filter: MetadataFilter = {
      whereContains: { name: '100%_test' },
    };

    const result = toPgVectorFilter(filter);
    // % and _ should be escaped
    expect(result.params[0]).toBe('%100\\%\\_test%');
  });
});

describe('mergeFilters', () => {
  it('should return empty filter for no inputs', () => {
    expect(mergeFilters()).toEqual({});
  });

  it('should return empty filter for undefined inputs', () => {
    expect(mergeFilters(undefined, undefined)).toEqual({});
  });

  it('should return single filter unchanged', () => {
    const filter: MetadataFilter = { where: { language: 'typescript' } };
    expect(mergeFilters(filter)).toEqual(filter);
  });

  it('should merge multiple filters with AND', () => {
    const filter1: MetadataFilter = { where: { language: 'typescript' } };
    const filter2: MetadataFilter = { whereGt: { startLine: 10 } };

    const result = mergeFilters(filter1, filter2);
    expect(result).toEqual({
      and: [filter1, filter2],
    });
  });

  it('should skip empty filters', () => {
    const filter: MetadataFilter = { where: { language: 'typescript' } };
    const result = mergeFilters({}, filter, undefined);
    expect(result).toEqual(filter);
  });
});

describe('whereEquals', () => {
  it('should create equality filter', () => {
    const filter = whereEquals('language', 'typescript');
    expect(filter).toEqual({
      where: { language: 'typescript' },
    });
  });
});

describe('whereIn', () => {
  it('should create in-list filter', () => {
    const filter = whereIn('language', ['typescript', 'javascript']);
    expect(filter).toEqual({
      whereIn: { language: ['typescript', 'javascript'] },
    });
  });
});

describe('whereRange', () => {
  it('should create inclusive range filter', () => {
    const filter = whereRange('lineNumber', 10, 100);
    expect(filter).toEqual({
      whereGte: { lineNumber: 10 },
      whereLte: { lineNumber: 100 },
    });
  });
});
