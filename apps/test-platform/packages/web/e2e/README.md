# E2E Tests - AIBaaS Web Application

Comprehensive end-to-end tests for the AIBaaS (AI Benchmarking as a Service) web application using Playwright.

## Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Setup](#setup)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Writing New Tests](#writing-new-tests)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

This E2E test suite provides comprehensive coverage for:

- **Authentication flows**: Registration, login, email verification, password reset
- **API key management**: Creation, viewing, editing, revoking API keys
- **Complete user journeys**: End-to-end workflows from registration to API usage
- **Accessibility compliance**: WCAG 2.1 standards using axe-core
- **Cross-browser testing**: Chrome, Firefox, Safari, and mobile browsers
- **Visual regression**: Screenshot comparison for UI consistency

## Test Structure

```
e2e/
├── auth/                          # Authentication tests
│   ├── registration.spec.ts       # User registration flow
│   ├── email-verification.spec.ts # Email verification
│   ├── login.spec.ts              # Login flow
│   └── password-reset.spec.ts     # Password reset flow
├── api-keys/                      # API key management tests
│   ├── create-key.spec.ts         # API key creation
│   └── manage-keys.spec.ts        # Key management operations
├── workflows/                     # Complete user journey tests
│   └── complete-user-journey.spec.ts
├── a11y/                          # Accessibility tests
│   └── accessibility.spec.ts      # WCAG compliance tests
├── helpers/                       # Reusable test utilities
│   ├── auth.ts                    # Authentication helpers
│   ├── api-keys.ts                # API key helpers
│   └── accessibility.ts           # Accessibility testing utilities
├── pages/                         # Page Object Models
│   ├── LoginPage.ts
│   ├── RegisterPage.ts
│   └── APIKeysPage.ts
├── fixtures/                      # Test data and configurations
│   └── test-data.ts               # Test fixtures and mock data
└── setup/                         # Global setup/teardown
    ├── global-setup.ts
    └── global-teardown.ts
```

## Setup

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Running backend API (localhost:8787)

### Installation

1. Install dependencies:

```bash
npm install
```

2. Install Playwright browsers:

```bash
npx playwright install
```

3. Install additional dependencies:

```bash
npm install @faker-js/faker axe-core axe-playwright --save-dev
```

### Environment Configuration

Create a `.env.test` file in the project root:

```env
BASE_URL=http://localhost:3000
API_URL=http://localhost:8787
NODE_ENV=test
```

## Running Tests

### Run All Tests

```bash
npm run test:e2e
```

### Run Tests in UI Mode (Interactive)

```bash
npm run test:e2e:ui
```

### Run Tests in Headed Mode (Browser Visible)

```bash
npm run test:e2e:headed
```

### Debug Tests

```bash
npm run test:e2e:debug
```

### Run Specific Browser

```bash
# Chrome only
npm run test:e2e:chrome

# Firefox only
npm run test:e2e:firefox

# Safari only
npm run test:e2e:webkit

# Mobile browsers
npm run test:e2e:mobile
```

### Run Specific Test File

```bash
npx playwright test e2e/auth/login.spec.ts
```

### Run Tests Matching Pattern

```bash
npx playwright test --grep "login"
```

### View Test Report

```bash
npm run test:e2e:report
```

### Generate Test Code

```bash
npm run test:e2e:codegen
```

## Test Coverage

### Authentication Tests (57 tests)

**Registration Flow** (`e2e/auth/registration.spec.ts`)
- Display registration form with all fields
- Successfully register new user
- Validate email format
- Validate password strength (weak, no uppercase, no number, too short)
- Validate password matching
- Handle duplicate email
- Disable submit during processing
- Show loading state
- Navigate to login page
- Clear validation errors
- Accessibility attributes
- Preserve form data on error
- Password strength indicator
- Handle network errors
- Autofocus behavior

**Email Verification** (`e2e/auth/email-verification.spec.ts`)
- Successfully verify with valid token
- Display loading state
- Handle expired token
- Handle invalid token
- Handle missing token
- Resend verification email
- Handle network failures
- Allow retry after failure
- Handle already verified email
- Provide login link after verification
- Accessibility attributes
- Malformed token handling
- Show verification instructions

**Login Flow** (`e2e/auth/login.spec.ts`)
- Display login form
- Successfully login with valid credentials
- Login with remember me option
- Handle invalid credentials
- Handle unverified email
- Validate empty fields
- Validate email format
- Toggle password visibility
- Disable submit during processing
- Show loading state
- Navigate to forgot password
- Navigate to registration
- Handle network errors
- Preserve email after failed login
- Redirect to return URL
- Accessibility attributes
- Handle server errors
- Autofocus behavior
- Password requirements hint
- Enter key submission

**Password Reset** (`e2e/auth/password-reset.spec.ts`)
- Display forgot password form
- Successfully request password reset
- Validate email format
- Handle non-existent email
- Display reset password form
- Successfully reset password
- Handle expired reset token
- Handle invalid reset token
- Handle missing token
- Validate weak password
- Validate password mismatch
- Password strength indicator
- Toggle password visibility
- Disable submit during processing
- Handle network errors
- Provide option for new reset link
- Accessibility attributes
- Enter key submission

### API Key Management Tests (29 tests)

**Create Key** (`e2e/api-keys/create-key.spec.ts`)
- Display API keys management page
- Open creation modal
- Successfully create API key
- Copy key to clipboard
- Require confirmation before closing
- Validate required fields
- Validate key name length
- Require scope selection
- Validate rate limit values
- Validate expiration period
- Display key only once
- Add key to list after creation
- Cancel key creation
- Handle API errors
- Disable submit during creation
- Show scope descriptions

**Manage Keys** (`e2e/api-keys/manage-keys.spec.ts`)
- Display list of API keys
- View key details
- Edit key name and description
- View usage statistics
- View security information
- Revoke key with confirmation
- Cancel revocation
- Show revoked status
- Filter keys by status
- Search keys by name
- Display creation date
- Display key scopes
- Handle pagination
- Display rate limit information
- Display expiration information
- Prevent editing revoked keys
- Show empty state

### Complete User Journey Test (4 tests)

**Full Lifecycle** (`e2e/workflows/complete-user-journey.spec.ts`)
- Complete user lifecycle:
  1. Register new user
  2. Verify email
  3. Login
  4. Create API key
  5. View API key usage
  6. Change password
  7. Logout
  8. Login with new password
  9. Verify data persistence
- Handle errors during journey
- Maintain session across refreshes

### Accessibility Tests (17 tests)

**WCAG Compliance** (`e2e/a11y/accessibility.spec.ts`)
- Login page accessibility
- Registration page accessibility
- Forgot password page accessibility
- API keys page accessibility
- Form inputs have proper labels
- Buttons are keyboard accessible
- Error messages have ARIA attributes
- Modals trap focus
- Links have descriptive text
- Proper heading structure
- Visible focus indicators
- Form submission with Enter key
- Password toggle ARIA labels
- Loading state announcements
- Disabled button attributes
- Comprehensive audit for all pages

## Writing New Tests

### Using Page Object Model

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test('example test', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('user@example.com', 'password123');

  await expect(page).toHaveURL('/dashboard');
});
```

### Using Test Helpers

```typescript
import { login, logout, isAuthenticated } from '../helpers/auth';
import { createAPIKey, revokeAPIKey } from '../helpers/api-keys';

test('example with helpers', async ({ page }) => {
  await login(page, 'user@example.com', 'password123');

  const apiKey = await createAPIKey(page, {
    name: 'Test Key',
    description: 'Test description',
    scopes: ['read:benchmarks'],
    rateLimit: 1000,
    expiresInDays: 30,
  });

  await revokeAPIKey(page, 'Test Key');
  await logout(page);
});
```

### Using Test Data Fixtures

```typescript
import { createTestUser, createTestAPIKey, MOCK_TOKENS } from '../fixtures/test-data';

test('example with fixtures', async ({ page }) => {
  const testUser = createTestUser();
  const testKey = createTestAPIKey();

  // Use in test...
});
```

## Best Practices

### 1. Test Organization

- Group related tests using `test.describe()`
- Use descriptive test names that explain what is being tested
- Keep tests focused on a single behavior

### 2. Test Data

- Use test data generators for unique data
- Clean up test data after tests complete
- Use mock API responses for edge cases

### 3. Assertions

- Use Playwright's auto-waiting assertions
- Add explicit timeout only when necessary
- Verify both positive and negative scenarios

### 4. Selectors

- Prefer `data-testid` attributes for stable selectors
- Use semantic selectors (role, label) when possible
- Avoid CSS selectors that depend on styling

### 5. Authentication

- Use `setupAuthenticatedSession()` helper for tests that need auth
- Clear authentication state in `beforeEach` hooks
- Test both authenticated and unauthenticated scenarios

### 6. Performance

- Run tests in parallel when possible
- Use `test.beforeEach` for common setup
- Avoid unnecessary waits and delays

### 7. Accessibility

- Include accessibility tests for all user-facing pages
- Test keyboard navigation for interactive elements
- Verify ARIA attributes are properly used

## Troubleshooting

### Tests Failing Intermittently

- Increase timeout values in `playwright.config.ts`
- Use `page.waitForLoadState('networkidle')` when needed
- Avoid hard-coded delays, use `waitFor` methods instead

### Cannot Find Elements

- Verify selectors are correct using Playwright Inspector
- Check if element is in Shadow DOM
- Ensure element is visible and enabled

### Network Errors

- Verify backend server is running on correct port
- Check API URL configuration in `.env.test`
- Review network mocks in test setup

### Browser Issues

- Update Playwright browsers: `npx playwright install`
- Clear browser cache: `npx playwright install --force`
- Check browser-specific configurations in `playwright.config.ts`

### CI/CD Failures

- Ensure CI has required dependencies installed
- Use `--workers=1` for resource-limited environments
- Enable retries: `retries: 2` in config

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [axe-core Documentation](https://github.com/dequelabs/axe-core)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

## Contributing

When adding new tests:

1. Follow the existing test structure and patterns
2. Update this README with new test coverage
3. Add appropriate accessibility tests
4. Ensure tests pass in all browsers
5. Update test data fixtures if needed

## License

Part of the AIBaaS Test Platform project.
