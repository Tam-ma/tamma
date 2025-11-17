# Quick Start Guide - Suggestion Components

Get up and running with the new suggestion review components in 5 minutes.

## Installation

All required dependencies are already installed. No additional setup needed!

## Running the App

```bash
cd doc-review
npm run dev
```

Visit: `http://localhost:6700`

## Quick Demo

### 1. Create Your First Suggestion

**Step 1**: Navigate to a document
```
http://localhost:6700/docs/architecture
```

**Step 2**: Create a review session (first time only)
- Scroll to "Edit Suggestions" panel in sidebar
- Find "Need a new review session?" section
- Enter title: "My First Session"
- Click "Create Session"

**Step 3**: Create a suggestion
- Select "My First Session" from dropdown
- Enter line start: `1`
- Enter line end: `5`
- Enter summary: "Test suggestion"
- Copy first 5 lines from document → paste in "Original Text"
- Make some edits → paste in "Suggested Text"
- Click "Propose Change"

**Done!** Your suggestion appears in the recent suggestions list.

### 2. View All Suggestions

**Step 1**: Click "Review All Suggestions" button (top of page)

**Step 2**: Full-page review interface opens
```
http://localhost:6700/docs/architecture/suggestions
```

**Step 3**: Explore the interface
- See your suggestion in the list
- Click to expand and view the diff
- Try the "Unified" vs "Split" view toggle
- Try the "Collapse" toggle for large diffs

### 3. Review a Suggestion (Requires Reviewer Role)

**Note**: Currently set to `canReview: false` until role support is added.

Once enabled:
- Expand a pending suggestion
- Review the diff
- Click "Approve" or "Reject"
- Status updates immediately
- PR is created automatically on first approval

## Component Usage

### Import Components

```tsx
import {
  DiffViewer,
  SuggestionCard,
  SuggestionReviewPanel,
} from '~/components/suggestions';
```

### Use DiffViewer

```tsx
<DiffViewer
  diffString={suggestion.diff}
  originalText={suggestion.originalText}
  suggestedText={suggestion.suggestedText}
/>
```

### Use SuggestionCard

```tsx
<SuggestionCard
  suggestion={suggestion}
  expanded={false}
  canReview={true}
/>
```

### Use SuggestionReviewPanel

```tsx
<SuggestionReviewPanel
  docPath="architecture.md"
  canReview={true}
/>
```

## API Endpoints

### List Suggestions
```
GET /api/suggestions?docPath=architecture.md&status=pending
```

### Get Single Suggestion
```
GET /api/suggestions/:id
```

### Update Suggestion
```
PATCH /api/suggestions/:id
Body: { status: "approved" }
```

### Create Suggestion
```
POST /api/suggestions
Body: {
  docPath: "architecture.md",
  sessionId: "uuid",
  description: "Fix typo",
  originalText: "...",
  suggestedText: "...",
  lineStart: 10,
  lineEnd: 15
}
```

## File Locations

```
doc-review/
├── app/
│   ├── components/suggestions/
│   │   ├── DiffViewer.tsx              # Diff visualization
│   │   ├── SuggestionCard.tsx          # Individual suggestion
│   │   ├── SuggestionReviewPanel.tsx   # Full review interface
│   │   └── SuggestionsPanel.tsx        # Sidebar panel
│   ├── lib/
│   │   ├── types/suggestion.ts         # TypeScript types
│   │   └── utils/diff-parser.ts        # Diff parsing utilities
│   └── routes/
│       └── docs.$documentId.suggestions.tsx  # Full-page route
```

## Testing Checklist

- [ ] Create a review session
- [ ] Create a suggestion
- [ ] View suggestion in sidebar
- [ ] Click "Review All Suggestions"
- [ ] Expand a suggestion
- [ ] Toggle unified/split view
- [ ] Toggle collapse
- [ ] Copy suggested text
- [ ] Filter by status
- [ ] Use keyboard navigation (j/k/Enter)
- [ ] Test on mobile device

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` | Next suggestion |
| `k` | Previous suggestion |
| `Enter` | Expand/collapse |

## Common Issues

### Suggestion Not Showing

**Cause**: Session required

**Fix**: Create a session first, then create suggestion

### Diff Not Rendering

**Cause**: Missing diff property

**Fix**: Ensure API returns `diff` field in suggestion

### TypeScript Errors

**Cause**: Missing types

**Fix**: Check imports from `~/lib/types/suggestion`

## Development Tips

### Hot Reload

Changes to components reload automatically:
```bash
# Make changes to DiffViewer.tsx
# Save file
# Browser auto-reloads
```

### Type Checking

```bash
npm run typecheck
```

### Building

```bash
npm run build
```

### Linting

```bash
npm run lint
```

## Examples

### Custom Suggestion List

```tsx
import { useFetcher } from 'react-router';
import { SuggestionCard } from '~/components/suggestions';

function MySuggestionList() {
  const fetcher = useFetcher<{ suggestions: Suggestion[] }>();

  useEffect(() => {
    fetcher.load('/api/suggestions?docPath=my-doc.md');
  }, []);

  return (
    <div>
      {fetcher.data?.suggestions.map(suggestion => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          canReview={true}
        />
      ))}
    </div>
  );
}
```

### Filter Suggestions

```tsx
// Filter by status
<SuggestionReviewPanel
  docPath="architecture.md"
  canReview={true}
/>
// User selects "Pending" from dropdown

// Filter by session
const sessionId = "uuid-of-session";
<SuggestionReviewPanel
  sessionId={sessionId}
  canReview={true}
/>
```

### Custom Diff View

```tsx
import { parseUnifiedDiff } from '~/lib/utils/diff-parser';

const diff = parseUnifiedDiff(diffString);
console.log('Hunks:', diff.hunks);
console.log('From:', diff.from);
console.log('To:', diff.to);
```

## Next Steps

1. **Read Full Documentation**
   - `SUGGESTIONS_COMPONENTS.md` - Complete API reference
   - `SUGGESTION_COMPONENTS_GUIDE.md` - Visual guide and workflows

2. **Explore Components**
   - Open components in your editor
   - Read the TypeScript interfaces
   - Understand the props

3. **Customize**
   - Adjust colors in Tailwind classes
   - Modify layout and spacing
   - Add new features

4. **Integrate**
   - Add to other routes
   - Connect to different APIs
   - Build custom workflows

## Resources

- **React Router Docs**: https://reactrouter.com/
- **Tailwind CSS**: https://tailwindcss.com/
- **Lucide Icons**: https://lucide.dev/
- **diff Library**: https://www.npmjs.com/package/diff

## Getting Help

### Debug Mode

Add console logs to understand state:

```tsx
console.log('Suggestion:', suggestion);
console.log('Parsed diff:', parsedDiff);
console.log('Fetcher state:', fetcher.state);
```

### Check Network Tab

View API calls in browser DevTools:
1. Open DevTools (F12)
2. Go to Network tab
3. Filter by "Fetch/XHR"
4. Look for `/api/suggestions` calls

### Check Console

View errors in browser DevTools:
1. Open DevTools (F12)
2. Go to Console tab
3. Look for red error messages

## Performance

All components are optimized:
- Memoized diff parsing
- Lazy loading of suggestions
- Efficient re-renders
- Keyboard navigation

## Browser Support

Tested on:
- Chrome 120+
- Firefox 120+
- Safari 17+
- Edge 120+

## Mobile Support

Fully responsive:
- Touch-friendly buttons
- Scrollable diffs
- Adaptive layouts

## Accessibility

- Keyboard navigation
- Screen reader support
- ARIA labels
- Focus management

## What's Next?

Potential enhancements:
- Role-based permissions (in progress)
- Batch operations
- Inline editing
- Real-time updates
- AI-powered suggestions

---

**Ready to contribute?** Check out the main project README for contribution guidelines.

**Questions?** Open an issue on GitHub.

**Happy reviewing!** 🎉
