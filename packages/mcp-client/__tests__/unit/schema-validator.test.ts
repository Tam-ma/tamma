/**
 * Schema validator unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateSchema,
  validateToolArguments,
  applyDefaults,
} from '../../src/utils/schema-validator.js';
import { MCPValidationError } from '../../src/errors.js';
import { sampleToolSchemas } from '../mocks/fixtures.js';

describe('Schema Validator', () => {
  describe('validateSchema', () => {
    describe('type validation', () => {
      it('should validate string type', () => {
        const schema = { type: 'string' };

        expect(validateSchema('hello', schema).valid).toBe(true);
        expect(validateSchema(123, schema).valid).toBe(false);
        expect(validateSchema(null, schema).valid).toBe(false);
      });

      it('should validate number type', () => {
        const schema = { type: 'number' };

        expect(validateSchema(123, schema).valid).toBe(true);
        expect(validateSchema(12.5, schema).valid).toBe(true);
        expect(validateSchema('123', schema).valid).toBe(false);
        expect(validateSchema(NaN, schema).valid).toBe(false);
      });

      it('should validate integer type', () => {
        const schema = { type: 'integer' };

        expect(validateSchema(123, schema).valid).toBe(true);
        expect(validateSchema(12.5, schema).valid).toBe(false);
        expect(validateSchema('123', schema).valid).toBe(false);
      });

      it('should validate boolean type', () => {
        const schema = { type: 'boolean' };

        expect(validateSchema(true, schema).valid).toBe(true);
        expect(validateSchema(false, schema).valid).toBe(true);
        expect(validateSchema('true', schema).valid).toBe(false);
        expect(validateSchema(1, schema).valid).toBe(false);
      });

      it('should validate array type', () => {
        const schema = { type: 'array' };

        expect(validateSchema([], schema).valid).toBe(true);
        expect(validateSchema([1, 2, 3], schema).valid).toBe(true);
        expect(validateSchema({}, schema).valid).toBe(false);
        expect(validateSchema('array', schema).valid).toBe(false);
      });

      it('should validate object type', () => {
        const schema = { type: 'object' };

        expect(validateSchema({}, schema).valid).toBe(true);
        expect(validateSchema({ key: 'value' }, schema).valid).toBe(true);
        expect(validateSchema([], schema).valid).toBe(false);
        expect(validateSchema(null, schema).valid).toBe(false);
      });

      it('should validate null type', () => {
        const schema = { type: 'null' };

        expect(validateSchema(null, schema).valid).toBe(true);
        expect(validateSchema(undefined, schema).valid).toBe(false);
        expect(validateSchema('', schema).valid).toBe(false);
      });
    });

    describe('object validation', () => {
      it('should validate required fields', () => {
        const schema = {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name'],
        };

        expect(validateSchema({ name: 'John' }, schema).valid).toBe(true);
        expect(validateSchema({ name: 'John', age: 30 }, schema).valid).toBe(true);
        expect(validateSchema({ age: 30 }, schema).valid).toBe(false);
        expect(validateSchema({}, schema).valid).toBe(false);
      });

      it('should validate nested properties', () => {
        const schema = {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
              required: ['name'],
            },
          },
        };

        expect(validateSchema({ user: { name: 'John' } }, schema).valid).toBe(true);
        expect(validateSchema({ user: { name: 123 } }, schema).valid).toBe(false);
        expect(validateSchema({ user: {} }, schema).valid).toBe(false);
      });
    });

    describe('array validation', () => {
      it('should validate array items', () => {
        const schema = {
          type: 'array',
          items: { type: 'string' },
        };

        expect(validateSchema(['a', 'b', 'c'], schema).valid).toBe(true);
        expect(validateSchema([], schema).valid).toBe(true);
        expect(validateSchema(['a', 1, 'c'], schema).valid).toBe(false);
      });

      it('should validate nested array items', () => {
        const schema = {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
            },
            required: ['id'],
          },
        };

        expect(validateSchema([{ id: 1 }, { id: 2 }], schema).valid).toBe(true);
        expect(validateSchema([{ id: 1 }, {}], schema).valid).toBe(false);
      });
    });

    describe('enum validation', () => {
      it('should validate enum values', () => {
        const schema = {
          type: 'string',
          enum: ['red', 'green', 'blue'],
        };

        expect(validateSchema('red', schema).valid).toBe(true);
        expect(validateSchema('green', schema).valid).toBe(true);
        expect(validateSchema('yellow', schema).valid).toBe(false);
      });

      it('should validate enum with mixed types', () => {
        const schema = {
          enum: ['a', 1, true, null],
        };

        expect(validateSchema('a', schema).valid).toBe(true);
        expect(validateSchema(1, schema).valid).toBe(true);
        expect(validateSchema(true, schema).valid).toBe(true);
        expect(validateSchema(null, schema).valid).toBe(true);
        expect(validateSchema('b', schema).valid).toBe(false);
      });
    });

    describe('string constraints', () => {
      it('should validate minLength', () => {
        const schema = { type: 'string', minLength: 3 };

        expect(validateSchema('hello', schema).valid).toBe(true);
        expect(validateSchema('hi', schema).valid).toBe(false);
      });

      it('should validate maxLength', () => {
        const schema = { type: 'string', maxLength: 5 };

        expect(validateSchema('hello', schema).valid).toBe(true);
        expect(validateSchema('hello!', schema).valid).toBe(false);
      });

      it('should validate pattern', () => {
        const schema = { type: 'string', pattern: '^[a-z]+$' };

        expect(validateSchema('hello', schema).valid).toBe(true);
        expect(validateSchema('Hello', schema).valid).toBe(false);
        expect(validateSchema('hello123', schema).valid).toBe(false);
      });
    });

    describe('number constraints', () => {
      it('should validate minimum', () => {
        const schema = { type: 'number', minimum: 0 };

        expect(validateSchema(0, schema).valid).toBe(true);
        expect(validateSchema(10, schema).valid).toBe(true);
        expect(validateSchema(-1, schema).valid).toBe(false);
      });

      it('should validate maximum', () => {
        const schema = { type: 'number', maximum: 100 };

        expect(validateSchema(100, schema).valid).toBe(true);
        expect(validateSchema(50, schema).valid).toBe(true);
        expect(validateSchema(101, schema).valid).toBe(false);
      });
    });

    describe('error reporting', () => {
      it('should report path for nested errors', () => {
        const schema = {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
            },
          },
        };

        const result = validateSchema({ user: { name: 123 } }, schema);

        expect(result.valid).toBe(false);
        expect(result.errors[0]?.path).toBe('user.name');
      });

      it('should report path for array errors', () => {
        const schema = {
          type: 'array',
          items: { type: 'string' },
        };

        const result = validateSchema(['a', 123, 'c'], schema);

        expect(result.valid).toBe(false);
        expect(result.errors[0]?.path).toBe('[1]');
      });
    });
  });

  describe('validateToolArguments', () => {
    it('should not throw for valid arguments', () => {
      const schema = sampleToolSchemas['echo']!;

      expect(() => {
        validateToolArguments({ message: 'Hello' }, schema, 'echo');
      }).not.toThrow();
    });

    it('should throw MCPValidationError for invalid arguments', () => {
      const schema = sampleToolSchemas['echo']!;

      expect(() => {
        validateToolArguments({}, schema, 'echo');
      }).toThrow(MCPValidationError);
    });

    it('should include tool name in error message', () => {
      const schema = sampleToolSchemas['echo']!;

      try {
        validateToolArguments({}, schema, 'my-tool');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPValidationError);
        expect((error as MCPValidationError).message).toContain('my-tool');
      }
    });

    it('should validate complex schemas', () => {
      const schema = sampleToolSchemas['calculate']!;

      expect(() => {
        validateToolArguments(
          { operation: 'add', a: 1, b: 2 },
          schema,
          'calculate'
        );
      }).not.toThrow();

      expect(() => {
        validateToolArguments(
          { operation: 'invalid', a: 1, b: 2 },
          schema,
          'calculate'
        );
      }).toThrow(MCPValidationError);
    });
  });

  describe('applyDefaults', () => {
    it('should apply default values', () => {
      const schema = {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 },
          offset: { type: 'number', default: 0 },
        },
      };

      const result = applyDefaults({ query: 'test' }, schema);

      expect(result).toEqual({
        query: 'test',
        limit: 10,
        offset: 0,
      });
    });

    it('should not override provided values', () => {
      const schema = {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 10 },
        },
      };

      const result = applyDefaults({ limit: 50 }, schema);

      expect(result.limit).toBe(50);
    });

    it('should handle missing properties', () => {
      const schema = {
        type: 'object',
      };

      const result = applyDefaults({ key: 'value' }, schema);

      expect(result).toEqual({ key: 'value' });
    });
  });
});
