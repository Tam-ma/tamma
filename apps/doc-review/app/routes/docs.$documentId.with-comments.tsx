import { useCallback, useEffect } from 'react';
import { useFetcher, useLoaderData } from 'react-router';
import { requireAuth } from '../lib/auth/session.server';
import { DocumentLoader } from '../lib/docs/loader.server';
import { MarkdownRendererWithComments } from '../components/MarkdownRendererWithComments';
import { SuggestionsPanel } from '../components/suggestions/SuggestionsPanel';
import { DiscussionsPanel } from '../components/discussions/DiscussionsPanel';
import type { Document } from '../lib/types/document';
import type { ReviewSession } from '../lib/types/review-session';

export async function loader({ request, context, params }: any) {
  await requireAuth(request, context);
  const { documentId } = params;

  if (!documentId) {
    throw new Response('Document ID is required', { status: 400 });
  }

  const env = context.env ?? context.cloudflare?.env ?? {};
  const loader = DocumentLoader.forEnv(env);

  try {
    // Try to load the document by mapping the ID to a path
    const documentPath = mapDocumentIdToPath(documentId);
    const document = await loader.loadDocument(documentPath);

    return { document };
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

export default function DocumentViewWithComments() {
  const { document } = useLoaderData<{ document: Document }>();
  const sessionsFetcher = useFetcher<{ sessions: ReviewSession[] }>();

  useEffect(() => {
    sessionsFetcher.load(`/api/sessions?docPath=${encodeURIComponent(document.path)}`);
  }, [document.path, sessionsFetcher]);

  const sessions = sessionsFetcher.data?.sessions ?? [];

  const refreshSessions = useCallback(() => {
    sessionsFetcher.load(`/api/sessions?docPath=${encodeURIComponent(document.path)}`);
  }, [document.path, sessionsFetcher]);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="container mx-auto px-4">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Main content with line-level comments */}
          <div className="min-w-0">
            <MarkdownRendererWithComments document={document} />
          </div>

          {/* Side panels */}
          <div className="space-y-4">
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
      </div>
    </div>
  );
}
