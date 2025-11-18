export default function DocsIndex() {
  return (
    <div className="max-w-3xl mx-auto bg-white shadow-sm rounded-lg p-8 border border-gray-100">
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Select a document to begin</h1>
      <p className="text-gray-600 mb-4">
        Use the navigation panel on the left to open product requirements, architecture docs,
        epics, stories, research notes, or retrospectives. Inline comments, suggestions, and
        discussions will appear beside the document as those features come online.
      </p>
      <p className="text-gray-500 text-sm">
        Need a specific file? Append its identifier to the URL (for example,
        <code className="mx-1 rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
          /docs/prd
        </code>
        or
        <code className="mx-1 rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
          /docs/1-0
        </code>
        ).
      </p>
    </div>
  );
}
