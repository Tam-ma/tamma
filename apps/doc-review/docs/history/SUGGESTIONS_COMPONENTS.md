# Suggestion Review Components Documentation

This document describes the new React components for viewing and managing edit suggestions with visual diff display.

## Overview

The suggestion review system consists of several interconnected components that provide a complete workflow for:
- Creating edit suggestions
- Viewing diffs with syntax highlighting
- Approving or rejecting suggestions
- Managing multiple suggestions across documents
- Filtering and organizing suggestions by status and session

## Components

### 1. DiffViewer

**Location**: `/app/components/suggestions/DiffViewer.tsx`

A sophisticated diff viewer that displays before/after comparisons with syntax highlighting.

**Features**:
- Two view modes: Unified and Split
- Syntax highlighting for additions (green) and deletions (red)
- Line numbers for both before/after versions
- Collapsible unchanged sections for large diffs
- Copy button for suggested text
- Responsive design

**Props**:
```typescript
interface DiffViewerProps {
  diffString: string;           // Unified diff format from 'diff' library
  originalText: string;         // Original text for split view
  suggestedText: string;        // Suggested text for split view
  viewMode?: 'unified' | 'split'; // Default: 'unified'
  showCollapse?: boolean;       // Show collapse toggle (default: true)
  contextLines?: number;        // Context lines to show (default: 3)
  className?: string;
}
```

**Example**:
```tsx
<DiffViewer
  diffString={suggestion.diff}
  originalText={suggestion.originalText}
  suggestedText={suggestion.suggestedText}
  viewMode="unified"
  showCollapse={true}
  contextLines={3}
/>
```

### 2. SuggestionCard

**Location**: `/app/components/suggestions/SuggestionCard.tsx`

Displays a single suggestion with metadata, diff viewer, and action buttons.

**Features**:
- Expandable/collapsible card
- Status badges (pending/approved/rejected/deleted)
- Author and timestamp information
- Line range indicator
- Document path display
- Session and PR links
- Approve/Reject buttons (for reviewers)
- Real-time updates using React Router's useFetcher

**Props**:
```typescript
interface SuggestionCardProps {
  suggestion: Suggestion;       // Full suggestion object
  expanded?: boolean;           // Initially expanded (default: false)
  onUpdate?: () => void;        // Callback after update
  showActions?: boolean;        // Show approve/reject (default: true)
  canReview?: boolean;          // User can review (default: false)
  className?: string;
}
```

**Example**:
```tsx
<SuggestionCard
  suggestion={suggestion}
  expanded={false}
  onUpdate={handleRefresh}
  showActions={true}
  canReview={user.role === 'reviewer'}
/>
```

### 3. SuggestionReviewPanel

**Location**: `/app/components/suggestions/SuggestionReviewPanel.tsx`

A comprehensive panel for managing multiple suggestions with filtering and keyboard navigation.

**Features**:
- Filter by status (all/pending/approved/rejected)
- Filter by review session
- Status count badges
- Grouped by session view
- Keyboard navigation (j/k for next/prev, Enter to expand)
- Loading states
- Empty states
- Responsive design

**Props**:
```typescript
interface SuggestionReviewPanelProps {
  docPath?: string;             // Filter by document path
  sessionId?: string;           // Filter by session ID
  userId?: string;              // Filter by user ID
  canReview?: boolean;          // User can approve/reject
  onUpdate?: () => void;        // Callback after updates
  className?: string;
}
```

**Example**:
```tsx
<SuggestionReviewPanel
  docPath={document.path}
  canReview={user.role === 'reviewer'}
  className="rounded-lg bg-white p-6 shadow"
/>
```

**Keyboard Shortcuts**:
- `j` or `↓`: Navigate to next suggestion
- `k` or `↑`: Navigate to previous suggestion
- `Enter`: Expand/collapse current suggestion

### 4. SuggestionsPanel (Updated)

**Location**: `/app/components/suggestions/SuggestionsPanel.tsx`

The original panel now uses SuggestionCard for better consistency and features.

**Changes**:
- Now displays recent suggestions using SuggestionCard
- Collapsible recent suggestions section
- Improved visual hierarchy
- Better integration with the new components

## Type Definitions

### Suggestion Type

**Location**: `/app/lib/types/suggestion.ts`

```typescript
export interface Suggestion {
  id: string;
  docPath: string;
  description: string;
  originalText: string;
  suggestedText: string;
  lineStart: number;
  lineEnd: number;
  status: SuggestionStatus;
  userId: string;
  sessionId: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
  diff?: string;
  author?: {
    id: string | null;
    name: string | null;
    avatarUrl?: string | null;
  };
  session?: {
    id: string;
    title: string;
    status: string;
    prNumber?: number | null;
    prUrl?: string | null;
  };
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'deleted';
```

## Utility Functions

### Diff Parser

**Location**: `/app/lib/utils/diff-parser.ts`

Utilities for parsing and manipulating unified diff strings.

**Functions**:

1. **parseUnifiedDiff(diffString: string): ParsedDiff**
   - Parses a unified diff string into structured data
   - Extracts hunks, line numbers, and change types

2. **collapseUnchangedLines(hunk: DiffHunk, contextLines: number): DiffHunk**
   - Collapses unchanged sections in a diff
   - Keeps N context lines before/after changes

3. **getDiffSummary(diff: ParsedDiff): { additions: number; deletions: number; changes: number }**
   - Returns summary statistics for a diff

## Routes

### Document Suggestions View

**Location**: `/app/routes/docs.$documentId.suggestions.tsx`

A dedicated full-page view for reviewing all suggestions for a document.

**Features**:
- Back navigation to document
- Full SuggestionReviewPanel
- Reviewer mode indicator
- Responsive layout

**URL Pattern**: `/docs/:documentId/suggestions`

**Example**: `/docs/architecture/suggestions`

### Document View (Updated)

**Location**: `/app/routes/docs.$documentId.tsx`

Added a "Review All Suggestions" button that links to the dedicated suggestions page.

## API Integration

All components use React Router's `useFetcher` for API calls:

### Endpoints Used

1. **GET /api/suggestions**
   - List suggestions with filters
   - Query params: `docPath`, `status`, `sessionId`, `userId`, `limit`, `offset`

2. **GET /api/suggestions/:id**
   - Get a single suggestion with diff

3. **PATCH /api/suggestions/:id**
   - Update suggestion (status, description)
   - Triggers PR creation on approval

4. **DELETE /api/suggestions/:id**
   - Soft delete a suggestion

## Styling

All components use:
- **Tailwind CSS** for styling
- **Lucide React** for icons
- **dayjs** for date formatting (with relativeTime plugin)
- Responsive design patterns
- Accessible color contrasts
- Dark mode ready (where applicable)

## Accessibility

- Semantic HTML structure
- ARIA labels and roles
- Keyboard navigation support
- Focus management
- Screen reader friendly
- Proper heading hierarchy
- Color contrast compliance

## Usage Examples

### Basic Suggestion Review Workflow

1. User creates a suggestion via SuggestionsPanel
2. Suggestion appears in the panel with "pending" status
3. Reviewer clicks "Review All Suggestions" button
4. Dedicated page shows all suggestions with filters
5. Reviewer expands a suggestion to see the diff
6. Reviewer approves or rejects the suggestion
7. On approval, PR is created/updated automatically
8. Status badge updates in real-time

### Filtering Suggestions

```tsx
// Filter by status
<SuggestionReviewPanel
  docPath="architecture.md"
  canReview={true}
/>
// User selects "Pending" from status dropdown

// Filter by session
<SuggestionReviewPanel
  sessionId={session.id}
  canReview={true}
/>
```

### Custom Integration

```tsx
import { DiffViewer, SuggestionCard } from '~/components/suggestions';

function CustomReviewPage() {
  const suggestions = useSuggestions();

  return (
    <div>
      {suggestions.map(suggestion => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          expanded={false}
          canReview={true}
        />
      ))}
    </div>
  );
}
```

## Performance Considerations

- **Lazy loading**: Suggestions loaded on demand
- **Pagination**: API supports limit/offset
- **Memoization**: Diff parsing is memoized
- **Keyboard navigation**: Only active when not typing
- **Collapsible sections**: Reduces DOM size for large diffs

## Future Enhancements

Potential improvements for the future:

1. **Inline editing**: Edit suggestion text directly in the card
2. **Batch operations**: Approve/reject multiple suggestions at once
3. **Comments on suggestions**: Add discussion threads to suggestions
4. **Side-by-side document view**: Show document alongside suggestions
5. **Suggestion templates**: Quick templates for common edits
6. **AI-powered suggestions**: Suggest improvements automatically
7. **Conflict detection**: Detect overlapping suggestions
8. **Suggestion analytics**: Track acceptance rates and patterns
9. **Real-time collaboration**: See other reviewers in real-time
10. **Mobile-optimized views**: Better mobile experience

## Troubleshooting

### Common Issues

1. **Diff not rendering**
   - Check that `suggestion.diff` is populated
   - Verify unified diff format is correct
   - Check browser console for parsing errors

2. **Approve/Reject not working**
   - Verify user has reviewer role
   - Check API endpoint is accessible
   - Check session exists and is active

3. **Keyboard navigation not working**
   - Ensure focus is not in an input field
   - Check browser console for errors
   - Verify suggestions array is populated

### Debug Mode

Enable debug logging:
```typescript
// In DiffViewer.tsx
console.log('Parsed diff:', parsedDiff);

// In SuggestionCard.tsx
console.log('Suggestion:', suggestion);
console.log('Fetcher state:', fetcher.state);
```

## Dependencies

- `react` ^19.2.0
- `react-router` ^7.9.5
- `lucide-react` ^0.553.0
- `dayjs` ^1.11.13
- `diff` ^7.0.0
- `@types/diff` ^6.0.0

## Contributing

When adding new features to the suggestion system:

1. Update TypeScript types in `/app/lib/types/suggestion.ts`
2. Add utility functions to `/app/lib/utils/diff-parser.ts`
3. Update components with proper prop types
4. Add tests for new functionality
5. Update this documentation

## License

Part of the Tamma documentation review system.
