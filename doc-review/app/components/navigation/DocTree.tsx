import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import type { DocumentNavigation } from '~/lib/types/document';

interface DocTreeProps {
  navigation: DocumentNavigation;
  currentPath?: string;
  searchQuery?: string;
}

interface TreeNode {
  id: string;
  title: string;
  path?: string;
  type: 'section' | 'document' | 'epic' | 'story' | 'techspec';
  children?: TreeNode[];
  epicId?: string;
  storyId?: string;
}

export function DocTree({ navigation, currentPath, searchQuery = '' }: DocTreeProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['main', 'epics']));

  // Load expanded sections from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('doc-tree-expanded');
    if (saved) {
      try {
        const sections = JSON.parse(saved);
        setExpandedSections(new Set(sections));
      } catch (err) {
        console.error('Failed to parse saved tree state:', err);
      }
    }
  }, []);

  // Save expanded sections to localStorage
  useEffect(() => {
    localStorage.setItem('doc-tree-expanded', JSON.stringify([...expandedSections]));
  }, [expandedSections]);

  // Build tree structure from navigation
  const treeData = useMemo(() => {
    const tree: TreeNode[] = [];

    // Main Documents Section
    if (navigation.main.length > 0) {
      tree.push({
        id: 'main',
        title: 'Main Documents',
        type: 'section',
        children: navigation.main.map((doc) => ({
          id: doc.id,
          title: doc.title,
          path: doc.path,
          type: 'document',
        })),
      });
    }

    // Epics Section
    if (navigation.epics.length > 0) {
      tree.push({
        id: 'epics',
        title: 'Epics',
        type: 'section',
        children: navigation.epics.map((epic) => {
          const epicChildren: TreeNode[] = [];

          // Add tech spec if available
          if (epic.techSpec) {
            epicChildren.push({
              id: `${epic.id}-techspec`,
              title: 'Technical Specification',
              path: epic.techSpec,
              type: 'techspec',
              epicId: epic.id,
            });
          }

          // Add stories
          if (epic.stories && epic.stories.length > 0) {
            epicChildren.push(
              ...epic.stories.map((story) => ({
                id: `${epic.id}-${story.id}`,
                title: `${story.id}: ${story.title}`,
                path: story.path,
                type: 'story' as const,
                epicId: epic.id,
                storyId: story.id,
              }))
            );
          }

          return {
            id: epic.id,
            title: epic.title,
            type: 'epic',
            children: epicChildren,
            epicId: epic.id,
          };
        }),
      });
    }

    // Research Section
    if (navigation.research.length > 0) {
      tree.push({
        id: 'research',
        title: 'Research',
        type: 'section',
        children: navigation.research.map((doc) => ({
          id: doc.id,
          title: doc.title,
          path: doc.path,
          type: 'document',
        })),
      });
    }

    // Retrospectives Section
    if (navigation.retrospectives.length > 0) {
      tree.push({
        id: 'retrospectives',
        title: 'Retrospectives',
        type: 'section',
        children: navigation.retrospectives.map((doc) => ({
          id: doc.id,
          title: doc.title,
          path: doc.path,
          type: 'document',
        })),
      });
    }

    return tree;
  }, [navigation]);

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery) return treeData;

    const query = searchQuery.toLowerCase();

    const filterNode = (node: TreeNode): TreeNode | null => {
      const matches = node.title.toLowerCase().includes(query);
      const filteredChildren = node.children
        ?.map((child) => filterNode(child))
        .filter((child): child is TreeNode => child !== null);

      if (matches || (filteredChildren && filteredChildren.length > 0)) {
        return {
          ...node,
          children: filteredChildren,
        };
      }

      return null;
    };

    return treeData
      .map((node) => filterNode(node))
      .filter((node): node is TreeNode => node !== null);
  }, [treeData, searchQuery]);

  // Auto-expand sections when searching
  useEffect(() => {
    if (searchQuery) {
      const allSectionIds = treeData
        .filter((node) => node.type === 'section')
        .map((node) => node.id);
      setExpandedSections(new Set(allSectionIds));
    }
  }, [searchQuery, treeData]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isExpanded = (id: string) => expandedSections.has(id);

  const getIcon = (type: TreeNode['type']) => {
    switch (type) {
      case 'section':
        return '📁';
      case 'epic':
        return '📦';
      case 'story':
        return '📝';
      case 'techspec':
        return '📋';
      case 'document':
        return '📄';
      default:
        return '📄';
    }
  };

  const renderNode = (node: TreeNode, level = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const expanded = isExpanded(node.id);
    const isActive = currentPath && node.path && currentPath.includes(node.path.replace('.md', ''));

    const paddingLeft = `${level * 1}rem`;

    if (node.type === 'section') {
      return (
        <div key={node.id} className="mb-2">
          <button
            onClick={() => toggleSection(node.id)}
            className="w-full flex items-center justify-between px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
          >
            <div className="flex items-center space-x-2">
              <span className="text-lg">{getIcon(node.type)}</span>
              <span className="uppercase tracking-wider text-xs font-semibold text-gray-600">
                {node.title}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${
                expanded ? 'rotate-90' : ''
              }`}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {expanded && hasChildren && (
            <div className="mt-1 space-y-1">{node.children!.map((child) => renderNode(child, level + 1))}</div>
          )}
        </div>
      );
    }

    if (node.type === 'epic') {
      return (
        <div key={node.id} className="mb-1" style={{ paddingLeft }}>
          <button
            onClick={() => toggleSection(node.id)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-sm text-gray-900 hover:bg-gray-100 rounded transition-colors group"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
          >
            <div className="flex items-center space-x-2 flex-1 min-w-0">
              <span className="text-base flex-shrink-0">{getIcon(node.type)}</span>
              <span className="font-medium truncate">{node.title}</span>
            </div>
            {hasChildren && (
              <svg
                className={`w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-transform duration-200 flex-shrink-0 ${
                  expanded ? 'rotate-90' : ''
                }`}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
          {expanded && hasChildren && (
            <div className="mt-1 space-y-1">{node.children!.map((child) => renderNode(child, level + 1))}</div>
          )}
        </div>
      );
    }

    // Leaf nodes (documents, stories, techspec)
    if (!node.path) return null;

    const documentPath = `/docs/${node.path.replace('.md', '')}`;

    return (
      <div key={node.id} style={{ paddingLeft }}>
        <Link
          to={documentPath}
          className={`
            flex items-center space-x-2 px-2 py-1.5 text-sm rounded transition-colors group
            ${
              isActive
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100'
            }
          `}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className={`text-base flex-shrink-0 ${isActive ? 'filter brightness-110' : ''}`}>
            {getIcon(node.type)}
          </span>
          <span className="truncate">{node.title}</span>
        </Link>
      </div>
    );
  };

  if (filteredTree.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p className="text-sm">No documents found</p>
        {searchQuery && <p className="text-xs mt-1">Try a different search term</p>}
      </div>
    );
  }

  return <div className="space-y-2">{filteredTree.map((node) => renderNode(node))}</div>;
}
