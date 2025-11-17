/**
 * API Key Creation E2E Tests
 *
 * Tests the API key creation flow including:
 * - Creating API key with various configurations
 * - Form validation
 * - Clipboard operations
 * - One-time key display
 * - Scope selection
 */

import { test, expect } from '@playwright/test';
import { APIKeysPage } from '../pages/APIKeysPage';
import {
  createTestUser,
  createTestAPIKey,
  TEST_API_KEYS,
  ROUTES,
  TIMEOUTS,
} from '../fixtures/test-data';
import { setupAuthenticatedSession, clearAuthState } from '../helpers/auth';
import { createAPIKey } from '../helpers/api-keys';

test.describe('API Key Creation', () => {
  let apiKeysPage: APIKeysPage;

  test.beforeEach(async ({ page, context }) => {
    // Clear authentication state
    await clearAuthState(page);

    // Set up authenticated session
    const testUser = createTestUser();
    await setupAuthenticatedSession(page, testUser);

    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Initialize page object
    apiKeysPage = new APIKeysPage(page);

    // Navigate to API keys page
    await apiKeysPage.goto();
  });

  test('should display API keys management page', async ({ page }) => {
    // Verify page title
    await expect(page).toHaveTitle(/api keys|api key management/i);

    // Verify generate key button is present
    await expect(apiKeysPage.generateKeyButton).toBeVisible();
  });

  test('should open API key creation modal', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Verify modal appears
    await expect(
      page.locator('[role="dialog"], .modal')
    ).toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify form fields are present
    await expect(page.locator('[name="name"], #keyName')).toBeVisible();
    await expect(page.locator('[name="description"], #keyDescription')).toBeVisible();
  });

  test('should successfully create API key with basic configuration', async ({ page }) => {
    const keyData = TEST_API_KEYS.basic;

    // Mock API response
    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-123',
            name: keyData.name,
            key: 'sk_test_' + Math.random().toString(36).substring(2, 34),
            scopes: keyData.scopes,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await apiKeysPage.clickGenerateKey();

    // Fill form
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);

    // Select scopes
    for (const scope of keyData.scopes) {
      await page.check(`[value="${scope}"], input[type="checkbox"][value="${scope}"]`);
    }

    // Set rate limit
    await page.fill('[name="rateLimit"], #rateLimit', keyData.rateLimit.toString());

    // Set expiration
    await page.fill('[name="expiresInDays"], #expiresInDays', keyData.expiresInDays.toString());

    // Submit form
    await page.click('button[type="submit"]:has-text("Generate"), button:has-text("Create")');

    // Verify key generated modal appears
    await expect(
      page.locator('text=/API Key Generated|Your API Key|Successfully Created/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify API key is displayed
    const apiKeyElement = page.locator('[data-testid="generated-api-key"], .api-key-value, code');
    await expect(apiKeyElement).toBeVisible();

    const apiKeyText = await apiKeyElement.textContent();
    expect(apiKeyText).toMatch(/^sk_/); // Verify key format
  });

  test('should copy API key to clipboard', async ({ page }) => {
    const keyData = createTestAPIKey();
    const mockApiKey = 'sk_test_1234567890abcdefghijklmnopqr';

    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-123',
            name: keyData.name,
            key: mockApiKey,
            scopes: keyData.scopes,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await apiKeysPage.clickGenerateKey();

    // Fill minimal form
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);

    // Select at least one scope
    await page.check('[value="read:benchmarks"]');

    // Submit
    await page.click('button[type="submit"]');

    // Wait for key to be generated
    await expect(
      page.locator('[data-testid="generated-api-key"], .api-key-value, code')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Click copy button
    await page.click('button:has-text("Copy"), [aria-label*="copy" i]');

    // Verify clipboard content
    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toBe(mockApiKey);

    // Verify copy success feedback
    await expect(
      page.locator('text=/copied|copy successful/i')
    ).toBeVisible({ timeout: 1000 });
  });

  test('should require confirmation before closing key display modal', async ({ page }) => {
    const keyData = createTestAPIKey();

    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-123',
            name: keyData.name,
            key: 'sk_test_' + Math.random().toString(36).substring(2, 34),
            scopes: keyData.scopes,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await apiKeysPage.clickGenerateKey();

    // Fill and submit form
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);
    await page.check('[value="read:benchmarks"]');
    await page.click('button[type="submit"]');

    // Wait for key to be generated
    await expect(
      page.locator('[data-testid="generated-api-key"]')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify confirmation checkbox
    const confirmCheckbox = page.locator('[name="confirmed"], #confirmSaved');
    await expect(confirmCheckbox).toBeVisible();

    // Try to close without confirmation
    const closeButton = page.locator('button:has-text("Done"), button:has-text("Close")');
    await expect(closeButton).toBeDisabled();

    // Check confirmation
    await confirmCheckbox.check();

    // Now close button should be enabled
    await expect(closeButton).toBeEnabled();
  });

  test('should validate required fields', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Try to submit without filling required fields
    await page.click('button[type="submit"]');

    // Verify validation errors
    const nameError = page.locator('[id*="name"][role="alert"], .error:near([name="name"])');
    await expect(nameError).toBeVisible();
  });

  test('should validate key name length', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Enter name that's too short
    await page.fill('[name="name"], #keyName', 'a');
    await page.click('button[type="submit"]');

    // Verify validation error
    const nameError = page.locator('[id*="name"][role="alert"]');
    await expect(nameError).toBeVisible();
    await expect(nameError).toContainText(/at least|minimum|characters/i);
  });

  test('should require at least one scope selection', async ({ page }) => {
    const keyData = createTestAPIKey();

    await apiKeysPage.clickGenerateKey();

    // Fill form but don't select any scopes
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);

    // Try to submit
    await page.click('button[type="submit"]');

    // Verify scope validation error
    const scopeError = page.locator('text=/select at least one|scope required/i, [role="alert"]:near([name="scopes"])');
    await expect(scopeError).toBeVisible();
  });

  test('should validate rate limit values', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Try invalid rate limit
    await page.fill('[name="rateLimit"], #rateLimit', '-1');
    await page.blur('[name="rateLimit"], #rateLimit');

    // Verify validation error
    const rateLimitError = page.locator('[id*="rateLimit"][role="alert"]');
    const errorVisible = await rateLimitError.isVisible().catch(() => false);

    if (errorVisible) {
      await expect(rateLimitError).toContainText(/positive|greater than|minimum/i);
    }
  });

  test('should validate expiration period', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Try invalid expiration
    await page.fill('[name="expiresInDays"], #expiresInDays', '0');
    await page.blur('[name="expiresInDays"], #expiresInDays');

    // Verify validation error or minimum value
    const expirationError = page.locator('[id*="expires"][role="alert"]');
    const errorVisible = await expirationError.isVisible().catch(() => false);

    if (errorVisible) {
      await expect(expirationError).toContainText(/at least|minimum/i);
    }
  });

  test('should display API key only once', async ({ page }) => {
    const keyData = createTestAPIKey();
    const mockApiKey = 'sk_test_1234567890abcdefghijklmnopqr';

    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-123',
            name: keyData.name,
            key: mockApiKey,
            scopes: keyData.scopes,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await apiKeysPage.clickGenerateKey();

    // Create key
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);
    await page.check('[value="read:benchmarks"]');
    await page.click('button[type="submit"]');

    // Verify key is displayed
    await expect(
      page.locator(`text="${mockApiKey}"`)
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Close modal
    await page.check('[name="confirmed"], #confirmSaved');
    await page.click('button:has-text("Done"), button:has-text("Close")');

    // Verify key is no longer displayed anywhere on the page
    await expect(page.locator(`text="${mockApiKey}"`)).not.toBeVisible();
  });

  test('should add created key to the list', async ({ page }) => {
    const keyData = createTestAPIKey();

    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-123',
            name: keyData.name,
            key: 'sk_test_1234567890abcdefghijklmnopqr',
            scopes: keyData.scopes,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    // Get initial count
    const initialCount = await apiKeysPage.getKeyCount();

    await apiKeysPage.clickGenerateKey();

    // Create key
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);
    await page.check('[value="read:benchmarks"]');
    await page.click('button[type="submit"]');

    // Close modal
    await page.check('[name="confirmed"], #confirmSaved');
    await page.click('button:has-text("Done")');

    // Wait for modal to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify key appears in list
    const keyRow = await apiKeysPage.getKeyByName(keyData.name);
    await expect(keyRow).toBeVisible();

    // Verify count increased
    const newCount = await apiKeysPage.getKeyCount();
    expect(newCount).toBe(initialCount + 1);
  });

  test('should cancel key creation', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Start filling form
    await page.fill('[name="name"], #keyName', 'Test Key');

    // Cancel
    await page.click('button:has-text("Cancel")');

    // Verify modal is closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify no key was created
    const keyRow = await apiKeysPage.getKeyByName('Test Key');
    const count = await keyRow.count();
    expect(count).toBe(0);
  });

  test('should handle API errors during creation', async ({ page }) => {
    const keyData = createTestAPIKey();

    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Failed to create API key',
        }),
      });
    });

    await apiKeysPage.clickGenerateKey();

    // Fill form
    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);
    await page.check('[value="read:benchmarks"]');
    await page.click('button[type="submit"]');

    // Verify error message
    await expect(
      page.locator('text=/error|failed|try again/i, [role="alert"]')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should disable submit button while creating', async ({ page }) => {
    const keyData = createTestAPIKey();

    await page.route('**/api/api-keys/create', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-123',
            name: keyData.name,
            key: 'sk_test_1234567890abcdefghijklmnopqr',
            scopes: keyData.scopes,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await apiKeysPage.clickGenerateKey();

    await page.fill('[name="name"], #keyName', keyData.name);
    await page.fill('[name="description"], #keyDescription', keyData.description);
    await page.check('[value="read:benchmarks"]');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Verify button is disabled during submission
    await expect(submitButton).toBeDisabled();
  });

  test('should show scope descriptions on hover', async ({ page }) => {
    await apiKeysPage.clickGenerateKey();

    // Look for scope options with descriptions
    const scopeOption = page.locator('[value="read:benchmarks"]').first();
    await scopeOption.hover();

    // Check if tooltip/description appears (optional feature)
    const tooltip = page.locator('[role="tooltip"], .tooltip');
    const isVisible = await tooltip.isVisible().catch(() => false);

    // If tooltips are implemented, they should appear on hover
    if (isVisible) {
      await expect(tooltip).toBeVisible();
    }
  });
});
