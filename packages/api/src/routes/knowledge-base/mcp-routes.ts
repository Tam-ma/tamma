/**
 * MCP Server Routes
 *
 * API endpoints for MCP server management.
 */

import type { FastifyInstance } from 'fastify';
import type { MCPManagementService } from '../../services/knowledge-base/MCPManagementService.js';
import type { MCPToolInvokeRequest } from '@tamma/shared';

export function registerMCPRoutes(
  app: FastifyInstance,
  service: MCPManagementService,
): void {
  // GET /mcp/servers - List all servers
  app.get('/mcp/servers', async (_request, reply) => {
    const servers = await service.listServers();
    return reply.send(servers);
  });

  // GET /mcp/servers/:name - Get server status
  app.get('/mcp/servers/:name', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      const server = await service.getServerStatus(params.name);
      return reply.send(server);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(404).send({ error: message });
    }
  });

  // POST /mcp/servers/:name/start - Start server
  app.post('/mcp/servers/:name/start', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      await service.startServer(params.name);
      return reply.status(202).send({ message: `Server ${params.name} starting` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(409).send({ error: message });
    }
  });

  // POST /mcp/servers/:name/stop - Stop server
  app.post('/mcp/servers/:name/stop', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      await service.stopServer(params.name);
      return reply.send({ message: `Server ${params.name} stopped` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(409).send({ error: message });
    }
  });

  // POST /mcp/servers/:name/restart - Restart server
  app.post('/mcp/servers/:name/restart', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      await service.restartServer(params.name);
      return reply.status(202).send({ message: `Server ${params.name} restarting` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: message instanceof Error ? message : 'Unknown error' });
    }
  });

  // GET /mcp/servers/:name/tools - List server tools
  app.get('/mcp/servers/:name/tools', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      const tools = await service.listTools(params.name);
      return reply.send(tools);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(404).send({ error: message });
    }
  });

  // POST /mcp/servers/:name/tools/:tool/invoke - Invoke a tool
  app.post('/mcp/servers/:name/tools/:tool/invoke', async (request, reply) => {
    try {
      const params = request.params as { name: string; tool: string };
      const body = request.body as { arguments?: Record<string, unknown> };
      const invokeRequest: MCPToolInvokeRequest = {
        serverName: params.name,
        toolName: params.tool,
        arguments: body.arguments ?? {},
      };
      const result = await service.invokeTool(invokeRequest);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // GET /mcp/servers/:name/logs - Get server logs
  app.get('/mcp/servers/:name/logs', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      const query = request.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      const logs = await service.getServerLogs(params.name, limit);
      return reply.send(logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(404).send({ error: message });
    }
  });
}
