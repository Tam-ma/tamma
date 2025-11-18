import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for E2E Testing
 *
 * This configuration sets up Playwright for testing the AIBaaS web application.
 * It includes settings for parallel execution, retry logic, reporting, and browser configurations.
 */
export default defineConfig({
  // Test directory containing all E2E tests
  testDir: './e2e',

  // Run tests in parallel for faster execution
  fullyParallel: true,

  // Fail the build on CI if tests have .only annotations
  forbidOnly: !!process.env.CI,

  // Retry failed tests in CI for flakiness handling
  retries: process.env.CI ? 2 : 0,

  // Limit workers in CI to prevent resource issues
  workers: process.env.CI ? 1 : undefined,

  // Test timeout (30 seconds per test)
  timeout: 30 * 1000,

  // Expect timeout (5 seconds for assertions)
  expect: {
    timeout: 5 * 1000,
  },

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
  ],

  // Global test configuration
  use: {
    // Base URL for the application
    baseURL: process.env.BASE_URL || 'http://localhost:3100',

    // API base URL for backend
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },

    // Capture trace on first retry for debugging
    trace: 'on-first-retry',

    // Screenshot on failure for visual debugging
    screenshot: 'only-on-failure',

    // Record video on retry
    video: 'retain-on-failure',

    // Browser context options
    viewport: { width: 1280, height: 720 },

    // Ignore HTTPS errors in development
    ignoreHTTPSErrors: true,

    // Set locale and timezone
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable clipboard API
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile testing
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },

    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },

    // Tablet testing
    {
      name: 'tablet',
      use: { ...devices['iPad Pro'] },
    },
  ],

  // Web server configuration - starts the Next.js dev server
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes to start
    stdout: 'ignore',
    stderr: 'pipe',
  },

  // Global setup/teardown
  globalSetup: './e2e/setup/global-setup.ts',
  globalTeardown: './e2e/setup/global-teardown.ts',
});
