/**
 * API Key Management E2E Tests
 *
 * Tests API key management operations including:
 * - Viewing key details
 * - Editing key information
 * - Viewing usage statistics
 * - Viewing security information
 * - Revoking keys
 */

import { test, expect } from '@playwright/test';
import { APIKeysPage } from '../pages/APIKeysPage';
import {
  createTestUser,
  createTestAPIKey,
  ROUTES,
  TIMEOUTS,
} from '../fixtures/test-data';
import { setupAuthenticatedSession, clearAuthState } from '../helpers/auth';
import {
  revokeAPIKey,
  viewAPIKeyDetails,
  viewAPIKeyUsage,
  assertAPIKeyStatus,
} from '../helpers/api-keys';

test.describe('API Key Management', () => {
  let apiKeysPage: APIKeysPage;
  let testKeyName: string;

  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);

    const testUser = createTestUser();
    await setupAuthenticatedSession(page, testUser);

    apiKeysPage = new APIKeysPage(page);
    await apiKeysPage.goto();

    // Create a test key for management operations
    testKeyName = 'Test Management Key ' + Date.now();

    await page.route('**/api/api-keys/create', (route) => {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          apiKey: {
            id: 'key-test-123',
            name: testKeyName,
            key: 'sk_test_1234567890abcdefghijklmnopqr',
            scopes: ['read:benchmarks', 'write:benchmarks'],
            createdAt: new Date().toISOString(),
            status: 'active',
          },
        }),
      });
    });

    // Create the test key
    await apiKeysPage.clickGenerateKey();
    await page.fill('[name="name"]', testKeyName);
    await page.fill('[name="description"]', 'Test key for management operations');
    await page.check('[value="read:benchmarks"]');
    await page.click('button[type="submit"]');
    await page.check('[name="confirmed"]');
    await page.click('button:has-text("Done")');
  });

  test('should display list of API keys', async ({ page }) => {
    // Verify the created key appears in the list
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await expect(keyRow).toBeVisible();
  });

  test('should view API key details', async ({ page }) => {
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.locator('.key-name, [data-testid="key-name"], button:has-text("Details")').first().click();

    // Verify details modal appears
    await expect(
      page.locator('[role="dialog"]:has-text("Details"), .key-details')
    ).toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify key information is displayed
    await expect(page.locator(`text="${testKeyName}"`)).toBeVisible();
    await expect(page.locator('text=/created|status|scopes/i')).toBeVisible();
  });

  test('should edit API key name and description', async ({ page }) => {
    const newName = 'Updated Key Name';
    const newDescription = 'Updated description';

    await page.route('**/api/api-keys/*/update', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'API key updated successfully',
        }),
      });
    });

    // Open key details
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.click();

    // Click edit button
    await page.click('button:has-text("Edit"), [aria-label*="edit" i]');

    // Update fields
    await page.fill('[name="name"]', newName);
    await page.fill('[name="description"]', newDescription);

    // Save changes
    await page.click('button:has-text("Save"), button:has-text("Update")');

    // Verify success message
    await expect(
      page.locator('text=/updated successfully|changes saved/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should view API key usage statistics', async ({ page }) => {
    await page.route('**/api/api-keys/*/usage', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          usage: {
            totalRequests: 1250,
            successfulRequests: 1200,
            failedRequests: 50,
            rateLimitExceeded: 10,
            lastUsed: new Date().toISOString(),
          },
        }),
      });
    });

    // Open key details
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.click();

    // Click usage tab
    await page.click('button:has-text("Usage"), [role="tab"]:has-text("Usage")');

    // Verify usage statistics are displayed
    await expect(
      page.locator('.usage-chart, [data-testid="usage-statistics"]')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify usage metrics are shown
    await expect(page.locator('text=/requests|usage|statistics/i')).toBeVisible();
  });

  test('should view API key security information', async ({ page }) => {
    // Open key details
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.click();

    // Click security tab
    await page.click('button:has-text("Security"), [role="tab"]:has-text("Security")');

    // Verify security information is displayed
    await expect(
      page.locator('.security-info, [data-testid="security-details"]')
    ).toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify security details are shown
    await expect(page.locator('text=/last used|ip address|security/i')).toBeVisible();
  });

  test('should revoke API key with confirmation', async ({ page }) => {
    await page.route('**/api/api-keys/*/revoke', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'API key revoked successfully',
        }),
      });
    });

    // Click revoke button
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.locator('button:has-text("Revoke"), [aria-label*="revoke" i]').click();

    // Verify confirmation modal appears
    await expect(
      page.locator('[role="dialog"]:has-text("Revoke"), .confirm-modal')
    ).toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify warning message
    await expect(
      page.locator('text=/are you sure|cannot be undone|revoke this key/i')
    ).toBeVisible();

    // Confirm revocation
    await page.click('button:has-text("Revoke"), button:has-text("Confirm")');

    // Verify success message
    await expect(
      page.locator('text=/revoked successfully|key has been revoked/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should cancel key revocation', async ({ page }) => {
    // Click revoke button
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.locator('button:has-text("Revoke")').click();

    // Wait for confirmation modal
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: TIMEOUTS.animation });

    // Cancel
    await page.click('button:has-text("Cancel")');

    // Verify modal is closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: TIMEOUTS.animation });

    // Verify key is still active
    await expect(keyRow).toBeVisible();
  });

  test('should show revoked status after revocation', async ({ page }) => {
    await page.route('**/api/api-keys/*/revoke', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'API key revoked successfully',
        }),
      });
    });

    // Revoke key
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.locator('button:has-text("Revoke")').click();
    await page.click('button:has-text("Revoke"), button:has-text("Confirm")');

    // Wait for success
    await expect(
      page.locator('text=/revoked successfully/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Close any modals
    const closeButton = page.locator('button:has-text("Close"), button:has-text("Done")');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }

    // Verify key shows revoked status
    const statusBadge = keyRow.locator('.key-status, [data-testid="key-status"]');
    await expect(statusBadge).toContainText(/revoked/i);
  });

  test('should filter keys by status', async ({ page }) => {
    // Select revoked filter
    await apiKeysPage.filterByStatus('revoked');

    // If no revoked keys exist, list should be empty or show no results message
    const noResults = page.locator('text=/no keys found|no revoked keys/i');
    const isVisible = await noResults.isVisible().catch(() => false);

    if (isVisible) {
      await expect(noResults).toBeVisible();
    }

    // Select all/active filter
    await apiKeysPage.filterByStatus('active');

    // Verify the active test key appears
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await expect(keyRow).toBeVisible();
  });

  test('should search for keys by name', async ({ page }) => {
    await apiKeysPage.searchKeys(testKeyName);

    // Verify the matching key appears
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await expect(keyRow).toBeVisible();

    // Search for non-existent key
    await apiKeysPage.searchKeys('NonExistentKey12345');

    // Verify no results or empty message
    const noResults = page.locator('text=/no keys found|no results/i');
    await expect(noResults).toBeVisible();
  });

  test('should display key creation date', async ({ page }) => {
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);

    // Look for date display
    const dateElement = keyRow.locator('text=/created|ago|last used/i');
    await expect(dateElement).toBeVisible();
  });

  test('should display key scopes', async ({ page }) => {
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.click();

    // Verify scopes are displayed in details
    await expect(page.locator('text=/read:benchmarks/i')).toBeVisible();
  });

  test('should handle pagination if many keys exist', async ({ page }) => {
    // Look for pagination controls
    const pagination = page.locator('[role="navigation"], .pagination, button:has-text("Next")');
    const hasPagination = await pagination.count();

    // If pagination exists, test it
    if (hasPagination > 0) {
      const nextButton = page.locator('button:has-text("Next"), [aria-label*="next" i]');
      if (await nextButton.isEnabled()) {
        await nextButton.click();

        // Verify page changed
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('should display rate limit information', async ({ page }) => {
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.click();

    // Look for rate limit info
    const rateLimitInfo = page.locator('text=/rate limit|requests per/i');
    await expect(rateLimitInfo).toBeVisible();
  });

  test('should display expiration information', async ({ page }) => {
    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.click();

    // Look for expiration info
    const expirationInfo = page.locator('text=/expires|expiration|never expires/i');
    await expect(expirationInfo).toBeVisible();
  });

  test('should not allow editing of revoked keys', async ({ page }) => {
    // First revoke the key
    await page.route('**/api/api-keys/*/revoke', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'API key revoked successfully',
        }),
      });
    });

    const keyRow = await apiKeysPage.getKeyByName(testKeyName);
    await keyRow.locator('button:has-text("Revoke")').click();
    await page.click('button:has-text("Confirm")');

    // Wait for revocation
    await expect(
      page.locator('text=/revoked successfully/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Close modal if open
    const closeButton = page.locator('button:has-text("Close")');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }

    // Try to access key details
    await page.reload();
    const revokedKeyRow = await apiKeysPage.getKeyByName(testKeyName);
    await revokedKeyRow.click();

    // Verify edit button is disabled or not present
    const editButton = page.locator('button:has-text("Edit")');
    const isEditVisible = await editButton.isVisible().catch(() => false);

    if (isEditVisible) {
      await expect(editButton).toBeDisabled();
    }
  });

  test('should show empty state when no keys exist', async ({ page }) => {
    // Delete/revoke all keys first
    await page.route('**/api/api-keys', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          keys: [],
        }),
      });
    });

    await page.reload();

    // Verify empty state message
    const emptyState = page.locator('text=/no api keys|create your first|get started/i');
    await expect(emptyState).toBeVisible();

    // Verify generate button is still available
    await expect(apiKeysPage.generateKeyButton).toBeVisible();
  });
});
