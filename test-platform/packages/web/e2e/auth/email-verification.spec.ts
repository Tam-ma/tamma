/**
 * Email Verification E2E Tests
 *
 * Tests the email verification flow including:
 * - Valid token verification
 * - Expired token handling
 * - Invalid token handling
 * - UI feedback and navigation
 */

import { test, expect } from '@playwright/test';
import { MOCK_TOKENS, ROUTES, TIMEOUTS } from '../fixtures/test-data';
import { verifyEmail, clearAuthState } from '../helpers/auth';

test.describe('Email Verification Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing authentication state
    await clearAuthState(page);
  });

  test('should successfully verify email with valid token', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

    // Mock successful verification API response
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

    // Navigate to verification page with valid token
    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Verify success message appears
    await expect(
      page.locator('text=/email verified|verification successful|verified successfully/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify redirect to login page or dashboard
    await page.waitForURL(/\/(login|dashboard)/, { timeout: TIMEOUTS.navigation });
  });

  test('should display verification page with loading state', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

    // Add delay to API response to observe loading state
    await page.route('**/api/auth/verify-email*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Email verified successfully',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Verify loading indicator appears
    const loadingIndicator = page.locator(
      'text=/verifying|please wait/i, [role="status"], .spinner, .loading'
    );
    await expect(loadingIndicator).toBeVisible();
  });

  test('should handle expired verification token', async ({ page }) => {
    const expiredToken = MOCK_TOKENS.expiredVerification;

    // Mock expired token API response
    await page.route('**/api/auth/verify-email*', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Verification token has expired',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${expiredToken}`);

    // Verify error message appears
    await expect(
      page.locator('text=/expired|no longer valid|token expired/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify option to request new verification email
    const resendButton = page.locator('button:has-text("Resend"), a:has-text("Resend")');
    await expect(resendButton).toBeVisible();
  });

  test('should handle invalid verification token', async ({ page }) => {
    const invalidToken = MOCK_TOKENS.invalidVerification;

    // Mock invalid token API response
    await page.route('**/api/auth/verify-email*', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Invalid verification token',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${invalidToken}`);

    // Verify error message appears
    await expect(
      page.locator('text=/invalid|not found|verification failed/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should handle missing verification token', async ({ page }) => {
    // Navigate without token parameter
    await page.goto(ROUTES.verifyEmail);

    // Verify error message for missing token
    await expect(
      page.locator('text=/missing token|no token|invalid link/i')
    ).toBeVisible();
  });

  test('should allow user to resend verification email', async ({ page }) => {
    const expiredToken = MOCK_TOKENS.expiredVerification;

    // Mock expired token response
    await page.route('**/api/auth/verify-email*', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Verification token has expired',
        }),
      });
    });

    // Mock resend verification email API
    await page.route('**/api/auth/resend-verification*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Verification email sent',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${expiredToken}`);

    // Click resend button
    const resendButton = page.locator('button:has-text("Resend"), a:has-text("Resend")');
    await resendButton.click();

    // Verify success message
    await expect(
      page.locator('text=/email sent|check your email|new verification email/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should show appropriate error for network failures', async ({ page, context }) => {
    const validToken = MOCK_TOKENS.validVerification;

    // Simulate network failure
    await context.route('**/api/auth/verify-email*', (route) => {
      route.abort('failed');
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Verify network error message appears
    await expect(
      page.locator('text=/network error|connection failed|try again/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify retry button is available
    const retryButton = page.locator('button:has-text("Try Again"), button:has-text("Retry")');
    await expect(retryButton).toBeVisible();
  });

  test('should allow retry after verification failure', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

    let attemptCount = 0;

    // Mock first request to fail, second to succeed
    await page.route('**/api/auth/verify-email*', (route) => {
      attemptCount++;

      if (attemptCount === 1) {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Server error',
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Email verified successfully',
          }),
        });
      }
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Wait for error to appear
    await expect(page.locator('text=/error|failed/i')).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Click retry button
    const retryButton = page.locator('button:has-text("Try Again"), button:has-text("Retry")');
    await retryButton.click();

    // Verify success on retry
    await expect(
      page.locator('text=/email verified|verification successful/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should display instructions for already verified email', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

    // Mock already verified response
    await page.route('**/api/auth/verify-email*', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Email already verified',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Verify message indicating email is already verified
    await expect(
      page.locator('text=/already verified|email has been verified/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify login link is provided
    const loginLink = page.locator('a[href*="/login"]');
    await expect(loginLink).toBeVisible();
  });

  test('should provide link to login after successful verification', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

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

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Verify login link is available
    const loginLink = page.locator('a[href*="/login"], button:has-text("Sign In")');
    await expect(loginLink).toBeVisible({ timeout: TIMEOUTS.navigation });

    // Click login link
    await loginLink.click();

    // Verify navigation to login page
    await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
  });

  test('should have proper accessibility attributes', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

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

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Check for proper ARIA attributes on status messages
    const statusMessage = page.locator('[role="status"], [role="alert"]');
    const count = await statusMessage.count();

    // At least one status/alert element should be present
    expect(count).toBeGreaterThan(0);
  });

  test('should handle malformed token in URL', async ({ page }) => {
    const malformedToken = 'malformed%20token%20with%20spaces';

    await page.route('**/api/auth/verify-email*', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Invalid token format',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${malformedToken}`);

    // Verify error message
    await expect(
      page.locator('text=/invalid|malformed|verification failed/i')
    ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
  });

  test('should show verification instructions before token verification', async ({ page }) => {
    const validToken = MOCK_TOKENS.validVerification;

    // Add delay to see initial state
    await page.route('**/api/auth/verify-email*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Email verified successfully',
        }),
      });
    });

    await page.goto(`${ROUTES.verifyEmail}?token=${validToken}`);

    // Verify instructions or loading message
    const instructions = page.locator('text=/verifying|processing|please wait/i');
    await expect(instructions).toBeVisible();
  });
});
