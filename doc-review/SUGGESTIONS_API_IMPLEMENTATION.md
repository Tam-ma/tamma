# Suggestions API Implementation

## Overview
This document describes the fully implemented CRUD operations for the Suggestions API with diff generation and PR integration.

## API Endpoints

### 1. GET /api/suggestions - List Suggestions

**Description**: Retrieve a list of suggestions with optional filters and pagination.

**Query Parameters**:
- `docPath` (string): Filter by document path
- `status` (string): Filter by status (pending, approved, rejected, deleted)
- `sessionId` (string): Filter by review session ID
- `userId` (string): Filter by user ID
- `limit` (number): Maximum number of results (default: 50, max: 50)
- `offset` (number): Skip first N results (default: 0)

**Response**:
```json
{
  "suggestions": [
    {
      "id": "uuid",
      "docPath": "docs/example.md",
      "description": "Fix typo",
      "originalText": "teh",
      "suggestedText": "the",
      "lineStart": 10,
      "lineEnd": 10,
      "status": "pending",
      "userId": "user-id",
      "sessionId": "session-id",
      "reviewedBy": null,
      "reviewedAt": null,
      "createdAt": 1234567890,
      "updatedAt": 1234567890,
      "author": {
        "id": "user-id",
        "name": "John Doe",
        "avatarUrl": "https://..."
      },
      "session": {
        "id": "session-id",
        "title": "Review Session",
        "status": "draft",
        "prNumber": 123,
        "prUrl": "https://github.com/..."
      },
      "diff": "--- docs/example.md\n+++ docs/example.md\n@@ -1,1 +1,1 @@\n-teh\n+the"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

### 2. GET /api/suggestions/:id - Get Single Suggestion

**Description**: Retrieve a specific suggestion by ID.

**Response**:
```json
{
  "suggestion": {
    "id": "uuid",
    "docPath": "docs/example.md",
    "description": "Fix typo",
    "originalText": "teh",
    "suggestedText": "the",
    "lineStart": 10,
    "lineEnd": 10,
    "status": "pending",
    "diff": "--- docs/example.md\n+++ docs/example.md\n@@ -1,1 +1,1 @@\n-teh\n+the"
  }
}
```

**Error Responses**:
- `404`: Suggestion not found

### 3. POST /api/suggestions - Create Suggestion

**Description**: Create a new suggestion.

**Request Body**:
```json
{
  "docPath": "docs/example.md",
  "description": "Fix typo (optional)",
  "originalText": "teh",
  "suggestedText": "the",
  "lineStart": 10,
  "lineEnd": 10,
  "sessionId": "session-id (optional)"
}
```

**Response** (201 Created):
```json
{
  "suggestion": {
    "id": "new-uuid",
    "docPath": "docs/example.md",
    "description": "Fix typo",
    "originalText": "teh",
    "suggestedText": "the",
    "lineStart": 10,
    "lineEnd": 10,
    "status": "pending",
    "diff": "--- docs/example.md\n+++ docs/example.md\n@@ -1,1 +1,1 @@\n-teh\n+the"
  },
  "ok": true
}
```

**Error Responses**:
- `400`: Validation error (missing required fields)
- `404`: Review session not found (if sessionId provided)

### 4. PATCH /api/suggestions/:id - Update Suggestion

**Description**: Update a suggestion's description or status. Approving a suggestion creates/updates a PR.

**Request Body**:
```json
{
  "description": "Updated description (optional)",
  "status": "approved | rejected | pending (optional)"
}
```

**Response**:
```json
{
  "suggestion": {
    "id": "uuid",
    "status": "approved",
    "reviewedBy": "reviewer-id",
    "reviewedAt": 1234567890
  },
  "ok": true
}
```

**Special Behaviors**:
- When status is changed to "approved":
  - Sets `reviewedBy` and `reviewedAt` fields
  - Creates or updates PR via GitHub API if sessionId exists
  - Applies suggestion as a patch to the session's branch
- When status is changed to "rejected":
  - Sets `reviewedBy` and `reviewedAt` fields
  - No PR is created

**Error Responses**:
- `400`: Validation error
- `403`: Unauthorized (only reviewers/admins can change status)
- `404`: Suggestion not found

### 5. DELETE /api/suggestions/:id - Delete Suggestion

**Description**: Soft delete a suggestion by setting `deletedAt` timestamp.

**Response**:
```json
{
  "message": "Suggestion deleted successfully.",
  "ok": true
}
```

**Error Responses**:
- `403`: Unauthorized (must own suggestion or be admin/reviewer)
- `404`: Suggestion not found

## Database Schema

```typescript
export const suggestions = sqliteTable('suggestions', {
  id: text('id').primaryKey(),
  docPath: text('doc_path').notNull(),
  lineStart: integer('line_start').notNull(),
  lineEnd: integer('line_end').notNull(),
  originalText: text('original_text').notNull(),
  suggestedText: text('suggested_text').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: integer('reviewed_at', { mode: 'number' }),
  userId: text('user_id').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
});
```

## Key Features

### 1. Diff Generation
Every suggestion includes a unified diff showing the exact changes:
```javascript
import * as Diff from 'diff';

const diff = Diff.createPatch(
  docPath,
  originalText,
  suggestedText,
  'original',
  'suggested'
);
```

### 2. PR Integration
When a suggestion is approved and has a sessionId:
1. Gets the review session details
2. Initializes the GitHub provider
3. Creates a diff patch
4. Applies the patch to the session's branch
5. Creates or updates the PR if not already exists

### 3. Soft Delete
Deletions don't remove data but set a `deletedAt` timestamp:
- All queries filter out soft-deleted items using `isNull(suggestions.deletedAt)`
- Preserves audit trail and allows recovery

### 4. Authorization
- **Create**: Any authenticated user
- **Read**: Any authenticated user
- **Update Description**: Suggestion owner or admin/reviewer
- **Update Status**: Only admin/reviewer roles
- **Delete**: Suggestion owner or admin/reviewer

### 5. Input Validation
Uses dedicated validators for each operation:
- `validateSuggestionPayload` - For creation
- `validateSuggestionUpdatePayload` - For updates
- Ensures required fields are present
- Validates status values
- Returns clear error messages

## Integration with Review Sessions

When a suggestion is linked to a review session (via `sessionId`):
1. The document must be part of the session's `docPaths`
2. Approved suggestions are automatically added to the session's PR
3. The PR is created as a draft initially
4. Multiple suggestions can be batched into a single PR

## GitHub Provider Integration

The system uses the `GitHubProvider` class to:
1. Create branches for review sessions
2. Apply suggestion patches to branches
3. Create pull requests
4. Track PR status

Example flow:
```javascript
const provider = getGitProvider(env);
const result = await provider.appendSuggestionPatch({
  sessionId: suggestion.sessionId,
  docPath: suggestion.docPath,
  diff: generatedDiff
});
```

## Error Handling

All operations include comprehensive error handling:
- Validation errors return 400
- Authentication errors return 401
- Authorization errors return 403
- Not found errors return 404
- Server errors return 500
- Database unavailable returns 503

## Testing

A comprehensive test suite is provided in `api.suggestions.test.ts`:
- Tests all CRUD operations
- Validates authorization checks
- Tests diff generation
- Mocks database and external dependencies
- Achieves high code coverage

## Migration

The database schema includes a migration that:
1. Adds `deletedAt` field to suggestions table
2. Makes `sessionId` nullable
3. Adds soft delete support to related tables

Run migrations with:
```bash
npm run db:generate  # Generate migration files
npm run db:migrate:local  # Apply locally
npm run db:migrate  # Apply to production
```

## Usage Examples

### Create a suggestion
```bash
curl -X POST http://localhost:5173/api/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "docPath": "docs/example.md",
    "description": "Fix typo",
    "originalText": "teh quick brown fox",
    "suggestedText": "the quick brown fox",
    "lineStart": 10,
    "lineEnd": 10
  }'
```

### Approve a suggestion
```bash
curl -X PATCH http://localhost:5173/api/suggestions/uuid-here \
  -H "Content-Type: application/json" \
  -d '{
    "status": "approved"
  }'
```

### List suggestions for a document
```bash
curl "http://localhost:5173/api/suggestions?docPath=docs/example.md&status=pending"
```

## Future Enhancements

1. **Batch Operations**: Apply multiple suggestions at once
2. **Conflict Resolution**: Handle overlapping suggestions
3. **Version Control**: Track suggestion history
4. **Real-time Updates**: WebSocket/SSE for live updates
5. **AI Integration**: Auto-generate suggestions using AI
6. **Metrics**: Track suggestion acceptance rate
7. **Export**: Download suggestions as patch files