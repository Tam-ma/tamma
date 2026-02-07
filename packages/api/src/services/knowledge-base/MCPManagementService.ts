/**
 * MCP Management Service
 *
 * Manages MCP (Model Context Protocol) server lifecycle,
 * tool discovery, invocation, and log viewing.
 */

import { randomUUID } from 'node:crypto';
import type {
  MCPServerInfo,
  MCPTool,
  MCPToolInvokeRequest,
  MCPToolInvokeResult,
  MCPServerLog,
} from '@tamma/shared';

export class MCPManagementService {
  private servers: Map<string, MCPServerInfo> = new Map();
  private logs: Map<string, MCPServerLog[]> = new Map();

  constructor() {
    // Seed with example servers
    this.servers.set('filesystem', {
      name: 'filesystem',
      status: 'connected',
      transport: 'stdio',
      toolCount: 4,
      resourceCount: 2,
      lastConnected: new Date().toISOString(),
      config: {
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
        enabled: true,
      },
    });
    this.servers.set('github', {
      name: 'github',
      status: 'connected',
      transport: 'stdio',
      toolCount: 8,
      resourceCount: 0,
      lastConnected: new Date().toISOString(),
      config: {
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: '***' },
        enabled: true,
      },
    });
    this.servers.set('memory', {
      name: 'memory',
      status: 'disconnected',
      transport: 'stdio',
      toolCount: 0,
      resourceCount: 0,
      config: {
        name: 'memory',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        enabled: false,
      },
    });

    // Seed logs
    const now = Date.now();
    this.logs.set('filesystem', [
      { timestamp: new Date(now - 60000).toISOString(), level: 'info', message: 'Server started successfully' },
      { timestamp: new Date(now - 30000).toISOString(), level: 'info', message: 'Connected to transport' },
      { timestamp: new Date(now - 10000).toISOString(), level: 'debug', message: 'Tool list refreshed: 4 tools available' },
    ]);
    this.logs.set('github', [
      { timestamp: new Date(now - 45000).toISOString(), level: 'info', message: 'Server started successfully' },
      { timestamp: new Date(now - 20000).toISOString(), level: 'info', message: 'Authenticated with GitHub API' },
    ]);
  }

  async listServers(): Promise<MCPServerInfo[]> {
    return Array.from(this.servers.values());
  }

  async getServerStatus(name: string): Promise<MCPServerInfo> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server not found: ${name}`);
    }
    return { ...server };
  }

  async startServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server not found: ${name}`);
    }
    if (server.status === 'connected') {
      throw new Error(`Server ${name} is already running`);
    }

    server.status = 'starting';
    this.servers.set(name, { ...server });

    // Simulate startup
    setTimeout(() => {
      const s = this.servers.get(name);
      if (s && s.status === 'starting') {
        s.status = 'connected';
        s.lastConnected = new Date().toISOString();
        s.toolCount = name === 'memory' ? 3 : s.toolCount;
        this.servers.set(name, { ...s });

        const logList = this.logs.get(name) ?? [];
        logList.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Server started successfully',
        });
        this.logs.set(name, logList);
      }
    }, 1000);
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server not found: ${name}`);
    }
    if (server.status === 'disconnected') {
      throw new Error(`Server ${name} is already stopped`);
    }

    server.status = 'disconnected';
    this.servers.set(name, { ...server });

    const logList = this.logs.get(name) ?? [];
    logList.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Server stopped',
    });
    this.logs.set(name, logList);
  }

  async restartServer(name: string): Promise<void> {
    await this.stopServer(name);
    await this.startServer(name);
  }

  async listTools(serverName?: string): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];

    const addToolsForServer = (name: string): void => {
      if (name === 'filesystem') {
        tools.push(
          { name: 'read_file', description: 'Read a file from the filesystem', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, serverName: name },
          { name: 'write_file', description: 'Write content to a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, serverName: name },
          { name: 'list_directory', description: 'List contents of a directory', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, serverName: name },
          { name: 'search_files', description: 'Search for files matching a pattern', inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } }, serverName: name },
        );
      } else if (name === 'github') {
        tools.push(
          { name: 'list_issues', description: 'List repository issues', inputSchema: { type: 'object', properties: { state: { type: 'string' } } }, serverName: name },
          { name: 'create_issue', description: 'Create a new issue', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } }, serverName: name },
          { name: 'get_pull_request', description: 'Get pull request details', inputSchema: { type: 'object', properties: { number: { type: 'number' } } }, serverName: name },
        );
      }
    };

    if (serverName) {
      addToolsForServer(serverName);
    } else {
      for (const name of this.servers.keys()) {
        addToolsForServer(name);
      }
    }

    return tools;
  }

  async invokeTool(request: MCPToolInvokeRequest): Promise<MCPToolInvokeResult> {
    const server = this.servers.get(request.serverName);
    if (!server) {
      throw new Error(`MCP server not found: ${request.serverName}`);
    }
    if (server.status !== 'connected') {
      return {
        success: false,
        content: null,
        error: `Server ${request.serverName} is not connected`,
        durationMs: 0,
      };
    }

    const startTime = Date.now();

    // Simulate tool invocation
    const result: MCPToolInvokeResult = {
      success: true,
      content: { message: `Tool ${request.toolName} invoked successfully`, arguments: request.arguments },
      durationMs: Date.now() - startTime + Math.floor(Math.random() * 50),
    };

    return result;
  }

  async getServerLogs(name: string, limit = 100): Promise<MCPServerLog[]> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server not found: ${name}`);
    }

    const logList = this.logs.get(name) ?? [];
    return logList.slice(-limit);
  }
}
