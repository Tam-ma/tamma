/**
 * MCP Servers Hook
 *
 * React hook for MCP server management.
 */

import { useState, useCallback } from 'react';
import type { MCPServerInfo, MCPTool, MCPToolInvokeResult, MCPServerLog } from '@tamma/shared';
import { mcpApi } from '../../services/knowledge-base/api-client.js';

export interface UseMCPServersReturn {
  servers: MCPServerInfo[];
  tools: MCPTool[];
  logs: MCPServerLog[];
  invokeResult: MCPToolInvokeResult | null;
  loading: boolean;
  error: string | null;
  loadServers: () => Promise<void>;
  startServer: (name: string) => Promise<void>;
  stopServer: (name: string) => Promise<void>;
  restartServer: (name: string) => Promise<void>;
  loadTools: (serverName: string) => Promise<void>;
  invokeTool: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<void>;
  loadLogs: (serverName: string, limit?: number) => Promise<void>;
}

export function useMCPServers(): UseMCPServersReturn {
  const [servers, setServers] = useState<MCPServerInfo[]>([]);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [logs, setLogs] = useState<MCPServerLog[]>([]);
  const [invokeResult, setInvokeResult] = useState<MCPToolInvokeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mcpApi.listServers();
      setServers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  const startServer = useCallback(async (name: string) => {
    try {
      await mcpApi.startServer(name);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start server');
    }
  }, [loadServers]);

  const stopServer = useCallback(async (name: string) => {
    try {
      await mcpApi.stopServer(name);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop server');
    }
  }, [loadServers]);

  const restartServer = useCallback(async (name: string) => {
    try {
      await mcpApi.restartServer(name);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart server');
    }
  }, [loadServers]);

  const loadTools = useCallback(async (serverName: string) => {
    try {
      const data = await mcpApi.listTools(serverName);
      setTools(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    }
  }, []);

  const invokeTool = useCallback(async (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => {
    setLoading(true);
    try {
      const result = await mcpApi.invokeTool(serverName, toolName, args);
      setInvokeResult(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool invocation failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (serverName: string, limit = 100) => {
    try {
      const data = await mcpApi.getServerLogs(serverName, limit);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    }
  }, []);

  return {
    servers,
    tools,
    logs,
    invokeResult,
    loading,
    error,
    loadServers,
    startServer,
    stopServer,
    restartServer,
    loadTools,
    invokeTool,
    loadLogs,
  };
}
