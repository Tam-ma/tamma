/**
 * Test fixtures for MCP client tests
 */

import type { MCPClientConfig, MCPServerConfig, MCPTool, MCPResource, JSONSchema } from '../../src/types.js';

/**
 * Sample server configurations
 */
export const sampleServerConfigs: Record<string, MCPServerConfig> = {
  stdio: {
    name: 'test-stdio',
    transport: 'stdio',
    command: 'node',
    args: ['./mock-server.js'],
    enabled: true,
    autoConnect: true,
    timeout: 5000,
  },

  sse: {
    name: 'test-sse',
    transport: 'sse',
    url: 'http://localhost:3000/mcp',
    enabled: true,
    autoConnect: false,
    timeout: 10000,
  },

  websocket: {
    name: 'test-ws',
    transport: 'websocket',
    url: 'ws://localhost:3001/mcp',
    enabled: true,
    autoConnect: false,
    headers: {
      'Authorization': 'Bearer test-token',
    },
  },

  disabled: {
    name: 'disabled-server',
    transport: 'stdio',
    command: 'node',
    args: ['./disabled.js'],
    enabled: false,
  },

  rateLimited: {
    name: 'rate-limited',
    transport: 'stdio',
    command: 'node',
    args: ['./server.js'],
    enabled: true,
    rateLimitRpm: 10, // 10 requests per minute
  },
};

/**
 * Sample client configuration
 */
export const sampleClientConfig: MCPClientConfig = {
  servers: [
    sampleServerConfigs['stdio']!,
    sampleServerConfigs['sse']!,
  ],
  defaultTimeout: 30000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  enableCaching: true,
  cacheTTLMs: 300000,
  logLevel: 'info',
};

/**
 * Sample tool schemas
 */
export const sampleToolSchemas: Record<string, JSONSchema> = {
  echo: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to echo',
      },
    },
    required: ['message'],
  },

  calculate: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'subtract', 'multiply', 'divide'],
        description: 'The operation to perform',
      },
      a: {
        type: 'number',
        description: 'First operand',
      },
      b: {
        type: 'number',
        description: 'Second operand',
      },
    },
    required: ['operation', 'a', 'b'],
  },

  search: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
        minLength: 1,
        maxLength: 1000,
      },
      limit: {
        type: 'integer',
        description: 'Maximum results',
        default: 10,
        minimum: 1,
        maximum: 100,
      },
      filters: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
        },
      },
    },
    required: ['query'],
  },

  nested: {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          values: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['enabled'],
      },
    },
    required: ['config'],
  },
};

/**
 * Sample tools
 */
export const sampleTools: MCPTool[] = [
  {
    name: 'echo',
    description: 'Echoes the input message back',
    inputSchema: sampleToolSchemas['echo']!,
    serverName: 'test-server',
  },
  {
    name: 'calculate',
    description: 'Performs arithmetic operations',
    inputSchema: sampleToolSchemas['calculate']!,
    serverName: 'test-server',
  },
  {
    name: 'search',
    description: 'Searches for content',
    inputSchema: sampleToolSchemas['search']!,
    serverName: 'test-server',
  },
];

/**
 * Sample resources
 */
export const sampleResources: MCPResource[] = [
  {
    uri: 'file:///workspace/README.md',
    name: 'README.md',
    description: 'Project readme file',
    mimeType: 'text/markdown',
    serverName: 'test-server',
  },
  {
    uri: 'file:///workspace/package.json',
    name: 'package.json',
    description: 'Package configuration',
    mimeType: 'application/json',
    serverName: 'test-server',
  },
  {
    uri: 'db://users/1',
    name: 'User 1',
    description: 'User record',
    mimeType: 'application/json',
    serverName: 'database-server',
  },
];

/**
 * Sample JSON-RPC messages
 */
export const sampleJSONRPCMessages = {
  initializeRequest: {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  },

  initializeResponse: {
    jsonrpc: '2.0' as const,
    id: 1,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      },
      serverInfo: { name: 'test-server', version: '1.0.0' },
    },
  },

  toolsListRequest: {
    jsonrpc: '2.0' as const,
    id: 2,
    method: 'tools/list',
  },

  toolsListResponse: {
    jsonrpc: '2.0' as const,
    id: 2,
    result: {
      tools: sampleTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    },
  },

  toolCallRequest: {
    jsonrpc: '2.0' as const,
    id: 3,
    method: 'tools/call',
    params: {
      name: 'echo',
      arguments: { message: 'Hello, World!' },
    },
  },

  toolCallResponse: {
    jsonrpc: '2.0' as const,
    id: 3,
    result: {
      content: [{ type: 'text', text: 'Hello, World!' }],
    },
  },

  errorResponse: {
    jsonrpc: '2.0' as const,
    id: 4,
    error: {
      code: -32602,
      message: 'Invalid params',
      data: { field: 'message', reason: 'required' },
    },
  },
};

/**
 * Sample resource content
 */
export const sampleResourceContent = {
  readme: {
    uri: 'file:///workspace/README.md',
    mimeType: 'text/markdown',
    text: '# Test Project\n\nThis is a test project.',
  },

  packageJson: {
    uri: 'file:///workspace/package.json',
    mimeType: 'application/json',
    text: JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
    }),
  },

  binaryImage: {
    uri: 'file:///workspace/image.png',
    mimeType: 'image/png',
    // Small 1x1 transparent PNG as base64
    blob: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  },
};

/**
 * Invalid configurations for testing validation
 */
export const invalidConfigs = {
  missingServerName: {
    transport: 'stdio',
    command: 'node',
  },

  missingCommand: {
    name: 'test',
    transport: 'stdio',
  },

  missingUrl: {
    name: 'test',
    transport: 'sse',
  },

  invalidTransport: {
    name: 'test',
    transport: 'invalid',
    command: 'node',
  },

  invalidUrl: {
    name: 'test',
    transport: 'sse',
    url: 'not-a-valid-url',
  },

  duplicateNames: [
    { name: 'test', transport: 'stdio', command: 'node' },
    { name: 'test', transport: 'sse', url: 'http://localhost:3000' },
  ],

  reservedName: {
    name: 'default',
    transport: 'stdio',
    command: 'node',
  },
};
