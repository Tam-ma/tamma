/**
 * Metadata Filter Utilities
 *
 * Utilities for validating, parsing, and building metadata filters
 * for different vector store providers.
 */

import type { MetadataFilter } from '../interfaces.js';
import { VectorStoreError, VectorStoreErrorCode } from '../errors.js';

/**
 * Validate a metadata filter structure
 *
 * @param filter - Filter to validate
 * @throws VectorStoreError if filter is invalid
 */
export function validateMetadataFilter(filter: MetadataFilter): void {
  // Check that numeric comparisons have numeric values
  const numericFields: (keyof MetadataFilter)[] = ['whereGt', 'whereGte', 'whereLt', 'whereLte'];

  for (const field of numericFields) {
    const value = filter[field];
    if (value !== undefined) {
      for (const [key, val] of Object.entries(value)) {
        if (typeof val !== 'number') {
          throw new VectorStoreError(
            `Invalid filter: ${field}.${key} must be a number, got ${typeof val}`,
            VectorStoreErrorCode.INVALID_FILTER,
          );
        }
      }
    }
  }

  // Check that whereIn and whereNotIn have array values
  const arrayFields: (keyof MetadataFilter)[] = ['whereIn', 'whereNotIn'];

  for (const field of arrayFields) {
    const value = filter[field];
    if (value !== undefined) {
      for (const [key, val] of Object.entries(value)) {
        if (!Array.isArray(val)) {
          throw new VectorStoreError(
            `Invalid filter: ${field}.${key} must be an array, got ${typeof val}`,
            VectorStoreErrorCode.INVALID_FILTER,
          );
        }
      }
    }
  }

  // Check that whereContains has string values
  if (filter.whereContains !== undefined) {
    for (const [key, val] of Object.entries(filter.whereContains)) {
      if (typeof val !== 'string') {
        throw new VectorStoreError(
          `Invalid filter: whereContains.${key} must be a string, got ${typeof val}`,
          VectorStoreErrorCode.INVALID_FILTER,
        );
      }
    }
  }

  // Recursively validate nested filters
  if (filter.and !== undefined) {
    for (const nested of filter.and) {
      validateMetadataFilter(nested);
    }
  }

  if (filter.or !== undefined) {
    for (const nested of filter.or) {
      validateMetadataFilter(nested);
    }
  }
}

/**
 * Check if a filter is empty (no conditions)
 */
export function isEmptyFilter(filter: MetadataFilter | undefined): boolean {
  if (filter === undefined) {
    return true;
  }

  return (
    Object.keys(filter.where ?? {}).length === 0 &&
    Object.keys(filter.whereIn ?? {}).length === 0 &&
    Object.keys(filter.whereNotIn ?? {}).length === 0 &&
    Object.keys(filter.whereGt ?? {}).length === 0 &&
    Object.keys(filter.whereGte ?? {}).length === 0 &&
    Object.keys(filter.whereLt ?? {}).length === 0 &&
    Object.keys(filter.whereLte ?? {}).length === 0 &&
    Object.keys(filter.whereContains ?? {}).length === 0 &&
    (filter.and === undefined || filter.and.length === 0) &&
    (filter.or === undefined || filter.or.length === 0)
  );
}

/**
 * ChromaDB where clause type
 */
export interface ChromaDBWhereClause {
  [key: string]:
    | unknown
    | { $eq?: unknown }
    | { $ne?: unknown }
    | { $gt?: number }
    | { $gte?: number }
    | { $lt?: number }
    | { $lte?: number }
    | { $in?: unknown[] }
    | { $nin?: unknown[] }
    | { $contains?: string }
    | { $and?: ChromaDBWhereClause[] }
    | { $or?: ChromaDBWhereClause[] };
}

/**
 * Convert a MetadataFilter to ChromaDB where clause format
 *
 * @param filter - Metadata filter
 * @returns ChromaDB-compatible where clause
 */
export function toChromaDBFilter(filter: MetadataFilter): ChromaDBWhereClause {
  const conditions: ChromaDBWhereClause[] = [];

  // Exact match conditions
  if (filter.where !== undefined) {
    for (const [key, value] of Object.entries(filter.where)) {
      conditions.push({ [key]: { $eq: value } });
    }
  }

  // In list conditions
  if (filter.whereIn !== undefined) {
    for (const [key, values] of Object.entries(filter.whereIn)) {
      conditions.push({ [key]: { $in: values } });
    }
  }

  // Not in list conditions
  if (filter.whereNotIn !== undefined) {
    for (const [key, values] of Object.entries(filter.whereNotIn)) {
      conditions.push({ [key]: { $nin: values } });
    }
  }

  // Greater than conditions
  if (filter.whereGt !== undefined) {
    for (const [key, value] of Object.entries(filter.whereGt)) {
      conditions.push({ [key]: { $gt: value } });
    }
  }

  // Greater than or equal conditions
  if (filter.whereGte !== undefined) {
    for (const [key, value] of Object.entries(filter.whereGte)) {
      conditions.push({ [key]: { $gte: value } });
    }
  }

  // Less than conditions
  if (filter.whereLt !== undefined) {
    for (const [key, value] of Object.entries(filter.whereLt)) {
      conditions.push({ [key]: { $lt: value } });
    }
  }

  // Less than or equal conditions
  if (filter.whereLte !== undefined) {
    for (const [key, value] of Object.entries(filter.whereLte)) {
      conditions.push({ [key]: { $lte: value } });
    }
  }

  // Contains conditions (for string fields)
  if (filter.whereContains !== undefined) {
    for (const [key, value] of Object.entries(filter.whereContains)) {
      conditions.push({ [key]: { $contains: value } });
    }
  }

  // Handle nested AND conditions
  if (filter.and !== undefined && filter.and.length > 0) {
    const nestedConditions = filter.and.map((f) => toChromaDBFilter(f));
    conditions.push({ $and: nestedConditions });
  }

  // Handle nested OR conditions
  if (filter.or !== undefined && filter.or.length > 0) {
    const nestedConditions = filter.or.map((f) => toChromaDBFilter(f));
    conditions.push({ $or: nestedConditions });
  }

  // Combine all conditions with AND
  if (conditions.length === 0) {
    return {};
  } else if (conditions.length === 1) {
    return conditions[0] as ChromaDBWhereClause;
  } else {
    return { $and: conditions };
  }
}

/**
 * SQL condition with parameters for pgvector
 */
export interface PgVectorSQLCondition {
  sql: string;
  params: unknown[];
}

/**
 * Convert a MetadataFilter to pgvector SQL WHERE clause
 *
 * @param filter - Metadata filter
 * @param paramOffset - Starting parameter number (for $1, $2, etc.)
 * @returns SQL condition with parameters
 */
export function toPgVectorFilter(
  filter: MetadataFilter,
  paramOffset: number = 1,
): PgVectorSQLCondition {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = paramOffset;

  // Exact match conditions
  if (filter.where !== undefined) {
    for (const [key, value] of Object.entries(filter.where)) {
      conditions.push(`metadata->>'${escapeIdentifier(key)}' = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  // In list conditions
  if (filter.whereIn !== undefined) {
    for (const [key, values] of Object.entries(filter.whereIn)) {
      const placeholders = values.map(() => {
        const ph = `$${paramIndex}`;
        paramIndex++;
        return ph;
      });
      conditions.push(
        `metadata->>'${escapeIdentifier(key)}' IN (${placeholders.join(', ')})`,
      );
      params.push(...values);
    }
  }

  // Not in list conditions
  if (filter.whereNotIn !== undefined) {
    for (const [key, values] of Object.entries(filter.whereNotIn)) {
      const placeholders = values.map(() => {
        const ph = `$${paramIndex}`;
        paramIndex++;
        return ph;
      });
      conditions.push(
        `metadata->>'${escapeIdentifier(key)}' NOT IN (${placeholders.join(', ')})`,
      );
      params.push(...values);
    }
  }

  // Greater than conditions
  if (filter.whereGt !== undefined) {
    for (const [key, value] of Object.entries(filter.whereGt)) {
      conditions.push(`(metadata->>'${escapeIdentifier(key)}')::numeric > $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  // Greater than or equal conditions
  if (filter.whereGte !== undefined) {
    for (const [key, value] of Object.entries(filter.whereGte)) {
      conditions.push(`(metadata->>'${escapeIdentifier(key)}')::numeric >= $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  // Less than conditions
  if (filter.whereLt !== undefined) {
    for (const [key, value] of Object.entries(filter.whereLt)) {
      conditions.push(`(metadata->>'${escapeIdentifier(key)}')::numeric < $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  // Less than or equal conditions
  if (filter.whereLte !== undefined) {
    for (const [key, value] of Object.entries(filter.whereLte)) {
      conditions.push(`(metadata->>'${escapeIdentifier(key)}')::numeric <= $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  // Contains conditions (using LIKE for string matching)
  if (filter.whereContains !== undefined) {
    for (const [key, value] of Object.entries(filter.whereContains)) {
      conditions.push(`metadata->>'${escapeIdentifier(key)}' LIKE $${paramIndex}`);
      params.push(`%${escapeForLike(value)}%`);
      paramIndex++;
    }
  }

  // Handle nested AND conditions
  if (filter.and !== undefined && filter.and.length > 0) {
    const nestedConditions: string[] = [];
    for (const nestedFilter of filter.and) {
      const nested = toPgVectorFilter(nestedFilter, paramIndex);
      if (nested.sql) {
        nestedConditions.push(`(${nested.sql})`);
        params.push(...nested.params);
        paramIndex += nested.params.length;
      }
    }
    if (nestedConditions.length > 0) {
      conditions.push(`(${nestedConditions.join(' AND ')})`);
    }
  }

  // Handle nested OR conditions
  if (filter.or !== undefined && filter.or.length > 0) {
    const nestedConditions: string[] = [];
    for (const nestedFilter of filter.or) {
      const nested = toPgVectorFilter(nestedFilter, paramIndex);
      if (nested.sql) {
        nestedConditions.push(`(${nested.sql})`);
        params.push(...nested.params);
        paramIndex += nested.params.length;
      }
    }
    if (nestedConditions.length > 0) {
      conditions.push(`(${nestedConditions.join(' OR ')})`);
    }
  }

  return {
    sql: conditions.join(' AND '),
    params,
  };
}

/**
 * Escape a PostgreSQL identifier (column/field name)
 */
function escapeIdentifier(identifier: string): string {
  // Remove any characters that aren't alphanumeric or underscore
  return identifier.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Escape special characters for SQL LIKE patterns
 */
function escapeForLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

/**
 * Merge multiple metadata filters with AND logic
 */
export function mergeFilters(...filters: (MetadataFilter | undefined)[]): MetadataFilter {
  const validFilters = filters.filter(
    (f): f is MetadataFilter => f !== undefined && !isEmptyFilter(f),
  );

  if (validFilters.length === 0) {
    return {};
  }

  if (validFilters.length === 1) {
    return validFilters[0] as MetadataFilter;
  }

  return {
    and: validFilters,
  };
}

/**
 * Create a simple equality filter
 */
export function whereEquals(field: string, value: unknown): MetadataFilter {
  return {
    where: { [field]: value },
  };
}

/**
 * Create an "in list" filter
 */
export function whereIn(field: string, values: unknown[]): MetadataFilter {
  return {
    whereIn: { [field]: values },
  };
}

/**
 * Create a range filter (inclusive)
 */
export function whereRange(field: string, min: number, max: number): MetadataFilter {
  return {
    whereGte: { [field]: min },
    whereLte: { [field]: max },
  };
}
