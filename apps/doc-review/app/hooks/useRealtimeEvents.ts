/**
 * React hook for real-time event subscription
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Comment, Suggestion, Discussion } from '~/lib/types/document';

export interface RealtimeEventHandlers {
  onComment?: (event: { type: 'created' | 'updated' | 'deleted'; data: Comment | { id: string } }) => void;
  onSuggestion?: (event: { type: 'created' | 'updated' | 'approved'; data: Suggestion }) => void;
  onDiscussion?: (event: { type: 'created' | 'message'; data: Discussion | any }) => void;
  onPresence?: (event: { userId: string; status: 'online' | 'offline' }) => void;
  onConnect?: (connectionId: string) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export interface UseRealtimeEventsOptions extends RealtimeEventHandlers {
  docPath?: string;
  enabled?: boolean;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  connectionId: string | null;
  error: Error | null;
}

export function useRealtimeEvents(options: UseRealtimeEventsOptions) {
  const {
    docPath,
    enabled = true,
    reconnectDelay = 1000,
    maxReconnectDelay = 30000,
    onComment,
    onSuggestion,
    onDiscussion,
    onPresence,
    onConnect,
    onDisconnect,
    onError
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    connected: false,
    connecting: false,
    connectionId: null,
    error: null
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(reconnectDelay);
  const isUnmountedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionState({
      connected: false,
      connecting: false,
      connectionId: null,
      error: null
    });
  }, []);

  const handleEvent = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);

      // Handle connection event
      if (data.type === 'connected') {
        setConnectionState(prev => ({
          ...prev,
          connected: true,
          connecting: false,
          connectionId: data.data.connectionId
        }));
        reconnectDelayRef.current = reconnectDelay;
        onConnect?.(data.data.connectionId);
        return;
      }

      // Handle comment events
      if (data.type.startsWith('comment.')) {
        const eventType = data.type.split('.')[1] as 'created' | 'updated' | 'deleted';
        onComment?.({ type: eventType, data: data.data });
      }

      // Handle suggestion events
      if (data.type.startsWith('suggestion.')) {
        const eventType = data.type.split('.')[1] as 'created' | 'updated' | 'approved';
        onSuggestion?.({ type: eventType, data: data.data });
      }

      // Handle discussion events
      if (data.type.startsWith('discussion.')) {
        const eventType = data.type.split('.')[1] as 'created' | 'message';
        onDiscussion?.({ type: eventType, data: data.data });
      }

      // Handle presence events
      if (data.type === 'user.presence') {
        onPresence?.(data.data);
      }
    } catch (error) {
      console.error('Error parsing SSE event:', error);
    }
  }, [onComment, onSuggestion, onDiscussion, onPresence, onConnect, reconnectDelay]);

  const connect = useCallback(() => {
    if (!docPath || !enabled || isUnmountedRef.current) {
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionState(prev => ({
      ...prev,
      connecting: true,
      error: null
    }));

    try {
      const url = `/api/events?docPath=${encodeURIComponent(docPath)}`;
      const eventSource = new EventSource(url);

      eventSource.onmessage = handleEvent;

      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);

        const errorObj = new Error('Connection failed');
        setConnectionState(prev => ({
          ...prev,
          connected: false,
          connecting: false,
          error: errorObj
        }));

        onError?.(errorObj);
        onDisconnect?.();

        // Close the connection
        eventSource.close();
        eventSourceRef.current = null;

        // Schedule reconnection with exponential backoff
        if (!isUnmountedRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              maxReconnectDelay
            );
            connect();
          }, reconnectDelayRef.current);
        }
      };

      eventSource.onopen = () => {
        console.log('SSE connection opened');
      };

      eventSourceRef.current = eventSource;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Failed to create EventSource');
      setConnectionState(prev => ({
        ...prev,
        connecting: false,
        error: errorObj
      }));
      onError?.(errorObj);
    }
  }, [docPath, enabled, handleEvent, maxReconnectDelay, onDisconnect, onError]);

  // Handle connection lifecycle
  useEffect(() => {
    isUnmountedRef.current = false;

    if (enabled && docPath) {
      connect();
    }

    return () => {
      isUnmountedRef.current = true;
      cleanup();
    };
  }, [docPath, enabled]); // Note: Intentionally not including connect to avoid recreation loops

  // Public API
  const reconnect = useCallback(() => {
    cleanup();
    reconnectDelayRef.current = reconnectDelay;
    connect();
  }, [cleanup, connect, reconnectDelay]);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    ...connectionState,
    reconnect,
    disconnect
  };
}

/**
 * Helper hook for comment-specific real-time updates
 */
export function useRealtimeComments(
  docPath: string | undefined,
  onUpdate: (event: { type: 'created' | 'updated' | 'deleted'; data: Comment | { id: string } }) => void
) {
  return useRealtimeEvents({
    docPath,
    onComment: onUpdate
  });
}

/**
 * Helper hook for suggestion-specific real-time updates
 */
export function useRealtimeSuggestions(
  docPath: string | undefined,
  onUpdate: (event: { type: 'created' | 'updated' | 'approved'; data: Suggestion }) => void
) {
  return useRealtimeEvents({
    docPath,
    onSuggestion: onUpdate
  });
}

/**
 * Helper hook for discussion-specific real-time updates
 */
export function useRealtimeDiscussions(
  docPath: string | undefined,
  onUpdate: (event: { type: 'created' | 'message'; data: Discussion | any }) => void
) {
  return useRealtimeEvents({
    docPath,
    onDiscussion: onUpdate
  });
}