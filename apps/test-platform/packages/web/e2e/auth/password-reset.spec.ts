/**
 * Password Reset Flow E2E Tests
 *
 * Tests the complete password reset flow including:
 * - Forgot password request
 * - Reset password with valid token
 * - Expired/invalid token handling
 * - Password validation
 * - UI feedback and navigation
 */

import { test, expect } from '@playwright/test';
import {
  MOCK_TOKENS,
  ROUTES,
  TIMEOUTS,
  TEST_CREDENTIALS,
  generateStrongPassword,
} from '../fixtures/test-data';
import { clearAuthState } from '../helpers/auth';

test.describe('Password Reset Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing authentication state
    await clearAuthState(page);
  });

  test.describe('Forgot Password', () => {
    test('should display forgot password form', async ({ page }) => {
      await page.goto(ROUTES.forgotPassword);

      // Verify page title
      await expect(page).toHaveTitle(/forgot password|reset password/i);

      // Verify form elements
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expect(page.locator('a[href="/login"]')).toBeVisible();
    });

    test('should successfully request password reset', async ({ page }) => {
      await page.route('**/api/auth/forgot-password', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Password reset email sent',
          }),
        });
      });

      await page.goto(ROUTES.forgotPassword);
      await page.fill('#email', TEST_CREDENTIALS.email);
      await page.click('button[type="submit"]');

      // Verify success message
      await expect(
        page.locator('text=/email sent|check your email|reset link/i')
      ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
    });

    test('should show error for invalid email', async ({ page }) => {
      await page.goto(ROUTES.forgotPassword);
      await page.fill('#email', 'invalid-email');
      await page.click('button[type="submit"]');

      // Verify email validation error
      const emailError = page.locator('#email-error, [id*="email"][role="alert"]');
      await expect(emailError).toBeVisible();
      await expect(emailError).toContainText(/invalid|valid email/i);
    });

    test('should show error for empty email', async ({ page }) => {
      await page.goto(ROUTES.forgotPassword);
      await page.click('button[type="submit"]');

      // Verify required error
      const emailError = page.locator('#email-error, [id*="email"][role="alert"]');
      await expect(emailError).toBeVisible();
      await expect(emailError).toContainText(/required|enter/i);
    });

    test('should show error for non-existent email', async ({ page }) => {
      await page.route('**/api/auth/forgot-password', (route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Email not found',
          }),
        });
      });

      await page.goto(ROUTES.forgotPassword);
      await page.fill('#email', 'nonexistent@example.com');
      await page.click('button[type="submit"]');

      // Verify error message (or success for security - no user enumeration)
      const alert = page.locator('[role="alert"]');
      await expect(alert).toBeVisible({ timeout: TIMEOUTS.apiRequest });
    });

    test('should disable submit button while processing', async ({ page }) => {
      await page.route('**/api/auth/forgot-password', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Email sent',
          }),
        });
      });

      await page.goto(ROUTES.forgotPassword);
      await page.fill('#email', TEST_CREDENTIALS.email);

      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Verify button is disabled
      await expect(submitButton).toBeDisabled();
    });

    test('should navigate back to login', async ({ page }) => {
      await page.goto(ROUTES.forgotPassword);
      await page.click('a[href="/login"]');

      // Verify navigation to login
      await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
    });
  });

  test.describe('Reset Password', () => {
    test('should display reset password form with valid token', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);

      // Verify form elements
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('#confirmPassword')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should successfully reset password with valid token', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;
      const newPassword = generateStrongPassword();

      await page.route('**/api/auth/reset-password', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Password reset successfully',
          }),
        });
      });

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);
      await page.click('button[type="submit"]');

      // Verify success message and redirect to login
      await expect(
        page.locator('text=/password reset|successfully reset|password updated/i')
      ).toBeVisible({ timeout: TIMEOUTS.apiRequest });

      await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
    });

    test('should show error for expired token', async ({ page }) => {
      const expiredToken = MOCK_TOKENS.expiredPasswordReset;

      await page.route('**/api/auth/reset-password', (route) => {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Reset token has expired',
          }),
        });
      });

      await page.goto(`${ROUTES.resetPassword}?token=${expiredToken}`);

      // May show error immediately or after submission
      const newPassword = generateStrongPassword();
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);
      await page.click('button[type="submit"]');

      // Verify error message
      await expect(
        page.locator('text=/expired|no longer valid|token expired/i')
      ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
    });

    test('should show error for invalid token', async ({ page }) => {
      const invalidToken = MOCK_TOKENS.invalidPasswordReset;

      await page.route('**/api/auth/reset-password', (route) => {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Invalid reset token',
          }),
        });
      });

      await page.goto(`${ROUTES.resetPassword}?token=${invalidToken}`);

      const newPassword = generateStrongPassword();
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);
      await page.click('button[type="submit"]');

      // Verify error message
      await expect(
        page.locator('text=/invalid|not found|token invalid/i')
      ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
    });

    test('should show error for missing token', async ({ page }) => {
      await page.goto(ROUTES.resetPassword);

      // Verify error about missing token
      await expect(
        page.locator('text=/missing token|no token|invalid link/i')
      ).toBeVisible();
    });

    test('should validate weak password', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);
      await page.fill('#password', 'weak');
      await page.fill('#confirmPassword', 'weak');
      await page.click('button[type="submit"]');

      // Verify password validation error
      const passwordError = page.locator('#password-error, [id*="password"][role="alert"]');
      await expect(passwordError).toBeVisible();
      await expect(passwordError).toContainText(/password must be|at least|characters/i);
    });

    test('should validate password mismatch', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;
      const password1 = generateStrongPassword();
      const password2 = generateStrongPassword();

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);
      await page.fill('#password', password1);
      await page.fill('#confirmPassword', password2);
      await page.click('button[type="submit"]');

      // Verify mismatch error
      const confirmError = page.locator('#confirmPassword-error, [id*="confirm"][role="alert"]');
      await expect(confirmError).toBeVisible();
      await expect(confirmError).toContainText(/passwords must match|do not match/i);
    });

    test('should show password strength indicator', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);

      // Type weak password
      await page.fill('#password', 'weak');

      // Look for strength indicator (optional feature)
      const strengthIndicator = page.locator(
        '[data-testid="password-strength"], .password-strength, text=/weak|strong|medium/i'
      );

      const isVisible = await strengthIndicator.isVisible().catch(() => false);

      if (isVisible) {
        await expect(strengthIndicator).toContainText(/weak/i);
      }
    });

    test('should toggle password visibility', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);

      const passwordInput = page.locator('#password');
      const toggleButton = page.locator('button[aria-label*="password" i]').first();

      await passwordInput.fill('TestPassword123!');

      // Verify password is hidden initially
      await expect(passwordInput).toHaveAttribute('type', 'password');

      // Toggle visibility
      await toggleButton.click();

      // Verify password is now visible
      await expect(passwordInput).toHaveAttribute('type', 'text');
    });

    test('should disable submit button while processing', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;
      const newPassword = generateStrongPassword();

      await page.route('**/api/auth/reset-password', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Password reset',
          }),
        });
      });

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);

      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Verify button is disabled
      await expect(submitButton).toBeDisabled();
    });

    test('should handle network errors gracefully', async ({ page, context }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;
      const newPassword = generateStrongPassword();

      // Simulate network failure
      await context.route('**/api/auth/reset-password', (route) => {
        route.abort('failed');
      });

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);
      await page.click('button[type="submit"]');

      // Verify error message
      await expect(
        page.locator('text=/network error|connection failed|try again/i')
      ).toBeVisible({ timeout: TIMEOUTS.apiRequest });
    });

    test('should provide option to request new reset link if expired', async ({ page }) => {
      const expiredToken = MOCK_TOKENS.expiredPasswordReset;

      await page.route('**/api/auth/reset-password', (route) => {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Reset token has expired',
          }),
        });
      });

      await page.goto(`${ROUTES.resetPassword}?token=${expiredToken}`);

      const newPassword = generateStrongPassword();
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);
      await page.click('button[type="submit"]');

      // Wait for error
      await expect(page.locator('text=/expired/i')).toBeVisible({ timeout: TIMEOUTS.apiRequest });

      // Look for link to request new reset
      const requestNewLink = page.locator('a[href*="forgot-password"], button:has-text("Request New Link")');
      await expect(requestNewLink).toBeVisible();
    });

    test('should have proper accessibility attributes', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);

      // Check for proper labels
      await expect(page.locator('label[for="password"]')).toBeVisible();
      await expect(page.locator('label[for="confirmPassword"]')).toBeVisible();
    });

    test('should support Enter key for form submission', async ({ page }) => {
      const validToken = MOCK_TOKENS.validPasswordReset;
      const newPassword = generateStrongPassword();

      await page.route('**/api/auth/reset-password', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Password reset',
          }),
        });
      });

      await page.goto(`${ROUTES.resetPassword}?token=${validToken}`);
      await page.fill('#password', newPassword);
      await page.fill('#confirmPassword', newPassword);

      // Press Enter instead of clicking submit
      await page.locator('#confirmPassword').press('Enter');

      // Verify submission succeeds
      await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
    });
  });
});
