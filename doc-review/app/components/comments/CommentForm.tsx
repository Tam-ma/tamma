import { useState } from 'react';
import { useFetcher } from 'react-router';
import { X, Eye, Edit3 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CommentFormProps {
  docPath: string;
  lineNumber: number;
  lineContent: string;
  parentId?: string;
  onCancel: () => void;
  onSuccess?: () => void;
}

export function CommentForm({
  docPath,
  lineNumber,
  lineContent,
  parentId,
  onCancel,
  onSuccess,
}: CommentFormProps) {
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const isSubmitting = fetcher.state !== 'idle';
  const hasError = fetcher.data?.error;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) {
      return;
    }

    const formData = new FormData();
    formData.append('docPath', docPath);
    formData.append('lineNumber', lineNumber.toString());
    formData.append('lineContent', lineContent);
    formData.append('content', content.trim());
    if (parentId) {
      formData.append('parentId', parentId);
    }

    fetcher.submit(formData, {
      method: 'POST',
      action: '/api/comments',
    });
  };

  // Reset form and call onSuccess when submission succeeds
  if (fetcher.state === 'idle' && fetcher.data?.ok) {
    setContent('');
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          {parentId ? 'Reply to comment' : 'Add comment'} on line {lineNumber}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close form"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 rounded bg-slate-50 p-2">
        <code className="text-xs text-slate-700">{lineContent}</code>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowPreview(false)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            !showPreview
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Edit3 className="h-3 w-3" />
          Write
        </button>
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            showPreview
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
      </div>

      {showPreview ? (
        <div className="mb-3 min-h-[100px] rounded border border-slate-200 p-3">
          {content.trim() ? (
            <div className="prose prose-sm prose-slate max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">Nothing to preview</p>
          )}
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="mb-3 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={4}
          placeholder="Write your comment... (Markdown supported)"
          required
          disabled={isSubmitting}
        />
      )}

      {hasError && (
        <div className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          {fetcher.data.error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          disabled={isSubmitting || !content.trim()}
        >
          {isSubmitting ? 'Submitting...' : parentId ? 'Reply' : 'Comment'}
        </button>
      </div>
    </form>
  );
}
