# Search User Guide

## Overview

The doc-review platform provides a powerful full-text search system that allows you to quickly find content across documents, comments, suggestions, and discussions. This guide will help you make the most of the search features.

## Quick Start

### Basic Search

1. **Using the Search Bar**
   - Click on the search bar at the top of any page
   - Or press `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux) to focus the search bar
   - Type your search query and press Enter

2. **Search Page**
   - Navigate to `/search` for the full search experience
   - Access advanced filters and sorting options
   - View detailed results with context highlighting

## Search Features

### 1. Full-Text Search

Search across all content types:
- **Documents** - Search document titles and content
- **Comments** - Find specific discussions in comments
- **Suggestions** - Locate edit suggestions
- **Discussions** - Search discussion threads
- **Messages** - Find messages within discussions

### 2. Autocomplete & Suggestions

As you type, the search bar provides:
- **Popular searches** (🔥) - Frequently searched terms
- **Recent searches** (🕐) - Your search history
- **Document titles** (📄) - Matching documents
- **Author names** (👤) - Search by author with `author:name`

### 3. Search Operators

#### Phrase Search
Use quotes for exact phrase matching:
```
"product requirements"
```

#### Prefix Search
Use asterisk for prefix matching:
```
arch*
```
This will match: architecture, architect, archive, etc.

#### Boolean Operators
Combine terms with AND, OR, NOT:
```
architecture AND microservices
deployment NOT kubernetes
frontend OR backend
```

### 4. Filters

Apply filters to narrow your search:

#### Filter by Type
- `type:comments` - Only search comments
- `type:suggestions` - Only search suggestions
- `type:discussions` - Only search discussions
- `type:documents` - Only search documents

#### Filter by Document
- `docPath:/docs/PRD.md` - Search within a specific document

#### Filter by Author
- `author:john` - Find content by a specific author
- `userId:user-123` - Search by user ID

#### Filter by Status
- `status:open` - Open items
- `status:pending` - Pending suggestions
- `status:resolved` - Resolved comments
- `status:approved` - Approved suggestions
- `status:rejected` - Rejected suggestions

#### Filter by Date
- `after:2024-01-01` - Content created after date
- `before:2024-12-31` - Content created before date

#### Filter by Resolution (Comments)
- `resolved:true` - Only resolved comments
- `resolved:false` - Only unresolved comments

### 5. Advanced Search Syntax

#### Field-Specific Search
Target specific fields in your search:
```
title:architecture         # Search only in titles
content:microservices      # Search only in content
author:jane                # Search by author name
```

#### Combining Filters
Use multiple filters together:
```
microservices type:documents status:open after:2024-01-01
```

## Search Results

### Understanding Results

Each search result shows:
- **Type Icon** - Visual indicator of content type
  - 📄 Document
  - 💬 Comment
  - ✏️ Suggestion
  - 🗣️ Discussion
  - 📨 Message
- **Title/Content** - The main content with highlighted matches
- **Status Badge** - Current status (if applicable)
- **Metadata** - Author, document path, creation date
- **Relevance Score** - How well the result matches your query

### Result Ranking

Results are ranked by:
1. **Relevance** - How well the content matches your query
2. **Match Location** - Title matches rank higher than content matches
3. **Recency** - Newer content ranks higher for similar relevance
4. **Content Type** - Documents typically rank higher than comments

### Highlighted Matches

Search terms are highlighted in results:
- **[highlighted]** - Your search terms appear in brackets
- Context is shown around matches for better understanding

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search bar |
| `Enter` | Execute search |
| `Escape` | Clear search / Close suggestions |
| `↑ / ↓` | Navigate autocomplete suggestions |
| `Tab` | Accept selected suggestion |

## Search Tips & Best Practices

### 1. Start Broad, Then Narrow
Begin with general terms, then use filters to refine:
```
1. Search: "authentication"
2. Add filter: type:documents
3. Add filter: after:2024-01-01
```

### 2. Use Autocomplete
Let autocomplete guide you to popular searches and correct spelling.

### 3. Save Common Searches
Frequently used searches appear in your history and popular searches.

### 4. Combine Search Techniques
Mix different search features for precise results:
```
"user authentication" type:documents author:security-team status:approved
```

### 5. Check No-Results Queries
If you get no results:
- Check spelling
- Try broader terms
- Remove some filters
- Use wildcards (e.g., `auth*` instead of `authentication`)

## Search Performance

### Response Times
- Most searches complete in **<200ms**
- Complex queries with multiple filters may take up to **500ms**
- Autocomplete suggestions appear within **100ms**

### Limits
- **Query Length**: Maximum 1000 characters
- **Results per Page**: 20 (paginated)
- **Autocomplete Suggestions**: 10
- **Search History**: Last 100 searches saved

## Privacy & Data

### What's Tracked
- Search queries (for analytics and suggestions)
- Click-through data (to improve ranking)
- Response times (for performance monitoring)

### What's NOT Tracked
- Searches are not associated with sensitive data
- Private document searches remain confidential
- Search history can be cleared anytime

### Data Retention
- Search queries: 90 days
- Popular searches: Updated continuously
- Personal history: Last 100 searches

## Troubleshooting

### No Results Found
- Check spelling and typos
- Try simpler search terms
- Remove filters one by one
- Use wildcards for partial matches

### Slow Search
- Simplify complex queries
- Reduce the number of filters
- Try searching during off-peak hours

### Missing Content
- Content may not be indexed yet
- Check if the document exists
- Verify you have access permissions

### Incorrect Results
- Use quotes for exact phrases
- Add more specific terms
- Use filters to exclude unwanted types

## Admin Features

Administrators have access to additional search features:

### Search Analytics Dashboard
- View top searches
- Monitor no-results queries
- Track search performance
- Analyze user behavior

### Maintenance Tools
- Re-index all content
- Clear old search data
- Monitor index health
- Performance optimization

### Access Admin Dashboard
Navigate to `/admin/search` (admin role required)

## Examples

### Example 1: Find Recent Comments on a Document
```
type:comments docPath:/docs/architecture.md after:2024-11-01
```

### Example 2: Search for Pending Suggestions by Author
```
type:suggestions status:pending author:john
```

### Example 3: Find Discussions About Security
```
security type:discussions status:open
```

### Example 4: Locate Specific Error Messages
```
"TypeError: Cannot read property" type:comments
```

### Example 5: Find All Content from Last Week
```
after:2024-11-06 before:2024-11-13
```

## API Access

For programmatic access, use the Search API:

### Endpoint
```
GET /api/search
```

### Parameters
- `q` - Search query (required)
- `type` - Filter by type
- `docPath` - Filter by document
- `userId` - Filter by user
- `status` - Filter by status
- `before` - Before date
- `after` - After date
- `limit` - Results per page (max 100)
- `offset` - Pagination offset

### Example Request
```bash
curl "https://your-domain.com/api/search?q=authentication&type=documents&limit=10"
```

### Response Format
```json
{
  "results": [...],
  "total": 42,
  "facets": {
    "types": {...},
    "statuses": {...},
    "authors": [...]
  }
}
```

## Getting Help

If you need assistance with search:
1. Check this user guide
2. Try the search tips above
3. Contact support with specific queries
4. Report bugs or feature requests

## Updates & Improvements

The search system is continuously improved based on:
- User feedback
- Search analytics
- Performance metrics
- New feature requests

Check back regularly for updates to search capabilities!