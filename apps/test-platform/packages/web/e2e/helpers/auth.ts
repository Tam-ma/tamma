/**
 * Authentication Helper Utilities
 *
 * Provides reusable functions for authentication-related operations in E2E tests.
 * These helpers abstract common authentication patterns and reduce code duplication.
 */

import { Page, expect } from '@playwright/test';
import { TestUser, ROUTES, TIMEOUTS } from '../fixtures/test-data';

/**
 * Performs user login
 *
 * @param page - Playwright page instance
 * @param email - User email address
 * @param password - User password
 * @param rememberMe - Whether to check "Remember Me" option
 * @returns Promise that resolves when login is complete
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  rememberMe: boolean = false
): Promise<void> {
  await page.goto(ROUTES.login);

  // Fill login form
  await page.fill('#email', email);
  await page.fill('#password', password);

  if (rememberMe) {
    await page.check('#rememberMe');
  }

  // Submit form
  await page.click('button[type="submit"]');

  // Wait for navigation to dashboard/home
  await page.waitForURL(/\/(dashboard|$)/, { timeout: TIMEOUTS.navigation });
}

/**
 * Performs user registration
 *
 * @param page - Playwright page instance
 * @param userData - User registration data
 * @returns Promise that resolves when registration is complete
 */
export async function register(page: Page, userData: TestUser): Promise<void> {
  await page.goto(ROUTES.register);

  // Fill registration form
  await page.fill('#fullName', userData.fullName);
  await page.fill('#email', userData.email);
  await page.fill('#password', userData.password);
  await page.fill('#confirmPassword', userData.confirmPassword || userData.password);

  // Submit form
  await page.click('button[type="submit"]');

  // Wait for success message or redirect to verification page
  await page.waitForURL(/\/verify-email/, { timeout: TIMEOUTS.navigation });
}

/**
 * Performs user logout
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves when logout is complete
 */
export async function logout(page: Page): Promise<void> {
  // Click on user menu/avatar
  await page.click('[data-testid="user-menu"], [aria-label*="user menu" i]', {
    timeout: TIMEOUTS.navigation,
  });

  // Click logout button
  await page.click('[data-testid="logout-button"], text=/sign out|logout/i');

  // Wait for redirect to login page
  await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
}

/**
 * Extracts authentication token from storage
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves with the auth token or null
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  // Try to get token from localStorage
  const localStorageToken = await page.evaluate(() => {
    return localStorage.getItem('auth_token') || localStorage.getItem('token');
  });

  if (localStorageToken) {
    return localStorageToken;
  }

  // Try to get token from cookies
  const cookies = await page.context().cookies();
  const authCookie = cookies.find(
    (cookie) => cookie.name === 'auth_token' || cookie.name === 'token'
  );

  return authCookie?.value || null;
}

/**
 * Checks if user is authenticated
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves with true if authenticated, false otherwise
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  const token = await getAuthToken(page);
  return token !== null;
}

/**
 * Sets authentication token directly (for bypassing login)
 *
 * @param page - Playwright page instance
 * @param token - Authentication token to set
 */
export async function setAuthToken(page: Page, token: string): Promise<void> {
  await page.evaluate((authToken) => {
    localStorage.setItem('auth_token', authToken);
  }, token);
}

/**
 * Clears authentication state
 *
 * @param page - Playwright page instance
 */
export async function clearAuthState(page: Page): Promise<void> {
  // Clear cookies first (doesn't require navigating to a page)
  await page.context().clearCookies();

  // Try to clear storage, but only if we're on a page that allows it
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch (error) {
    // Ignore errors if localStorage is not accessible
    // This can happen if we haven't navigated to a page yet
  }
}

/**
 * Performs password reset request
 *
 * @param page - Playwright page instance
 * @param email - Email address for password reset
 */
export async function requestPasswordReset(page: Page, email: string): Promise<void> {
  await page.goto(ROUTES.forgotPassword);
  await page.fill('#email', email);
  await page.click('button[type="submit"]');

  // Wait for success message
  await expect(page.locator('text=/email sent|check your email/i')).toBeVisible({
    timeout: TIMEOUTS.navigation,
  });
}

/**
 * Resets password using reset token
 *
 * @param page - Playwright page instance
 * @param token - Password reset token
 * @param newPassword - New password to set
 */
export async function resetPassword(
  page: Page,
  token: string,
  newPassword: string
): Promise<void> {
  await page.goto(`${ROUTES.resetPassword}?token=${token}`);
  await page.fill('#password', newPassword);
  await page.fill('#confirmPassword', newPassword);
  await page.click('button[type="submit"]');

  // Wait for success message and redirect to login
  await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
}

/**
 * Verifies email using verification token
 *
 * @param page - Playwright page instance
 * @param token - Email verification token
 */
export async function verifyEmail(page: Page, token: string): Promise<void> {
  await page.goto(`${ROUTES.verifyEmail}?token=${token}`);

  // Wait for success message
  await expect(
    page.locator('text=/email verified|verification successful/i')
  ).toBeVisible({ timeout: TIMEOUTS.navigation });
}

/**
 * Waits for authentication to complete
 *
 * @param page - Playwright page instance
 * @param timeout - Maximum time to wait (default: 5000ms)
 */
export async function waitForAuthentication(
  page: Page,
  timeout: number = TIMEOUTS.navigation
): Promise<void> {
  await page.waitForFunction(
    () => {
      return (
        localStorage.getItem('auth_token') !== null ||
        localStorage.getItem('token') !== null ||
        document.cookie.includes('auth_token') ||
        document.cookie.includes('token')
      );
    },
    { timeout }
  );
}

/**
 * Asserts that user is on the login page
 *
 * @param page - Playwright page instance
 */
export async function assertOnLoginPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(ROUTES.login);
  await expect(page.locator('h2:has-text("Sign in")')).toBeVisible();
}

/**
 * Asserts that user is authenticated and on dashboard
 *
 * @param page - Playwright page instance
 */
export async function assertAuthenticated(page: Page): Promise<void> {
  // Check for dashboard URL or user menu presence
  const isOnDashboard = page.url().includes('/dashboard');
  const hasUserMenu = await page.locator('[data-testid="user-menu"]').count();

  expect(isOnDashboard || hasUserMenu > 0).toBeTruthy();
}

/**
 * Creates a test user and performs complete registration flow
 *
 * @param page - Playwright page instance
 * @param userData - User data for registration
 * @returns Promise that resolves with the registered user data
 */
export async function registerAndVerify(
  page: Page,
  userData: TestUser
): Promise<TestUser> {
  await register(page, userData);

  // In a real scenario, you would extract the verification token from email
  // For testing, we'll use a mock token
  const mockToken = 'mock-verification-token-' + Date.now();
  await verifyEmail(page, mockToken);

  return userData;
}

/**
 * Sets up an authenticated session for tests
 * This is useful for tests that need an authenticated user but don't need to test login
 *
 * @param page - Playwright page instance
 * @param userData - User data to use for authentication
 * @returns Promise that resolves when authentication is set up
 */
export async function setupAuthenticatedSession(
  page: Page,
  userData: TestUser
): Promise<void> {
  // For tests, we can either login normally or set a mock token
  // This implementation does a real login for more realistic testing
  await login(page, userData.email, userData.password);

  // Verify authentication succeeded
  await waitForAuthentication(page);
}
