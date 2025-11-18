# Playwright E2E Tests

End-to-end tests for the doc-review platform using Playwright.

## Setup

### Install Dependencies

```bash
pnpm install
pnpm playwright:install
```

### Configuration

Tests run on port **3200** by default (configured in `playwright/config/local.config.ts`).

Environment variables can be set in `.env` file:
```bash
TEST_ENV=local  # Options: local (default)
PORT=3200
```

## Running Tests

### All Tests

```bash
pnpm test:e2e              # Run all E2E tests (headless)
pnpm test:e2e:headed       # Run with visible browser
pnpm test:e2e:ui           # Run with Playwright UI mode
pnpm test:e2e:debug        # Run in debug mode
```

### Specific Browsers

```bash
pnpm test:e2e:chromium     # Run on Chromium only
pnpm test:e2e:firefox      # Run on Firefox only
pnpm test:e2e:webkit       # Run on WebKit (Safari) only
```

### Specific Test Files

```bash
# Run specific test file
npx playwright test playwright/tests/search.spec.ts

# Run specific test by name
npx playwright test -g "should perform a basic search"
```

## Test Structure

```
playwright/
├── config/
│   ├── base.config.ts       # Base configuration (timeouts, reporters)
│   └── local.config.ts      # Local development config (port 3200)
├── support/
│   ├── fixtures/
│   │   └── base.ts          # Custom test fixtures (auto-capture logs)
│   └── page-objects/
│       ├── BasePage.ts      # Base page object class
│       ├── SearchPage.ts    # Search page actions
│       └── DocumentPage.ts  # Document page actions
└── tests/
    ├── homepage.spec.ts     # Homepage tests
    ├── search.spec.ts       # Search functionality tests
    └── documents.spec.ts    # Document viewing tests
```

## Page Objects

Page objects encapsulate page interactions and selectors:

```typescript
import { SearchPage } from '../support/page-objects/SearchPage';

test('search test', async ({ page }) => {
  const searchPage = new SearchPage(page);

  await searchPage.navigate();
  await searchPage.search('test query');

  const resultCount = await searchPage.getResultCount();
  expect(resultCount).toBeGreaterThan(0);
});
```

## Test Reports

After running tests:

```bash
pnpm test:e2e:report       # Open HTML report
```

Reports are saved to:
- `playwright-report/` - HTML report (visual, interactive)
- `test-results/` - Screenshots, videos, traces
- `test-results/e2e-results.xml` - JUnit XML (for CI)

## Debugging

### Playwright Inspector

```bash
pnpm test:e2e:debug
```

### View Trace

```bash
npx playwright show-trace test-results/.../trace.zip
```

### Screenshots on Failure

Screenshots are automatically captured on test failures and saved to `test-results/`.

## Timeouts

- **Test timeout**: 60 seconds
- **Action timeout**: 15 seconds (click, fill, etc.)
- **Navigation timeout**: 30 seconds (page.goto)
- **Expect timeout**: 10 seconds (assertions)

Override per test:
```typescript
test('slow test', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes
});
```

## CI/CD

Tests can run in CI with:

```bash
TEST_ENV=local pnpm test:e2e
```

Artifacts (screenshots, videos, reports) are uploaded on failure.

## Best Practices

1. **Use Page Objects** - Encapsulate page interactions
2. **Wait for Network Idle** - Use `waitForLoadState('networkidle')`
3. **Avoid Hard Waits** - Use event-based waits instead of `page.waitForTimeout()`
4. **Test Data** - Use fixtures for consistent test data
5. **Selectors** - Prefer `data-testid`, `role`, `text` over CSS selectors
6. **Cleanup** - Tests should be independent and clean up after themselves

## Troubleshooting

### Port Already in Use

If port 3200 is in use:
```bash
# Kill process on port 3200
kill -9 $(lsof -t -i:3200)
```

### Browser Not Installed

```bash
pnpm playwright:install
```

### Tests Timing Out

- Increase timeout in test file
- Check if dev server is running on port 3200
- Verify network connectivity

## Contributing

When adding new tests:

1. Create test file in `playwright/tests/`
2. Use page objects for reusable actions
3. Follow naming convention: `feature.spec.ts`
4. Add appropriate `data-testid` attributes to UI components
5. Ensure tests pass on all three browsers
