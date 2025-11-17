import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base Playwright Configuration
 * Shared settings across all environments
 */
export const baseConfig = defineConfig({
  testDir: path.resolve(__dirname, '../tests'),
  outputDir: path.resolve(__dirname, '../../test-results/e2e'),

  // Run tests in parallel within single file
  fullyParallel: true,

  // Prevent accidentally committed .only() from blocking CI
  forbidOnly: !!process.env.CI,

  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,

  // Worker configuration
  workers: process.env.CI ? 1 : undefined,

  // Reporters
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/e2e-results.xml' }],
    ['list'],
  ],

  // Global test timeout: 60 seconds
  timeout: 60000,

  use: {
    // Action timeout: 15 seconds (click, fill, etc.)
    actionTimeout: 15000,

    // Navigation timeout: 30 seconds (page.goto, page.reload)
    navigationTimeout: 30000,

    // Capture artifacts on failure
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Expect timeout: 10 seconds (all assertions)
  expect: {
    timeout: 10000,
    // Visual regression settings
    toHaveScreenshot: {
      // Maximum pixel difference threshold (0-1, where 1 = 100%)
      threshold: 0.2,
      // Maximum number of different pixels allowed
      maxDiffPixels: 100,
      // Animations: disabled for consistent screenshots
      animations: 'disabled',
    },
  },
});
