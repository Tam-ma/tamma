import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrchestratorChat } from './OrchestratorChat';
import type {
  AgentConversationPayload,
  ChannelConnectionState,
  ChannelEnvelope,
  ChatRelayResult,
  UserChannel,
} from '../../api/userChannel';

function createMockChannel(initialState: ChannelConnectionState = 'connected') {
  let state: ChannelConnectionState = initialState;
  const stateListeners = new Set<(s: ChannelConnectionState) => void>();
  const chatListeners = new Set<(e: ChannelEnvelope<AgentConversationPayload>) => void>();
  const sendMock = vi.fn<(_convId: string, _text: string) => Promise<ChatRelayResult>>(
    async () => ({ accepted: true, reason: null }),
  );

  const channel: UserChannel = {
    start: vi.fn(async () => {
      for (const l of stateListeners) l(state);
    }),
    stop: vi.fn(async () => undefined),
    getState: () => state,
    onStateChange: (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    onReconnect: () => () => undefined,
    onChatMessage: (l) => {
      chatListeners.add(l);
      return () => chatListeners.delete(l);
    },
    onTaskUpdate: () => () => undefined,
    sendChatMessage: sendMock,
    ack: vi.fn(async () => true),
  };

  return {
    channel,
    sendMock,
    setState: (next: ChannelConnectionState) => {
      state = next;
      for (const l of stateListeners) l(next);
    },
    emitChat: (env: ChannelEnvelope<AgentConversationPayload>) => {
      for (const l of chatListeners) l(env);
    },
  };
}

const CONV_ID = '11111111-1111-4111-8111-111111111111';

function stubChatFetch(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`/api/chat/conversations/${CONV_ID}`)) {
      return new Response(
        JSON.stringify({
          conversationId: CONV_ID,
          messages: [
            {
              eventId: 'e-1',
              sequenceNumber: 1,
              conversationId: CONV_ID,
              turnId: 't-1',
              direction: 'user->agent',
              content: 'Investigate acme/web#42',
              timestamp: '2026-11-26T10:00:00Z',
            },
            {
              eventId: 'e-2',
              sequenceNumber: 2,
              conversationId: CONV_ID,
              turnId: 't-1',
              direction: 'agent->user',
              content: 'I will dispatch workflow investigate-issue for acme/web#42. Please confirm before I start it.',
              timestamp: '2026-11-26T10:00:02Z',
            },
          ],
          nextCursor: null,
          hasMore: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        items: [
          {
            conversationId: CONV_ID,
            lastActivityAt: '2026-11-26T10:00:02Z',
            lastSnippet: 'Please confirm before I start it.',
            messageCount: 2,
          },
        ],
        count: 1,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  stubChatFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OrchestratorChat', () => {
  it('loads persisted history, renders dispatch confirmation distinctly, and accumulates streamed frames', async () => {
    const mock = createMockChannel('connected');
    render(<OrchestratorChat channelFactory={() => mock.channel} />);

    await waitFor(() => {
      expect(screen.getByText('Investigate acme/web#42')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chat-dispatch-confirmation')).toBeInTheDocument();

    // Stream two partial frames then final frame.
    act(() => {
      mock.emitChat({
        messageId: 'm-p1',
        tenantId: 't-1',
        audience: 'user',
        createdAt: '2026-11-26T10:01:00Z',
        message: {
          kind: 'agent-conversation',
          conversationId: CONV_ID,
          userId: 'u-1',
          direction: 'agent->user',
          text: 'Checking ',
          partial: true,
        },
      });
      mock.emitChat({
        messageId: 'm-p2',
        tenantId: 't-1',
        audience: 'user',
        createdAt: '2026-11-26T10:01:01Z',
        message: {
          kind: 'agent-conversation',
          conversationId: CONV_ID,
          userId: 'u-1',
          direction: 'agent->user',
          text: 'issue #42...',
          partial: true,
        },
      });
    });

    expect(screen.getByTestId('chat-streaming-message')).toHaveTextContent('Checking issue #42...');

    act(() => {
      mock.emitChat({
        messageId: 'm-final',
        tenantId: 't-1',
        audience: 'user',
        createdAt: '2026-11-26T10:01:02Z',
        message: {
          kind: 'agent-conversation',
          conversationId: CONV_ID,
          userId: 'u-1',
          direction: 'agent->user',
          text: 'I cannot access acme/secret because you lack repository permission.',
          done: true,
        },
      });
    });

    expect(screen.queryByTestId('chat-streaming-message')).not.toBeInTheDocument();
    expect(
      screen.getByText('I cannot access acme/secret because you lack repository permission.'),
    ).toBeInTheDocument();
  });

  it('shows offline banner, disables send when disconnected, and preserves draft when agent is offline', async () => {
    const user = userEvent.setup();
    const mock = createMockChannel('disconnected');
    render(<OrchestratorChat channelFactory={() => mock.channel} />);

    expect(screen.getByTestId('chat-offline-banner')).toBeInTheDocument();
    const input = screen.getByLabelText('Message orchestrator');
    const sendBtn = screen.getByRole('button', { name: 'Send' });

    await user.type(input, 'Keep this draft');
    expect(sendBtn).toBeDisabled();

    // When channel connects but agent replies offline -> banner shown and draft preserved!
    mock.sendMock.mockResolvedValueOnce({
      accepted: false,
      reason: 'agent-offline: orchestrator is unavailable',
    });
    act(() => {
      mock.setState('connected');
    });

    await waitFor(() => expect(sendBtn).not.toBeDisabled());
    await user.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByTestId('agent-offline-banner')).toHaveTextContent('agent-offline');
    });
    expect(input).toHaveValue('Keep this draft');
  });
});
