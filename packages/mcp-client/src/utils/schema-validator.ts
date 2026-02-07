/**
 * @tamma/mcp-client
 * JSON Schema validation utilities
 */

import type { JSONSchema } from '../types.js';
import { MCPValidationError } from '../errors.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

/**
 * Validate a value against a JSON Schema
 *
 * This is a simplified JSON Schema validator that handles common cases.
 * For production use with complex schemas, consider using a full validator like ajv.
 */
export function validateSchema(
  value: unknown,
  schema: JSONSchema,
  path = ''
): ValidationResult {
  const errors: ValidationError[] = [];

  // Type validation
  if (schema.type !== undefined) {
    const typeErrors = validateType(value, schema.type, path);
    errors.push(...typeErrors);

    // If type doesn't match, skip further validation
    if (typeErrors.length > 0) {
      return { valid: false, errors };
    }
  }

  // Object validation
  if (schema.type === 'object' && typeof value === 'object' && value !== null) {
    const objValue = value as Record<string, unknown>;

    // Required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in objValue)) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            message: `Missing required field '${field}'`,
          });
        }
      }
    }

    // Properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in objValue) {
          const propResult = validateSchema(
            objValue[key],
            propSchema,
            path ? `${path}.${key}` : key
          );
          errors.push(...propResult.errors);
        }
      }
    }
  }

  // Array validation
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`;
        const itemResult = validateSchema(value[i], schema.items, itemPath);
        errors.push(...itemResult.errors);
      }
    }
  }

  // Enum validation
  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    if (!schema.enum.some((enumValue) => deepEqual(value, enumValue))) {
      errors.push({
        path,
        message: `Value must be one of: ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`,
        expected: schema.enum.map(v => String(v)).join(' | '),
        actual: String(value),
      });
    }
  }

  // String validation
  if (schema.type === 'string' && typeof value === 'string') {
    // minLength
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      errors.push({
        path,
        message: `String must be at least ${schema['minLength']} characters`,
        expected: `>= ${schema['minLength']} characters`,
        actual: `${value.length} characters`,
      });
    }

    // maxLength
    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
      errors.push({
        path,
        message: `String must be at most ${schema['maxLength']} characters`,
        expected: `<= ${schema['maxLength']} characters`,
        actual: `${value.length} characters`,
      });
    }

    // pattern
    if (typeof schema['pattern'] === 'string') {
      const regex = new RegExp(schema['pattern']);
      if (!regex.test(value)) {
        errors.push({
          path,
          message: `String must match pattern: ${schema['pattern']}`,
          expected: schema['pattern'],
          actual: value,
        });
      }
    }
  }

  // Number validation
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
    // minimum
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      errors.push({
        path,
        message: `Value must be >= ${schema['minimum']}`,
        expected: `>= ${schema['minimum']}`,
        actual: String(value),
      });
    }

    // maximum
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      errors.push({
        path,
        message: `Value must be <= ${schema['maximum']}`,
        expected: `<= ${schema['maximum']}`,
        actual: String(value),
      });
    }

    // integer check
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push({
        path,
        message: 'Value must be an integer',
        expected: 'integer',
        actual: String(value),
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a value's type
 */
function validateType(value: unknown, type: string, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const actualType = getJSONType(value);

  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push({
          path,
          message: `Expected string, got ${actualType}`,
          expected: 'string',
          actual: actualType,
        });
      }
      break;

    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({
          path,
          message: `Expected number, got ${actualType}`,
          expected: 'number',
          actual: actualType,
        });
      }
      break;

    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push({
          path,
          message: `Expected integer, got ${actualType}`,
          expected: 'integer',
          actual: actualType,
        });
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({
          path,
          message: `Expected boolean, got ${actualType}`,
          expected: 'boolean',
          actual: actualType,
        });
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push({
          path,
          message: `Expected array, got ${actualType}`,
          expected: 'array',
          actual: actualType,
        });
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({
          path,
          message: `Expected object, got ${actualType}`,
          expected: 'object',
          actual: actualType,
        });
      }
      break;

    case 'null':
      if (value !== null) {
        errors.push({
          path,
          message: `Expected null, got ${actualType}`,
          expected: 'null',
          actual: actualType,
        });
      }
      break;
  }

  return errors;
}

/**
 * Get the JSON type of a value
 */
function getJSONType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return 'NaN';
  }
  return typeof value;
}

/**
 * Deep equality check
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (typeof a !== 'object' || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

/**
 * Validate tool arguments against a tool schema
 * Throws MCPValidationError if validation fails
 */
export function validateToolArguments(
  args: Record<string, unknown>,
  schema: JSONSchema,
  toolName: string
): void {
  const result = validateSchema(args, schema);

  if (!result.valid) {
    throw new MCPValidationError(
      `Invalid arguments for tool '${toolName}': ${result.errors.map(e => e.message).join('; ')}`,
      {
        toolName,
        errors: result.errors,
        args,
      }
    );
  }
}

/**
 * Apply default values from a schema to arguments
 */
export function applyDefaults(
  args: Record<string, unknown>,
  schema: JSONSchema
): Record<string, unknown> {
  const result = { ...args };

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in result) && propSchema.default !== undefined) {
        result[key] = propSchema.default;
      }
    }
  }

  return result;
}
