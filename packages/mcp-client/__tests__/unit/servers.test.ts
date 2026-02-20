/**
 * Built-in server configuration helpers tests
 */

import { describe, it, expect } from 'vitest';
import {
  createGitHubServer,
  createFilesystemServer,
  createPostgresServer,
  createSlackServer,
  createCustomStdioServer,
  createCustomSSEServer,
  validateServerConfig,
  SERVER_PRESETS,
} from '../../src/servers/index.js';

describe('createGitHubServer', () => {
  it('should create GitHub server config with defaults', () => {
    const config = createGitHubServer({
      githubToken: 'ghp_test123',
    });

    expect(config.name).toBe('github');
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('npx');
    expect(config.args).toContain('@modelcontextprotocol/server-github');
    expect(config.env?.['GITHUB_TOKEN']).toBe('ghp_test123');
    expect(config.enabled).toBe(true);
    expect(config.timeout).toBe(60000);
    expect(config.rateLimitRpm).toBe(100);
  });

  it('should allow custom options', () => {
    const config = createGitHubServer({
      githubToken: 'ghp_test123',
      name: 'my-github',
      timeout: 30000,
      rateLimitRpm: 50,
    });

    expect(config.name).toBe('my-github');
    expect(config.timeout).toBe(30000);
    expect(config.rateLimitRpm).toBe(50);
  });
});

describe('createFilesystemServer', () => {
  it('should create Filesystem server config with paths', () => {
    const config = createFilesystemServer({
      allowedPaths: ['/workspace', '/home/user'],
    });

    expect(config.name).toBe('filesystem');
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('npx');
    expect(config.args).toContain('@modelcontextprotocol/server-filesystem');
    expect(config.args).toContain('/workspace');
    expect(config.args).toContain('/home/user');
    expect(config.sandboxed).toBe(true);
    expect(config.rateLimitRpm).toBe(1000);
  });

  it('should allow custom options', () => {
    const config = createFilesystemServer({
      allowedPaths: ['/data'],
      name: 'files',
      timeout: 10000,
    });

    expect(config.name).toBe('files');
    expect(config.timeout).toBe(10000);
  });
});

describe('createPostgresServer', () => {
  it('should create PostgreSQL server config', () => {
    const config = createPostgresServer({
      databaseUrl: 'postgresql://user:pass@localhost/db',
    });

    expect(config.name).toBe('postgres');
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('npx');
    expect(config.args).toContain('@modelcontextprotocol/server-postgres');
    expect(config.env?.['DATABASE_URL']).toBe('postgresql://user:pass@localhost/db');
    expect(config.timeout).toBe(120000); // Higher for long queries
    expect(config.rateLimitRpm).toBe(60);
  });
});

describe('createSlackServer', () => {
  it('should create Slack server config', () => {
    const config = createSlackServer({
      slackToken: 'xoxb-test',
      url: 'http://localhost:3001/mcp',
    });

    expect(config.name).toBe('slack');
    expect(config.transport).toBe('sse');
    expect(config.url).toBe('http://localhost:3001/mcp');
    expect(config.headers?.['Authorization']).toBe('Bearer xoxb-test');
    expect(config.rateLimitRpm).toBe(50);
  });
});

describe('createCustomStdioServer', () => {
  it('should create custom stdio server config', () => {
    const config = createCustomStdioServer({
      name: 'my-server',
      command: 'python',
      args: ['./server.py'],
      env: { API_KEY: 'secret' },
      cwd: '/app',
    });

    expect(config.name).toBe('my-server');
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('python');
    expect(config.args).toEqual(['./server.py']);
    expect(config.env?.['API_KEY']).toBe('secret');
    expect(config.cwd).toBe('/app');
    expect(config.sandboxed).toBe(true);
  });

  it('should allow disabling sandbox', () => {
    const config = createCustomStdioServer({
      name: 'trusted-server',
      command: 'node',
      sandboxed: false,
    });

    expect(config.sandboxed).toBe(false);
  });
});

describe('createCustomSSEServer', () => {
  it('should create custom SSE server config', () => {
    const config = createCustomSSEServer({
      name: 'my-api',
      url: 'https://api.example.com/mcp',
      headers: { 'X-API-Key': 'key123' },
    });

    expect(config.name).toBe('my-api');
    expect(config.transport).toBe('sse');
    expect(config.url).toBe('https://api.example.com/mcp');
    expect(config.headers?.['X-API-Key']).toBe('key123');
    expect(config.reconnectOnError).toBe(true);
  });
});

describe('validateServerConfig', () => {
  it('should return empty array for valid config', () => {
    const errors = validateServerConfig({
      name: 'test',
      transport: 'stdio',
      command: 'node',
    });

    expect(errors).toHaveLength(0);
  });

  it('should return error for missing name', () => {
    const errors = validateServerConfig({
      name: '',
      transport: 'stdio',
      command: 'node',
    });

    expect(errors).toContain('Server name is required');
  });

  it('should return error for missing transport', () => {
    const errors = validateServerConfig({
      name: 'test',
      transport: '' as 'stdio',
      command: 'node',
    });

    expect(errors).toContain('Transport type is required');
  });

  it('should return error for stdio without command', () => {
    const errors = validateServerConfig({
      name: 'test',
      transport: 'stdio',
    });

    expect(errors).toContain('Command is required for stdio transport');
  });

  it('should return error for SSE without URL', () => {
    const errors = validateServerConfig({
      name: 'test',
      transport: 'sse',
    });

    expect(errors).toContain('URL is required for SSE/WebSocket transport');
  });

  it('should return error for WebSocket without URL', () => {
    const errors = validateServerConfig({
      name: 'test',
      transport: 'websocket',
    });

    expect(errors).toContain('URL is required for SSE/WebSocket transport');
  });
});

describe('SERVER_PRESETS', () => {
  it('should export all preset functions', () => {
    expect(SERVER_PRESETS.github).toBe(createGitHubServer);
    expect(SERVER_PRESETS.filesystem).toBe(createFilesystemServer);
    expect(SERVER_PRESETS.postgres).toBe(createPostgresServer);
    expect(SERVER_PRESETS.slack).toBe(createSlackServer);
    expect(SERVER_PRESETS.customStdio).toBe(createCustomStdioServer);
    expect(SERVER_PRESETS.customSSE).toBe(createCustomSSEServer);
  });
});
