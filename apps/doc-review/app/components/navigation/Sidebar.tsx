import { useState, useEffect } from 'react';
import type { DocumentNavigation } from '~/lib/types/document';
import { SearchBar } from './SearchBar';
import { DocTree } from './DocTree';

interface SidebarProps {
  navigation: DocumentNavigation;
  currentPath?: string;
}

export function Sidebar({ navigation, currentPath }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Close mobile menu on navigation
  useEffect(() => {
    setIsMobileOpen(false);
  }, [currentPath]);

  // Load saved sidebar state from localStorage
  useEffect(() => {
    const savedState = localStorage.getItem('sidebar-open');
    if (savedState !== null) {
      setIsOpen(savedState === 'true');
    }
  }, []);

  // Save sidebar state to localStorage
  const toggleSidebar = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    localStorage.setItem('sidebar-open', String(newState));
  };

  const toggleMobileSidebar = () => {
    setIsMobileOpen(!isMobileOpen);
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Toggle Button */}
      <button
        onClick={toggleMobileSidebar}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-md bg-white shadow-md hover:bg-gray-100 transition-colors"
        aria-label="Toggle navigation menu"
      >
        <svg
          className="w-6 h-6 text-gray-600"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          {isMobileOpen ? (
            <path d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-40 h-screen bg-white shadow-lg
          transition-all duration-300 ease-in-out
          ${isOpen ? 'w-80' : 'w-0 lg:w-16'}
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        aria-label="Document navigation"
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            {isOpen && (
              <div className="flex items-center space-x-2">
                <span className="text-2xl" role="img" aria-label="Books">
                  📚
                </span>
                <h2 className="text-lg font-semibold text-gray-900">Documentation</h2>
              </div>
            )}
            <button
              onClick={toggleSidebar}
              className="hidden lg:block p-2 rounded-md hover:bg-gray-100 transition-colors"
              aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg
                className={`w-5 h-5 text-gray-600 transition-transform duration-300 ${
                  isOpen ? '' : 'rotate-180'
                }`}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Search Bar */}
          {isOpen && (
            <div className="p-4 border-b border-gray-200">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search documents..."
              />
            </div>
          )}

          {/* Document Tree */}
          {isOpen && (
            <div className="flex-1 overflow-y-auto p-4">
              <DocTree
                navigation={navigation}
                currentPath={currentPath}
                searchQuery={searchQuery}
              />
            </div>
          )}

          {/* Collapsed State - Icon Only */}
          {!isOpen && (
            <div className="hidden lg:flex flex-col items-center py-4 space-y-4">
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-md hover:bg-gray-100 transition-colors"
                aria-label="Expand sidebar"
                title="Expand sidebar"
              >
                <span className="text-2xl" role="img" aria-label="Books">
                  📚
                </span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Spacer to prevent content from going under sidebar */}
      <div
        className={`hidden lg:block transition-all duration-300 ease-in-out ${
          isOpen ? 'w-80' : 'w-16'
        }`}
        aria-hidden="true"
      />
    </>
  );
}
