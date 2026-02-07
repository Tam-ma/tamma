/**
 * Validator unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateClientConfig,
  validateServerConfig,
  validateStdioCommand,
  validateTransportUrl,
  sanitizeEnv,
  validateServerNames,
} from '../../src/security/validator.js';
import { MCPValidationError } from '../../src/errors.js';
import { sampleServerConfigs, sampleClientConfig, invalidConfigs } from '../mocks/fixtures.js';

describe('Validator', () => {
  describe('validateClientConfig', () => {
    it('should validate a valid config', () => {
      const config = validateClientConfig(sampleClientConfig);

      expect(config.servers).toHaveLength(2);
      expect(config.defaultTimeout).toBe(30000);
    });

    it('should apply defaults', () => {
      const config = validateClientConfig({
        servers: [sampleServerConfigs['stdio']],
      });

      expect(config.defaultTimeout).toBe(30000);
      expect(config.retryAttempts).toBe(3);
      expect(config.enableCaching).toBe(true);
    });

    it('should throw for missing servers', () => {
      expect(() => validateClientConfig({})).toThrow(MCPValidationError);
    });

    it('should throw for empty servers array', () => {
      expect(() => validateClientConfig({ servers: [] })).toThrow(MCPValidationError);
    });
  });

  describe('validateServerConfig', () => {
    it('should validate a valid stdio config', () => {
      const config = validateServerConfig(sampleServerConfigs['stdio']);

      expect(config.name).toBe('test-stdio');
      expect(config.transport).toBe('stdio');
      expect(config.command).toBe('node');
    });

    it('should validate a valid SSE config', () => {
      const config = validateServerConfig(sampleServerConfigs['sse']);

      expect(config.name).toBe('test-sse');
      expect(config.transport).toBe('sse');
      expect(config.url).toBe('http://localhost:3000/mcp');
    });

    it('should throw for missing server name', () => {
      expect(() => validateServerConfig(invalidConfigs['missingServerName'])).toThrow(
        MCPValidationError
      );
    });

    it('should throw for stdio without command', () => {
      expect(() => validateServerConfig(invalidConfigs['missingCommand'])).toThrow(
        MCPValidationError
      );
    });

    it('should throw for SSE without URL', () => {
      expect(() => validateServerConfig(invalidConfigs['missingUrl'])).toThrow(
        MCPValidationError
      );
    });
  });

  describe('validateStdioCommand', () => {
    it('should allow npx', () => {
      expect(() => validateStdioCommand('npx')).not.toThrow();
    });

    it('should allow node', () => {
      expect(() => validateStdioCommand('node')).not.toThrow();
    });

    it('should allow python', () => {
      expect(() => validateStdioCommand('python')).not.toThrow();
      expect(() => validateStdioCommand('python3')).not.toThrow();
    });

    it('should allow uvx', () => {
      expect(() => validateStdioCommand('uvx')).not.toThrow();
    });

    it('should allow deno', () => {
      expect(() => validateStdioCommand('deno')).not.toThrow();
    });

    it('should allow bun', () => {
      expect(() => validateStdioCommand('bun')).not.toThrow();
    });

    it('should reject unknown commands', () => {
      expect(() => validateStdioCommand('sh')).toThrow(MCPValidationError);
      expect(() => validateStdioCommand('bash')).toThrow(MCPValidationError);
      expect(() => validateStdioCommand('rm')).toThrow(MCPValidationError);
    });

    it('should handle full paths', () => {
      expect(() => validateStdioCommand('/usr/bin/node')).not.toThrow();
    });
  });

  describe('validateTransportUrl', () => {
    it('should allow http URLs with public hosts', () => {
      expect(() => validateTransportUrl('http://example.com/mcp')).not.toThrow();
      expect(() => validateTransportUrl('http://mcp-server.example.com:3000')).not.toThrow();
    });

    it('should allow https URLs', () => {
      expect(() => validateTransportUrl('https://api.example.com')).not.toThrow();
    });

    it('should allow ws URLs with public hosts', () => {
      expect(() => validateTransportUrl('ws://mcp.example.com:3000')).not.toThrow();
    });

    it('should allow wss URLs', () => {
      expect(() => validateTransportUrl('wss://api.example.com')).not.toThrow();
    });

    it('should reject file URLs', () => {
      expect(() => validateTransportUrl('file:///etc/passwd')).toThrow(
        MCPValidationError
      );
    });

    it('should reject invalid URLs', () => {
      expect(() => validateTransportUrl('not-a-url')).toThrow(MCPValidationError);
    });

    it('should reject blocked hosts', () => {
      expect(() => validateTransportUrl('http://0.0.0.0:3000')).toThrow(
        MCPValidationError
      );
      expect(() => validateTransportUrl('http://127.0.0.1:3000')).toThrow(
        MCPValidationError
      );
      expect(() => validateTransportUrl('http://localhost:3000')).toThrow(
        MCPValidationError
      );
      expect(() => validateTransportUrl('http://[::1]:3000')).toThrow(
        MCPValidationError
      );
    });

    it('should reject private IP addresses', () => {
      expect(() => validateTransportUrl('http://10.0.0.1:3000')).toThrow(
        MCPValidationError
      );
      expect(() => validateTransportUrl('http://192.168.1.1:3000')).toThrow(
        MCPValidationError
      );
      expect(() => validateTransportUrl('http://172.16.0.1:3000')).toThrow(
        MCPValidationError
      );
      expect(() => validateTransportUrl('http://172.31.255.1:3000')).toThrow(
        MCPValidationError
      );
    });
  });

  describe('sanitizeEnv', () => {
    it('should pass through normal env vars', () => {
      const env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        NODE_ENV: 'production',
      };

      const sanitized = sanitizeEnv(env);

      expect(sanitized['PATH']).toBe('/usr/bin');
      expect(sanitized['HOME']).toBe('/home/user');
      expect(sanitized['NODE_ENV']).toBe('production');
    });

    it('should remove sensitive vars', () => {
      const env = {
        GITHUB_TOKEN: 'abc123',
        AWS_SECRET_ACCESS_KEY: 'secret',
        DATABASE_PASSWORD: 'password',
        API_SECRET: 'secret',
      };

      const sanitized = sanitizeEnv(env);

      expect(sanitized['GITHUB_TOKEN']).toBeUndefined(); // Tokens are now filtered
      expect(sanitized['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
      expect(sanitized['DATABASE_PASSWORD']).toBeUndefined();
      expect(sanitized['API_SECRET']).toBeUndefined();
    });

    it('should remove vars ending with _TOKEN, _SECRET, or _CREDENTIAL', () => {
      const env = {
        AUTH_TOKEN: 'token123',
        APP_SECRET: 'secret456',
        DB_CREDENTIAL: 'cred789',
        NORMAL_VAR: 'keep-this',
      };

      const sanitized = sanitizeEnv(env);

      expect(sanitized['AUTH_TOKEN']).toBeUndefined();
      expect(sanitized['APP_SECRET']).toBeUndefined();
      expect(sanitized['DB_CREDENTIAL']).toBeUndefined();
      expect(sanitized['NORMAL_VAR']).toBe('keep-this');
    });

    it('should handle empty env', () => {
      const sanitized = sanitizeEnv({});
      expect(sanitized).toEqual({});
    });
  });

  describe('validateServerNames', () => {
    it('should pass for unique names', () => {
      const configs = [
        { name: 'server1', transport: 'stdio', command: 'node' },
        { name: 'server2', transport: 'sse', url: 'http://localhost' },
      ] as any[];

      expect(() => validateServerNames(configs)).not.toThrow();
    });

    it('should throw for duplicate names', () => {
      const configs = invalidConfigs['duplicateNames'] as any[];

      expect(() => validateServerNames(configs)).toThrow(MCPValidationError);
      expect(() => validateServerNames(configs)).toThrow(/Duplicate server name/);
    });

    it('should throw for reserved names', () => {
      expect(() =>
        validateServerNames([invalidConfigs['reservedName'] as any])
      ).toThrow(MCPValidationError);
      expect(() =>
        validateServerNames([invalidConfigs['reservedName'] as any])
      ).toThrow(/reserved/);
    });

    it('should reject other reserved names', () => {
      const configs = [
        { name: 'all', transport: 'stdio', command: 'node' },
      ] as any[];

      expect(() => validateServerNames(configs)).toThrow(/reserved/);

      const configs2 = [
        { name: 'none', transport: 'stdio', command: 'node' },
      ] as any[];

      expect(() => validateServerNames(configs2)).toThrow(/reserved/);
    });
  });
});
