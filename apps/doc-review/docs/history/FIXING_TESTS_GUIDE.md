# Guide: Fixing Integration Tests

## Why Tests Are Failing

The API implementation has evolved to include a permission-based authorization system. The tests were written for the original API but need to be updated to mock the new permission middleware.

## Required Changes

### 1. Add Permission System Mocks

Add these mocks to each test file:

```typescript
// Add to the top of test files (after other mocks)
vi.mock('~/lib/auth/middleware', () => ({
  requireAuthWithRole: vi.fn().mockImplementation(async (request, context) => {
    // Return the mocked user from auth-helpers
    const authModule = await import('~/lib/auth/session.server');
    return authModule.requireAuth(request, { env: context.env });
  }),
}));

vi.mock('~/lib/auth/permissions', () => ({
  hasPermission: vi.fn((user, permission) => {
    // Grant all permissions by default, or customize per test
    return true;
  }),
  canModifyResource: vi.fn((user, ownerId) => {
    // Allow if user owns resource or is admin
    return user.id === ownerId || user.role === 'admin';
  }),
  canDeleteResource: vi.fn((user, ownerId) => {
    // Allow if user owns resource or is admin
    return user.id === ownerId || user.role === 'admin';
  }),
  canApprove: vi.fn((user) => {
    // Only admins can approve
    return user.role === 'admin';
  }),
  logPermissionViolation: vi.fn(),
  Permission: {
    READ: 'read',
    COMMENT: 'comment',
    SUGGEST: 'suggest',
    APPROVE: 'approve',
    EDIT_ANY: 'edit_any',
    DELETE_ANY: 'delete_any',
  },
}));
```

### 2. Example: Fixing Comments API Tests

Here's how to update `/app/routes/api.comments.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.comments';
import { loader as loaderSingle, action as actionSingle } from './api.comments.$id';
import {
  createTestUser,
  createTestUsers,
  mockAuth,
  mockUserSync,
} from '../test/helpers/auth-helpers';
// ... rest of imports

// Add new mocks
vi.mock('~/lib/auth/middleware', () => ({
  requireAuthWithRole: vi.fn().mockImplementation(async (request, context) => {
    const authModule = await import('~/lib/auth/session.server');
    return authModule.requireAuth(request, { env: context.env });
  }),
}));

vi.mock('~/lib/auth/permissions', () => ({
  hasPermission: vi.fn((user, permission) => true),
  canModifyResource: vi.fn((user, ownerId) => {
    return user.id === ownerId || user.role === 'admin';
  }),
  canDeleteResource: vi.fn((user, ownerId) => {
    return user.id === ownerId || user.role === 'admin';
  }),
  canApprove: vi.fn((user) => user.role === 'admin'),
  logPermissionViolation: vi.fn(),
  Permission: {
    READ: 'read',
    COMMENT: 'comment',
    SUGGEST: 'suggest',
    APPROVE: 'approve',
    EDIT_ANY: 'edit_any',
    DELETE_ANY: 'delete_any',
  },
}));

// Keep existing mocks...
vi.mock('~/lib/auth/session.server');
vi.mock('~/lib/db/client.server');
vi.mock('~/lib/db/users.server');
// ... etc

describe('Comments API Integration Tests', () => {
  // ... rest of tests
});
```

### 3. Add Permission-Specific Tests

Add tests for permission scenarios:

```typescript
describe('Permission System', () => {
  it('should require comment permission to create comments', async () => {
    const permissionsModule = require('~/lib/auth/permissions');
    vi.spyOn(permissionsModule, 'hasPermission').mockReturnValue(false);

    const commentData = {
      docPath: 'docs/test.md',
      content: 'Test comment',
    };

    const request = createPostRequest('/api/comments', commentData);
    const context = createTestContext();

    const response = await action({ request, context, params: {} });
    const data = await parseResponse(response);

    expect(response.status).toBe(403);
    expect(data.error).toBe('Forbidden');
    expect(data.requiredPermission).toBe('comment');
  });

  it('should allow admins to modify any comment', async () => {
    const adminUser = createTestUser({ role: 'admin' });
    mockAuth(adminUser);

    const comment = createTestComment({ userId: 'other-user' });
    mockDb.get
      .mockResolvedValueOnce(comment)
      .mockResolvedValueOnce({ ...comment, content: 'Updated' });

    const updates = { content: 'Updated by admin' };
    const request = createPatchRequest('/api/comments/comment-001', updates);
    const context = createTestContext();

    const response = await actionSingle({
      request,
      context,
      params: { id: 'comment-001' },
    });
    const data = await parseResponse(response);

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });
});
```

### 4. Quick Fix Script

Create a bash script to update all tests at once:

```bash
#!/bin/bash
# fix-tests.sh

# Add permission mocks to all test files
for file in app/routes/api.*.test.ts; do
  echo "Updating $file..."

  # Add permission mocks after session mock
  sed -i "/vi.mock('~\/lib\/auth\/session.server');/a\\
vi.mock('~\/lib\/auth\/middleware', () => ({\\
  requireAuthWithRole: vi.fn().mockImplementation(async (request, context) => {\\
    const authModule = await import('~\/lib\/auth\/session.server');\\
    return authModule.requireAuth(request, { env: context.env });\\
  }),\\
}));\\
\\
vi.mock('~\/lib\/auth\/permissions', () => ({\\
  hasPermission: vi.fn((user, permission) => true),\\
  canModifyResource: vi.fn((user, ownerId) => user.id === ownerId || user.role === 'admin'),\\
  canDeleteResource: vi.fn((user, ownerId) => user.id === ownerId || user.role === 'admin'),\\
  canApprove: vi.fn((user) => user.role === 'admin'),\\
  logPermissionViolation: vi.fn(),\\
  Permission: {\\
    READ: 'read',\\
    COMMENT: 'comment',\\
    SUGGEST: 'suggest',\\
    APPROVE: 'approve',\\
    EDIT_ANY: 'edit_any',\\
    DELETE_ANY: 'delete_any',\\
  },\\
}));" "$file"
done

echo "Done! Run 'npm test' to verify."
```

## Step-by-Step Fix Process

### Step 1: Update One Test File

1. Open `/app/routes/api.comments.test.ts`
2. Add permission mocks (see section 2 above)
3. Run tests: `npm test api.comments.test.ts`
4. Fix any remaining issues

### Step 2: Verify Permission Tests Work

1. Add permission-specific tests (see section 3)
2. Test different user roles (viewer, editor, reviewer, admin)
3. Verify authorization logic

### Step 3: Apply to All Test Files

1. Use the pattern from Step 1 for other test files
2. Update each test file:
   - `api.suggestions.test.ts`
   - `api.discussions.test.ts`
   - `api.discussions.messages.test.ts`
   - `api.sessions.test.ts`

### Step 4: Run Full Test Suite

```bash
npm run test:coverage
```

## Common Issues and Solutions

### Issue 1: "requireAuthWithRole is not a function"

**Solution**: Add the middleware mock:
```typescript
vi.mock('~/lib/auth/middleware', () => ({
  requireAuthWithRole: vi.fn().mockImplementation(async (request, context) => {
    const authModule = await import('~/lib/auth/session.server');
    return authModule.requireAuth(request, { env: context.env });
  }),
}));
```

### Issue 2: "hasPermission is not defined"

**Solution**: Add the permissions mock with all methods:
```typescript
vi.mock('~/lib/auth/permissions', () => ({
  hasPermission: vi.fn((user, permission) => true),
  canModifyResource: vi.fn((user, ownerId) => user.id === ownerId || user.role === 'admin'),
  canDeleteResource: vi.fn((user, ownerId) => user.id === ownerId || user.role === 'admin'),
  canApprove: vi.fn((user) => user.role === 'admin'),
  logPermissionViolation: vi.fn(),
  Permission: { /* all permission constants */ },
}));
```

### Issue 3: Tests expect different error messages

**Solution**: Update expected error messages:
```typescript
// Old
expect(data.error).toContain('not authorized');

// New (with permission system)
expect(data.error).toBe('Forbidden');
expect(data.requiredPermission).toBeDefined();
```

### Issue 4: Tests fail on authorization checks

**Solution**: Mock the permission functions per test:
```typescript
it('should prevent unauthorized updates', async () => {
  const permissionsModule = require('~/lib/auth/permissions');
  vi.spyOn(permissionsModule, 'canModifyResource').mockReturnValue(false);

  // ... rest of test
});
```

## Testing Strategy

### 1. Test Permission Denial

```typescript
it('should deny action without permission', async () => {
  const permissionsModule = require('~/lib/auth/permissions');
  vi.spyOn(permissionsModule, 'hasPermission').mockReturnValue(false);

  const response = await action({ request, context, params: {} });
  const data = await parseResponse(response);

  expect(response.status).toBe(403);
  expect(data.error).toBe('Forbidden');
  expect(permissionsModule.logPermissionViolation).toHaveBeenCalled();
});
```

### 2. Test Role-Based Access

```typescript
describe('Role-based access', () => {
  it('should allow admin to approve suggestions', async () => {
    const adminUser = createTestUser({ role: 'admin' });
    mockAuth(adminUser);
    // ... test admin can approve
  });

  it('should deny reviewer from approving', async () => {
    const reviewerUser = createTestUser({ role: 'reviewer' });
    mockAuth(reviewerUser);

    const permissionsModule = require('~/lib/auth/permissions');
    vi.spyOn(permissionsModule, 'canApprove').mockReturnValue(false);

    // ... test reviewer cannot approve
  });
});
```

### 3. Test Permission Logging

```typescript
it('should log permission violations', async () => {
  const permissionsModule = require('~/lib/auth/permissions');
  vi.spyOn(permissionsModule, 'hasPermission').mockReturnValue(false);

  await action({ request, context, params: {} });

  expect(permissionsModule.logPermissionViolation).toHaveBeenCalledWith(
    expect.objectContaining({ id: testUser.id }),
    expect.any(String),
    expect.any(Object)
  );
});
```

## Verification Checklist

After making changes, verify:

- [ ] All mocks are properly imported
- [ ] Permission functions are mocked
- [ ] Tests use correct user roles
- [ ] Error messages match new format
- [ ] Authorization tests cover all scenarios
- [ ] Permission logging is verified
- [ ] All tests pass: `npm run test:run`
- [ ] Coverage meets targets: `npm run test:coverage`

## Timeline Estimate

- **Quick fix (basic mocks)**: 1-2 hours
- **Comprehensive fix (with permission tests)**: 4-6 hours
- **Full coverage optimization**: 8-10 hours

## Resources

- Permission system docs: `/app/lib/auth/permissions.ts`
- Middleware docs: `/app/lib/auth/middleware.ts`
- Test helpers: `/app/test/helpers/auth-helpers.ts`
- Test documentation: `/app/test/README.md`

## Next Steps

1. Choose one test file to fix first (recommend `api.comments.test.ts`)
2. Add permission mocks
3. Run tests to verify: `npm test api.comments.test.ts`
4. Apply same pattern to other files
5. Add permission-specific test cases
6. Run full suite: `npm run test:coverage`
7. Celebrate 🎉 when you hit 80%+ coverage!

---

**Note**: The test infrastructure is solid. These fixes are just about adapting the mocks to match the evolved API implementation. Once the mocks are updated, you'll have a comprehensive test suite ready for TDD.
