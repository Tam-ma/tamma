import { useCallback, useEffect, Suspense } from 'react';
import {
  useFetcher,
  useLoaderData,
  Link,
  useNavigation,
  useRouteError,
  isRouteErrorResponse,
} from 'react-router';
import { MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { getUser } from '../lib/auth/session.server';
import { DocumentLoader } from '../lib/docs/loader.server';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { TableOfContents } from '../components/TableOfContents';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { CommentsPanel } from '../components/comments/CommentsPanel';
import { SuggestionsPanel } from '../components/suggestions/SuggestionsPanel';
import { DiscussionsPanel } from '../components/discussions/DiscussionsPanel';
import type { Document, DocumentNavigation } from '../lib/types/document';
import type { ReviewSession } from '../lib/types/review-session';

export async function loader({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};

  // Get user if available (optional - docs can be viewed without auth)
  const user = await getUser(request, { env });

  const { documentId } = params;

  if (!documentId) {
    throw new Response('Document ID is required', { status: 400 });
  }

  const loader = DocumentLoader.forEnv(env);

  try {
    // Try to load the document by mapping the ID to a path
    const documentPath = mapDocumentIdToPath(documentId);
    const document = await loader.loadDocument(documentPath);

    // Get navigation for prev/next links
    const navigation = await loader.getNavigation();
    const { prev, next } = findAdjacentDocuments(navigation, documentId);

    return { document, documentId, prev, next };
  } catch (error) {
    throw new Response(`Document not found: ${documentId}`, { status: 404 });
  }
}

function mapDocumentIdToPath(documentId: string): string {
  // Map document IDs to their file paths
  const pathMap: Record<string, string> = {
    // Main documents
    prd: 'PRD.md',
    architecture: 'architecture.md',
    epics: 'epics.md',

    // Research documents
    'research/ai-provider-strategy-2024-10': 'research/ai-provider-strategy-2024-10.md',
    'research/ai-provider-cost-analysis-2024-10': 'research/ai-provider-cost-analysis-2024-10.md',
    'research/ai-provider-test-scenarios-2024-10': 'research/ai-provider-test-scenarios-2024-10.md',

    // Retrospectives
    'retrospectives/epic-1-retro-2025-11-06': 'retrospectives/epic-1-retro-2025-11-06.md',
    'retrospectives/epic-2-retro-2025-11-06': 'retrospectives/epic-2-retro-2025-11-06.md',

    // Epic 4 technical spec (only one that exists)
    'tech-spec-epic-4': 'stories/epic-4/tech-spec-epic-4.md',
  };

  // Stories - handle the actual story structure
  if (documentId.match(/^\d+-\d+$/)) {
    const [epicNum] = documentId.split('-');
    return `stories/epic-${epicNum}/story-${documentId}/${documentId}.md`;
  }

  // Direct mapping
  if (pathMap[documentId]) {
    return pathMap[documentId];
  }

  // If no mapping found, assume it's a direct path
  return `${documentId}.md`;
}

function findAdjacentDocuments(
  navigation: DocumentNavigation,
  currentId: string
): { prev: { id: string; title: string } | null; next: { id: string; title: string } | null } {
  // Flatten all documents into a single array
  const allDocs: Array<{ id: string; title: string }> = [
    ...navigation.main,
    ...navigation.epics.flatMap((epic) => [
      { id: epic.id, title: epic.title },
      ...(epic.stories || []).map((story) => ({
        id: story.id,
        title: `${story.id}: ${story.title}`,
      })),
    ]),
    ...navigation.research,
    ...navigation.retrospectives,
  ];

  const currentIndex = allDocs.findIndex((doc) => doc.id === currentId);

  if (currentIndex === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: currentIndex > 0 ? allDocs[currentIndex - 1] : null,
    next: currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null,
  };
}

export default function DocumentView() {
  const { document, documentId, prev, next } = useLoaderData<{
    document: Document;
    documentId: string;
    prev: { id: string; title: string } | null;
    next: { id: string; title: string } | null;
  }>();
  const navigation = useNavigation();
  const sessionsFetcher = useFetcher<{ sessions: ReviewSession[] }>();

  useEffect(() => {
    sessionsFetcher.load(`/api/sessions?docPath=${encodeURIComponent(document.path)}`);
  }, [document.path, sessionsFetcher]);

  const sessions = sessionsFetcher.data?.sessions ?? [];

  const refreshSessions = useCallback(() => {
    sessionsFetcher.load(`/api/sessions?docPath=${encodeURIComponent(document.path)}`);
  }, [document.path, sessionsFetcher]);

  // Show loading state during navigation
  if (navigation.state === 'loading') {
    return <LoadingSpinner size="lg" message="Loading document..." />;
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          {prev && (
            <Link
              to={`/docs/${prev.id}`}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              title={prev.title}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          )}
          {next && (
            <Link
              to={`/docs/${next.id}`}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              title={next.title}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        <Link
          to={`/docs/${documentId}/suggestions`}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <MessageSquare className="h-4 w-4" />
          Review All Suggestions
        </Link>
      </div>

      {/* Main content with Table of Contents */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_250px_320px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Suspense fallback={<LoadingSpinner message="Loading content..." />}>
            <MarkdownRenderer document={document} />
          </Suspense>
        </div>

        {/* Table of Contents - hidden on smaller screens */}
        <div className="hidden xl:block">
          <TableOfContents document={document} />
        </div>

        {/* Collaboration panels */}
        <div className="space-y-4">
          <CommentsPanel docPath={document.path} />
          <SuggestionsPanel
            docPath={document.path}
            sessions={sessions}
            onSessionUpdated={refreshSessions}
          />
          <DiscussionsPanel
            docPath={document.path}
            sessions={sessions}
            onSessionUpdated={refreshSessions}
          />
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-6 py-4 rounded-lg">
        {prev ? (
          <Link
            to={`/docs/${prev.id}`}
            className="group flex flex-col items-start gap-1 hover:text-indigo-600 transition-colors"
          >
            <span className="text-xs text-gray-500 group-hover:text-indigo-500">Previous</span>
            <span className="text-sm font-medium flex items-center gap-1">
              <ChevronLeft className="h-4 w-4" />
              {prev.title}
            </span>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            to={`/docs/${next.id}`}
            className="group flex flex-col items-end gap-1 hover:text-indigo-600 transition-colors"
          >
            <span className="text-xs text-gray-500 group-hover:text-indigo-500">Next</span>
            <span className="text-sm font-medium flex items-center gap-1">
              {next.title}
              <ChevronRight className="h-4 w-4" />
            </span>
          </Link>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorMessage
        title={error.status === 404 ? 'Document Not Found' : 'Error'}
        message={
          error.status === 404
            ? 'The document you are looking for could not be found. It may have been moved or deleted.'
            : error.data || 'An error occurred while loading the document.'
        }
      />
    );
  }

  return (
    <ErrorMessage
      title="Unexpected Error"
      message="An unexpected error occurred while loading the document. Please try again later."
    />
  );
}
