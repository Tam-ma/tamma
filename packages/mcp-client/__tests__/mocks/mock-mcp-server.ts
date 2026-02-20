/**
 * Mock MCP Server for testing
 */

import type { JSONRPCRequest, JSONRPCResponse } from '../../src/utils/json-rpc.js';
import type { MCPTool, MCPResource, MCPPrompt, JSONSchema } from '../../src/types.js';
import { createSuccessResponse, createErrorResponse } from '../../src/utils/json-rpc.js';

/**
 * Mock tool definition
 */
export interface MockTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (args: Record<string, unknown>) => unknown;
}

/**
 * Mock resource definition
 */
export interface MockResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  content: { text?: string; blob?: string };
}

/**
 * Mock prompt definition
 */
export interface MockPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * Mock MCP Server for unit testing
 *
 * Simulates an MCP server without actual subprocess or network communication.
 */
export class MockMCPServer {
  private tools = new Map<string, MockTool>();
  private resources = new Map<string, MockResource>();
  private prompts = new Map<string, MockPrompt>();
  private latencyMs = 0;
  private simulatedErrors = new Map<string, Error>();
  private initialized = false;

  /**
   * Server name for identification
   */
  readonly name: string;

  constructor(name = 'mock-server') {
    this.name = name;
  }

  /**
   * Add a tool to the mock server
   */
  addTool(tool: MockTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Add a resource to the mock server
   */
  addResource(resource: MockResource): void {
    this.resources.set(resource.uri, resource);
  }

  /**
   * Add a prompt to the mock server
   */
  addPrompt(prompt: MockPrompt): void {
    this.prompts.set(prompt.name, prompt);
  }

  /**
   * Remove a tool
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Remove a resource
   */
  removeResource(uri: string): boolean {
    return this.resources.delete(uri);
  }

  /**
   * Set latency for simulating slow responses
   */
  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  /**
   * Simulate an error for a specific method
   */
  simulateError(method: string, error: Error): void {
    this.simulatedErrors.set(method, error);
  }

  /**
   * Clear a simulated error
   */
  clearError(method: string): void {
    this.simulatedErrors.delete(method);
  }

  /**
   * Clear all simulated errors
   */
  clearAllErrors(): void {
    this.simulatedErrors.clear();
  }

  /**
   * Reset the server to initial state
   */
  reset(): void {
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();
    this.latencyMs = 0;
    this.simulatedErrors.clear();
    this.initialized = false;
  }

  /**
   * Handle a JSON-RPC request
   */
  async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    // Simulate latency
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    // Check for simulated error
    const simulatedError = this.simulatedErrors.get(request.method);
    if (simulatedError) {
      return createErrorResponse(request.id, -32000, simulatedError.message);
    }

    // Handle different methods
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);

      case 'tools/list':
        return this.handleToolsList(request);

      case 'tools/call':
        return this.handleToolsCall(request);

      case 'resources/list':
        return this.handleResourcesList(request);

      case 'resources/read':
        return this.handleResourcesRead(request);

      case 'prompts/list':
        return this.handlePromptsList(request);

      case 'ping':
        return createSuccessResponse(request.id, {});

      default:
        return createErrorResponse(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(request: JSONRPCRequest): JSONRPCResponse {
    this.initialized = true;

    return createSuccessResponse(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: true },
      },
      serverInfo: {
        name: this.name,
        version: '1.0.0',
      },
    });
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: JSONRPCRequest): JSONRPCResponse {
    const tools = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    return createSuccessResponse(request.id, { tools });
  }

  /**
   * Handle tools/call request
   */
  private handleToolsCall(request: JSONRPCRequest): JSONRPCResponse {
    const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;

    if (!params?.name) {
      return createErrorResponse(request.id, -32602, 'Missing tool name');
    }

    const tool = this.tools.get(params.name);
    if (!tool) {
      return createErrorResponse(request.id, -32602, `Tool not found: ${params.name}`);
    }

    try {
      const result = tool.handler(params.arguments ?? {});

      return createSuccessResponse(request.id, {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
      });
    } catch (error) {
      return createSuccessResponse(request.id, {
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      });
    }
  }

  /**
   * Handle resources/list request
   */
  private handleResourcesList(request: JSONRPCRequest): JSONRPCResponse {
    const resources = Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));

    return createSuccessResponse(request.id, { resources });
  }

  /**
   * Handle resources/read request
   */
  private handleResourcesRead(request: JSONRPCRequest): JSONRPCResponse {
    const params = request.params as { uri: string } | undefined;

    if (!params?.uri) {
      return createErrorResponse(request.id, -32602, 'Missing resource URI');
    }

    const resource = this.resources.get(params.uri);
    if (!resource) {
      return createErrorResponse(request.id, -32602, `Resource not found: ${params.uri}`);
    }

    return createSuccessResponse(request.id, {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.content.text,
          blob: resource.content.blob,
        },
      ],
    });
  }

  /**
   * Handle prompts/list request
   */
  private handlePromptsList(request: JSONRPCRequest): JSONRPCResponse {
    const prompts = Array.from(this.prompts.values()).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));

    return createSuccessResponse(request.id, { prompts });
  }

  /**
   * Get list of tools (for testing)
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      serverName: this.name,
    }));
  }

  /**
   * Get list of resources (for testing)
   */
  getResources(): MCPResource[] {
    return Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      serverName: this.name,
    }));
  }

  /**
   * Get list of prompts (for testing)
   */
  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values()).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
      serverName: this.name,
    }));
  }
}

/**
 * Create a pre-configured mock server with sample tools and resources
 */
export function createSampleMockServer(name = 'sample-server'): MockMCPServer {
  const server = new MockMCPServer(name);

  // Add sample tools
  server.addTool({
    name: 'echo',
    description: 'Echoes the input message',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to echo' },
      },
      required: ['message'],
    },
    handler: (args) => args['message'],
  });

  server.addTool({
    name: 'add',
    description: 'Adds two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
      required: ['a', 'b'],
    },
    handler: (args) => {
      const a = args['a'] as number;
      const b = args['b'] as number;
      return { result: a + b };
    },
  });

  // Add sample resources
  server.addResource({
    uri: 'file:///test.txt',
    name: 'test.txt',
    description: 'A test text file',
    mimeType: 'text/plain',
    content: { text: 'Hello, World!' },
  });

  server.addResource({
    uri: 'file:///data.json',
    name: 'data.json',
    description: 'Sample JSON data',
    mimeType: 'application/json',
    content: { text: JSON.stringify({ key: 'value', count: 42 }) },
  });

  // Add sample prompts
  server.addPrompt({
    name: 'greeting',
    description: 'Generate a greeting',
    arguments: [
      { name: 'name', description: 'Name to greet', required: true },
      { name: 'formal', description: 'Use formal greeting', required: false },
    ],
  });

  return server;
}
