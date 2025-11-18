import { useEffect, useMemo } from 'react';
import { useFetcher } from 'react-router';

type Comment = {
  id: string;
  content: string;
  lineNumber: number | null;
  userId: string;
  createdAt: number;
  author?: {
    id: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
};

interface CommentsPanelProps {
  docPath: string;
}

export function CommentsPanel({ docPath }: CommentsPanelProps) {
  const listFetcher = useFetcher<{ comments?: Comment[]; message?: string }>();
  const formFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  useEffect(() => {
    listFetcher.load(`/api/comments?docPath=${encodeURIComponent(docPath)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath]);

  useEffect(() => {
    if (formFetcher.state === 'idle' && formFetcher.data?.ok) {
      listFetcher.load(`/api/comments?docPath=${encodeURIComponent(docPath)}`);
    }
  }, [formFetcher.state, formFetcher.data, docPath, listFetcher]);

  const comments = useMemo(() => listFetcher.data?.comments ?? [], [listFetcher.data]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Inline Comments</h2>
        <span className="text-xs text-slate-500">{comments.length} entries</span>
      </header>

      {listFetcher.data?.message && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {listFetcher.data.message}
        </p>
      )}

      <div className="space-y-2 max-h-48 overflow-auto pr-1">
        {comments.length === 0 ? (
          <p className="text-sm text-slate-500">No comments yet. Be the first to leave a note.</p>
        ) : (
          comments.map((comment) => (
            <article key={comment.id} className="rounded border border-slate-100 p-2 text-sm">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  Line {comment.lineNumber ?? '—'} ·{' '}
                  {comment.author?.name ?? 'Unknown reviewer'}
                </span>
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-slate-800">{comment.content}</p>
            </article>
          ))
        )}
      </div>

      <formFetcher.Form method="post" action="/api/comments" className="mt-4 space-y-2">
        <input type="hidden" name="docPath" value={docPath} />
        <label className="block text-xs font-medium text-slate-600" htmlFor="lineNumber">
          Line Number (optional)
        </label>
        <input
          id="lineNumber"
          name="lineNumber"
          type="number"
          min="1"
          className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
          placeholder="42"
        />
        <label className="block text-xs font-medium text-slate-600" htmlFor="content">
          Comment
        </label>
        <textarea
          id="content"
          name="content"
          className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
          rows={3}
          placeholder="Leave actionable feedback..."
          required
        />
        {formFetcher.data?.error && (
          <p className="text-xs text-red-600">{formFetcher.data.error}</p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          disabled={formFetcher.state !== 'idle'}
        >
          {formFetcher.state === 'idle' ? 'Add Comment' : 'Saving...'}
        </button>
      </formFetcher.Form>
    </div>
  );
}
