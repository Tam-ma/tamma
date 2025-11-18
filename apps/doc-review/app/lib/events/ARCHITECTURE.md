# Real-time Events Architecture

## Overview
This document outlines the real-time collaboration system for doc-review using Server-Sent Events (SSE) and Cloudflare Durable Objects.

## Architecture Decision

### Chosen Approach: Cloudflare Durable Objects

We have chosen **Durable Objects** over KV with polling for the following reasons:

1. **Real-time Coordination**: Durable Objects provide stateful, in-memory coordination perfect for managing SSE connections
2. **Low Latency**: Direct WebSocket-like performance without the WebSocket protocol overhead
3. **Automatic Scaling**: Each document gets its own Durable Object instance, providing natural sharding
4. **Connection Management**: Built-in support for managing multiple concurrent connections
5. **Consistency**: Strong consistency guarantees for event ordering within a document

### Architecture Components

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ SSE Connection
       ▼
┌─────────────┐
│  SSE API    │
│  Endpoint   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│  Durable    │────▶│  Event Bus   │
│  Objects    │     │  (In-Memory) │
└─────────────┘     └──────────────┘
       ▲
       │ Publish Events
┌──────┴──────┐
│   API       │
│  Endpoints  │
└─────────────┘
```

## Event Flow

1. **Event Generation**: API endpoints (comments, suggestions, discussions) generate events
2. **Event Publishing**: Events are sent to the appropriate Durable Object based on document ID
3. **Event Distribution**: Durable Object broadcasts events to all connected SSE clients
4. **Client Reception**: Clients receive events and update UI in real-time

## Event Types

```typescript
type RealtimeEvent =
  | { type: 'comment.created', docPath: string, data: Comment }
  | { type: 'comment.updated', docPath: string, data: Comment }
  | { type: 'comment.deleted', docPath: string, data: { id: string } }
  | { type: 'suggestion.created', docPath: string, data: Suggestion }
  | { type: 'suggestion.updated', docPath: string, data: Suggestion }
  | { type: 'suggestion.approved', docPath: string, data: Suggestion }
  | { type: 'discussion.created', docPath: string, data: Discussion }
  | { type: 'discussion.message', docPath: string, data: DiscussionMessage }
  | { type: 'user.presence', docPath: string, data: { userId: string, status: 'online' | 'offline' } }
```

## Durable Object Design

### EventBroadcaster Durable Object

Each document gets its own EventBroadcaster instance identified by document path hash.

**State Management**:
- Active SSE connections (Map<connectionId, Response>)
- Recent events buffer (last 100 events for replay)
- Active users presence tracking

**Methods**:
- `handleSSE(request)`: Establish SSE connection
- `publishEvent(event)`: Broadcast to all connections
- `getRecentEvents()`: Return buffered events for new connections

## SSE Connection Lifecycle

1. **Connection**: Client connects to `/api/events?docPath=X`
2. **Authentication**: Verify user session
3. **Durable Object Routing**: Route to document's Durable Object
4. **Event Replay**: Send recent events to catch up client
5. **Live Streaming**: Stream new events as they occur
6. **Heartbeat**: Send ping every 30s to keep connection alive
7. **Reconnection**: Client auto-reconnects on disconnect

## Performance Targets

- **Event Latency**: < 100ms (within same region)
- **Connection Limit**: 1000 concurrent per document
- **Event Throughput**: 100 events/second per document
- **Reconnection Time**: < 2 seconds
- **Memory Usage**: < 10MB per Durable Object

## Error Handling

1. **Connection Failures**: Automatic retry with exponential backoff
2. **Durable Object Failures**: Fallback to KV-based event log
3. **Network Partitions**: Client-side event queue for offline support
4. **Rate Limiting**: 10 events/second per user

## Security Considerations

1. **Authentication**: All SSE connections require valid session
2. **Authorization**: Users only receive events for documents they can access
3. **Event Filtering**: Server-side filtering based on user permissions
4. **Rate Limiting**: Prevent event flooding attacks
5. **Connection Limits**: Max 5 connections per user

## Monitoring

Key metrics to track:
- Active connections per document
- Event delivery latency
- Connection drop rate
- Event throughput
- Durable Object memory usage

## Future Enhancements

1. **Event Compression**: Batch and compress events for high-volume scenarios
2. **Event Persistence**: Store events in D1 for replay and analytics
3. **Cursor Tracking**: Show where other users are viewing/editing
4. **Typing Indicators**: Show when users are typing comments
5. **Conflict Resolution**: Handle concurrent edits with CRDTs