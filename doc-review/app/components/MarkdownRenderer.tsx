import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import type { Document } from '~/lib/types/document';

interface MarkdownRendererProps {
  document: Document;
  className?: string;
}

type MarkdownComponents = Components & { yaml?: React.ComponentType };

const markdownComponents: MarkdownComponents = {
  h1: ({ children }) => (
    <h1 id={buildSlug(children) || undefined} className="text-3xl font-bold mt-8 mb-4">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 id={buildSlug(children) || undefined} className="text-2xl font-semibold mt-6 mb-3">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={buildSlug(children) || undefined} className="text-xl font-semibold mt-4 mb-2">
      {children}
    </h3>
  ),
  code({ inline, className, children }: any) {
    const language = /language-(\w+)/.exec(className || '')?.[1];

    if (inline) {
      return (
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100">
          {children}
        </code>
      );
    }

    return (
      <pre className="relative overflow-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
        {language && (
          <span className="absolute right-4 top-2 text-xs uppercase tracking-wide text-gray-400">
            {language}
          </span>
        )}
        <code>{children}</code>
      </pre>
    );
  },
  ul: ({ children }) => <ul className="list-disc space-y-2 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-2 pl-6">{children}</ol>,
  yaml: () => null,
};

function buildSlug(children: ReactNode | ReactNode[]): string {
  const nodes = Array.isArray(children) ? children : [children];
  return nodes
    .map((child) =>
      typeof child === 'string'
        ? child
        : typeof child === 'number'
          ? child.toString()
          : ''
    )
    .join(' ')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

export function MarkdownRenderer({ document, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`prose prose-slate dark:prose-invert max-w-none ${className}`}>
      <div className="mb-6 border-b border-gray-100 pb-4">
        <h1
          className="text-3xl font-bold text-gray-900 dark:text-white mb-2"
          data-testid="document-title"
        >
          {document.title}
        </h1>
        {document.description && (
          <p className="text-gray-600 dark:text-gray-400">{document.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-3">
          <span className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">{document.category}</span>
          <span>{document.wordCount} words</span>
          <span>{document.lineCount} lines</span>
          {document.epicId && <span>Epic {document.epicId}</span>}
          {document.storyId && <span>Story {document.storyId}</span>}
        </div>
      </div>

      <div data-testid="document-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkFrontmatter]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {document.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
