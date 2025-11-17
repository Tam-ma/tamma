import { Link } from 'react-router';
import type { DocumentNavigation } from '~/lib/types/document';

interface DocNavigationProps {
  navigation: DocumentNavigation;
}

export function DocNavigation({ navigation }: DocNavigationProps) {
  return (
    <div className="space-y-6">
      {/* Main Documents */}
      <div>
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">
          Main Documents
        </h3>
        <ul className="space-y-1">
          {navigation.main.map((doc) => (
            <li key={doc.id}>
              <Link
                to={`/docs/${doc.id}`}
                className="block px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                {doc.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Epics */}
      <div>
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Epics</h3>
        <ul className="space-y-2">
          {navigation.epics.map((epic) => (
            <li key={epic.id}>
              <div className="space-y-1">
                <Link
                  to={`/docs/${epic.id}`}
                  className="block px-2 py-1 text-sm font-medium text-gray-900 hover:bg-gray-100 rounded"
                >
                  {epic.title}
                </Link>
                {epic.techSpec && (
                  <Link
                    to={`/docs/${epic.techSpec.replace('.md', '')}`}
                    className="block px-4 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                  >
                    📋 Technical Specification
                  </Link>
                )}
                {epic.stories && epic.stories.length > 0 && (
                  <div className="ml-2 mt-1">
                    <p className="text-xs text-gray-500 px-2 py-1">Stories:</p>
                    <ul className="space-y-1">
                      {epic.stories.map((story) => (
                        <li key={story.id}>
                          <Link
                            to={`/docs/${story.path.replace('.md', '')}`}
                            className="block px-4 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                          >
                            {story.id}: {story.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Research */}
      {navigation.research.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">
            Research
          </h3>
          <ul className="space-y-1">
            {navigation.research.map((doc) => (
              <li key={doc.id}>
                <Link
                  to={`/docs/${doc.path.replace('.md', '')}`}
                  className="block px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                >
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Retrospectives */}
      {navigation.retrospectives.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">
            Retrospectives
          </h3>
          <ul className="space-y-1">
            {navigation.retrospectives.map((doc) => (
              <li key={doc.id}>
                <Link
                  to={`/docs/${doc.path.replace('.md', '')}`}
                  className="block px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                >
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
