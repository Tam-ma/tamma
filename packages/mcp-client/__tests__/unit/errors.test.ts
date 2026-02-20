/**
 * Error classes unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPToolError,
  MCPResourceError,
  MCPValidationError,
  MCPRateLimitError,
  MCPProtocolError,
  MCPServerNotFoundError,
  MCPToolNotFoundError,
  MCPResourceNotFoundError,
  MCPTransportError,
} from '../../src/errors.js';
import { TammaError } from '@tamma/shared';

describe('MCP Error Classes', () => {
  describe('MCPError', () => {
    it('should extend TammaError', () => {
      const error = new MCPError('test error', 'MCP_ERROR');
      expect(error).toBeInstanceOf(TammaError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should set message and code', () => {
      const error = new MCPError('test error', 'TEST_CODE');
      expect(error.message).toBe('test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('MCPError');
    });

    it('should include server name', () => {
      const error = new MCPError('test error', 'TEST_CODE', {
        serverName: 'my-server',
      });
      expect(error.serverName).toBe('my-server');
      expect(error.context).toEqual({ serverName: 'my-server' });
    });

    it('should include cause', () => {
      const cause = new Error('root cause');
      const error = new MCPError('test error', 'TEST_CODE', { cause });
      expect(error.cause).toBe(cause);
    });
  });

  describe('MCPConnectionError', () => {
    it('should have correct code and name', () => {
      const error = new MCPConnectionError('my-server', 'Connection failed');
      expect(error.code).toBe('MCP_CONNECTION_ERROR');
      expect(error.name).toBe('MCPConnectionError');
      expect(error.serverName).toBe('my-server');
    });

    it('should be retryable by default', () => {
      const error = new MCPConnectionError('my-server', 'Connection failed');
      expect(error.retryable).toBe(true);
    });

    it('should allow setting retryable to false', () => {
      const error = new MCPConnectionError('my-server', 'Connection failed', {
        retryable: false,
      });
      expect(error.retryable).toBe(false);
    });
  });

  describe('MCPTimeoutError', () => {
    it('should include operation and timeout info', () => {
      const error = new MCPTimeoutError('my-server', 'tools/call', 5000);
      expect(error.message).toContain('tools/call');
      expect(error.message).toContain('5000ms');
      expect(error.operation).toBe('tools/call');
      expect(error.timeoutMs).toBe(5000);
      expect(error.retryable).toBe(true);
    });
  });

  describe('MCPToolError', () => {
    it('should include tool name', () => {
      const error = new MCPToolError('my-server', 'my-tool', 'Execution failed');
      expect(error.message).toContain('my-tool');
      expect(error.message).toContain('Execution failed');
      expect(error.toolName).toBe('my-tool');
      expect(error.serverName).toBe('my-server');
    });

    it('should not be retryable by default', () => {
      const error = new MCPToolError('my-server', 'my-tool', 'Failed');
      expect(error.retryable).toBe(false);
    });
  });

  describe('MCPResourceError', () => {
    it('should include URI', () => {
      const error = new MCPResourceError('my-server', 'file:///test.txt', 'Not found');
      expect(error.message).toContain('file:///test.txt');
      expect(error.uri).toBe('file:///test.txt');
    });
  });

  describe('MCPValidationError', () => {
    it('should include details', () => {
      const error = new MCPValidationError('Invalid input', {
        field: 'name',
        reason: 'required',
      });
      expect(error.code).toBe('MCP_VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'name', reason: 'required' });
      expect(error.retryable).toBe(false);
    });
  });

  describe('MCPRateLimitError', () => {
    it('should include retry after time', () => {
      const error = new MCPRateLimitError('my-server', 5000);
      expect(error.message).toContain('my-server');
      expect(error.retryAfterMs).toBe(5000);
      expect(error.retryable).toBe(true);
    });

    it('should handle undefined retry time', () => {
      const error = new MCPRateLimitError('my-server');
      expect(error.retryAfterMs).toBeUndefined();
    });
  });

  describe('MCPProtocolError', () => {
    it('should include JSON-RPC error code', () => {
      const error = new MCPProtocolError('my-server', -32600, 'Invalid Request');
      expect(error.jsonRpcCode).toBe(-32600);
      expect(error.message).toContain('-32600');
      expect(error.retryable).toBe(false);
    });

    it('should include data when provided', () => {
      const error = new MCPProtocolError('my-server', -32602, 'Invalid params', {
        data: { field: 'name' },
      });
      expect(error.context).toEqual({
        serverName: 'my-server',
        jsonRpcCode: -32602,
        data: { field: 'name' },
      });
    });
  });

  describe('MCPServerNotFoundError', () => {
    it('should have correct message', () => {
      const error = new MCPServerNotFoundError('my-server');
      expect(error.message).toContain('my-server');
      expect(error.message).toContain('not found');
      expect(error.code).toBe('MCP_SERVER_NOT_FOUND');
    });
  });

  describe('MCPToolNotFoundError', () => {
    it('should include server and tool names', () => {
      const error = new MCPToolNotFoundError('my-server', 'my-tool');
      expect(error.message).toContain('my-server');
      expect(error.message).toContain('my-tool');
      expect(error.toolName).toBe('my-tool');
      expect(error.code).toBe('MCP_TOOL_NOT_FOUND');
    });
  });

  describe('MCPResourceNotFoundError', () => {
    it('should include server and URI', () => {
      const error = new MCPResourceNotFoundError('my-server', 'file:///test.txt');
      expect(error.message).toContain('my-server');
      expect(error.message).toContain('file:///test.txt');
      expect(error.uri).toBe('file:///test.txt');
      expect(error.code).toBe('MCP_RESOURCE_NOT_FOUND');
    });
  });

  describe('MCPTransportError', () => {
    it('should include transport type', () => {
      const error = new MCPTransportError('my-server', 'stdio', 'Process died');
      expect(error.message).toContain('stdio');
      expect(error.transportType).toBe('stdio');
      expect(error.retryable).toBe(true);
    });
  });
});
