import { Link } from 'react-router';
import { useMemo } from 'react';
import type { DocumentNavigation } from '~/lib/types/document';

interface BreadcrumbsProps {
  navigation: DocumentNavigation;
  currentPath?: string;
}

interface BreadcrumbItem {
  label: string;
  path?: string;
  icon?: string;
}

export function Breadcrumbs({ navigation, currentPath }: BreadcrumbsProps) {
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];

    const items: BreadcrumbItem[] = [{ label: 'Docs', path: '/docs', icon: '📚' }];

    // Check if it's a main document
    const mainDoc = navigation.main.find((doc) => currentPath.includes(doc.id));
    if (mainDoc) {
      items.push({ label: mainDoc.title, icon: '📄' });
      return items;
    }

    // Check if it's in research
    const researchDoc = navigation.research.find((doc) => currentPath.includes(doc.id));
    if (researchDoc) {
      items.push(
        { label: 'Research', path: '/docs', icon: '🔬' },
        { label: researchDoc.title, icon: '📄' }
      );
      return items;
    }

    // Check if it's in retrospectives
    const retroDoc = navigation.retrospectives.find((doc) => currentPath.includes(doc.id));
    if (retroDoc) {
      items.push(
        { label: 'Retrospectives', path: '/docs', icon: '🔄' },
        { label: retroDoc.title, icon: '📄' }
      );
      return items;
    }

    // Check if it's in epics
    for (const epic of navigation.epics) {
      // Check tech spec
      if (epic.techSpec && currentPath.includes(epic.techSpec.replace('.md', ''))) {
        items.push(
          { label: 'Epics', path: '/docs', icon: '📦' },
          { label: epic.title, icon: '📦' },
          { label: 'Technical Specification', icon: '📋' }
        );
        return items;
      }

      // Check stories
      const story = epic.stories?.find((s) => currentPath.includes(s.path.replace('.md', '')));
      if (story) {
        items.push(
          { label: 'Epics', path: '/docs', icon: '📦' },
          { label: epic.title, icon: '📦' },
          { label: `${story.id}: ${story.title}`, icon: '📝' }
        );
        return items;
      }
    }

    return items;
  }, [navigation, currentPath]);

  if (breadcrumbs.length === 0) {
    return null;
  }

  // Collapse middle breadcrumbs if there are too many
  const displayBreadcrumbs = useMemo(() => {
    if (breadcrumbs.length <= 4) {
      return breadcrumbs;
    }

    // Show first, ellipsis, and last two
    return [
      breadcrumbs[0],
      { label: '...', icon: undefined },
      ...breadcrumbs.slice(-2),
    ];
  }, [breadcrumbs]);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-sm">
      {displayBreadcrumbs.map((crumb, index) => {
        const isLast = index === displayBreadcrumbs.length - 1;
        const isEllipsis = crumb.label === '...';

        return (
          <div key={`${crumb.label}-${index}`} className="flex items-center space-x-2">
            {index > 0 && (
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            )}

            {isEllipsis ? (
              <span className="text-gray-400 px-2">...</span>
            ) : isLast ? (
              <span className="flex items-center space-x-1.5 text-gray-900 font-medium">
                {crumb.icon && <span role="img" aria-hidden="true">{crumb.icon}</span>}
                <span>{crumb.label}</span>
              </span>
            ) : crumb.path ? (
              <Link
                to={crumb.path}
                className="flex items-center space-x-1.5 text-gray-600 hover:text-gray-900 transition-colors"
              >
                {crumb.icon && <span role="img" aria-hidden="true">{crumb.icon}</span>}
                <span>{crumb.label}</span>
              </Link>
            ) : (
              <span className="flex items-center space-x-1.5 text-gray-600">
                {crumb.icon && <span role="img" aria-hidden="true">{crumb.icon}</span>}
                <span>{crumb.label}</span>
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
