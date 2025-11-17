import { useState, useEffect, useMemo, useCallback } from 'react';
import { useFetcher } from 'react-router';
import { Filter, ChevronDown, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import type { Suggestion, SuggestionStatus } from '~/lib/types/suggestion';
import type { ReviewSession } from '~/lib/types/review-session';
import { SuggestionCard } from './SuggestionCard';

interface SuggestionReviewPanelProps {
  docPath?: string;
  sessionId?: string;
  userId?: string;
  canReview?: boolean;
  onUpdate?: () => void;
  className?: string;
}

export function SuggestionReviewPanel({
  docPath,
  sessionId,
  userId,
  canReview = false,
  onUpdate,
  className = '',
}: SuggestionReviewPanelProps) {
  const fetcher = useFetcher<{
    suggestions?: Suggestion[];
    pagination?: { limit: number; offset: number; hasMore: boolean };
  }>();

  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | 'all'>('all');
  const [sessionFilter, setSessionFilter] = useState<string | 'all'>(sessionId || 'all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);

  // Load suggestions on mount and when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (docPath) params.set('docPath', docPath);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sessionFilter !== 'all') params.set('sessionId', sessionFilter);
    if (userId) params.set('userId', userId);

    fetcher.load(`/api/suggestions?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath, statusFilter, sessionFilter, userId]);

  const suggestions = fetcher.data?.suggestions ?? [];

  // Group suggestions by session
  const groupedSuggestions = useMemo(() => {
    const groups: Map<string, Suggestion[]> = new Map();

    for (const suggestion of suggestions) {
      const key = suggestion.session?.id || 'no-session';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(suggestion);
    }

    return groups;
  }, [suggestions]);

  // Get unique sessions for filter dropdown
  const sessions = useMemo(() => {
    const sessionMap = new Map<string, ReviewSession | null>();

    for (const suggestion of suggestions) {
      if (suggestion.session) {
        sessionMap.set(suggestion.session.id, {
          id: suggestion.session.id,
          title: suggestion.session.title,
          status: suggestion.session.status,
          prNumber: suggestion.session.prNumber ?? null,
          prUrl: suggestion.session.prUrl ?? null,
          // These fields are not available from suggestion data, but required by type
          summary: null,
          docPaths: [docPath || ''],
          primaryDocPath: docPath || '',
          branch: null,
          ownerId: '',
          createdAt: 0,
        });
      }
    }

    return Array.from(sessionMap.values()).filter(
      (s): s is ReviewSession => s !== null
    );
  }, [suggestions, docPath]);

  // Count suggestions by status
  const statusCounts = useMemo(() => {
    const counts = {
      all: suggestions.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      deleted: 0,
    };

    for (const suggestion of suggestions) {
      counts[suggestion.status]++;
    }

    return counts;
  }, [suggestions]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't handle if typing in input
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setKeyboardIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const suggestion = suggestions[keyboardIndex];
        if (suggestion) {
          setExpandedId(expandedId === suggestion.id ? null : suggestion.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [suggestions, keyboardIndex, expandedId]);

  const handleRefresh = useCallback(() => {
    const params = new URLSearchParams();
    if (docPath) params.set('docPath', docPath);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sessionFilter !== 'all') params.set('sessionId', sessionFilter);
    if (userId) params.set('userId', userId);

    fetcher.load(`/api/suggestions?${params.toString()}`);
    onUpdate?.();
  }, [docPath, statusFilter, sessionFilter, userId, fetcher, onUpdate]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header with filters */}
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Suggestions</h2>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {fetcher.state === 'loading' && (
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            )}
            <span>{suggestions.length} total</span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          {/* Status filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SuggestionStatus | 'all')}
              className="appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Status ({statusCounts.all})</option>
              <option value="pending">
                Pending ({statusCounts.pending})
              </option>
              <option value="approved">
                Approved ({statusCounts.approved})
              </option>
              <option value="rejected">
                Rejected ({statusCounts.rejected})
              </option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          </div>

          {/* Session filter */}
          {sessions.length > 0 && (
            <div className="relative">
              <select
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                className="appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">All Sessions</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title}
                    {session.prNumber ? ` (PR #${session.prNumber})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
          )}

          {/* Status badges */}
          <div className="flex flex-1 items-center justify-end gap-2">
            {statusCounts.pending > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  statusFilter === 'pending'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Clock className="h-3 w-3" />
                {statusCounts.pending}
              </button>
            )}
            {statusCounts.approved > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('approved')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  statusFilter === 'approved'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <CheckCircle className="h-3 w-3" />
                {statusCounts.approved}
              </button>
            )}
            {statusCounts.rejected > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('rejected')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  statusFilter === 'rejected'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <XCircle className="h-3 w-3" />
                {statusCounts.rejected}
              </button>
            )}
          </div>
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          Tip: Use <kbd className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono">j</kbd> /{' '}
          <kbd className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono">k</kbd> to navigate,{' '}
          <kbd className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono">Enter</kbd> to
          expand
        </div>
      </header>

      {/* Suggestions list */}
      {suggestions.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <Filter className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No suggestions found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {statusFilter !== 'all'
              ? 'Try changing the filter to see more suggestions.'
              : 'Create a suggestion to get started.'}
          </p>
        </div>
      ) : sessionFilter !== 'all' || groupedSuggestions.size <= 1 ? (
        // Show flat list if filtering by session or only one session
        <div className="space-y-3">
          {suggestions.map((suggestion, index) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              expanded={expandedId === suggestion.id}
              onUpdate={handleRefresh}
              showActions={true}
              canReview={canReview}
              className={keyboardIndex === index ? 'ring-2 ring-indigo-500' : ''}
            />
          ))}
        </div>
      ) : (
        // Show grouped by session
        <div className="space-y-6">
          {Array.from(groupedSuggestions.entries()).map(([sessionKey, sessionSuggestions]) => {
            const session = sessionSuggestions[0].session;

            return (
              <div key={sessionKey} className="space-y-3">
                {session && (
                  <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {session.title}
                    </h3>
                    {session.prNumber && (
                      <span className="text-xs text-gray-600">PR #{session.prNumber}</span>
                    )}
                    <span className="ml-auto text-xs text-gray-500">
                      {sessionSuggestions.length} suggestion
                      {sessionSuggestions.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
                {sessionSuggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    expanded={expandedId === suggestion.id}
                    onUpdate={handleRefresh}
                    showActions={true}
                    canReview={canReview}
                    className={
                      keyboardIndex ===
                      suggestions.findIndex((s) => s.id === suggestion.id)
                        ? 'ring-2 ring-indigo-500'
                        : ''
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
