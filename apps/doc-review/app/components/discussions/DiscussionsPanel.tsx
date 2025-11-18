import { useEffect, useMemo } from 'react';
import { useFetcher } from 'react-router';
import type { ReviewSession } from '~/lib/types/review-session';

type Discussion = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: number;
  author?: {
    id: string | null;
    name: string | null;
  };
  session?: {
    id: string;
    title: string;
    status: string;
    prNumber?: number | null;
    prUrl?: string | null;
  };
};

interface DiscussionsPanelProps {
  docPath: string;
  sessions: ReviewSession[];
  onSessionUpdated: () => void;
}

export function DiscussionsPanel({ docPath, sessions, onSessionUpdated }: DiscussionsPanelProps) {
  const listFetcher = useFetcher<{ discussions?: Discussion[]; message?: string }>();
  const formFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const sessionFormFetcher = useFetcher<{ session?: ReviewSession; error?: string }>();

  useEffect(() => {
    listFetcher.load(`/api/discussions?docPath=${encodeURIComponent(docPath)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath]);

  useEffect(() => {
    if (formFetcher.state === 'idle' && formFetcher.data?.ok) {
      listFetcher.load(`/api/discussions?docPath=${encodeURIComponent(docPath)}`);
    }
  }, [formFetcher.state, formFetcher.data, docPath, listFetcher]);

  useEffect(() => {
    if (sessionFormFetcher.state === 'idle' && sessionFormFetcher.data?.session) {
      onSessionUpdated();
    }
  }, [sessionFormFetcher.state, sessionFormFetcher.data, onSessionUpdated]);

  const hasSessions = sessions.length > 0;
  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => (
        <option key={session.id} value={session.id}>
          {session.title}{' '}
          {session.prNumber ? `(PR #${session.prNumber})` : `(${session.status})`}
        </option>
      )),
    [sessions]
  );

  return (
    <div className="rounded-lg border border-amber-100 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">Discussions</h2>
          <p className="text-xs text-amber-600">Track open questions for this document.</p>
        </div>
        <span className="text-xs text-amber-600">
          {(listFetcher.data?.discussions ?? []).length} threads
        </span>
      </header>

      <div className="space-y-2 max-h-40 overflow-auto pr-1">
        {(listFetcher.data?.discussions ?? []).length === 0 ? (
          <p className="text-sm text-amber-700">No open discussions. Start one below.</p>
        ) : (
          listFetcher.data?.discussions?.map((discussion) => (
            <article key={discussion.id} className="rounded border border-amber-100 p-2 text-sm">
              <div className="flex items-center justify-between text-xs text-amber-500">
                <span>
                  {discussion.status} · {discussion.author?.name ?? 'Unknown'}
                  {discussion.session?.prNumber && (
                    <button
                      type="button"
                      className="ml-2 text-[11px] font-semibold text-amber-700 underline"
                      onClick={() => {
                        if (discussion.session?.prUrl) {
                          window.open(discussion.session.prUrl, '_blank');
                        }
                      }}
                    >
                      PR #{discussion.session.prNumber}
                    </button>
                  )}
                </span>
                <span>{new Date(discussion.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-1 font-medium text-amber-900">{discussion.title}</p>
              {discussion.description && (
                <p className="text-xs text-amber-700">{discussion.description}</p>
              )}
            </article>
          ))
        )}
      </div>

      <formFetcher.Form method="post" action="/api/discussions" className="mt-4 space-y-2">
        <input type="hidden" name="docPath" value={docPath} />
        <div>
          <label className="block text-xs font-medium text-amber-700" htmlFor="sessionId-discussions">
            Review Session
          </label>
          <select
            id="sessionId-discussions"
            name="sessionId"
            className="w-full rounded border border-amber-200 px-2 py-1 text-sm"
            required
            disabled={!hasSessions || formFetcher.state !== 'idle'}
            defaultValue={sessions[0]?.id ?? ''}
          >
            {hasSessions ? sessionOptions : <option value="">No sessions available</option>}
          </select>
          {!hasSessions && (
            <p className="mt-1 text-xs text-amber-600">
              Create a session below to tie this discussion to a PR.
            </p>
          )}
        </div>
        <label className="block text-xs font-medium text-amber-700" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          className="w-full rounded border border-amber-200 px-2 py-1 text-sm"
          placeholder="Clarify orchestration events"
          required
        />

        <label className="block text-xs font-medium text-amber-700" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          className="w-full rounded border border-amber-200 px-2 py-1 text-sm"
          rows={3}
          placeholder="Capture the question or context..."
          required
        />

        {formFetcher.data?.error && (
          <p className="text-xs text-red-600">{formFetcher.data.error}</p>
        )}

        <button
          type="submit"
          className="w-full rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          disabled={formFetcher.state !== 'idle' || !hasSessions}
        >
          {formFetcher.state === 'idle' ? 'Start Discussion' : 'Starting...'}
        </button>
      </formFetcher.Form>

      <div className="mt-4 rounded border border-amber-50 bg-amber-50/60 p-3">
        <p className="text-xs font-semibold text-amber-900">Need a new session?</p>
        <p className="text-xs text-amber-700">
          Sessions keep related docs under one PR. Create one per topic/epic.
        </p>
        <sessionFormFetcher.Form method="post" action="/api/sessions" className="mt-2 space-y-2">
          <input type="hidden" name="docPaths" value={docPath} />
          <label className="block text-xs font-medium text-amber-700" htmlFor="discussion-session-title">
            Session Title
          </label>
          <input
            id="discussion-session-title"
            name="title"
            className="w-full rounded border border-amber-200 px-2 py-1 text-sm"
            placeholder="Session name"
            required
          />
          <button
            type="submit"
            className="w-full rounded bg-white px-3 py-1.5 text-xs font-medium text-amber-700 shadow disabled:opacity-60"
            disabled={sessionFormFetcher.state !== 'idle'}
          >
            {sessionFormFetcher.state === 'idle' ? 'Create Session' : 'Creating...'}
          </button>
          {sessionFormFetcher.data?.error && (
            <p className="text-xs text-red-600">{sessionFormFetcher.data.error}</p>
          )}
        </sessionFormFetcher.Form>
      </div>
    </div>
  );
}
