import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskView } from './TaskView';
import type { ChannelEnvelope, TaskAssignedPayload, UserChannel } from '../../api/userChannel';

function createMockTaskChannel() {
  const taskListeners = new Set<(e: ChannelEnvelope<TaskAssignedPayload>) => void>();
  const channel: UserChannel = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    getState: () => 'connected',
    onStateChange: (l) => {
      l('connected');
      return () => undefined;
    },
    onReconnect: () => () => undefined,
    onChatMessage: () => () => undefined,
    onTaskUpdate: (l) => {
      taskListeners.add(l);
      return () => taskListeners.delete(l);
    },
    sendChatMessage: vi.fn(async () => ({ accepted: true })),
    ack: vi.fn(async () => true),
  };

  return {
    channel,
    emitTaskUpdate: (env: ChannelEnvelope<TaskAssignedPayload>) => {
      for (const l of taskListeners) l(env);
    },
  };
}

const SAMPLE_TASK = {
  sessionId: '22222222-2222-4222-8222-222222222222',
  taskType: 'acceptance_decision',
  documentType: 'design',
  documentId: '33333333-3333-4333-8333-333333333333',
  issueId: 'acme/web#42',
  correlationId: 'wf-42',
  repoKey: 'acme/web',
  assignedRole: 'member',
  eligibilityBasis: 'repo-access',
  autonomyContext: 'autonomy level 65: Design requires human acceptance',
  rulesReference: 'rules-v4',
  assignedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  status: 'pending',
  lineageUrl: '/api/documents/issues/acme%2Fweb%2342/lineage',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TaskView', () => {
  it('renders task metadata, autonomy context, lineage link, and submits decision to 39-8 resume endpoint', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/documents/decisions/') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ resumed: true, kind: 'accept', channel: 'user' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ items: [SAMPLE_TASK], count: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mock = createMockTaskChannel();
    render(<TaskView channelFactory={() => mock.channel} />);

    await waitFor(() => {
      expect(screen.getByText('autonomy level 65: Design requires human acceptance')).toBeInTheDocument();
    });

    const lineageLink = screen.getByRole('link', { name: /view lineage/i });
    expect(lineageLink).toHaveAttribute('href', SAMPLE_TASK.lineageUrl);

    await user.click(screen.getByRole('button', { name: 'Act' }));
    await user.type(screen.getByLabelText('Feedback'), 'Looks solid');
    await user.click(screen.getByRole('button', { name: 'Submit decision' }));

    await waitFor(() => {
      expect(screen.getByTestId('task-notice')).toHaveTextContent("Decision 'accept' submitted.");
    });

    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes(`/api/documents/decisions/${SAMPLE_TASK.sessionId}/resume`),
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      kind: 'accept',
      feedback: 'Looks solid',
    });
    expect(screen.queryByText('wf-42')).not.toBeInTheDocument();
  });

  it('removes row with already-completed notice on 409 and refetches on channel task update', async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/documents/decisions/') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'gate_not_waiting' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      listCalls++;
      return new Response(
        JSON.stringify({ items: listCalls === 1 ? [SAMPLE_TASK] : [], count: listCalls === 1 ? 1 : 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const mock = createMockTaskChannel();
    render(<TaskView channelFactory={() => mock.channel} />);

    await waitFor(() => expect(screen.getByText('wf-42')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Act' }));
    await user.click(screen.getByRole('button', { name: 'Submit decision' }));

    await waitFor(() => {
      expect(screen.getByTestId('task-notice')).toHaveTextContent(/already completed/i);
    });

    // Live channel update triggers refetch.
    act(() => {
      mock.emitTaskUpdate({
        messageId: 'm-1',
        tenantId: 't-1',
        audience: 'user',
        createdAt: new Date().toISOString(),
        message: {
          kind: 'task-assigned',
          taskId: 'tk-1',
          decisionSessionId: 's-new',
          assignedRole: 'member',
          basis: 'repo-access',
          documentTypeKey: 'design',
          documentId: 'd-1',
          issueId: 'acme/web#99',
          autonomyLevel: 50,
        },
      });
    });

    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
  });
});
