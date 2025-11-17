import { useState } from 'react';
import { useFetcher } from 'react-router';
import {
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  User,
  Calendar,
  FileText,
  Hash,
} from 'lucide-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { Suggestion } from '~/lib/types/suggestion';
import { DiffViewer } from './DiffViewer';

dayjs.extend(relativeTime);

interface SuggestionCardProps {
  suggestion: Suggestion;
  expanded?: boolean;
  onUpdate?: () => void;
  showActions?: boolean;
  canReview?: boolean;
  className?: string;
}

export function SuggestionCard({
  suggestion,
  expanded: initialExpanded = false,
  showActions = true,
  canReview = false,
  className = '',
}: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const isSubmitting = fetcher.state !== 'idle';
  const isApproving = fetcher.formData?.get('status') === 'approved';
  const isRejecting = fetcher.formData?.get('status') === 'rejected';

  const handleApprove = () => {
    fetcher.submit(
      { status: 'approved' },
      { method: 'PATCH', action: `/api/suggestions/${suggestion.id}` }
    );
  };

  const handleReject = () => {
    fetcher.submit(
      { status: 'rejected' },
      { method: 'PATCH', action: `/api/suggestions/${suggestion.id}` }
    );
  };

  const statusConfig = {
    pending: {
      badge: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      label: 'Pending Review',
      icon: <Calendar className="h-3 w-3" />,
    },
    approved: {
      badge: 'bg-green-100 text-green-800 border-green-200',
      label: 'Approved',
      icon: <Check className="h-3 w-3" />,
    },
    rejected: {
      badge: 'bg-red-100 text-red-800 border-red-200',
      label: 'Rejected',
      icon: <X className="h-3 w-3" />,
    },
    deleted: {
      badge: 'bg-gray-100 text-gray-800 border-gray-200',
      label: 'Deleted',
      icon: <X className="h-3 w-3" />,
    },
  };

  const status = statusConfig[suggestion.status] || statusConfig.pending;

  return (
    <article
      className={`rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md ${className}`}
    >
      {/* Header */}
      <header className="border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            {/* Description */}
            <h3 className="text-sm font-semibold text-gray-900">
              {suggestion.description || 'Untitled suggestion'}
            </h3>

            {/* Metadata row */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
              {/* Author */}
              {suggestion.author && (
                <div className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span>{suggestion.author.name || 'Unknown'}</span>
                </div>
              )}

              {/* Created date */}
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span title={dayjs(suggestion.createdAt).format('LLLL')}>
                  {dayjs(suggestion.createdAt).fromNow()}
                </span>
              </div>

              {/* Line range */}
              <div className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                <span>
                  Lines {suggestion.lineStart}-{suggestion.lineEnd}
                </span>
              </div>

              {/* Document path */}
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                <span className="truncate max-w-[200px]" title={suggestion.docPath}>
                  {suggestion.docPath.split('/').pop()}
                </span>
              </div>
            </div>
          </div>

          {/* Status badge and expand button */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.badge}`}
            >
              {status.icon}
              {status.label}
            </span>

            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Session info */}
        {suggestion.session && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-gray-600">Session:</span>
            <span className="font-medium text-indigo-700">{suggestion.session.title}</span>
            {suggestion.session.prNumber && suggestion.session.prUrl && (
              <a
                href={suggestion.session.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                PR #{suggestion.session.prNumber}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </header>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-4 p-4">
          {/* Diff viewer */}
          {suggestion.diff && (
            <DiffViewer
              diffString={suggestion.diff}
              originalText={suggestion.originalText}
              suggestedText={suggestion.suggestedText}
              viewMode="unified"
              showCollapse={true}
              contextLines={3}
            />
          )}

          {/* Review info */}
          {suggestion.reviewedBy && suggestion.reviewedAt && (
            <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Reviewed {dayjs(suggestion.reviewedAt).fromNow()}
            </div>
          )}

          {/* Actions */}
          {showActions && canReview && suggestion.status === 'pending' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {isApproving ? 'Approving...' : 'Approve'}
              </button>

              <button
                type="button"
                onClick={handleReject}
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                {isRejecting ? 'Rejecting...' : 'Reject'}
              </button>

              {fetcher.data?.error && (
                <span className="text-sm text-red-600">{fetcher.data.error}</span>
              )}
            </div>
          )}

          {/* Success message */}
          {fetcher.data?.ok && (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Suggestion updated successfully!
            </div>
          )}
        </div>
      )}
    </article>
  );
}
