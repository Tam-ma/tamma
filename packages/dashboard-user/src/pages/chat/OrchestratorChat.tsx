/**
 * OrchestratorChat — /chat (Story 39-19 AC1 / AC2 / D4 / D6 / D10)
 *
 * Primary per-user conversational interface with the tenant's Orchestrator Agent:
 *   - Loads reloadable conversation list & history from REST projections
 *     (GET /api/chat/conversations, GET /api/chat/conversations/{id}).
 *   - Sends live turns & receives streamed / final replies over `/hubs/user`.
 *   - Accumulates partial streamed frames in-place before committing the final reply.
 *   - When disconnected or when the orchestrator agent is offline: shows a
 *     persistent banner, disables send while disconnected, preserves composer text,
 *     and NEVER silently buffers messages locally (technical note 4).
 *   - Visually distinguishes workflow dispatch confirmation prompts (D6).
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import {
  getConversation,
  listConversations,
  type ChatConversationSummary,
  type ChatMessageItem,
} from '../../api/chat';
import type {
  AgentConversationPayload,
  ChannelEnvelope,
  UserChannel,
} from '../../api/userChannel';
import { useUserChannel } from '../../hooks/useUserChannel';

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
}

function isDispatchConfirmation(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes('confirm') && (lower.includes('workflow') || lower.includes('dispatch') || lower.includes('start'))) ||
    lower.includes('please confirm before')
  );
}

export interface OrchestratorChatProps {
  /** Optional channel factory override for tests. */
  channelFactory?: () => UserChannel;
}

export function OrchestratorChat({ channelFactory }: OrchestratorChatProps = {}): JSX.Element {
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(() => newUuid());
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const resp = await listConversations(50);
      const list = resp?.items ?? [];
      setConversations(list);
      if (list.length > 0) {
        setActiveConversationId((prev) =>
          list.some((c) => c.conversationId === prev) ? prev : list[0]!.conversationId,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadConversationHistory = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    setError(null);
    try {
      const page = await getConversation(convId, { limit: 100 });
      setMessages(page?.messages ?? []);
      setStreamingText(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation history');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const handleIncomingChat = useCallback(
    (envelope: ChannelEnvelope<AgentConversationPayload>) => {
      const msg = envelope.message;
      if (msg.conversationId !== activeConversationId) {
        void loadConversations();
        return;
      }

      if (msg.partial && !msg.done) {
        setStreamingText((prev) => (prev ?? '') + msg.text);
        return;
      }

      setStreamingText(null);
      setOfflineReason(null);
      setMessages((prev) => {
        if (prev.some((m) => m.eventId === envelope.messageId)) {
          return prev;
        }
        return [
          ...prev,
          {
            eventId: envelope.messageId,
            sequenceNumber: prev.length > 0 ? prev[prev.length - 1]!.sequenceNumber + 1 : 1,
            conversationId: msg.conversationId,
            turnId: null,
            direction: msg.direction,
            content: msg.text,
            timestamp: envelope.createdAt,
          },
        ];
      });
      void loadConversations();
    },
    [activeConversationId, loadConversations],
  );

  const handleReconnect = useCallback(() => {
    setOfflineReason(null);
    void loadConversations();
    void loadConversationHistory(activeConversationId);
  }, [activeConversationId, loadConversationHistory, loadConversations]);

  const { connectionState, sendChatMessage } = useUserChannel({
    channelFactory,
    onReconnect: handleReconnect,
    onChatMessage: handleIncomingChat,
  });

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const exists = conversations.some((c) => c.conversationId === activeConversationId);
    if (exists) {
      void loadConversationHistory(activeConversationId);
    } else {
      setMessages([]);
      setStreamingText(null);
    }
  }, [activeConversationId, conversations, loadConversationHistory]);

  const isConnected = connectionState === 'connected';

  const handleNewConversation = (): void => {
    const fresh = newUuid();
    setActiveConversationId(fresh);
    setMessages([]);
    setStreamingText(null);
    setOfflineReason(null);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !isConnected || sending) return;

    setSending(true);
    setError(null);
    setOfflineReason(null);

    try {
      const result = await sendChatMessage(activeConversationId, trimmed);
      if (!result.accepted) {
        // Offline / refused: preserve composer text and show persistent banner (never silently buffer).
        setOfflineReason(result.reason ?? 'Orchestrator agent is offline.');
        return;
      }

      // Accepted: append user bubble locally and clear draft.
      setMessages((prev) => [
        ...prev,
        {
          eventId: `local-${Date.now()}`,
          sequenceNumber: prev.length > 0 ? prev[prev.length - 1]!.sequenceNumber + 1 : 1,
          conversationId: activeConversationId,
          turnId: null,
          direction: 'user->agent',
          content: trimmed,
          timestamp: new Date().toISOString(),
        },
      ]);
      setDraft('');
      void loadConversations();
    } catch (err) {
      setOfflineReason(err instanceof Error ? err.message : 'Unable to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orchestrator Chat</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Ask about your repositories, workflows, or start an authorized workflow run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="channel-status"
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isConnected
                ? 'bg-green-100 text-green-800'
                : connectionState === 'connecting' || connectionState === 'reconnecting'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-red-100 text-red-800'
            }`}
          >
            {isConnected ? 'Connected' : connectionState === 'reconnecting' ? 'Reconnecting…' : 'Offline'}
          </span>
          <button
            type="button"
            onClick={handleNewConversation}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            New conversation
          </button>
        </div>
      </div>

      {!isConnected && (
        <div
          role="alert"
          data-testid="chat-offline-banner"
          className="p-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md"
        >
          Chat channel is currently offline ({connectionState}). Sending is paused until reconnected; your draft is preserved.
        </div>
      )}

      {offlineReason !== null && (
        <div
          role="alert"
          data-testid="agent-offline-banner"
          className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md"
        >
          Orchestrator unavailable: {offlineReason}
        </div>
      )}

      {error !== null && (
        <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 rounded-md">
          {error}
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 min-h-0">
        <aside className="bg-white border border-gray-200 rounded-md p-3 overflow-y-auto">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Conversations
          </h2>
          {loadingList ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-gray-400">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conv) => (
                <li key={conv.conversationId}>
                  <button
                    type="button"
                    onClick={() => setActiveConversationId(conv.conversationId)}
                    className={`w-full text-left px-2.5 py-2 rounded text-xs transition ${
                      conv.conversationId === activeConversationId
                        ? 'bg-gray-900 text-white'
                        : 'hover:bg-gray-100 text-gray-800'
                    }`}
                  >
                    <div className="truncate font-medium">
                      {conv.lastSnippet || 'Conversation'}
                    </div>
                    <div
                      className={`mt-0.5 text-[11px] ${
                        conv.conversationId === activeConversationId
                          ? 'text-gray-300'
                          : 'text-gray-500'
                      }`}
                    >
                      {conv.messageCount} messages
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="md:col-span-3 flex flex-col bg-white border border-gray-200 rounded-md min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="chat-messages">
            {loadingMessages ? (
              <p className="text-sm text-gray-500">Loading history…</p>
            ) : messages.length === 0 && streamingText === null ? (
              <p className="text-sm text-gray-500">
                Start a conversation with the Orchestrator Agent.
              </p>
            ) : (
              <>
                {messages.map((m) => {
                  const isUser = m.direction === 'user->agent';
                  const isConfirmation = !isUser && isDispatchConfirmation(m.content);
                  return (
                    <div
                      key={m.eventId}
                      data-testid={
                        isConfirmation
                          ? 'chat-dispatch-confirmation'
                          : isUser
                            ? 'chat-msg-user'
                            : 'chat-msg-agent'
                      }
                      className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                        isUser
                          ? 'ml-auto bg-gray-900 text-white'
                          : isConfirmation
                            ? 'mr-auto bg-indigo-50 border border-indigo-300 text-indigo-950'
                            : 'mr-auto bg-gray-100 text-gray-900'
                      }`}
                    >
                      {isConfirmation && (
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 mb-1">
                          Workflow dispatch confirmation
                        </div>
                      )}
                      <div>{m.content}</div>
                    </div>
                  );
                })}
                {streamingText !== null && (
                  <div
                    data-testid="chat-streaming-message"
                    className="max-w-[85%] mr-auto rounded-lg px-3.5 py-2.5 text-sm bg-gray-100 text-gray-900 whitespace-pre-wrap"
                  >
                    {streamingText}
                  </div>
                )}
              </>
            )}
          </div>

          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="border-t border-gray-200 p-3 flex gap-2"
          >
            <input
              type="text"
              aria-label="Message orchestrator"
              placeholder="Ask the orchestrator or request a workflow…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <button
              type="submit"
              disabled={!isConnected || sending || draft.trim().length === 0}
              className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
