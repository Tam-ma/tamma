# Line-Level Commenting Components

React components for adding line-level commenting functionality to markdown documents.

## Components

### MarkdownRendererWithComments

Main component that renders a document with line-level commenting support.

```tsx
import { MarkdownRendererWithComments } from '~/components/MarkdownRendererWithComments';

<MarkdownRendererWithComments document={document} />
```

**Features:**
- Displays document content split by lines
- Shows line numbers with comment indicators
- Automatically loads and organizes comments by line
- Handles comment updates and refreshes

### LineWithComments

Wrapper component that combines a line of content with its comments.

**Props:**
- `lineNumber: number` - Line number
- `content: string` - Line content
- `comments: Comment[]` - Comments for this line
- `docPath: string` - Document path
- `onCommentsUpdated?: () => void` - Callback when comments are updated

**Features:**
- Toggleable comment UI
- Shows all threads for the line
- Allows adding new comments

### LineNumberGutter

Displays line numbers with visual indicators for comments.

**Props:**
- `lineNumber: number` - Line number to display
- `hasComments: boolean` - Whether line has comments
- `commentCount: number` - Number of top-level comments
- `isSelected: boolean` - Whether line is selected
- `onClick: () => void` - Click handler

**Features:**
- Visual comment indicators (badge with count)
- Hover state showing comment icon
- Keyboard accessible (Enter/Space)
- Selected state highlighting

### CommentThread

Displays a parent comment with nested replies.

**Props:**
- `comment: Comment` - Parent comment
- `replies: Comment[]` - Reply comments
- `docPath: string` - Document path
- `lineContent: string` - Content of the line being commented on
- `onReplySuccess?: () => void` - Callback when reply is successful

**Features:**
- Shows author avatar, name, timestamp
- Threaded reply display
- Reply button to add nested comments
- Resolve button for parent comments
- Actions menu (reply, resolve, delete)
- "Resolved" badge display

### CommentForm

Form for creating new comments or replies.

**Props:**
- `docPath: string` - Document path
- `lineNumber: number` - Line number
- `lineContent: string` - Content of the line
- `parentId?: string` - Parent comment ID (for replies)
- `onCancel: () => void` - Cancel handler
- `onSuccess?: () => void` - Success callback

**Features:**
- Markdown editor with preview
- Real-time preview tab
- Shows line content context
- Loading states
- Error handling
- Optimistic UI updates via useFetcher

### CommentItem

Internal component used by CommentThread to render individual comments.

**Features:**
- Author information display
- Timestamp with "time ago" formatting
- "Edited" indicator
- "Resolved" badge
- Actions dropdown menu
- Markdown rendering for content

## Type Definitions

### Comment

```typescript
interface Comment {
  id: string;
  docPath: string;
  content: string;
  lineNumber: number | null;
  lineContent: string | null;
  resolved: boolean;
  userId: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  author?: {
    id: string | null;
    name: string | null;
    avatarUrl: string | null;
    role: string | null;
  };
}
```

### CommentThread

```typescript
interface CommentThread {
  parentComment: Comment;
  replies: Comment[];
}
```

### CommentsByLine

```typescript
interface CommentsByLine {
  [lineNumber: number]: CommentThread[];
}
```

## API Integration

All components use React Router's `useFetcher` for API calls:

### Fetch Comments
```
GET /api/comments?docPath={path}&lineNumber={number}
```

### Create Comment
```
POST /api/comments
Body: {
  docPath: string;
  lineNumber: number;
  lineContent: string;
  content: string;
  parentId?: string;
}
```

### Update Comment (Resolve)
```
PATCH /api/comments/{id}
Body: {
  resolved: boolean;
}
```

## Styling

All components use Tailwind CSS classes. Key design choices:

- **Colors:** Slate palette for neutral UI
- **Accents:** Blue for selected states, Amber for comment indicators, Green for resolved
- **Typography:** Font-mono for line numbers and code, prose classes for markdown
- **Spacing:** Consistent padding and gaps for clean layout
- **Transitions:** Smooth hover and state transitions
- **Icons:** Lucide React icons (MessageCircle, CheckCircle, Reply, etc.)

## Accessibility

- Keyboard navigation support (Tab, Enter, Space)
- ARIA labels for screen readers
- Semantic HTML structure
- Focus management
- Proper button/link roles

## Example Usage

See `/app/routes/docs.$documentId.with-comments.tsx` for a complete example of integrating line-level comments into a document viewer.

## Dependencies

- `react-router` - For data fetching and form handling
- `react-markdown` - For markdown rendering
- `remark-gfm` - For GitHub Flavored Markdown support
- `lucide-react` - For icons
- `tailwindcss` - For styling
