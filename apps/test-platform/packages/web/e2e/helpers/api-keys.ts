/**
 * API Keys Helper Utilities
 *
 * Provides reusable functions for API key management operations in E2E tests.
 * These helpers simplify interactions with the API keys management interface.
 */

import { Page, expect } from '@playwright/test';
import { TestAPIKey, ROUTES, TIMEOUTS } from '../fixtures/test-data';

/**
 * Navigates to the API keys management page
 *
 * @param page - Playwright page instance
 */
export async function navigateToAPIKeysPage(page: Page): Promise<void> {
  await page.goto(ROUTES.apiKeys);
  await page.waitForLoadState('networkidle');
}

/**
 * Creates a new API key
 *
 * @param page - Playwright page instance
 * @param keyData - API key configuration data
 * @returns Promise that resolves with the generated API key value
 */
export async function createAPIKey(
  page: Page,
  keyData: TestAPIKey
): Promise<string> {
  await navigateToAPIKeysPage(page);

  // Click "Generate New Key" button
  await page.click('button:has-text("Generate New Key"), button:has-text("Create API Key")');

  // Wait for modal to appear
  await expect(page.locator('[role="dialog"], .modal')).toBeVisible({
    timeout: TIMEOUTS.animation,
  });

  // Fill in key details
  await page.fill('[name="name"], #keyName', keyData.name);
  await page.fill('[name="description"], #keyDescription', keyData.description);

  // Select scopes
  for (const scope of keyData.scopes) {
    await page.check(`[value="${scope}"], input[name="scopes"][value="${scope}"]`);
  }

  // Set rate limit
  await page.fill('[name="rateLimit"], #rateLimit', keyData.rateLimit.toString());

  // Set expiration
  await page.fill('[name="expiresInDays"], #expiresInDays', keyData.expiresInDays.toString());

  // Submit form
  await page.click('button[type="submit"]:has-text("Generate"), button:has-text("Create")');

  // Wait for key generated modal
  await expect(
    page.locator('text=/API Key Generated|Your API Key/i')
  ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

  // Extract and copy the generated API key
  const apiKeyElement = page.locator('[data-testid="generated-api-key"], .api-key-value, code');
  const apiKey = await apiKeyElement.textContent();

  if (!apiKey) {
    throw new Error('Failed to extract generated API key');
  }

  // Copy key to clipboard
  await page.click('button:has-text("Copy"), [aria-label*="copy" i]');

  // Confirm "I have saved this key"
  await page.check('[name="confirmed"], #confirmSaved');

  // Close modal
  await page.click('button:has-text("Done"), button:has-text("Close")');

  // Wait for modal to close
  await expect(page.locator('[role="dialog"], .modal')).not.toBeVisible({
    timeout: TIMEOUTS.animation,
  });

  return apiKey.trim();
}

/**
 * Gets list of all API keys
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves with array of API key information
 */
export async function getAPIKeys(page: Page): Promise<Array<{
  id: string;
  name: string;
  status: string;
}>> {
  await navigateToAPIKeysPage(page);

  const keyRows = page.locator('[data-testid="api-key-row"], .api-key-item');
  const count = await keyRows.count();

  const keys: Array<{ id: string; name: string; status: string }> = [];

  for (let i = 0; i < count; i++) {
    const row = keyRows.nth(i);
    const id = await row.getAttribute('data-key-id') || `key-${i}`;
    const name = await row.locator('.key-name, [data-testid="key-name"]').textContent() || '';
    const status = await row.locator('.key-status, [data-testid="key-status"]').textContent() || 'active';

    keys.push({ id, name: name.trim(), status: status.trim().toLowerCase() });
  }

  return keys;
}

/**
 * Finds an API key by name
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key to find
 * @returns Promise that resolves with the key row locator or null
 */
export async function findAPIKeyByName(page: Page, keyName: string) {
  await navigateToAPIKeysPage(page);

  const keyRow = page.locator(`[data-testid="api-key-row"]:has-text("${keyName}"), .api-key-item:has-text("${keyName}")`);
  const count = await keyRow.count();

  return count > 0 ? keyRow.first() : null;
}

/**
 * Views API key details
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key to view
 */
export async function viewAPIKeyDetails(page: Page, keyName: string): Promise<void> {
  const keyRow = await findAPIKeyByName(page, keyName);

  if (!keyRow) {
    throw new Error(`API key with name "${keyName}" not found`);
  }

  // Click on the key name or details button
  await keyRow.locator('.key-name, [data-testid="key-name"], button:has-text("Details")').click();

  // Wait for details modal/page to appear
  await expect(
    page.locator('[role="dialog"]:has-text("Details"), .key-details')
  ).toBeVisible({ timeout: TIMEOUTS.animation });
}

/**
 * Updates API key details
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key to update
 * @param updates - Updates to apply
 */
export async function updateAPIKey(
  page: Page,
  keyName: string,
  updates: Partial<TestAPIKey>
): Promise<void> {
  await viewAPIKeyDetails(page, keyName);

  // Click edit button
  await page.click('button:has-text("Edit"), [aria-label*="edit" i]');

  // Update fields
  if (updates.name) {
    await page.fill('[name="name"], #keyName', updates.name);
  }

  if (updates.description) {
    await page.fill('[name="description"], #keyDescription', updates.description);
  }

  if (updates.rateLimit) {
    await page.fill('[name="rateLimit"], #rateLimit', updates.rateLimit.toString());
  }

  // Save changes
  await page.click('button[type="submit"]:has-text("Save"), button:has-text("Update")');

  // Wait for success message
  await expect(
    page.locator('text=/updated successfully|changes saved/i')
  ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
}

/**
 * Revokes an API key
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key to revoke
 */
export async function revokeAPIKey(page: Page, keyName: string): Promise<void> {
  const keyRow = await findAPIKeyByName(page, keyName);

  if (!keyRow) {
    throw new Error(`API key with name "${keyName}" not found`);
  }

  // Click revoke button
  await keyRow.locator('button:has-text("Revoke"), [aria-label*="revoke" i]').click();

  // Wait for confirmation modal
  await expect(
    page.locator('[role="dialog"]:has-text("Revoke"), .confirm-modal')
  ).toBeVisible({ timeout: TIMEOUTS.animation });

  // Confirm revocation
  await page.click('button:has-text("Revoke"), button:has-text("Confirm")');

  // Wait for success message
  await expect(
    page.locator('text=/revoked successfully|key has been revoked/i')
  ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

  // Close modal if needed
  const closeButton = page.locator('button:has-text("Close"), button:has-text("Done")');
  if (await closeButton.isVisible()) {
    await closeButton.click();
  }
}

/**
 * Views API key usage statistics
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key
 */
export async function viewAPIKeyUsage(page: Page, keyName: string): Promise<void> {
  await viewAPIKeyDetails(page, keyName);

  // Click on usage tab
  await page.click('button:has-text("Usage"), [role="tab"]:has-text("Usage")');

  // Wait for usage data to load
  await expect(
    page.locator('.usage-chart, [data-testid="usage-statistics"]')
  ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
}

/**
 * Views API key security information
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key
 */
export async function viewAPIKeySecurity(page: Page, keyName: string): Promise<void> {
  await viewAPIKeyDetails(page, keyName);

  // Click on security tab
  await page.click('button:has-text("Security"), [role="tab"]:has-text("Security")');

  // Wait for security info to load
  await expect(
    page.locator('.security-info, [data-testid="security-details"]')
  ).toBeVisible({ timeout: TIMEOUTS.animation });
}

/**
 * Deletes all API keys for a clean test state
 *
 * @param page - Playwright page instance
 */
export async function deleteAllAPIKeys(page: Page): Promise<void> {
  await navigateToAPIKeysPage(page);

  let keys = await getAPIKeys(page);

  while (keys.length > 0) {
    // Revoke the first key
    await revokeAPIKey(page, keys[0].name);

    // Refresh the list
    await page.reload();
    keys = await getAPIKeys(page);
  }
}

/**
 * Asserts that an API key exists
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key
 */
export async function assertAPIKeyExists(page: Page, keyName: string): Promise<void> {
  const keyRow = await findAPIKeyByName(page, keyName);
  expect(keyRow).not.toBeNull();
}

/**
 * Asserts that an API key does not exist
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key
 */
export async function assertAPIKeyNotExists(page: Page, keyName: string): Promise<void> {
  const keyRow = await findAPIKeyByName(page, keyName);
  expect(keyRow).toBeNull();
}

/**
 * Asserts that an API key has a specific status
 *
 * @param page - Playwright page instance
 * @param keyName - Name of the API key
 * @param expectedStatus - Expected status (active, revoked, expired)
 */
export async function assertAPIKeyStatus(
  page: Page,
  keyName: string,
  expectedStatus: string
): Promise<void> {
  const keys = await getAPIKeys(page);
  const key = keys.find((k) => k.name === keyName);

  expect(key).toBeDefined();
  expect(key?.status).toBe(expectedStatus.toLowerCase());
}

/**
 * Copies API key to clipboard
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves with the copied key value
 */
export async function copyAPIKeyToClipboard(page: Page): Promise<string> {
  // Grant clipboard permissions
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  // Get clipboard content after copy action
  const clipboardContent = await page.evaluate(async () => {
    return await navigator.clipboard.readText();
  });

  return clipboardContent;
}
