import { useLoaderData } from 'react-router';
import { DocumentLoader } from '../lib/docs/loader.server';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import type { Document } from '../lib/types/document';

export async function loader({ context }: any) {
  try {
    const env = context.env ?? context.cloudflare?.env ?? {};
    const loader = DocumentLoader.forEnv(env);
    const document = await loader.loadDocument('PRD.md');

    return { document };
  } catch (error) {
    throw new Response(
      `Document not found: ${error instanceof Error ? error.message : String(error)}`,
      { status: 404 }
    );
  }
}

export default function TestDoc() {
  const { document } = useLoaderData<{ document: Document }>();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Document Test</h1>
      <MarkdownRenderer document={document} />
    </div>
  );
}
