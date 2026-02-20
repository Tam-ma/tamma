/**
 * @tamma/mcp-client
 * Base transport interface
 */

import type { JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from '../utils/json-rpc.js';

/**
 * Transport message types
 */
export type TransportMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

/**
 * Message handler callback
 */
export type MessageHandler = (message: TransportMessage) => void | Promise<void>;

/**
 * Error handler callback
 */
export type ErrorHandler = (error: Error) => void;

/**
 * Close handler callback
 */
export type CloseHandler = () => void;

/**
 * MCP Transport Interface
 *
 * Transports handle the low-level communication with MCP servers.
 * They are responsible for:
 * - Establishing connections
 * - Sending and receiving messages
 * - Message framing (for stdio)
 * - Reconnection handling
 */
export interface IMCPTransport {
  /**
   * Connect to the server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the server
   */
  disconnect(): Promise<void>;

  /**
   * Send a message to the server
   */
  send(message: JSONRPCRequest | JSONRPCNotification): Promise<void>;

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register an error handler
   */
  onError(handler: ErrorHandler): void;

  /**
   * Register a close handler
   */
  onClose(handler: CloseHandler): void;

  /**
   * Check if the transport is connected
   */
  isConnected(): boolean;
}

/**
 * Base transport options
 */
export interface BaseTransportOptions {
  /** Server name for logging */
  serverName: string;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * Stdio transport options
 */
export interface StdioTransportOptions extends BaseTransportOptions {
  /** Command to execute */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Enable sandboxing */
  sandboxed?: boolean;
}

/**
 * SSE transport options
 */
export interface SSETransportOptions extends BaseTransportOptions {
  /** Server URL */
  url: string;
  /** Request headers */
  headers?: Record<string, string>;
}

/**
 * WebSocket transport options
 */
export interface WebSocketTransportOptions extends BaseTransportOptions {
  /** Server URL */
  url: string;
  /** Request headers */
  headers?: Record<string, string>;
}

/**
 * Abstract base class for transports
 */
export abstract class BaseTransport implements IMCPTransport {
  protected messageHandler?: MessageHandler;
  protected errorHandler?: ErrorHandler;
  protected closeHandler?: CloseHandler;
  protected connected = false;

  constructor(protected readonly serverName: string) {}

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(message: JSONRPCRequest | JSONRPCNotification): Promise<void>;

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Emit a message to the handler
   */
  protected emitMessage(message: TransportMessage): void {
    if (this.messageHandler) {
      void this.messageHandler(message);
    }
  }

  /**
   * Emit an error to the handler
   */
  protected emitError(error: Error): void {
    if (this.errorHandler) {
      this.errorHandler(error);
    }
  }

  /**
   * Emit a close event to the handler
   */
  protected emitClose(): void {
    if (this.closeHandler) {
      this.closeHandler();
    }
  }
}
