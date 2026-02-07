/**
 * MCP Management Service Contract
 *
 * Defines the interface for MCP server lifecycle management.
 */

import type {
  MCPServerInfo,
  MCPTool,
  MCPToolInvokeRequest,
  MCPToolInvokeResult,
  MCPServerLog,
} from '../../types/knowledge-base/mcp-types.js';

export interface IMCPService {
  listServers(): Promise<MCPServerInfo[]>;
  getServerStatus(name: string): Promise<MCPServerInfo>;
  startServer(name: string): Promise<void>;
  stopServer(name: string): Promise<void>;
  restartServer(name: string): Promise<void>;
  listTools(serverName?: string): Promise<MCPTool[]>;
  invokeTool(request: MCPToolInvokeRequest): Promise<MCPToolInvokeResult>;
  getServerLogs(name: string, limit?: number): Promise<MCPServerLog[]>;
}
