import { useState } from 'react';
import { useFetcher } from 'react-router';
import { MessageCircle, CheckCircle, MoreVertical, Reply, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Comment } from '~/lib/types/comment';
import { CommentForm } from './CommentForm';

interface CommentThreadProps {
  comment: Comment;
  replies: Comment[];
  docPath: string;
  lineContent: string;
  onReplySuccess?: () => void;
}

export function CommentThread({
  comment,
  replies,
  docPath,
  lineContent,
  onReplySuccess,
}: CommentThreadProps) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [showActions, setShowActions] = useState<string | null>(null);
  const resolveFetcher = useFetcher();

  const handleResolve = (commentId: string) => {
    const formData = new FormData();
    formData.append('resolved', 'true');

    resolveFetcher.submit(formData, {
      method: 'PATCH',
      action: `/api/comments/${commentId}`,
    });
  };

  const handleReplySuccess = () => {
    setShowReplyForm(false);
    onReplySuccess?.();
  };

  return (
    <div className="space-y-3">
      <CommentItem
        comment={comment}
        isParent
        onReply={() => setShowReplyForm(true)}
        onResolve={handleResolve}
        showActions={showActions === comment.id}
        onToggleActions={(id) => setShowActions(showActions === id ? null : id)}
      />

      {replies.length > 0 && (
        <div className="ml-8 space-y-2 border-l-2 border-slate-200 pl-4">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              isParent={false}
              showActions={showActions === reply.id}
              onToggleActions={(id) => setShowActions(showActions === id ? null : id)}
            />
          ))}
        </div>
      )}

      {showReplyForm && (
        <div className="ml-8">
          <CommentForm
            docPath={docPath}
            lineNumber={comment.lineNumber ?? 0}
            lineContent={lineContent}
            parentId={comment.id}
            onCancel={() => setShowReplyForm(false)}
            onSuccess={handleReplySuccess}
          />
        </div>
      )}
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  isParent: boolean;
  onReply?: () => void;
  onResolve?: (id: string) => void;
  showActions: boolean;
  onToggleActions: (id: string) => void;
}

function CommentItem({
  comment,
  isParent,
  onReply,
  onResolve,
  showActions,
  onToggleActions,
}: CommentItemProps) {
  const timeAgo = getTimeAgo(comment.createdAt);
  const isEdited = comment.updatedAt > comment.createdAt;

  return (
    <article className="group rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <header className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {comment.author?.avatarUrl ? (
            <img
              src={comment.author.avatarUrl}
              alt={comment.author.name ?? 'User'}
              className="h-6 w-6 rounded-full"
            />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {(comment.author?.name ?? 'U')[0].toUpperCase()}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900">
              {comment.author?.name ?? 'Unknown User'}
            </span>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <time dateTime={new Date(comment.createdAt).toISOString()}>{timeAgo}</time>
              {isEdited && <span className="italic">(edited)</span>}
              {comment.resolved && (
                <span className="flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                  <CheckCircle className="h-3 w-3" />
                  Resolved
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => onToggleActions(comment.id)}
            className="rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
            aria-label="Comment actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {showActions && (
            <div className="absolute right-0 top-8 z-10 min-w-[140px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {isParent && onReply && (
                <button
                  onClick={() => {
                    onReply();
                    onToggleActions(comment.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Reply className="h-4 w-4" />
                  Reply
                </button>
              )}
              {isParent && onResolve && !comment.resolved && (
                <button
                  onClick={() => {
                    onResolve(comment.id);
                    onToggleActions(comment.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <CheckCircle className="h-4 w-4" />
                  Resolve
                </button>
              )}
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="prose prose-sm prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.content}</ReactMarkdown>
      </div>

      {isParent && onReply && !comment.resolved && (
        <footer className="mt-2 pt-2 border-t border-slate-100">
          <button
            onClick={onReply}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Reply
          </button>
        </footer>
      )}
    </article>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
