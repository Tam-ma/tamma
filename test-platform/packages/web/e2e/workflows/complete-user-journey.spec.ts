/**
 * Complete User Journey E2E Test
 *
 * Tests the complete end-to-end user journey from registration to API key usage:
 * 1. Register new user
 * 2. Verify email (mock token)
 * 3. Login
 * 4. Create API key
 * 5. View API key usage
 * 6. Change password
 * 7. Logout
 * 8. Login with new password
 */

import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/RegisterPage';
import { LoginPage } from '../pages/LoginPage';
import { APIKeysPage } from '../pages/APIKeysPage';
import {
  createTestUser,
  createTestAPIKey,
  MOCK_TOKENS,
  ROUTES,
  TIMEOUTS,
  generateStrongPassword,
} from '../fixtures/test-data';
import { clearAuthState, waitForAuthentication } from '../helpers/auth';

test.describe('Complete User Journey', () => {
  test('should complete full user lifecycle from registration to API key management', async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const testUser = createTestUser();
    const newPassword = generateStrongPassword();
    const testApiKey = createTestAPIKey();

    // Clear any existing state
    await clearAuthState(page);

    // Step 1: Register new user
    await test.step('Register new user', async () => {
      const registerPage = new RegisterPage(page);

      await page.route('**/api/auth/register', (route) => {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Registration successful',
          }),
        });
      });

      await registerPage.goto();
      await registerPage.register(
        testUser.fullName,
        testUser.email,
        testUser.password,
        testUser.confirmPassword!
      );

      // Verify redirect to verification page
      await page.waitForURL(/\/verify-email/, { timeout: TIMEOUTS.navigation });
    });

    // Step 2: Verify email
    await test.step('Verify email address', async () => {
      await page.route('**/api/auth/verify-email*', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Email verified successfully',
          }),
        });
      });

      await page.goto(`${ROUTES.verifyEmail}?token=${MOCK_TOKENS.validVerification}`);

      // Verify success message
      await expect(page.locator('text=/email verified|verification successful/i')).toBeVisible({
        timeout: TIMEOUTS.apiRequest,
      });

      // Navigate to login
      await page.click('a[href*="/login"], button:has-text("Sign In")');
      await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
    });

    // Step 3: Login with registered credentials
    await test.step('Login with new credentials', async () => {
      const loginPage = new LoginPage(page);

      await page.route('**/api/auth/login', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            token: 'mock-jwt-token-123456',
            user: {
              id: '1',
              email: testUser.email,
              fullName: testUser.fullName,
            },
          }),
        });
      });

      await loginPage.login(testUser.email, testUser.password, true);

      // Verify redirect to dashboard
      await page.waitForURL(/\/(dashboard|$)/, { timeout: TIMEOUTS.navigation });

      // Verify authentication
      await waitForAuthentication(page);
    });

    // Step 4: Create API key
    await test.step('Create new API key', async () => {
      const apiKeysPage = new APIKeysPage(page);

      await page.route('**/api/api-keys/create', (route) => {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            apiKey: {
              id: 'key-123',
              name: testApiKey.name,
              key: 'sk_test_' + Math.random().toString(36).substring(2, 34),
              scopes: testApiKey.scopes,
              createdAt: new Date().toISOString(),
              status: 'active',
            },
          }),
        });
      });

      await apiKeysPage.goto();
      await apiKeysPage.clickGenerateKey();

      // Fill API key form
      await page.fill('[name="name"]', testApiKey.name);
      await page.fill('[name="description"]', testApiKey.description);

      // Select scopes
      for (const scope of testApiKey.scopes) {
        await page.check(`[value="${scope}"]`);
      }

      // Set rate limit and expiration
      await page.fill('[name="rateLimit"]', testApiKey.rateLimit.toString());
      await page.fill('[name="expiresInDays"]', testApiKey.expiresInDays.toString());

      // Submit
      await page.click('button[type="submit"]');

      // Verify key generated modal
      await expect(page.locator('text=/API Key Generated/i')).toBeVisible({
        timeout: TIMEOUTS.apiRequest,
      });

      // Copy key
      await page.click('button:has-text("Copy")');

      // Confirm and close
      await page.check('[name="confirmed"]');
      await page.click('button:has-text("Done")');

      // Verify key appears in list
      const keyRow = await apiKeysPage.getKeyByName(testApiKey.name);
      await expect(keyRow).toBeVisible();
    });

    // Step 5: View API key usage
    await test.step('View API key usage statistics', async () => {
      await page.route('**/api/api-keys/*/usage', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            usage: {
              totalRequests: 100,
              successfulRequests: 95,
              failedRequests: 5,
              lastUsed: new Date().toISOString(),
            },
          }),
        });
      });

      const apiKeysPage = new APIKeysPage(page);
      const keyRow = await apiKeysPage.getKeyByName(testApiKey.name);
      await keyRow.click();

      // Click usage tab
      await page.click('button:has-text("Usage"), [role="tab"]:has-text("Usage")');

      // Verify usage stats are displayed
      await expect(page.locator('.usage-chart, [data-testid="usage-statistics"]')).toBeVisible({
        timeout: TIMEOUTS.apiRequest,
      });

      // Close details
      await page.click('button:has-text("Close"), [aria-label*="close" i]');
    });

    // Step 6: Change password
    await test.step('Change password', async () => {
      await page.route('**/api/auth/change-password', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Password changed successfully',
          }),
        });
      });

      // Navigate to settings/profile
      await page.goto('/settings/profile');

      // Fill change password form
      await page.fill('#currentPassword', testUser.password);
      await page.fill('#newPassword', newPassword);
      await page.fill('#confirmNewPassword', newPassword);

      // Submit
      await page.click('button:has-text("Change Password"), button:has-text("Update Password")');

      // Verify success message
      await expect(page.locator('text=/password changed|updated successfully/i')).toBeVisible({
        timeout: TIMEOUTS.apiRequest,
      });
    });

    // Step 7: Logout
    await test.step('Logout', async () => {
      // Click user menu
      await page.click('[data-testid="user-menu"], [aria-label*="user menu" i]');

      // Click logout
      await page.click('[data-testid="logout-button"], text=/sign out|logout/i');

      // Verify redirect to login
      await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
    });

    // Step 8: Login with new password
    await test.step('Login with new password', async () => {
      const loginPage = new LoginPage(page);

      await page.route('**/api/auth/login', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            token: 'mock-jwt-token-789012',
            user: {
              id: '1',
              email: testUser.email,
              fullName: testUser.fullName,
            },
          }),
        });
      });

      await loginPage.login(testUser.email, newPassword);

      // Verify successful login
      await page.waitForURL(/\/(dashboard|$)/, { timeout: TIMEOUTS.navigation });

      // Verify authentication
      await waitForAuthentication(page);
    });

    // Final verification: Navigate to API keys and verify our key still exists
    await test.step('Verify API key persisted across sessions', async () => {
      const apiKeysPage = new APIKeysPage(page);

      await page.route('**/api/api-keys', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            keys: [
              {
                id: 'key-123',
                name: testApiKey.name,
                scopes: testApiKey.scopes,
                createdAt: new Date().toISOString(),
                status: 'active',
              },
            ],
          }),
        });
      });

      await apiKeysPage.goto();

      // Verify our key is still there
      const keyRow = await apiKeysPage.getKeyByName(testApiKey.name);
      await expect(keyRow).toBeVisible();
    });
  });

  test('should handle errors gracefully during user journey', async ({ page }) => {
    const testUser = createTestUser();

    await clearAuthState(page);

    // Attempt registration with network error
    await test.step('Handle registration error', async () => {
      const registerPage = new RegisterPage(page);

      await page.route('**/api/auth/register', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Registration failed',
          }),
        });
      });

      await registerPage.goto();
      await registerPage.register(
        testUser.fullName,
        testUser.email,
        testUser.password,
        testUser.confirmPassword!
      );

      // Verify error message
      await expect(registerPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });
    });
  });

  test('should maintain user session across page refreshes', async ({ page }) => {
    const testUser = createTestUser();

    await clearAuthState(page);

    // Login
    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-jwt-token-123456',
          user: {
            id: '1',
            email: testUser.email,
            fullName: testUser.fullName,
          },
        }),
      });
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testUser.email, testUser.password, true);

    // Wait for authentication
    await waitForAuthentication(page);

    // Refresh page
    await page.reload();

    // Verify still authenticated (should not redirect to login)
    await page.waitForLoadState('networkidle');

    // Should not be on login page
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');
  });
});
