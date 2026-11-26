/**
 * Story 39-19 (D10) — the SINGLE module in dashboard-user that knows the
 * Story 39-18 SignalR hub URL (`/hubs/user`) and wire method names
 * (`Receive`, `SendAgentMessage`, `Ack`). Any protocol adjustment in 39-18 is
 * a one-file edit here.
 */

import {
  HubConnectionBuilder,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr';

export type ChannelConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface AgentConversationPayload {
  kind: 'agent-conversation';
  conversationId: string;
  userId: string;
  direction: 'user->agent' | 'agent->user';
  text: string;
  partial?: boolean;
  done?: boolean;
}

export interface TaskAssignedPayload {
  kind: 'task-assigned';
  taskId: string;
  decisionSessionId: string;
  assignedRole: string;
  basis: string;
  documentTypeKey: string;
  documentId: string;
  issueId: string;
  autonomyLevel: number;
  rulesReference?: string | null;
}

export type ChannelMessagePayload =
  | AgentConversationPayload
  | TaskAssignedPayload
  | { kind: string; [key: string]: unknown };

export interface ChannelEnvelope<T = ChannelMessagePayload> {
  messageId: string;
  tenantId: string;
  audience: string;
  recipientUserId?: string | null;
  message: T;
  createdAt: string;
}

export interface ChatRelayResult {
  accepted: boolean;
  reason?: string | null;
}

export interface HubConnectionLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(methodName: string, handler: (...args: unknown[]) => void): void;
  off(methodName: string, handler: (...args: unknown[]) => void): void;
  invoke<T = unknown>(methodName: string, ...args: unknown[]): Promise<T>;
  onreconnecting(callback: (error?: Error) => void): void;
  onreconnected(callback: (connectionId?: string) => void): void;
  onclose(callback: (error?: Error) => void): void;
}

export interface UserChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): ChannelConnectionState;
  onStateChange(listener: (state: ChannelConnectionState) => void): () => void;
  onReconnect(listener: () => void): () => void;
  onChatMessage(listener: (envelope: ChannelEnvelope<AgentConversationPayload>) => void): () => void;
  onTaskUpdate(listener: (envelope: ChannelEnvelope<TaskAssignedPayload>) => void): () => void;
  sendChatMessage(conversationId: string, text: string): Promise<ChatRelayResult>;
  ack(messageId: string): Promise<boolean>;
}

export interface UserChannelOptions {
  baseUrl?: string;
  hubFactory?: () => HubConnectionLike;
}

const USER_HUB_PATH = '/hubs/user';

function resolveDefaultBaseUrl(): string {
  const envUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL) ||
    '';
  if (envUrl) return envUrl;
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.origin !== 'null'
  ) {
    return window.location.origin;
  }
  return 'http://localhost';
}

export function createUserChannel(options: UserChannelOptions = {}): UserChannel {
  const baseUrl = options.baseUrl ?? resolveDefaultBaseUrl();
  const connection: HubConnectionLike =
    options.hubFactory?.() ??
    (new HubConnectionBuilder()
      .withUrl(`${baseUrl}${USER_HUB_PATH}`, {
        withCredentials: true,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build() as HubConnection);

  let state: ChannelConnectionState = 'disconnected';
  const stateListeners = new Set<(s: ChannelConnectionState) => void>();
  const reconnectListeners = new Set<() => void>();
  const chatListeners = new Set<(e: ChannelEnvelope<AgentConversationPayload>) => void>();
  const taskListeners = new Set<(e: ChannelEnvelope<TaskAssignedPayload>) => void>();

  const setState = (next: ChannelConnectionState): void => {
    if (state === next) return;
    state = next;
    for (const listener of stateListeners) {
      listener(next);
    }
  };

  const handleReceive = (raw: unknown): void => {
    const envelope = raw as ChannelEnvelope | null;
    if (!envelope || !envelope.message) return;

    if (envelope.message.kind === 'agent-conversation') {
      const chatEnv = envelope as ChannelEnvelope<AgentConversationPayload>;
      for (const listener of chatListeners) {
        listener(chatEnv);
      }
      return;
    }

    if (envelope.message.kind === 'task-assigned') {
      const taskEnv = envelope as ChannelEnvelope<TaskAssignedPayload>;
      for (const listener of taskListeners) {
        listener(taskEnv);
      }
    }
  };

  connection.on('Receive', handleReceive);
  connection.onreconnecting(() => {
    setState('reconnecting');
  });
  connection.onreconnected(() => {
    setState('connected');
    for (const listener of reconnectListeners) {
      listener();
    }
  });
  connection.onclose(() => {
    setState('disconnected');
  });

  return {
    async start(): Promise<void> {
      if (state === 'connected' || state === 'connecting') return;
      setState('connecting');
      try {
        await connection.start();
        setState('connected');
      } catch {
        setState('disconnected');
      }
    },

    async stop(): Promise<void> {
      connection.off('Receive', handleReceive);
      try {
        await connection.stop();
      } finally {
        setState('disconnected');
      }
    },

    getState(): ChannelConnectionState {
      return state;
    },

    onStateChange(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },

    onChatMessage(listener) {
      chatListeners.add(listener);
      return () => {
        chatListeners.delete(listener);
      };
    },

    onTaskUpdate(listener) {
      taskListeners.add(listener);
      return () => {
        taskListeners.delete(listener);
      };
    },

    async sendChatMessage(conversationId: string, text: string): Promise<ChatRelayResult> {
      if (state !== 'connected') {
        return { accepted: false, reason: 'channel-disconnected: real-time channel is offline.' };
      }
      const payload = {
        kind: 'agent-conversation',
        conversationId,
        userId: '00000000-0000-0000-0000-000000000000',
        direction: 'user->agent',
        text,
      };
      return await connection.invoke<ChatRelayResult>('SendAgentMessage', payload);
    },

    async ack(messageId: string): Promise<boolean> {
      if (state !== 'connected') return false;
      const result = await connection.invoke<{ acked?: boolean }>('Ack', messageId);
      return Boolean(result?.acked);
    },
  };
}
