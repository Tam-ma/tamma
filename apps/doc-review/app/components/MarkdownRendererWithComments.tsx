import { useEffect, useMemo } from 'react';
import { useFetcher } from 'react-router';
import type { Document } from '~/lib/types/document';
import type { Comment, CommentsByLine } from '~/lib/types/comment';
import { LineWithComments } from './comments/LineWithComments';

interface MarkdownRendererWithCommentsProps {
  document: Document;
  className?: string;
}

export function MarkdownRendererWithComments({
  document,
  className = '',
}: MarkdownRendererWithCommentsProps) {
  const commentsFetcher = useFetcher<{ comments?: Comment[]; message?: string }>();

  // Load comments for this document
  useEffect(() => {
    commentsFetcher.load(`/api/comments?docPath=${encodeURIComponent(document.path)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.path]);

  // Organize comments by line number
  const commentsByLine = useMemo(() => {
    const comments = commentsFetcher.data?.comments ?? [];
    const byLine: CommentsByLine = {};

    comments.forEach((comment) => {
      if (comment.lineNumber !== null) {
        if (!byLine[comment.lineNumber]) {
          byLine[comment.lineNumber] = [];
        }

        // Only add parent comments here; replies will be handled by thread logic
        if (!comment.parentId) {
          const replies = comments.filter((c) => c.parentId === comment.id);
          byLine[comment.lineNumber].push({
            parentComment: comment,
            replies,
          });
        }
      }
    });

    return byLine;
  }, [commentsFetcher.data]);

  // Split content into lines
  const lines = useMemo(() => {
    return document.content.split('\n').map((line, index) => ({
      number: index + 1,
      content: line,
      comments: commentsByLine[index + 1]?.flatMap((thread) => [
        thread.parentComment,
        ...thread.replies,
      ]) ?? [],
    }));
  }, [document.content, commentsByLine]);

  const handleCommentsUpdated = () => {
    commentsFetcher.load(`/api/comments?docPath=${encodeURIComponent(document.path)}`);
  };

  return (
    <div className={className}>
      {/* Document Header */}
      <div className="mb-6 border-b border-slate-200 bg-white p-6 rounded-lg shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">{document.title}</h1>
        {document.description && (
          <p className="text-slate-600 mb-3">{document.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
          <span className="rounded bg-slate-100 px-2 py-1">{document.category}</span>
          <span>{document.wordCount} words</span>
          <span>{document.lineCount} lines</span>
          {document.epicId && <span>Epic {document.epicId}</span>}
          {document.storyId && <span>Story {document.storyId}</span>}
        </div>
      </div>

      {commentsFetcher.data?.message && (
        <div className="mb-4 rounded bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {commentsFetcher.data.message}
        </div>
      )}

      {/* Line-by-line content with comments */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        {lines.map((line) => (
          <LineWithComments
            key={line.number}
            lineNumber={line.number}
            content={line.content}
            comments={line.comments}
            docPath={document.path}
            onCommentsUpdated={handleCommentsUpdated}
          />
        ))}
      </div>

      {/* Loading state */}
      {commentsFetcher.state === 'loading' && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          Loading comments...
        </div>
      )}
    </div>
  );
}
