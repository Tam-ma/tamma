import { useEffect, useRef, useState, useCallback } from 'react';
import { useFetcher, useNavigate } from 'react-router';
import { debounce } from '../../lib/utils/debounce';

interface SearchBarProps {
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: (query: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

interface Suggestion {
  text: string;
  type: 'popular' | 'recent' | 'document' | 'author';
  metadata?: {
    count?: number;
    lastUsed?: number;
  };
}

export function SearchBar({
  value: controlledValue,
  onChange,
  onSearch,
  placeholder = 'Search documents, comments, suggestions...',
  autoFocus = false,
  className = ''
}: SearchBarProps) {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Use controlled value if provided, otherwise use internal state
  const value = controlledValue !== undefined ? controlledValue : internalValue;

  // Debounced function to fetch suggestions
  const fetchSuggestions = useCallback(
    debounce((query: string) => {
      if (query.length >= 2) {
        fetcher.load(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300),
    []
  );

  // Update suggestions when fetcher data changes
  useEffect(() => {
    if (fetcher.data?.suggestions) {
      setSuggestions(fetcher.data.suggestions);
      setShowSuggestions(true);
    }
  }, [fetcher.data]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global shortcut: Ctrl+K or Cmd+K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Only handle other keys when search is focused
      if (document.activeElement !== inputRef.current) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            handleSuggestionClick(suggestions[selectedIndex].text);
          } else {
            handleSearch(value);
          }
          break;

        case 'Escape':
          e.preventDefault();
          if (showSuggestions) {
            setShowSuggestions(false);
            setSelectedIndex(-1);
          } else {
            handleClear();
            inputRef.current?.blur();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [value, suggestions, selectedIndex, showSuggestions]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    if (onChange) {
      onChange(newValue);
    } else {
      setInternalValue(newValue);
    }

    setSelectedIndex(-1);
    fetchSuggestions(newValue);
  };

  const handleSearch = (query: string) => {
    if (query.trim()) {
      setShowSuggestions(false);
      if (onSearch) {
        onSearch(query);
      } else {
        // Navigate to search results page
        navigate(`/search?q=${encodeURIComponent(query)}`);
      }
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (onChange) {
      onChange(suggestion);
    } else {
      setInternalValue(suggestion);
    }
    setShowSuggestions(false);
    handleSearch(suggestion);
  };

  const handleClear = () => {
    if (onChange) {
      onChange('');
    } else {
      setInternalValue('');
    }
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const getSuggestionIcon = (type: Suggestion['type']) => {
    switch (type) {
      case 'popular':
        return '🔥'; // Popular/trending
      case 'recent':
        return '🕐'; // Recent/history
      case 'document':
        return '📄'; // Document
      case 'author':
        return '👤'; // Author
      default:
        return '🔍'; // Default search
    }
  };

  return (
    <div className={`relative ${className}`}>
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
          onChange={handleInputChange}
          onFocus={() => {
            setIsFocused(true);
            if (value.length >= 2) {
              setShowSuggestions(true);
            }
          }}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400 pr-2"
          aria-label="Search"
          aria-autocomplete="list"
          aria-controls="search-suggestions"
          aria-expanded={showSuggestions}
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

        {/* Loading Indicator */}
        {fetcher.state === 'loading' && (
          <div className="pr-3">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          </div>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          id="search-suggestions"
          className="absolute z-50 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.type}-${suggestion.text}`}
              onClick={() => handleSuggestionClick(suggestion.text)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`
                w-full flex items-center px-4 py-2 text-sm text-left transition-colors
                ${
                  index === selectedIndex
                    ? 'bg-blue-50 text-blue-900'
                    : 'hover:bg-gray-50 text-gray-900'
                }
              `}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span className="mr-3 text-lg" aria-hidden="true">
                {getSuggestionIcon(suggestion.type)}
              </span>
              <div className="flex-1">
                <div className="font-medium">{suggestion.text}</div>
                {suggestion.metadata && (
                  <div className="text-xs text-gray-500">
                    {suggestion.metadata.count && (
                      <span>{suggestion.metadata.count} searches</span>
                    )}
                  </div>
                )}
              </div>
              {index === selectedIndex && (
                <span className="text-xs text-gray-400">Press Enter</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Results Counter (when actively searching) */}
      {value && !showSuggestions && (
        <div className="mt-2 text-xs text-gray-500 px-2" aria-live="polite">
          Press Enter to search for "{value}"
        </div>
      )}
    </div>
  );
}