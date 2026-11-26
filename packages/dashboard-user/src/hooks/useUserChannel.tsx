/**
 * Story 39-19 (D10) — React hook wrapping the single-module SignalR user channel.
 * Tracks connection state, triggers an `onReconnect` callback whenever the
 * socket recovers (so pages refetch REST state), and cleanly tears down on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUserChannel,
  type AgentConversationPayload,
  type ChannelConnectionState,
  type ChannelEnvelope,
  type ChatRelayResult,
  type TaskAssignedPayload,
  type UserChannel,
} from '../api/userChannel';

export interface UseUserChannelOptions {
  enabled?: boolean | undefined;
  channelFactory?: (() => UserChannel) | undefined;
  onReconnect?: (() => void) | undefined;
  onChatMessage?: ((envelope: ChannelEnvelope<AgentConversationPayload>) => void) | undefined;
  onTaskUpdate?: ((envelope: ChannelEnvelope<TaskAssignedPayload>) => void) | undefined;
}

export interface UseUserChannelResult {
  connectionState: ChannelConnectionState;
  sendChatMessage: (conversationId: string, text: string) => Promise<ChatRelayResult>;
  ack: (messageId: string) => Promise<boolean>;
}

export function useUserChannel(options: UseUserChannelOptions = {}): UseUserChannelResult {
  const { enabled = true, channelFactory, onReconnect, onChatMessage, onTaskUpdate } = options;

  const [connectionState, setConnectionState] = useState<ChannelConnectionState>('disconnected');
  const channelRef = useRef<UserChannel | null>(null);
  const channelFactoryRef = useRef(channelFactory);
  const onReconnectRef = useRef(onReconnect);
  const onChatRef = useRef(onChatMessage);
  const onTaskRef = useRef(onTaskUpdate);

  channelFactoryRef.current = channelFactory;
  onReconnectRef.current = onReconnect;
  onChatRef.current = onChatMessage;
  onTaskRef.current = onTaskUpdate;

  useEffect(() => {
    if (!enabled) {
      setConnectionState('disconnected');
      return;
    }

    let channel: UserChannel;
    try {
      channel = channelFactoryRef.current ? channelFactoryRef.current() : createUserChannel();
    } catch {
      setConnectionState('disconnected');
      return;
    }
    channelRef.current = channel;
    setConnectionState(channel.getState());

    const offState = channel.onStateChange((next) => {
      setConnectionState(next);
    });
    const offReconnect = channel.onReconnect(() => {
      onReconnectRef.current?.();
    });
    const offChat = channel.onChatMessage((env) => {
      onChatRef.current?.(env);
    });
    const offTask = channel.onTaskUpdate((env) => {
      onTaskRef.current?.(env);
    });

    void channel.start();

    return () => {
      offState();
      offReconnect();
      offChat();
      offTask();
      channelRef.current = null;
      void channel.stop();
    };
  }, [enabled]);

  const sendChatMessage = useCallback(
    async (conversationId: string, text: string): Promise<ChatRelayResult> => {
      const channel = channelRef.current;
      if (!channel) {
        return { accepted: false, reason: 'channel-disconnected: real-time channel is offline.' };
      }
      return channel.sendChatMessage(conversationId, text);
    },
    [],
  );

  const ack = useCallback(async (messageId: string): Promise<boolean> => {
    const channel = channelRef.current;
    if (!channel) return false;
    return channel.ack(messageId);
  }, []);

  return { connectionState, sendChatMessage, ack };
}
