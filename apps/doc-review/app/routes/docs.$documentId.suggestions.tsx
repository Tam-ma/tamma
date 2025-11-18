import { useLoaderData, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { requireAuth } from '../lib/auth/session.server';
import { DocumentLoader } from '../lib/docs/loader.server';
import { SuggestionReviewPanel } from '../components/suggestions/SuggestionReviewPanel';
import type { Document } from '../lib/types/document';

export async function loader({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  await requireAuth(request, { env });

  const { documentId } = params;

  if (!documentId) {
    throw new Response('Document ID is required', { status: 400 });
  }

  const loader = DocumentLoader.forEnv(env);

  try {
    // Try to load the document by mapping the ID to a path
    const documentPath = mapDocumentIdToPath(documentId);
    const document = await loader.loadDocument(documentPath);

    // For now, set canReview to false until we add role support to user type
    const canReview = false;

    return { document, canReview };
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

export default function DocumentSuggestionsView() {
  const { document, canReview } = useLoaderData<{
    document: Document;
    canReview: boolean;
  }>();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              to={`/docs/${document.path.replace(/\.md$/, '').replace(/\//g, '-')}`}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Document
            </Link>

            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">
                Suggestions for {document.title}
              </h1>
              <p className="text-sm text-gray-600">{document.path}</p>
            </div>

            {canReview && (
              <div className="rounded-md bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700">
                Reviewer Mode
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SuggestionReviewPanel
          docPath={document.path}
          canReview={canReview}
          className="rounded-lg bg-white p-6 shadow"
        />
      </main>
    </div>
  );
}
