import { useEffect, useState } from 'react';
import type { Document } from '~/lib/types/document';

interface TableOfContentsProps {
  document: Document;
}

export function TableOfContents({ document }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -80% 0px' }
    );

    // Observe all headings
    document.headings.forEach((heading) => {
      const element = window.document.getElementById(heading.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [document.headings]);

  // Only show TOC for documents with multiple headings
  if (document.headings.length < 3) {
    return null;
  }

  return (
    <nav className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto" aria-label="Table of contents">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">On this page</h2>
      <ul className="space-y-1 text-sm border-l-2 border-gray-200 dark:border-gray-700">
        {document.headings.map((heading) => {
          // Only show h2 and h3 in TOC
          if (heading.level > 3) return null;

          const isActive = activeId === heading.id;
          const paddingClass = heading.level === 2 ? 'pl-3' : 'pl-6';

          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                className={`block py-1 ${paddingClass} transition-colors ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400 font-medium border-l-2 border-indigo-600 dark:border-indigo-400 -ml-0.5'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
