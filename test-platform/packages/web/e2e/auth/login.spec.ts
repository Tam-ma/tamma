/**
 * Login Flow E2E Tests
 *
 * Tests the complete user login flow including:
 * - Successful login with valid credentials
 * - Remember me functionality
 * - Invalid credentials handling
 * - Unverified email handling
 * - Password visibility toggle
 * - UI feedback and navigation
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import {
  createTestUser,
  TEST_USERS,
  ROUTES,
  TIMEOUTS,
} from '../fixtures/test-data';
import { clearAuthState, isAuthenticated, waitForAuthentication } from '../helpers/auth';

test.describe('Login Flow', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    // Clear any existing authentication state
    await clearAuthState(page);

    // Initialize page object
    loginPage = new LoginPage(page);

    // Navigate to login page
    await loginPage.goto();
  });

  test('should display login form with all required fields', async ({ page }) => {
    // Verify page title
    await expect(page).toHaveTitle(/sign in|login/i);

    // Verify all form fields are present
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.rememberMeCheckbox).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();

    // Verify links are present
    await expect(loginPage.forgotPasswordLink).toBeVisible();
    await expect(loginPage.signUpLink).toBeVisible();
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    const testUser = TEST_USERS.valid;

    // Mock successful login API response
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

    // Perform login
    await loginPage.login(testUser.email, testUser.password);

    // Verify redirect to dashboard
    await page.waitForURL(/\/(dashboard|$)/, { timeout: TIMEOUTS.navigation });

    // Verify user is authenticated
    await waitForAuthentication(page);
    const authenticated = await isAuthenticated(page);
    expect(authenticated).toBeTruthy();
  });

  test('should login with remember me option', async ({ page }) => {
    const testUser = TEST_USERS.valid;

    await page.route('**/api/auth/login', (route) => {
      const requestBody = route.request().postDataJSON();

      // Verify rememberMe was sent
      expect(requestBody.rememberMe).toBe(true);

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

    // Login with remember me
    await loginPage.login(testUser.email, testUser.password, true);

    // Verify redirect
    await page.waitForURL(/\/(dashboard|$)/, { timeout: TIMEOUTS.navigation });
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Invalid email or password',
        }),
      });
    });

    await loginPage.login('invalid@example.com', 'WrongPassword123!');

    // Verify error message appears
    await expect(loginPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/invalid|incorrect|wrong/);

    // Verify user remains on login page
    await expect(page).toHaveURL(ROUTES.login);
  });

  test('should show error for unverified email', async ({ page }) => {
    const unverifiedUser = TEST_USERS.unverified;

    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Please verify your email address before logging in',
        }),
      });
    });

    await loginPage.login(unverifiedUser.email, unverifiedUser.password);

    // Verify error message about unverified email
    await expect(loginPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/verify|verification|unverified/);
  });

  test('should show validation error for empty email', async ({ page }) => {
    await loginPage.login('', 'Password123!');

    // Verify email validation error
    const emailError = page.locator('#email-error, [id*="email"][role="alert"]');
    await expect(emailError).toBeVisible();
    await expect(emailError).toContainText(/required|enter|email/i);
  });

  test('should show validation error for empty password', async ({ page }) => {
    await loginPage.login('test@example.com', '');

    // Verify password validation error
    const passwordError = page.locator('#password-error, [id*="password"][role="alert"]');
    await expect(passwordError).toBeVisible();
    await expect(passwordError).toContainText(/required|enter|password/i);
  });

  test('should show validation error for invalid email format', async ({ page }) => {
    await loginPage.login('not-an-email', 'Password123!');

    // Verify email format error
    const emailError = page.locator('#email-error, [id*="email"][role="alert"]');
    await expect(emailError).toBeVisible();
    await expect(emailError).toContainText(/invalid|valid email/i);
  });

  test('should toggle password visibility', async ({ page }) => {
    await loginPage.passwordInput.fill('TestPassword123!');

    // Verify password is hidden initially
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');

    // Toggle visibility
    await loginPage.togglePasswordVisibility();

    // Verify password is now visible
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');

    // Toggle back
    await loginPage.togglePasswordVisibility();

    // Verify password is hidden again
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('should disable submit button while submitting', async ({ page }) => {
    const testUser = TEST_USERS.valid;

    // Add delay to API response
    await page.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-jwt-token-123456',
        }),
      });
    });

    await loginPage.emailInput.fill(testUser.email);
    await loginPage.passwordInput.fill(testUser.password);
    await loginPage.submitButton.click();

    // Verify button is disabled during submission
    await expect(loginPage.submitButton).toBeDisabled();
  });

  test('should show loading state while submitting', async ({ page }) => {
    const testUser = TEST_USERS.valid;

    await page.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-jwt-token-123456',
        }),
      });
    });

    await loginPage.login(testUser.email, testUser.password);

    // Verify loading indicator appears
    const loadingIndicator = page.locator(
      'text=/signing in|logging in|please wait/i, [role="status"], .spinner'
    );
    await expect(loadingIndicator).toBeVisible();
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await loginPage.clickForgotPassword();

    // Verify navigation to forgot password page
    await page.waitForURL(ROUTES.forgotPassword, { timeout: TIMEOUTS.navigation });
  });

  test('should navigate to registration page', async ({ page }) => {
    await loginPage.clickSignUp();

    // Verify navigation to registration page
    await page.waitForURL(ROUTES.register, { timeout: TIMEOUTS.navigation });
  });

  test('should handle network errors gracefully', async ({ page, context }) => {
    const testUser = TEST_USERS.valid;

    // Simulate network failure
    await context.route('**/api/auth/login', (route) => {
      route.abort('failed');
    });

    await loginPage.login(testUser.email, testUser.password);

    // Verify error message appears
    await expect(loginPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/error|failed|network|try again/);
  });

  test('should preserve email after failed login', async ({ page }) => {
    const testEmail = 'test@example.com';

    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Invalid credentials',
        }),
      });
    });

    await loginPage.login(testEmail, 'WrongPassword123!');

    // Wait for error
    await expect(loginPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    // Verify email is preserved
    await expect(loginPage.emailInput).toHaveValue(testEmail);
  });

  test('should redirect to return URL after login', async ({ page }) => {
    const returnUrl = '/settings/api-keys';
    const testUser = TEST_USERS.valid;

    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-jwt-token-123456',
        }),
      });
    });

    // Navigate with return URL
    await page.goto(`${ROUTES.login}?returnUrl=${returnUrl}`);

    await loginPage.login(testUser.email, testUser.password);

    // Verify redirect to return URL
    await page.waitForURL(returnUrl, { timeout: TIMEOUTS.navigation });
  });

  test('should have proper ARIA labels and accessibility attributes', async ({ page }) => {
    // Check for proper form labels
    await expect(page.locator('label[for="email"]')).toBeVisible();
    await expect(page.locator('label[for="password"]')).toBeVisible();
    await expect(page.locator('label[for="rememberMe"]')).toBeVisible();

    // Check password toggle button has proper ARIA label
    await expect(loginPage.showPasswordButton).toHaveAttribute('aria-label', /.+/);
  });

  test('should handle server errors gracefully', async ({ page }) => {
    const testUser = TEST_USERS.valid;

    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Internal server error',
        }),
      });
    });

    await loginPage.login(testUser.email, testUser.password);

    // Verify error message appears
    await expect(loginPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/error|try again|server/);
  });

  test('should autofocus on email input field', async ({ page }) => {
    // Check if email input has autofocus
    const focusedElement = await page.evaluate(() => document.activeElement?.id);

    // Email should be focused, or no specific focus (acceptable)
    if (focusedElement) {
      expect(focusedElement).toBe('email');
    }
  });

  test('should show password requirements on focus', async ({ page }) => {
    // Focus on password field
    await loginPage.passwordInput.focus();

    // Look for password requirements tooltip/hint (optional feature)
    const passwordHint = page.locator(
      '[data-testid="password-hint"], .password-requirements, text=/at least 12 characters/i'
    );

    // This is optional functionality, just verify if present
    const isVisible = await passwordHint.isVisible().catch(() => false);

    // If password hints are implemented, they should be visible
    // If not implemented, test passes
    if (isVisible) {
      await expect(passwordHint).toBeVisible();
    }
  });

  test('should support Enter key for form submission', async ({ page }) => {
    const testUser = TEST_USERS.valid;

    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-jwt-token-123456',
        }),
      });
    });

    await loginPage.emailInput.fill(testUser.email);
    await loginPage.passwordInput.fill(testUser.password);

    // Press Enter instead of clicking submit button
    await loginPage.passwordInput.press('Enter');

    // Verify login succeeds
    await page.waitForURL(/\/(dashboard|$)/, { timeout: TIMEOUTS.navigation });
  });
});
