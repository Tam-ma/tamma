# Suggestion Components - Visual Guide

This guide provides visual descriptions and usage patterns for the new suggestion review components.

## Component Hierarchy

```
SuggestionReviewPanel (Full page or panel)
  ├── Filters (Status, Session)
  ├── Status Badges (Pending, Approved, Rejected counts)
  └── List of SuggestionCards
       └── Each SuggestionCard contains:
            ├── Header (Description, Status, Author, Date, Lines)
            ├── Session Info (with PR link)
            └── DiffViewer (when expanded)
                 ├── View Mode Toggle (Unified/Split)
                 ├── Collapse Toggle
                 ├── Copy Button
                 └── Diff Content
```

## User Workflows

### Workflow 1: Creating a Suggestion

1. **Navigate to a document**
   ```
   URL: /docs/architecture
   ```

2. **Scroll to sidebar panel "Edit Suggestions"**
   - See recent suggestions (if any)
   - See "Create Session" section if no sessions exist

3. **Create a review session** (one-time setup)
   - Enter session title: e.g., "Epic 1 - AI Provider Updates"
   - Click "Create Session"

4. **Fill in suggestion form**
   - Select review session
   - Enter line start: e.g., `45`
   - Enter line end: e.g., `52`
   - Enter summary: "Clarify authentication flow"
   - Paste original text from document
   - Paste improved text
   - Click "Propose Change"

5. **Suggestion created**
   - Appears in recent suggestions
   - Status: "pending"
   - Ready for review

### Workflow 2: Reviewing Suggestions

1. **Navigate to document**
   ```
   URL: /docs/architecture
   ```

2. **Click "Review All Suggestions" button** (top of page)
   ```
   URL changes to: /docs/architecture/suggestions
   ```

3. **Full-page review interface loads**
   - Header shows document title and path
   - Filter bar with status and session dropdowns
   - List of all suggestions

4. **Filter suggestions**
   - Select "Pending" to see only pending reviews
   - Or select a specific session

5. **Navigate with keyboard** (optional)
   - Press `j` to move to next suggestion
   - Press `k` to move to previous suggestion
   - Press `Enter` to expand/collapse

6. **Review a suggestion**
   - Click on a suggestion card to expand
   - Diff viewer shows before/after comparison
   - Toggle between "Unified" and "Split" views
   - Click "Collapse" to hide unchanged lines

7. **Make a decision**
   - Click "Approve" to accept the change
   - Click "Reject" to decline the change
   - Status updates immediately

8. **PR Creation** (automatic on approval)
   - When first suggestion is approved, PR is created
   - PR link appears in session info
   - Future approvals add to the same PR

### Workflow 3: Viewing Diff Details

1. **Expand a suggestion card**
   - Click the expand button or press Enter

2. **Unified View** (default)
   ```
   Line numbers (before | after) | Content
   ─────────────────────────────────────────
   45  45  |  unchanged line
   46      | - removed line (red background)
       47  | + added line (green background)
   48  48  |  unchanged line
   ```

3. **Split View** (side-by-side)
   ```
   Original                    | Suggested
   ──────────────────────────────────────────
   45 | unchanged line          | 45 | unchanged line
   46 | removed line (red)      | 47 | added line (green)
   48 | unchanged line          | 48 | unchanged line
   ```

4. **Collapse Feature**
   - Large diffs show "..." for unchanged sections
   - Keeps 3 lines of context before/after changes
   - Click "Expand" to show all lines

5. **Copy Suggested Text**
   - Click "Copy New" button
   - Button changes to "Copied" with checkmark
   - Suggested text is in clipboard

## Component States

### SuggestionCard Status Badges

**Pending** (Yellow)
```
[ 🕒 Pending Review ]
- Waiting for reviewer action
- Shows approve/reject buttons (for reviewers)
```

**Approved** (Green)
```
[ ✓ Approved ]
- Change was accepted
- PR link may be visible
- No action buttons
```

**Rejected** (Red)
```
[ ✗ Rejected ]
- Change was declined
- No action buttons
```

**Deleted** (Gray)
```
[ ✗ Deleted ]
- Soft-deleted suggestion
- No action buttons
```

### Loading States

**Initial Load**
```
[ 🔄 Loading suggestions... ]
```

**Submitting**
```
Button: [ Approving... ] (disabled)
Button: [ Rejecting... ] (disabled)
```

### Empty States

**No Suggestions**
```
┌─────────────────────────────┐
│    🔍                        │
│    No suggestions found     │
│                             │
│    Try changing the filter  │
│    to see more suggestions. │
└─────────────────────────────┘
```

**No Sessions**
```
Need a review session?
Sessions group related changes and back a single PR.
Create one per epic or topic.

[ Create Session ]
```

## Filter Combinations

### Status Filter

- **All Status (25)**: Shows all suggestions
- **Pending (10)**: Shows only pending reviews
- **Approved (12)**: Shows only approved changes
- **Rejected (3)**: Shows only rejected changes

### Session Filter

- **All Sessions**: Shows suggestions from all sessions
- **Epic 1 - Provider Strategy (PR #123)**: Shows only suggestions from this session
- **Epic 2 - Worker Architecture**: Shows only suggestions from this session

### Grouped View

When not filtering by session, suggestions are grouped:

```
📁 Epic 1 - Provider Strategy  PR #123  (8 suggestions)
   ├── Suggestion 1: Clarify authentication flow
   ├── Suggestion 2: Update retry logic
   └── ...

📁 Epic 2 - Worker Architecture  (5 suggestions)
   ├── Suggestion 1: Add worker pool sizing
   └── ...

📁 No Session  (2 suggestions)
   └── Suggestion 1: Fix typo
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` or `↓` | Navigate to next suggestion |
| `k` or `↑` | Navigate to previous suggestion |
| `Enter` | Expand/collapse current suggestion |

**Note**: Keyboard shortcuts are disabled when typing in input fields.

## Responsive Layouts

### Mobile (< 640px)

- Single column layout
- Stacked filters
- Compact suggestion cards
- Split view becomes scrollable horizontal

### Tablet (640px - 1024px)

- Two column layout for split view
- Side-by-side filters
- Full suggestion cards

### Desktop (> 1024px)

- Full multi-column layouts
- Side-by-side diff views
- All features visible

## Color Coding

### Diff Colors

- **Green** (#f0fdf4 background, #166534 text): Additions
- **Red** (#fef2f2 background, #991b1b text): Deletions
- **White** (#ffffff background, #1f2937 text): Unchanged
- **Blue** (#eff6ff background, #1e40af text): Headers

### Status Colors

- **Yellow** (#fef3c7 background, #92400e text): Pending
- **Green** (#d1fae5 background, #065f46 text): Approved
- **Red** (#fee2e2 background, #991b1b text): Rejected
- **Gray** (#f3f4f6 background, #1f2937 text): Deleted

### UI Colors

- **Indigo** (#eef2ff background, #4f46e5 text): Primary actions
- **Gray** (#f9fafb background, #6b7280 text): Secondary actions

## Accessibility Features

### Semantic HTML

- `<article>` for suggestion cards
- `<header>` for card headers
- `<button>` for all interactive elements
- `<select>` for filters

### ARIA Labels

- Status badges have descriptive text
- Buttons have title attributes
- Filters have proper labels

### Keyboard Navigation

- All interactive elements are keyboard accessible
- Tab order follows visual order
- Focus states are visible

### Screen Reader Support

- Status changes announced
- Loading states announced
- Error messages announced

## Integration Points

### With Existing Components

**MarkdownRenderer**
- Shows document content
- Suggestions reference line numbers from rendered content

**CommentsPanel**
- Comments and suggestions are separate
- Both can reference same document lines

**DiscussionsPanel**
- Discussions can reference suggestions
- Cross-linking capability

### With API

**GET /api/suggestions**
- Fetches suggestions with filters
- Returns diff property generated server-side

**PATCH /api/suggestions/:id**
- Updates suggestion status
- Triggers PR creation on approval

**POST /api/suggestions**
- Creates new suggestion
- Validates against session

## Best Practices

### For Users

1. **Create sessions first** - Group related changes
2. **Descriptive summaries** - Help reviewers understand intent
3. **Small changes** - One logical change per suggestion
4. **Copy exact text** - Avoid manual retyping

### For Reviewers

1. **Review regularly** - Don't let suggestions pile up
2. **Use filters** - Focus on one session at a time
3. **Expand to review** - Always view the diff before approving
4. **Keyboard navigation** - Faster than clicking

### For Developers

1. **Handle loading states** - Always show feedback
2. **Handle errors** - Display user-friendly messages
3. **Memoize expensive operations** - Diff parsing is cached
4. **Type everything** - Use TypeScript types

## Common Patterns

### Optimistic UI Updates

Components use React Router's useFetcher for optimistic updates:

```tsx
const fetcher = useFetcher();

// Submit without page reload
fetcher.submit({ status: 'approved' }, { method: 'PATCH' });

// Show optimistic state
if (fetcher.state === 'submitting') {
  return <div>Approving...</div>;
}
```

### Memoization

Expensive operations are memoized:

```tsx
const parsedDiff = useMemo(() => {
  return parseUnifiedDiff(diffString);
}, [diffString]);
```

### Conditional Rendering

Components adapt to permissions:

```tsx
{canReview && suggestion.status === 'pending' && (
  <div>
    <button onClick={handleApprove}>Approve</button>
    <button onClick={handleReject}>Reject</button>
  </div>
)}
```

## Error Handling

### Parse Errors

If diff parsing fails:
```
┌────────────────────────────┐
│  ⚠️ Failed to parse diff   │
│     content.               │
└────────────────────────────┘
```

### API Errors

If API call fails:
```
[ ✗ Failed to update suggestion. ]
```

### Network Errors

Handled by React Router:
- Shows error boundary
- Allows retry

## Performance Tips

1. **Pagination** - Load suggestions in batches
2. **Lazy loading** - Only load expanded diffs
3. **Debouncing** - Debounce filter changes
4. **Memoization** - Cache expensive computations
5. **Code splitting** - Components are lazy-loaded

## Testing

### Manual Testing Checklist

- [ ] Create suggestion
- [ ] View suggestion in panel
- [ ] Expand suggestion card
- [ ] Toggle view mode (unified/split)
- [ ] Toggle collapse
- [ ] Copy suggested text
- [ ] Filter by status
- [ ] Filter by session
- [ ] Navigate with keyboard (j/k/Enter)
- [ ] Approve suggestion
- [ ] Reject suggestion
- [ ] View PR link
- [ ] Mobile responsive
- [ ] Tablet responsive
- [ ] Desktop responsive

### Browser Testing

- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Edge

## Troubleshooting

### Diff Not Showing

**Problem**: Diff viewer shows "Failed to parse diff content"

**Solutions**:
1. Check that `suggestion.diff` is populated
2. Verify diff format is unified diff
3. Check browser console for errors

### Keyboard Navigation Not Working

**Problem**: j/k keys don't navigate

**Solutions**:
1. Click outside input fields
2. Check that suggestions are loaded
3. Verify no JavaScript errors

### Approve/Reject Not Working

**Problem**: Buttons don't respond

**Solutions**:
1. Check user has reviewer permission
2. Verify suggestion is in pending state
3. Check API endpoint is accessible
4. Check browser network tab for errors

## Future Considerations

### Planned Features

1. **Batch Operations** - Select multiple suggestions
2. **Comments** - Add comments to suggestions
3. **Templates** - Save common edit patterns
4. **AI Suggestions** - Automatic improvement detection
5. **Conflict Detection** - Detect overlapping edits

### Performance Improvements

1. **Virtual Scrolling** - For large suggestion lists
2. **Incremental Loading** - Load as you scroll
3. **Service Worker** - Offline support
4. **WebSocket** - Real-time updates

### UI Enhancements

1. **Drag & Drop** - Reorder suggestions
2. **Inline Editing** - Edit suggestion text
3. **Rich Previews** - Show more context
4. **Dark Mode** - Support dark theme

---

**Last Updated**: November 2025
**Component Version**: 1.0.0
