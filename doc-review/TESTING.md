# Testing Guide for Tamma Doc Review

This document provides comprehensive information about the testing infrastructure, including database seeding, E2E tests, visual regression testing, and performance monitoring.

## Table of Contents

- [Overview](#overview)
- [Database Setup](#database-setup)
- [E2E Testing](#e2e-testing)
- [Visual Regression Testing](#visual-regression-testing)
- [Performance Testing](#performance-testing)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

## Overview

The testing infrastructure includes:

1. **Database Seeding**: Sample data for development and testing
2. **E2E Tests**: End-to-end testing with Playwright
3. **Visual Regression**: Screenshot comparison tests
4. **Performance Monitoring**: Lighthouse CI integration
5. **CI/CD**: Automated testing in GitHub Actions

## Database Setup

### Seeding the Database

The database seed script creates comprehensive test data including:
- Sample users (admin, editor, reviewer, viewer)
- Documents with metadata
- Review sessions
- Comments and comment threads
- Suggestions with diff information
- Discussions and messages
- Activity log entries

**Commands:**

```bash
# Seed local database (development)
pnpm db:seed

# Seed remote database (production - USE WITH CAUTION)
pnpm db:seed:remote

# Reset database (migrate + seed)
pnpm db:reset
```

**Sample Data Included:**

- **Users**: 4 users with different roles
  - admin@tamma.dev (Admin)
  - editor@tamma.dev (Editor)
  - reviewer@tamma.dev (Reviewer)
  - viewer@tamma.dev (Viewer)

- **Documents**: 5 sample documents
  - docs/architecture.md
  - docs/PRD.md
  - docs/epics.md
  - docs/stories/1-0-ai-provider-strategy-research.md
  - docs/stories/1-1-ai-provider-interface-definition.md

- **Comments**: 4 comments with threading
- **Suggestions**: 2 suggestions (1 pending, 1 accepted)
- **Discussions**: 2 discussions with messages
- **Activity Log**: 3 activity entries

### Migration Management

```bash
# Apply migrations locally
pnpm db:migrate:local

# Apply migrations to remote (production)
pnpm db:migrate

# Generate new migration from schema changes
pnpm db:generate
```

## E2E Testing

### Running E2E Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run in UI mode (interactive)
pnpm test:e2e:ui

# Run in headed mode (see browser)
pnpm test:e2e:headed

# Debug mode
pnpm test:e2e:debug

# Run specific browser
pnpm test:e2e:chromium
pnpm test:e2e:firefox
pnpm test:e2e:webkit

# View test report
pnpm test:e2e:report
```

### Test Suites

#### 1. Homepage Tests (`homepage.spec.ts`)
- Homepage loading and rendering
- Navigation elements
- Search functionality
- Document listing

#### 2. Documents Tests (`documents.spec.ts`)
- Document viewer
- Markdown rendering
- Navigation sidebar
- Table of contents

#### 3. Search Tests (`search.spec.ts`)
- Search functionality
- Full-text search
- Search filters
- Result display

#### 4. Authentication Tests (`auth.spec.ts`)
- Login flow
- OAuth provider options
- OAuth callback handling
- Logout flow
- Session persistence
- Protected routes
- User menu
- Permission-based UI

#### 5. Collaboration Tests (`collaboration.spec.ts`)
- **Comments**: Display, add, thread, resolve
- **Suggestions**: Display, diff viewer, accept/reject
- **Discussions**: List, create, messages
- **Review Sessions**: List, details
- **Real-time**: SSE connection, presence indicators
- **Activity Log**: Recent activity, filtering

### Test Configuration

Configuration is environment-based:

- **Local**: `playwright/config/local.config.ts`
- **Base**: `playwright/config/base.config.ts` (shared settings)

Environment selection via `TEST_ENV` variable:

```bash
TEST_ENV=local pnpm test:e2e
```

## Visual Regression Testing

Visual regression tests capture screenshots and compare them against baseline images.

### Running Visual Tests

```bash
# Run all tests (includes visual regression)
pnpm test:e2e

# Update baseline snapshots
pnpm test:e2e:update-snapshots
```

### Visual Test Coverage

The visual regression suite (`visual-regression.spec.ts`) includes:

#### Homepage
- Full page layout
- Header component
- Login button state

#### Documents
- Document listing page
- Document viewer layout
- Markdown rendering
- Code block syntax highlighting

#### Navigation
- Document navigation sidebar
- Table of contents

#### Comments UI
- Comments panel
- Comment threads

#### Suggestions UI
- Suggestions panel
- Diff viewer

#### Search UI
- Search bar
- Search results page

#### Responsive Design
- Mobile viewport (375x667)
- Tablet viewport (768x1024)
- Desktop viewport (1920x1080)

#### Dark Mode
- Dark mode homepage
- Dark mode document viewer

#### Error States
- 404 page
- Error boundary

### Visual Regression Settings

Configured in `playwright/config/base.config.ts`:

```typescript
expect: {
  toHaveScreenshot: {
    threshold: 0.2,        // 20% pixel difference tolerance
    maxDiffPixels: 100,    // Max 100 different pixels
    animations: 'disabled' // Disable animations for consistency
  }
}
```

### Handling Dynamic Content

Visual tests mask dynamic elements to prevent false positives:

```typescript
await expect(page).toHaveScreenshot('example.png', {
  mask: [
    page.locator('.timestamp'),      // Mask timestamps
    page.locator('.relative-time'),  // Mask relative times
  ]
});
```

## Performance Testing

### Lighthouse CI

Lighthouse CI runs automated performance, accessibility, best practices, and SEO audits.

**Installation:**

```bash
pnpm lighthouse:install
```

**Running Locally:**

```bash
# Start the app first
pnpm build && pnpm preview

# In another terminal
pnpm lighthouse
```

### Audited Pages

1. Homepage (`/`)
2. Documents listing (`/docs`)
3. Document viewer (`/docs/architecture.md`)
4. Search results (`/search?q=test`)

### Performance Budgets

Configured in `lighthouserc.json`:

**Categories (Minimum Scores):**
- Performance: 80
- Accessibility: 90
- Best Practices: 90
- SEO: 90

**Core Web Vitals:**
- First Contentful Paint (FCP): < 2s
- Largest Contentful Paint (LCP): < 2.5s
- Cumulative Layout Shift (CLS): < 0.1
- Total Blocking Time (TBT): < 300ms
- Speed Index: < 3s
- Time to Interactive (TTI): < 3.5s

### Lighthouse Reports

Reports are saved to `.lighthouseci/` directory:

```
.lighthouseci/
├── manifest.json           # Report manifest
├── lhr-*.json             # Lighthouse results (JSON)
└── lhr-*.html             # Lighthouse reports (HTML)
```

## CI/CD Integration

### GitHub Actions Workflows

#### 1. Deploy Workflow (`.github/workflows/deploy.yml`)

Runs on every push to `main` and includes:

1. **Unit Tests**
   - TypeScript type checking
   - Linting
   - Vitest unit tests
   - Coverage reporting

2. **E2E Tests**
   - Build application
   - Setup local D1 database
   - Seed database
   - Start preview server
   - Run Playwright tests
   - Upload test results and screenshots

3. **Build**
   - Production build
   - Verify build output

4. **Deploy**
   - Deploy to Cloudflare Pages
   - Apply database migrations
   - Wait for deployment to be live

5. **Smoke Tests**
   - Health check
   - Homepage accessibility

#### 2. Lighthouse Workflow (`.github/workflows/lighthouse.yml`)

Runs on pull requests and pushes to `main`:

1. Build application
2. Setup database
3. Start preview server
4. Run Lighthouse audits
5. Upload results
6. Comment on PR with performance scores

### Artifacts

Workflows upload the following artifacts:

- **test-results**: Unit test coverage
- **e2e-test-results**: E2E test results and Playwright reports
- **e2e-screenshots**: Screenshots from failed tests
- **lighthouse-results**: Lighthouse performance reports

Artifacts are retained for 7-30 days.

## Troubleshooting

### Database Issues

**Issue**: Database not seeded correctly

```bash
# Reset and reseed
pnpm db:reset
```

**Issue**: Migration conflicts

```bash
# Check migration status
pnpm wrangler d1 migrations list tamma-docs --local

# Rollback if needed
pnpm wrangler d1 migrations rollback tamma-docs --local
```

### E2E Test Failures

**Issue**: Tests fail due to missing dependencies

```bash
# Install Playwright browsers
pnpm playwright:install
```

**Issue**: Server not starting

```bash
# Check if port 8788 is in use
lsof -i :8788

# Kill existing process
kill -9 <PID>
```

**Issue**: Timeouts waiting for elements

- Check if the feature is implemented
- Increase timeout in test: `{ timeout: 10000 }`
- Run in headed mode to debug: `pnpm test:e2e:headed`

### Visual Regression Failures

**Issue**: Screenshots differ from baseline

```bash
# View differences in test report
pnpm test:e2e:report

# Update baselines if changes are intentional
pnpm test:e2e:update-snapshots
```

**Issue**: Inconsistent screenshots

- Ensure animations are disabled in test
- Mask dynamic elements (timestamps, etc.)
- Run multiple times to verify consistency

### Lighthouse Failures

**Issue**: Performance score below threshold

- Check Core Web Vitals in report
- Optimize images, scripts, CSS
- Reduce JavaScript bundle size
- Enable caching and compression

**Issue**: Accessibility issues

- Review contrast ratios
- Ensure proper ARIA labels
- Test with screen reader
- Fix missing alt text

### CI/CD Failures

**Issue**: E2E tests fail in CI but pass locally

- Check GitHub Actions logs
- Verify environment variables
- Ensure database is seeded
- Check for race conditions

**Issue**: Lighthouse fails in CI

- Review uploaded Lighthouse reports
- Check server startup
- Verify all pages are accessible

## Best Practices

### Writing E2E Tests

1. **Use semantic selectors**: Prefer `getByRole`, `getByLabel` over CSS selectors
2. **Wait for elements**: Always wait for elements before interaction
3. **Handle async operations**: Use `await` consistently
4. **Isolate tests**: Each test should be independent
5. **Clean up**: Ensure tests don't leave side effects
6. **Use test IDs**: Add `data-testid` for complex components

### Visual Regression

1. **Consistent environment**: Always run in same resolution/browser
2. **Mask dynamic content**: Timestamps, user-specific data
3. **Disable animations**: Ensures consistent screenshots
4. **Update baselines carefully**: Review diffs before updating

### Performance

1. **Set budgets**: Define acceptable performance thresholds
2. **Monitor trends**: Track performance over time
3. **Test on real devices**: Mobile, tablet, desktop
4. **Optimize assets**: Images, fonts, scripts
5. **Lazy load**: Non-critical resources

## Additional Resources

- [Playwright Documentation](https://playwright.dev)
- [Lighthouse Documentation](https://developers.google.com/web/tools/lighthouse)
- [Drizzle ORM Documentation](https://orm.drizzle.team)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1)
