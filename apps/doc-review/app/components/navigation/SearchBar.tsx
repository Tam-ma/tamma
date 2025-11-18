import { useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search...' }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Keyboard shortcut: Ctrl+K or Cmd+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // ESC to clear search and blur
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onChange('');
        inputRef.current?.blur();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onChange]);

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div
        className={`
          flex items-center bg-gray-50 border rounded-lg transition-all duration-200
          ${
            isFocused
              ? 'border-blue-400 ring-2 ring-blue-100 bg-white'
              : 'border-gray-300 hover:border-gray-400'
          }
        `}
      >
        {/* Search Icon */}
        <div className="flex items-center justify-center w-10 h-10">
          <svg
            className={`w-4 h-4 transition-colors ${
              isFocused ? 'text-blue-500' : 'text-gray-400'
            }`}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400 pr-2"
          aria-label="Search documents"
        />

        {/* Clear Button */}
        {value && (
          <button
            onClick={handleClear}
            className="flex items-center justify-center w-10 h-10 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear search"
            type="button"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Keyboard Shortcut Hint */}
        {!value && !isFocused && (
          <div className="hidden md:flex items-center pr-3 text-xs text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-gray-500 font-mono">
              ⌘K
            </kbd>
          </div>
        )}
      </div>

      {/* Results Counter */}
      {value && (
        <div className="mt-2 text-xs text-gray-500 px-2" aria-live="polite">
          Searching for "{value}"
        </div>
      )}
    </div>
  );
}
