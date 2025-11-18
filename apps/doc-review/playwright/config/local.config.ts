import { defineConfig, devices } from '@playwright/test';
import { baseConfig } from './base.config';

/**
 * Local Development Configuration
 * Uses port 6700 for local dev server
 */
export default defineConfig({
  ...baseConfig,

  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:6700',
    video: 'off', // No video locally for speed
  },

  // Projects for cross-browser testing
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Start local dev server
  webServer: {
    command: 'PORT=6700 pnpm dev',
    url: 'http://localhost:6700',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
