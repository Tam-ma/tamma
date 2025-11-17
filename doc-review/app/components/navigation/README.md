# Navigation Components

A comprehensive navigation system for the Tamma documentation review platform, featuring a collapsible sidebar with hierarchical document tree, search functionality, and breadcrumb navigation.

## Components

### Sidebar

The main navigation container with responsive design and persistent state.

**Features:**
- Collapsible sidebar (desktop) with smooth animations
- Mobile-responsive with slide-out menu and overlay
- Persistent state saved to localStorage
- Toggle button with visual feedback
- Search bar integration
- Hierarchical document tree

**Props:**
```typescript
interface SidebarProps {
  navigation: DocumentNavigation;  // Navigation structure from DocumentLoader
  currentPath?: string;            // Current route path for highlighting
}
```

**Keyboard Shortcuts:**
- Desktop: Click collapse/expand button
- Mobile: Hamburger menu button

**State Persistence:**
- Sidebar open/closed state: `localStorage.getItem('sidebar-open')`
- Automatically restores on page load

### DocTree

Hierarchical tree view component with collapsible sections, search filtering, and visual indicators.

**Features:**
- Collapsible sections (Main Docs, Epics, Research, Retrospectives)
- Nested tree structure (Epics → Tech Specs + Stories)
- Current page highlighting
- Document type icons (folder, document, epic, story, tech spec)
- Search result filtering
- Auto-expand on search
- Persistent expansion state in localStorage
- Smooth animations

**Props:**
```typescript
interface DocTreeProps {
  navigation: DocumentNavigation;  // Navigation structure
  currentPath?: string;            // Current route for active state
  searchQuery?: string;            // Filter tree by search term
}
```

**Document Type Icons:**
- 📁 Section (Main, Epics, Research, Retrospectives)
- 📦 Epic
- 📝 Story
- 📋 Technical Specification
- 📄 Document

**State Persistence:**
- Expanded sections: `localStorage.getItem('doc-tree-expanded')`
- JSON array of expanded section IDs

### SearchBar

Search input with keyboard shortcuts and clear functionality.

**Features:**
- Real-time search filtering
- Keyboard shortcut support (Ctrl+K / Cmd+K)
- ESC to clear and blur
- Clear button when text is present
- Focus state styling
- Keyboard shortcut hint display

**Props:**
```typescript
interface SearchBarProps {
  value: string;              // Current search value
  onChange: (value: string) => void;  // Change handler
  placeholder?: string;       // Placeholder text
}
```

**Keyboard Shortcuts:**
- `Ctrl+K` or `Cmd+K` - Focus search input
- `ESC` - Clear search and blur input

**Accessibility:**
- ARIA labels for screen readers
- Visual focus indicators
- Live region for search results

### Breadcrumbs

Contextual navigation showing current document location in hierarchy.

**Features:**
- Automatic path detection from current route
- Clickable breadcrumb links for navigation
- Smart truncation for long paths (shows first, last two, and ellipsis)
- Document type icons for visual context
- Responsive design

**Props:**
```typescript
interface BreadcrumbsProps {
  navigation: DocumentNavigation;  // Navigation structure
  currentPath?: string;            // Current route path
}
```

**Path Examples:**
- Main Document: `Docs > Architecture`
- Epic: `Docs > Epics > Epic 1: Foundation`
- Story: `Docs > Epics > Epic 1: Foundation > 1-0: AI Provider Strategy`
- Research: `Docs > Research > AI Provider Strategy`

## Usage

### Basic Setup

```typescript
import { Sidebar, Breadcrumbs } from '~/components/navigation';
import { useLoaderData, useLocation } from 'react-router';

export default function DocsLayout() {
  const { navigation } = useLoaderData<typeof loader>();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar with navigation tree */}
        <Sidebar navigation={navigation} currentPath={location.pathname} />

        <main className="flex-1">
          {/* Breadcrumbs in header */}
          <header className="bg-white border-b">
            <div className="px-6 py-4">
              <Breadcrumbs navigation={navigation} currentPath={location.pathname} />
            </div>
          </header>

          {/* Page content */}
          <div className="px-6 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
```

### Standalone Components

```typescript
// Just the tree view
import { DocTree } from '~/components/navigation';

<DocTree
  navigation={navigation}
  currentPath="/docs/stories/1-0-ai-provider-strategy"
  searchQuery={searchTerm}
/>

// Just the search bar
import { SearchBar } from '~/components/navigation';

const [query, setQuery] = useState('');
<SearchBar value={query} onChange={setQuery} placeholder="Search docs..." />

// Just the breadcrumbs
import { Breadcrumbs } from '~/components/navigation';

<Breadcrumbs navigation={navigation} currentPath={location.pathname} />
```

## Responsive Behavior

### Desktop (≥1024px)
- Sidebar visible by default
- Collapsible to icon-only mode
- State persists across page loads
- Fixed position, content area adjusts

### Mobile (<1024px)
- Sidebar hidden by default
- Slide-out menu with overlay
- Hamburger button in top-left
- Auto-closes on navigation
- Full-width when open

## Styling

All components use Tailwind CSS classes with a consistent design system:

**Colors:**
- Background: `bg-white`, `bg-gray-50`, `bg-gray-100`
- Text: `text-gray-600`, `text-gray-900`
- Accent: `text-blue-500`, `bg-blue-50`
- Border: `border-gray-200`, `border-gray-300`

**Transitions:**
- Sidebar: 300ms ease-in-out
- Tree expand/collapse: 200ms ease
- Hover states: default transition

**Z-Index Layers:**
- Overlay: z-40
- Sidebar: z-40
- Header: z-30

## Accessibility

All components follow WCAG 2.1 Level AA guidelines:

- **Semantic HTML:** Proper `<nav>`, `<button>`, `<header>` elements
- **ARIA Labels:** All interactive elements have labels
- **Keyboard Navigation:** Full keyboard support
- **Focus Management:** Clear focus indicators
- **Screen Readers:** Live regions for dynamic content
- **Color Contrast:** WCAG AA compliant

## Performance

**Optimizations:**
- `useMemo` for expensive tree filtering
- localStorage for state persistence (reduces re-renders)
- CSS transitions (GPU-accelerated)
- Lazy rendering of collapsed sections
- Debounced search filtering (via React state)

**Bundle Size:**
- Total: ~4KB gzipped (all navigation components)
- No external dependencies beyond React Router

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Testing

### Unit Tests

```bash
npm test -- navigation
```

### Manual Testing Checklist

- [ ] Sidebar collapses/expands on desktop
- [ ] Mobile menu opens with hamburger button
- [ ] Mobile overlay closes menu when clicked
- [ ] Search filters tree results
- [ ] Ctrl+K focuses search
- [ ] ESC clears search
- [ ] Tree sections expand/collapse
- [ ] Current page is highlighted
- [ ] Breadcrumbs show correct path
- [ ] State persists on page reload
- [ ] Links navigate correctly
- [ ] Responsive at all breakpoints

## Future Enhancements

Potential features for future iterations:

- [ ] Keyboard navigation in tree (arrow keys, enter)
- [ ] Search highlighting in results
- [ ] Recently viewed documents
- [ ] Bookmarks/favorites
- [ ] Drag-and-drop reordering (if editable)
- [ ] Export navigation as JSON
- [ ] Custom themes/color schemes
- [ ] Virtual scrolling for large trees
- [ ] Search suggestions/autocomplete
- [ ] Multi-select for batch operations

## Troubleshooting

### Sidebar not persisting state
Check localStorage permissions in browser. Some privacy modes block localStorage.

### Search not filtering
Verify `searchQuery` prop is passed to `<DocTree>` and state is updating.

### Mobile menu not closing
Check that `currentPath` changes on navigation. The component uses this as a dependency.

### Icons not displaying
Ensure emoji support in browser. Consider using icon library (Heroicons, etc.) for better cross-browser support.

### Build errors
Run `npm run build` to check TypeScript errors. Ensure all imports are correct.

## Contributing

When adding new navigation features:

1. Update type definitions in `/app/lib/types/document.ts`
2. Add new tree node types in `DocTree.tsx`
3. Update breadcrumb logic in `Breadcrumbs.tsx`
4. Add tests for new functionality
5. Update this README

## License

Part of the Tamma documentation review platform.
