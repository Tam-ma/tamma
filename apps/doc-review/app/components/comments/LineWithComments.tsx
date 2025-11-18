import { useState } from 'react';
import type { Comment } from '~/lib/types/comment';
import { LineNumberGutter } from './LineNumberGutter';
import { CommentThread } from './CommentThread';
import { CommentForm } from './CommentForm';

interface LineWithCommentsProps {
  lineNumber: number;
  content: string;
  comments: Comment[];
  docPath: string;
  onCommentsUpdated?: () => void;
}

export function LineWithComments({
  lineNumber,
  content,
  comments,
  docPath,
  onCommentsUpdated,
}: LineWithCommentsProps) {
  const [showCommentUI, setShowCommentUI] = useState(false);
  const [showNewCommentForm, setShowNewCommentForm] = useState(false);

  // Organize comments into threads (parent comments with their replies)
  const threads = organizeComments(comments);
  const hasComments = comments.length > 0;
  const topLevelCommentCount = threads.length;

  const handleLineClick = () => {
    setShowCommentUI(!showCommentUI);
    if (!showCommentUI && !hasComments) {
      setShowNewCommentForm(true);
    }
  };

  const handleFormSuccess = () => {
    setShowNewCommentForm(false);
    onCommentsUpdated?.();
  };

  return (
    <div className="group relative">
      <div className="flex">
        <LineNumberGutter
          lineNumber={lineNumber}
          hasComments={hasComments}
          commentCount={topLevelCommentCount}
          isSelected={showCommentUI}
          onClick={handleLineClick}
        />

        <div className="flex-1 px-4 py-1">
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-slate-800">
            {content}
          </pre>
        </div>
      </div>

      {showCommentUI && (
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <div className="space-y-4">
            {threads.map((thread) => (
              <CommentThread
                key={thread.parent.id}
                comment={thread.parent}
                replies={thread.replies}
                docPath={docPath}
                lineContent={content}
                onReplySuccess={onCommentsUpdated}
              />
            ))}

            {!showNewCommentForm && (
              <button
                onClick={() => setShowNewCommentForm(true)}
                className="w-full rounded border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
              >
                {hasComments ? 'Add another comment' : 'Add a comment'}
              </button>
            )}

            {showNewCommentForm && (
              <CommentForm
                docPath={docPath}
                lineNumber={lineNumber}
                lineContent={content}
                onCancel={() => setShowNewCommentForm(false)}
                onSuccess={handleFormSuccess}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CommentThreadData {
  parent: Comment;
  replies: Comment[];
}

function organizeComments(comments: Comment[]): CommentThreadData[] {
  const threads: CommentThreadData[] = [];
  const commentMap = new Map<string, Comment>();

  // First pass: create a map of all comments
  comments.forEach((comment) => {
    commentMap.set(comment.id, comment);
  });

  // Second pass: organize into threads
  const parentComments = comments.filter((c) => !c.parentId);

  parentComments.forEach((parent) => {
    const replies = comments
      .filter((c) => c.parentId === parent.id)
      .sort((a, b) => a.createdAt - b.createdAt);

    threads.push({ parent, replies });
  });

  // Sort threads by creation date (newest first)
  return threads.sort((a, b) => b.parent.createdAt - a.parent.createdAt);
}
