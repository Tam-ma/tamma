# Doc Review - Integration Test Suite

Comprehensive integration tests for all API endpoints using Vitest.

## Overview

This test suite provides complete coverage for the doc-review application's API layer, including:

- **Comments API** - Creating, reading, updating, and deleting comments with threading support
- **Suggestions API** - Managing document change suggestions with diff generation
- **Discussions API** - Discussion threads for collaborative review
- **Discussion Messages API** - Messages within discussion threads
- **Sessions API** - Review session management

## Test Structure

```
app/test/
├── setup.ts                    # Global test setup and teardown
├── helpers/
│   ├── auth-helpers.ts        # Authentication mocking utilities
│   ├── db-helpers.ts          # Database test utilities
│   ├── request-helpers.ts     # HTTP request helpers
│   └── fixtures.ts            # Test data fixtures
└── README.md                  # This file

app/routes/
├── api.comments.test.ts               # Comments API tests
├── api.comments.$id.test.ts           # Single comment operations (included in comments.test.ts)
├── api.suggestions.test.ts            # Suggestions API tests
├── api.discussions.test.ts            # Discussions API tests
├── api.discussions.messages.test.ts   # Discussion messages API tests
└── api.sessions.test.ts               # Sessions API tests
```

## Running Tests

### All Tests
```bash
npm test                    # Run all tests in watch mode
npm run test:run            # Run all tests once
```

### Specific Test Types
```bash
npm run test:unit           # Run unit tests only
npm run test:integration    # Run integration tests only
npm run test:watch          # Run tests in watch mode
```

### Coverage
```bash
npm run test:coverage       # Generate coverage report
npm run test:coverage:ui    # Open coverage UI
```

### UI Mode
```bash
npm run test:ui             # Open Vitest UI for interactive testing
```

## Coverage Targets

- **Lines**: 80% minimum
- **Functions**: 75% minimum
- **Branches**: 75% minimum
- **Statements**: 80% minimum

Coverage is enforced on:
- All API routes (`app/routes/api.*`)
- All library code (`app/lib/**`)

Coverage excludes:
- Test files
- Type definitions
- Database schemas

## Test Helpers

### Authentication Helpers

```typescript
import { createTestUser, mockAuth, mockAuthMiddleware } from '../test/helpers/auth-helpers';

// Create test users
const user = createTestUser({ role: 'editor' });
const users = createTestUsers(); // { viewer, editor, reviewer, admin }

// Mock authentication
mockAuth(user);
mockAuthMiddleware.asAdmin();
mockAuthMiddleware.asReviewer();
mockAuthMiddleware.asEditor();
mockAuthMiddleware.asViewer();
mockAuthMiddleware.asUnauthenticated();
```

### Database Helpers

```typescript
import {
  getTestDatabase,
  cleanupTestDatabase,
  seedTestData,
  getTestRecords,
  assertRecordExists,
  assertRecordCount,
} from '../test/helpers/db-helpers';

// Seed test data
await seedTestData({
  users: [user],
  comments: [comment1, comment2],
  suggestions: [suggestion1],
});

// Query test data
const comments = getTestRecords('comments', { userId: 'user-001' });

// Assert data state
assertRecordExists('comments', 'comment-001');
assertRecordCount('comments', 5);
```

### Request Helpers

```typescript
import {
  createGetRequest,
  createPostRequest,
  createPatchRequest,
  createDeleteRequest,
  createTestContext,
  parseResponse,
} from '../test/helpers/request-helpers';

// Create requests
const request = createGetRequest('/api/comments', { docPath: 'docs/test.md' });
const request = createPostRequest('/api/comments', { content: 'Test comment' });
const request = createPatchRequest('/api/comments/123', { resolved: true });
const request = createDeleteRequest('/api/comments/123');

// Create context
const context = createTestContext({ env: { DB: mockDb } });

// Parse response
const data = await parseResponse(response);
```

### Fixtures

```typescript
import {
  createTestComment,
  createTestSuggestion,
  createTestDiscussion,
  createTestDiscussionMessage,
  createTestReviewSession,
  createThreadedComments,
  createCompleteTestDataset,
} from '../test/helpers/fixtures';

// Create individual fixtures
const comment = createTestComment({ content: 'Custom comment' });
const suggestion = createTestSuggestion({ status: 'approved' });
const discussion = createTestDiscussion({ status: 'open' });
const session = createTestReviewSession({ docPaths: ['docs/test.md'] });

// Create threaded comments
const [parent, reply1, reply2] = createThreadedComments({}, 2);

// Create complete dataset
const dataset = createCompleteTestDataset();
```

## Writing Tests

### Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.comments';
import { createTestUser, mockAuth } from '../test/helpers/auth-helpers';
import { createGetRequest, parseResponse } from '../test/helpers/request-helpers';

describe('Comments API Integration Tests', () => {
  let testUser: any;

  beforeEach(() => {
    vi.clearAllMocks();
    testUser = createTestUser({ role: 'editor' });
    mockAuth(testUser);
  });

  describe('GET /api/comments', () => {
    it('should list comments', async () => {
      const request = createGetRequest('/api/comments');
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.comments).toBeDefined();
    });
  });
});
```

### Test Categories

Each API test file should include:

1. **GET (List) Tests**
   - Empty results
   - Filtering by various parameters
   - Pagination
   - Soft-deleted record exclusion
   - Database error handling

2. **POST (Create) Tests**
   - Successful creation
   - Validation errors
   - Authorization checks
   - Related entity verification

3. **GET (Single) Tests**
   - Successful retrieval
   - 404 for non-existent records
   - Soft-deleted record handling

4. **PATCH/PUT (Update) Tests**
   - Successful updates
   - Authorization checks (owner vs. admin)
   - Validation errors
   - 404 for non-existent records

5. **DELETE Tests**
   - Successful soft deletion
   - Authorization checks
   - 404 for non-existent records

6. **Business Logic Tests**
   - Specific workflow scenarios
   - Complex relationships
   - State transitions

7. **Error Handling Tests**
   - Database errors
   - Validation errors
   - Permission violations
   - Missing database configuration

## Mock Strategy

### Authentication Mocking
- Mock `requireAuth` and `requireAuthWithRole` to return test users
- Mock `syncUserRecord` to avoid database writes

### Database Mocking
- Use in-memory test database for state tracking
- Mock Drizzle ORM query builder methods
- Track insertions, updates, and deletions in test state

### External Service Mocking
- Mock Git provider for PR creation
- Mock KV storage for session data

## Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Cleanup**: Use `beforeEach`/`afterEach` to reset state between tests
3. **Determinism**: Use fixed IDs and timestamps for predictable results
4. **Clear Naming**: Test names should describe the behavior being tested
5. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification
6. **Mock Minimally**: Only mock what's necessary for the test
7. **Test Edge Cases**: Include boundary conditions, empty states, and error scenarios

## Common Patterns

### Testing Authorization

```typescript
it('should prevent unauthorized updates', async () => {
  const resource = createTestComment({ userId: 'other-user' });
  mockDb.get.mockResolvedValue(resource);

  const request = createPatchRequest('/api/comments/123', { content: 'Hacked' });
  const context = createTestContext();

  const response = await action({ request, context, params: { id: '123' } });
  const data = await parseResponse(response);

  expect(response.status).toBe(403);
  expect(data.error).toContain('not authorized');
});
```

### Testing Validation

```typescript
it('should validate required fields', async () => {
  const invalidData = { docPath: 'test.md' }; // Missing content

  const request = createPostRequest('/api/comments', invalidData);
  const context = createTestContext();

  const response = await action({ request, context, params: {} });
  const data = await parseResponse(response);

  expect(response.status).toBe(400);
  expect(data.error).toBeDefined();
});
```

### Testing Pagination

```typescript
it('should paginate results', async () => {
  const request = createGetRequest('/api/comments', {
    limit: '10',
    offset: '5',
  });
  const context = createTestContext();

  await loader({ request, context, params: {} });

  expect(mockDb.limit).toHaveBeenCalledWith(10);
  expect(mockDb.offset).toHaveBeenCalledWith(5);
});
```

## Troubleshooting

### Tests Failing with "Module not found"
- Ensure the `~` alias is configured in `vitest.config.ts`
- Check that all imports use the correct path

### Mock Not Working
- Verify `vi.clearAllMocks()` is called in `beforeEach`
- Check that the module path in `vi.mock()` matches exactly
- Ensure mocks are defined before importing the module under test

### Coverage Not Meeting Thresholds
- Run `npm run test:coverage:ui` to see uncovered lines
- Add tests for edge cases and error paths
- Ensure all API routes have comprehensive test coverage

### Tests Timing Out
- Check for missing `async`/`await` in test code
- Verify mock functions return resolved promises
- Increase timeout if needed: `it('test', async () => {}, 10000)`

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Push to main branch
- Manual workflow dispatch

Coverage reports are uploaded to the CI/CD platform and must meet minimum thresholds for merge approval.

## Future Enhancements

- [ ] Add E2E tests with real D1 database
- [ ] Add performance benchmarks
- [ ] Add contract tests for API schemas
- [ ] Add mutation testing with Stryker
- [ ] Add visual regression tests for UI components
- [ ] Add load testing with Artillery
- [ ] Add security testing with OWASP ZAP

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Test-Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
