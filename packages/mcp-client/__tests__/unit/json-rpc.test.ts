/**
 * JSON-RPC utilities unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RequestIdGenerator,
  createRequest,
  createNotification,
  createSuccessResponse,
  createErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
  isJSONRPCError,
  isErrorResponse,
  parseMessage,
  serializeMessage,
  JSONRPCErrorCodes,
} from '../../src/utils/json-rpc.js';

describe('JSON-RPC Utilities', () => {
  describe('RequestIdGenerator', () => {
    let generator: RequestIdGenerator;

    beforeEach(() => {
      generator = new RequestIdGenerator();
    });

    it('should generate incrementing IDs', () => {
      expect(generator.next()).toBe(1);
      expect(generator.next()).toBe(2);
      expect(generator.next()).toBe(3);
    });

    it('should reset counter', () => {
      generator.next();
      generator.next();
      generator.reset();
      expect(generator.next()).toBe(1);
    });
  });

  describe('createRequest', () => {
    it('should create a valid request', () => {
      const request = createRequest(1, 'test/method');

      expect(request).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'test/method',
      });
    });

    it('should include params when provided', () => {
      const request = createRequest(1, 'test/method', { key: 'value' });

      expect(request).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'test/method',
        params: { key: 'value' },
      });
    });

    it('should accept string IDs', () => {
      const request = createRequest('abc-123', 'test/method');
      expect(request.id).toBe('abc-123');
    });
  });

  describe('createNotification', () => {
    it('should create a valid notification', () => {
      const notification = createNotification('test/event');

      expect(notification).toEqual({
        jsonrpc: '2.0',
        method: 'test/event',
      });
    });

    it('should include params when provided', () => {
      const notification = createNotification('test/event', { data: 123 });

      expect(notification).toEqual({
        jsonrpc: '2.0',
        method: 'test/event',
        params: { data: 123 },
      });
    });
  });

  describe('createSuccessResponse', () => {
    it('should create a valid success response', () => {
      const response = createSuccessResponse(1, { result: 'success' });

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { result: 'success' },
      });
    });

    it('should handle null result', () => {
      const response = createSuccessResponse(1, null);
      expect(response.result).toBeNull();
    });
  });

  describe('createErrorResponse', () => {
    it('should create a valid error response', () => {
      const response = createErrorResponse(1, -32600, 'Invalid Request');

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      });
    });

    it('should include data when provided', () => {
      const response = createErrorResponse(1, -32602, 'Invalid params', {
        field: 'name',
      });

      expect(response.error?.data).toEqual({ field: 'name' });
    });

    it('should accept null ID', () => {
      const response = createErrorResponse(null, -32700, 'Parse error');
      expect(response.id).toBeNull();
    });
  });

  describe('Type Guards', () => {
    describe('isJSONRPCRequest', () => {
      it('should return true for valid request', () => {
        expect(
          isJSONRPCRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'test',
          })
        ).toBe(true);
      });

      it('should return false for missing jsonrpc', () => {
        expect(isJSONRPCRequest({ id: 1, method: 'test' })).toBe(false);
      });

      it('should return false for missing id', () => {
        expect(isJSONRPCRequest({ jsonrpc: '2.0', method: 'test' })).toBe(false);
      });

      it('should return false for missing method', () => {
        expect(isJSONRPCRequest({ jsonrpc: '2.0', id: 1 })).toBe(false);
      });

      it('should return false for non-object', () => {
        expect(isJSONRPCRequest('string')).toBe(false);
        expect(isJSONRPCRequest(null)).toBe(false);
        expect(isJSONRPCRequest(undefined)).toBe(false);
      });
    });

    describe('isJSONRPCResponse', () => {
      it('should return true for success response', () => {
        expect(
          isJSONRPCResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {},
          })
        ).toBe(true);
      });

      it('should return true for error response', () => {
        expect(
          isJSONRPCResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32600, message: 'Invalid' },
          })
        ).toBe(true);
      });

      it('should return true for null ID', () => {
        expect(
          isJSONRPCResponse({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          })
        ).toBe(true);
      });

      it('should return false for missing result and error', () => {
        expect(isJSONRPCResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
      });
    });

    describe('isJSONRPCNotification', () => {
      it('should return true for valid notification', () => {
        expect(
          isJSONRPCNotification({
            jsonrpc: '2.0',
            method: 'test/event',
          })
        ).toBe(true);
      });

      it('should return false when id is present', () => {
        expect(
          isJSONRPCNotification({
            jsonrpc: '2.0',
            id: 1,
            method: 'test/event',
          })
        ).toBe(false);
      });
    });

    describe('isJSONRPCError', () => {
      it('should return true for valid error', () => {
        expect(
          isJSONRPCError({
            code: -32600,
            message: 'Invalid Request',
          })
        ).toBe(true);
      });

      it('should return false for missing code', () => {
        expect(isJSONRPCError({ message: 'Error' })).toBe(false);
      });

      it('should return false for missing message', () => {
        expect(isJSONRPCError({ code: -32600 })).toBe(false);
      });
    });

    describe('isErrorResponse', () => {
      it('should return true for error response', () => {
        expect(
          isErrorResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32600, message: 'Error' },
          })
        ).toBe(true);
      });

      it('should return false for success response', () => {
        expect(
          isErrorResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {},
          })
        ).toBe(false);
      });
    });
  });

  describe('parseMessage', () => {
    it('should parse a request', () => {
      const json = '{"jsonrpc":"2.0","id":1,"method":"test"}';
      const message = parseMessage(json);

      expect(isJSONRPCRequest(message)).toBe(true);
    });

    it('should parse a response', () => {
      const json = '{"jsonrpc":"2.0","id":1,"result":{}}';
      const message = parseMessage(json);

      expect(isJSONRPCResponse(message)).toBe(true);
    });

    it('should parse a notification', () => {
      const json = '{"jsonrpc":"2.0","method":"event"}';
      const message = parseMessage(json);

      expect(isJSONRPCNotification(message)).toBe(true);
    });

    it('should throw for invalid JSON', () => {
      expect(() => parseMessage('not json')).toThrow();
    });

    it('should throw for invalid message', () => {
      expect(() => parseMessage('{"invalid": true}')).toThrow('Invalid JSON-RPC message');
    });
  });

  describe('serializeMessage', () => {
    it('should serialize a request', () => {
      const request = createRequest(1, 'test');
      const json = serializeMessage(request);

      expect(JSON.parse(json)).toEqual(request);
    });

    it('should serialize a response', () => {
      const response = createSuccessResponse(1, { data: 'test' });
      const json = serializeMessage(response);

      expect(JSON.parse(json)).toEqual(response);
    });
  });

  describe('JSONRPCErrorCodes', () => {
    it('should have standard error codes', () => {
      expect(JSONRPCErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(JSONRPCErrorCodes.INVALID_REQUEST).toBe(-32600);
      expect(JSONRPCErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(JSONRPCErrorCodes.INVALID_PARAMS).toBe(-32602);
      expect(JSONRPCErrorCodes.INTERNAL_ERROR).toBe(-32603);
    });
  });
});
