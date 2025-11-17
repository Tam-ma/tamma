# Comments API Documentation

## Overview
The Comments API provides full CRUD operations for managing document comments with support for threading, line-specific comments, and soft deletion.

## Authentication
All endpoints require authentication. The API uses session-based authentication via cookies.

## Base URL
- Development: `http://localhost:8788/api/comments`
- Production: `https://your-domain.com/api/comments`

## Data Model

### Comment Object
```typescript
{
  id: string;                  // UUID
  docPath: string;             // Path to the document
  content: string;             // Comment text
  lineNumber?: number;         // Optional line number for line-specific comments
  lineContent?: string;        // Optional content of the referenced line
  resolved: boolean;           // Whether the comment is resolved
  userId: string;              // ID of the comment author
  parentId?: string;           // ID of parent comment for threading
  createdAt: number;           // Unix timestamp
  updatedAt: number;           // Unix timestamp
  deletedAt?: number;          // Unix timestamp (soft delete)
  author: {                    // Author information
    id: string;
    name: string;
    avatarUrl?: string;
    role: string;
  }
}
```

## Endpoints

### 1. List Comments
**GET** `/api/comments`

Retrieve a list of comments with optional filtering and pagination.

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| docPath | string | Filter by document path | - |
| lineNumber | number | Filter by line number | - |
| userId | string | Filter by user ID | - |
| parentId | string | Filter by parent comment ID (use "null" for top-level) | - |
| includeDeleted | boolean | Include soft-deleted comments | false |
| limit | number | Maximum number of results (max 100) | 50 |
| offset | number | Number of results to skip | 0 |

#### Response
```json
{
  "comments": [/* array of comment objects */],
  "pagination": {
    "total": 100,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

#### Example
```bash
# Get all comments for a document
curl -X GET "/api/comments?docPath=/docs/example.md"

# Get comments for a specific line
curl -X GET "/api/comments?docPath=/docs/example.md&lineNumber=42"

# Get top-level comments only
curl -X GET "/api/comments?docPath=/docs/example.md&parentId=null"

# Get replies to a specific comment
curl -X GET "/api/comments?parentId=comment-uuid"

# Paginated results
curl -X GET "/api/comments?docPath=/docs/example.md&limit=20&offset=40"
```

### 2. Get Single Comment
**GET** `/api/comments/:id`

Retrieve a single comment by ID.

#### Response
```json
{
  "comment": {/* comment object */}
}
```

#### Example
```bash
curl -X GET "/api/comments/550e8400-e29b-41d4-a716-446655440000"
```

### 3. Create Comment
**POST** `/api/comments`

Create a new comment.

#### Request Body
```json
{
  "docPath": "/docs/example.md",    // Required
  "content": "This is a comment",   // Required
  "lineNumber": 42,                 // Optional
  "lineContent": "const x = 10;",   // Optional
  "parentId": "parent-comment-id"   // Optional (for threading)
}
```

#### Response
```json
{
  "comment": {/* created comment object */},
  "ok": true
}
```

Status: `201 Created`

#### Example
```bash
# Create a document-level comment
curl -X POST "/api/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "docPath": "/docs/example.md",
    "content": "Great documentation!"
  }'

# Create a line-specific comment
curl -X POST "/api/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "docPath": "/docs/example.md",
    "content": "This line needs clarification",
    "lineNumber": 42,
    "lineContent": "const x = 10;"
  }'

# Create a reply to another comment
curl -X POST "/api/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "docPath": "/docs/example.md",
    "content": "I agree with this suggestion",
    "parentId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### 4. Update Comment
**PATCH** `/api/comments/:id`

Update an existing comment. Only the comment owner can update their comments.

#### Request Body
```json
{
  "content": "Updated comment text",  // Optional
  "resolved": true                    // Optional
}
```

At least one field must be provided.

#### Response
```json
{
  "comment": {/* updated comment object */},
  "ok": true
}
```

#### Example
```bash
# Update comment text
curl -X PATCH "/api/comments/550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated comment text"
  }'

# Mark comment as resolved
curl -X PATCH "/api/comments/550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{
    "resolved": true
  }'

# Update both content and resolved status
curl -X PATCH "/api/comments/550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Issue has been fixed",
    "resolved": true
  }'
```

### 5. Delete Comment
**DELETE** `/api/comments/:id`

Soft delete a comment. Only the comment owner can delete their comments.

#### Response
```json
{
  "message": "Comment deleted successfully.",
  "ok": true
}
```

#### Example
```bash
curl -X DELETE "/api/comments/550e8400-e29b-41d4-a716-446655440000"
```

## Error Responses

All error responses follow this format:
```json
{
  "error": "Error message describing what went wrong"
}
```

### Common Error Status Codes
- `400 Bad Request` - Invalid request parameters or body
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - User lacks permission for this action
- `404 Not Found` - Comment or resource not found
- `405 Method Not Allowed` - HTTP method not supported
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Database not configured

## Features

### Comment Threading
Comments support threading through the `parentId` field. When creating a reply:
1. Set `parentId` to the ID of the comment you're replying to
2. The `docPath` must match the parent comment's document
3. Retrieve replies using `GET /api/comments?parentId=<comment-id>`

### Line-Specific Comments
Comments can be attached to specific lines in a document:
1. Set `lineNumber` when creating the comment
2. Optionally include `lineContent` to store the line's content
3. Filter line comments using `GET /api/comments?lineNumber=<number>`

### Soft Deletion
Comments are soft-deleted, meaning they're marked as deleted but not removed from the database:
1. Deleted comments have a `deletedAt` timestamp
2. By default, deleted comments are excluded from queries
3. Include deleted comments with `includeDeleted=true` query parameter

### Comment Resolution
Comments can be marked as resolved to indicate that an issue has been addressed:
1. Use the PATCH endpoint to set `resolved: true`
2. Filter resolved/unresolved comments on the client side

### Pagination
List endpoints support pagination for large result sets:
1. Use `limit` to control the number of results (max 100)
2. Use `offset` to skip results for pagination
3. Check `pagination.hasMore` to determine if more pages exist

## Rate Limiting
The API implements rate limiting to prevent abuse. Current limits:
- 100 requests per minute per user for read operations
- 30 requests per minute per user for write operations

## Best Practices

1. **Always specify docPath** when listing comments to improve performance
2. **Use pagination** for large comment threads
3. **Implement optimistic updates** on the client for better UX
4. **Cache comment lists** and invalidate on create/update/delete
5. **Handle errors gracefully** and show meaningful messages to users
6. **Use threading** for discussions rather than creating many top-level comments
7. **Resolve comments** when issues are addressed to keep discussions organized