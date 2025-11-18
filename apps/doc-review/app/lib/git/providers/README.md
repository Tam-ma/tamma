# Git Provider Implementation

## Overview

This directory contains Git provider implementations for the documentation review system. Currently implemented:

- **GitHubProvider**: Full GitHub API integration using REST and GraphQL APIs
- **StubGitProvider**: Mock provider for testing without API access

## GitHub Provider

The `GitHubProvider` class implements real GitHub API operations for the documentation review system.

### Features

- **Pull Request Management**: Create and manage draft PRs for documentation review sessions
- **File Operations**: Read, write, and list files from GitHub repositories
- **Branch Management**: Create branches for review sessions
- **Comment Integration**: Fetch and display PR comments
- **Blame Information**: Get line-level authorship information via GraphQL
- **Caching**: Optional KV namespace caching for improved performance

### Configuration

Set these environment variables in `wrangler.jsonc` or `.dev.vars`:

```jsonc
{
  "vars": {
    "GIT_PROVIDER": "github",        // Enable GitHub provider
    "GIT_OWNER": "your-org",         // GitHub organization or username
    "GIT_REPO": "your-repo",         // Repository name
    "GIT_DEFAULT_BRANCH": "main"     // Default branch name
  }
}
```

### Authentication

The GitHub provider requires a personal access token with the following scopes:

- `repo` - Full repository access (required for private repos)
- `public_repo` - Public repository access (for public repos only)

Set the token as a secret:

```bash
# For local development
echo "GITHUB_TOKEN=ghp_your_token_here" >> .dev.vars

# For production
pnpm wrangler secret put GITHUB_TOKEN
# or
pnpm wrangler secret put GIT_TOKEN
```

### API Methods

#### Core Provider Interface

```typescript
interface GitProvider {
  // Ensure a PR exists for a documentation review session
  ensureSessionPullRequest(input: {
    sessionId: string;
    title: string;
    summary?: string | null;
    docPaths: string[];
  }): Promise<GitPullRequestMeta>;

  // Apply suggested changes to documents
  appendSuggestionPatch(input: {
    sessionId: string;
    docPath: string;
    diff: string;
  }): Promise<{ status: 'queued' | 'committed'; branch: string }>;

  // List comments on the PR
  listPullRequestComments(sessionId: string): Promise<GitReviewComment[]>;
}
```

#### Additional GitHub-specific Methods

The implementation also includes these methods matching the `IGitProvider` interface:

- `getFile(path, ref?)` - Fetch file content
- `listFiles(directory, ref?)` - List directory contents
- `createBranch(name, fromRef)` - Create a new branch
- `createPullRequest(params)` - Create a pull request
- `getPullRequest(number)` - Get PR details
- `listPullRequests(options?)` - List PRs with filters
- `getBlame(path, ref?)` - Get blame information (via GraphQL)

### Usage Example

```typescript
import { GitHubProvider } from './providers/github';

const provider = new GitHubProvider({
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GIT_OWNER: 'meywd',
  GIT_REPO: 'tamma',
  GIT_DEFAULT_BRANCH: 'main',
  CACHE: env.CACHE, // Optional KV namespace
});

// Create a PR for a review session
const pr = await provider.ensureSessionPullRequest({
  sessionId: 'session-123',
  title: 'Documentation Review: API Guide',
  summary: 'Review and update API documentation',
  docPaths: ['docs/api/index.md', 'docs/api/authentication.md'],
});

console.log(`Created PR #${pr.prNumber}: ${pr.prUrl}`);

// Apply suggested changes
const result = await provider.appendSuggestionPatch({
  sessionId: 'session-123',
  docPath: 'docs/api/index.md',
  diff: '...' // Unified diff format
});

// Get PR comments
const comments = await provider.listPullRequestComments('session-123');
```

### Error Handling

The provider includes comprehensive error handling:

- Network errors with retry logic (TODO: implement exponential backoff)
- API rate limiting detection
- Authentication failures
- Resource not found errors
- Detailed error messages with GitHub API documentation links

### Caching Strategy

When a KV namespace is provided, the provider caches:

- Pull request metadata (24-hour TTL)
- Branch existence checks
- File content (with SHA validation)

Cache keys follow the pattern: `github-pr:{sessionId}`

### GraphQL Operations

The provider uses GitHub's GraphQL API for operations not available in REST:

- **Blame information**: Line-level authorship data
- **Advanced queries**: Complex repository queries

### Security Considerations

- Tokens are never logged or exposed in error messages
- All API requests use HTTPS
- Branch names are sanitized to prevent injection
- File paths are validated before operations

## Adding New Providers

To add support for a new Git platform:

1. Create a new file: `providers/{platform}.ts`
2. Implement the `GitProvider` interface from `../types.ts`
3. Add platform-specific configuration handling
4. Update `provider.server.ts` to include the new provider
5. Document configuration and authentication requirements

### Provider Template

```typescript
import type { GitProvider } from '../types';

export class MyGitProvider implements GitProvider {
  constructor(private config: MyProviderConfig) {
    // Initialize API client
  }

  async ensureSessionPullRequest(input) {
    // Implementation
  }

  async appendSuggestionPatch(input) {
    // Implementation
  }

  async listPullRequestComments(sessionId) {
    // Implementation
  }
}
```

## Testing

### Unit Tests

Run provider tests:

```bash
pnpm test providers/github.test.ts
```

### Integration Tests

With real GitHub API (requires token):

```bash
GITHUB_TOKEN=ghp_xxx pnpm test:integration
```

### Manual Testing

1. Set up `.dev.vars`:
   ```
   GITHUB_TOKEN=ghp_your_token
   GIT_PROVIDER=github
   GIT_OWNER=your-username
   GIT_REPO=test-repo
   ```

2. Run development server:
   ```bash
   pnpm dev
   ```

3. Test endpoints:
   - Create review session
   - Upload documents
   - Make suggestions
   - View PR

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check token validity and scopes
2. **404 Not Found**: Verify owner/repo configuration
3. **422 Unprocessable Entity**: Branch may already exist
4. **Rate Limiting**: Implement caching or use GraphQL

### Debug Mode

Enable debug logging:

```typescript
const provider = new GitHubProvider({
  // ... config
  debug: true, // TODO: implement debug logging
});
```

## Future Enhancements

- [ ] GitLab provider implementation
- [ ] Bitbucket provider implementation
- [ ] Azure DevOps provider implementation
- [ ] Exponential backoff for retries
- [ ] Webhook support for real-time updates
- [ ] Advanced diff application algorithms
- [ ] Batch operations for performance
- [ ] Provider health checks
- [ ] Metrics and monitoring

## License

Part of the Tamma project. See main repository for license details.