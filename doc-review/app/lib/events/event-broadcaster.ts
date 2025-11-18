/**
 * Durable Object for managing real-time event broadcasting
 */

export interface EventMessage {
  type: string;
  docPath: string;
  data: unknown;
  timestamp: number;
  userId?: string;
}

export interface Connection {
  id: string;
  userId: string;
  controller: ReadableStreamDefaultController;
  lastPing: number;
}

export class EventBroadcaster implements DurableObject {
  private connections: Map<string, Connection> = new Map();
  private recentEvents: EventMessage[] = [];
  private readonly maxRecentEvents = 100;
  private readonly pingInterval = 30000; // 30 seconds
  private pingTimer?: number;

  constructor(
    _state: DurableObjectState,
    _env: any
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/sse') {
      return this.handleSSE(request);
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      return this.handlePublish(request);
    }

    if (url.pathname === '/recent' && request.method === 'GET') {
      return this.handleGetRecent();
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleSSE(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const connectionId = crypto.randomUUID();

    if (!userId) {
      return new Response('User ID required', { status: 401 });
    }

    // Create SSE response with proper headers
    const encoder = new TextEncoder();

    // Store connection
    const connection: Connection = {
      id: connectionId,
      userId,
      controller: null as any, // Will be set by the stream
      lastPing: Date.now()
    };

    // Start SSE stream
    const stream = new ReadableStream({
      start: async (controller) => {
        connection.controller = controller;
        this.connections.set(connectionId, connection);

        // Send initial connection event
        const connectEvent = this.formatSSE({
          type: 'connected',
          data: { connectionId, userId },
          timestamp: Date.now()
        });
        controller.enqueue(encoder.encode(connectEvent));

        // Send recent events to catch up
        for (const event of this.recentEvents) {
          const sseEvent = this.formatSSE(event);
          controller.enqueue(encoder.encode(sseEvent));
        }

        // Start ping timer if not already running
        if (!this.pingTimer) {
          this.startPingTimer();
        }
      },
      cancel: () => {
        // Clean up on disconnect
        this.connections.delete(connectionId);
        if (this.connections.size === 0 && this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = undefined;
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Connection-Id': connectionId
      }
    });
  }

  private async handlePublish(request: Request): Promise<Response> {
    try {
      const event = await request.json() as EventMessage;

      // Add timestamp if not present
      if (!event.timestamp) {
        event.timestamp = Date.now();
      }

      // Store in recent events buffer
      this.recentEvents.push(event);
      if (this.recentEvents.length > this.maxRecentEvents) {
        this.recentEvents.shift();
      }

      // Broadcast to all connections
      this.broadcastEvent(event);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid event data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleGetRecent(): Promise<Response> {
    return new Response(JSON.stringify(this.recentEvents), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private broadcastEvent(event: EventMessage): void {
    const encoder = new TextEncoder();
    const sseEvent = this.formatSSE(event);
    const data = encoder.encode(sseEvent);

    // Send to all connected clients
    for (const [connectionId, connection] of this.connections) {
      try {
        connection.controller.enqueue(data);
      } catch (error) {
        // Connection is closed, remove it
        console.error(`Failed to send to connection ${connectionId}:`, error);
        this.connections.delete(connectionId);
      }
    }
  }

  private formatSSE(data: any): string {
    const eventData = JSON.stringify(data);
    return `data: ${eventData}\n\n`;
  }

  private startPingTimer(): void {
    const encoder = new TextEncoder();

    this.pingTimer = setInterval(() => {
      const pingData = encoder.encode(': ping\n\n');
      const now = Date.now();
      const deadConnections: string[] = [];

      for (const [connectionId, connection] of this.connections) {
        try {
          connection.controller.enqueue(pingData);
          connection.lastPing = now;
        } catch (error) {
          // Connection is dead
          deadConnections.push(connectionId);
        }
      }

      // Remove dead connections
      for (const connectionId of deadConnections) {
        this.connections.delete(connectionId);
      }

      // Stop timer if no connections
      if (this.connections.size === 0 && this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = undefined;
      }
    }, this.pingInterval) as unknown as number;
  }
}