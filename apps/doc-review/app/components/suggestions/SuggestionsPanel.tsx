import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from 'react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReviewSession } from '~/lib/types/review-session';
import type { Suggestion } from '~/lib/types/suggestion';
import { SuggestionCard } from './SuggestionCard';

interface SuggestionsPanelProps {
  docPath: string;
  sessions: ReviewSession[];
  onSessionUpdated: () => void;
}

export function SuggestionsPanel({ docPath, sessions, onSessionUpdated }: SuggestionsPanelProps) {
  const listFetcher = useFetcher<{ suggestions?: Suggestion[]; message?: string }>();
  const formFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const sessionFormFetcher = useFetcher<{ session?: ReviewSession; error?: string }>();
  const [showRecentSuggestions, setShowRecentSuggestions] = useState(false);

  useEffect(() => {
    listFetcher.load(`/api/suggestions?docPath=${encodeURIComponent(docPath)}&limit=5`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath]);

  useEffect(() => {
    if (formFetcher.state === 'idle' && formFetcher.data?.ok) {
      listFetcher.load(`/api/suggestions?docPath=${encodeURIComponent(docPath)}&limit=5`);
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

  const suggestions = listFetcher.data?.suggestions ?? [];

  return (
    <div className="rounded-lg border border-indigo-100 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-indigo-900">Edit Suggestions</h2>
          <p className="text-xs text-indigo-500">Draft improvements before opening a PR.</p>
        </div>
        <span className="text-xs text-indigo-600">
          {suggestions.length} recent
        </span>
      </header>

      {/* Recent suggestions preview */}
      {suggestions.length > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowRecentSuggestions(!showRecentSuggestions)}
            className="flex w-full items-center justify-between rounded-md bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
          >
            <span>Recent Suggestions ({suggestions.length})</span>
            {showRecentSuggestions ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showRecentSuggestions && (
            <div className="mt-2 space-y-2 max-h-96 overflow-auto pr-1">
              {suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  expanded={false}
                  showActions={false}
                  canReview={false}
                  className="text-sm"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {suggestions.length === 0 && (
        <div className="mb-4 rounded border border-indigo-100 bg-indigo-50/50 p-3 text-sm text-indigo-700">
          No suggestions yet. Create one below to get started.
        </div>
      )}

      <formFetcher.Form method="post" action="/api/suggestions" className="mt-4 space-y-2">
        <input type="hidden" name="docPath" value={docPath} />
        <div>
          <label className="block text-xs font-medium text-indigo-700" htmlFor="sessionId">
            Review Session
          </label>
          <select
            id="sessionId"
            name="sessionId"
            className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
            required
            disabled={!hasSessions || formFetcher.state !== 'idle'}
            defaultValue={sessions[0]?.id ?? ''}
          >
            {hasSessions ? sessionOptions : <option value="">No sessions available</option>}
          </select>
          {!hasSessions && (
            <p className="mt-1 text-xs text-indigo-600">
              Create a session below to start proposing changes.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-indigo-700" htmlFor="lineStart">
              Line Start
            </label>
            <input
              id="lineStart"
              name="lineStart"
              type="number"
              min="1"
              required
              className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-indigo-700" htmlFor="lineEnd">
              Line End
            </label>
            <input
              id="lineEnd"
              name="lineEnd"
              type="number"
              min="1"
              required
              className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
            />
          </div>
        </div>

        <label className="block text-xs font-medium text-indigo-700" htmlFor="description">
          Summary
        </label>
        <input
          id="description"
          name="description"
          className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
          placeholder="Clarify the deployment steps..."
          required
        />

        <label className="block text-xs font-medium text-indigo-700" htmlFor="originalText">
          Original Text
        </label>
        <textarea
          id="originalText"
          name="originalText"
          className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
          rows={2}
          required
        />

        <label className="block text-xs font-medium text-indigo-700" htmlFor="suggestedText">
          Suggested Text
        </label>
        <textarea
          id="suggestedText"
          name="suggestedText"
          className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
          rows={2}
          required
        />

        {formFetcher.data?.error && (
          <p className="text-xs text-red-600">{formFetcher.data.error}</p>
        )}

        <button
          type="submit"
          className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          disabled={formFetcher.state !== 'idle' || !hasSessions}
        >
          {formFetcher.state === 'idle' ? 'Propose Change' : 'Submitting...'}
        </button>
      </formFetcher.Form>

      <div className="mt-4 rounded border border-indigo-50 bg-indigo-50/50 p-3">
        <p className="text-xs font-semibold text-indigo-800">Need a new review session?</p>
        <p className="text-xs text-indigo-600">
          Sessions group related changes and back a single PR. Create one per epic or topic.
        </p>
        <sessionFormFetcher.Form method="post" action="/api/sessions" className="mt-2 space-y-2">
          <input type="hidden" name="docPaths" value={docPath} />
          <label className="block text-xs font-medium text-indigo-700" htmlFor="sessionTitle">
            Session Title
          </label>
          <input
            id="sessionTitle"
            name="title"
            className="w-full rounded border border-indigo-200 px-2 py-1 text-sm"
            placeholder="Epic 1 - provider strategy"
            required
          />
          <button
            type="submit"
            className="w-full rounded bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow disabled:opacity-60"
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
