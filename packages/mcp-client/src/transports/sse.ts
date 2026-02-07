/**
 * @tamma/mcp-client
 * SSE (Server-Sent Events) transport implementation
 *
 * Communicates with MCP servers via HTTP SSE for receiving messages
 * and HTTP POST for sending messages.
 */

import {
  BaseTransport,
  type SSETransportOptions,
} from './base.js';
import {
  type JSONRPCRequest,
  type JSONRPCNotification,
  serializeMessage,
  parseMessage,
} from '../utils/json-rpc.js';
import { MCPConnectionError, MCPTransportError } from '../errors.js';

/**
 * Default timeout for connection (ms)
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * SSE transport for MCP servers
 *
 * Uses Server-Sent Events for receiving messages from the server
 * and HTTP POST requests for sending messages to the server.
 */
export class SSETransport extends BaseTransport {
  private eventSource?: EventSource;
  private sessionId?: string;
  private readonly url: string;
  private readonly headers?: Record<string, string>;
  private readonly timeout: number;
  private abortController?: AbortController;

  constructor(options: SSETransportOptions) {
    super(options.serverName);
    this.url = options.url;
    this.headers = options.headers;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Connect to the MCP server via SSE
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.cleanup();
        reject(
          new MCPConnectionError(
            this.serverName,
            `Connection timed out after ${this.timeout}ms`
          )
        );
      }, this.timeout);

      try {
        this.abortController = new AbortController();

        // Note: Native EventSource doesn't support custom headers
        // For authentication, we rely on cookies or URL parameters
        // In a real implementation, you might use a polyfill or fetch-based SSE
        this.eventSource = new EventSource(this.url);

        this.eventSource.onopen = () => {
          clearTimeout(timeoutId);
          this.connected = true;
          resolve();
        };

        this.eventSource.onerror = (event) => {
          const error = new MCPConnectionError(
            this.serverName,
            'SSE connection error'
          );

          if (!this.connected) {
            clearTimeout(timeoutId);
            reject(error);
          } else {
            this.emitError(error);
            this.connected = false;
            this.emitClose();
          }
        };

        this.eventSource.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };

        // Handle custom event for session ID
        this.eventSource.addEventListener('session', (event) => {
          const messageEvent = event as MessageEvent<string>;
          try {
            const data = JSON.parse(messageEvent.data) as { sessionId?: string };
            if (data.sessionId) {
              this.sessionId = data.sessionId;
            }
          } catch {
            // Ignore parse errors for session events
          }
        });

        // Handle endpoint event (MCP protocol specific)
        this.eventSource.addEventListener('endpoint', (event) => {
          const messageEvent = event as MessageEvent<string>;
          // The endpoint event may contain the URL to POST messages to
          // This is implementation-specific
          console.debug(`[${this.serverName}] endpoint: ${messageEvent.data}`);
        });
      } catch (error) {
        clearTimeout(timeoutId);
        const err = error instanceof Error ? error : new Error(String(error));
        reject(
          new MCPConnectionError(
            this.serverName,
            `Failed to connect: ${err.message}`,
            { cause: err }
          )
        );
      }
    });
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.cleanup();
    this.emitClose();
  }

  /**
   * Send a message to the server via HTTP POST
   */
  async send(message: JSONRPCRequest | JSONRPCNotification): Promise<void> {
    if (!this.connected) {
      throw new MCPTransportError(
        this.serverName,
        'sse',
        'Transport not connected'
      );
    }

    const serialized = serializeMessage(message);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    // Add session ID if available
    if (this.sessionId) {
      headers['X-Session-ID'] = this.sessionId;
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: serialized,
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new MCPTransportError(
          this.serverName,
          'sse',
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      // Some implementations return the response in the HTTP response body
      // Check if there's content to process
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const text = await response.text();
        if (text) {
          this.handleMessage(text);
        }
      }
    } catch (error) {
      if (error instanceof MCPTransportError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      throw new MCPTransportError(
        this.serverName,
        'sse',
        `Failed to send message: ${err.message}`,
        { cause: err }
      );
    }
  }

  /**
   * Handle a message from the SSE stream
   */
  private handleMessage(data: string): void {
    const trimmed = data.trim();
    if (!trimmed) {
      return;
    }

    try {
      const message = parseMessage(trimmed);
      this.emitMessage(message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitError(
        new MCPTransportError(
          this.serverName,
          'sse',
          `Failed to parse message: ${err.message}`,
          { cause: err }
        )
      );
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.connected = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }

    this.sessionId = undefined;
  }

  /**
   * Get the session ID (useful for debugging)
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }
}
