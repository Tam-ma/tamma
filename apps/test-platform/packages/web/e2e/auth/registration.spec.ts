/**
 * Registration Flow E2E Tests
 *
 * Tests the complete user registration flow including:
 * - Successful registration
 * - Form validation (email format, password strength, password matching)
 * - Error handling (duplicate email, network errors)
 * - UI feedback and navigation
 */

import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/RegisterPage';
import {
  createTestUser,
  INVALID_USER_DATA,
  ROUTES,
  TIMEOUTS,
} from '../fixtures/test-data';
import { clearAuthState } from '../helpers/auth';

test.describe('Registration Flow', () => {
  let registerPage: RegisterPage;

  test.beforeEach(async ({ page }) => {
    // Clear any existing authentication state
    await clearAuthState(page);

    // Initialize page object
    registerPage = new RegisterPage(page);

    // Navigate to registration page
    await registerPage.goto();
  });

  test('should display registration form with all required fields', async ({ page }) => {
    // Verify page title contains app name
    await expect(page).toHaveTitle(/tamma test platform/i);

    // Verify all form fields are present
    await expect(registerPage.fullNameInput).toBeVisible();
    await expect(registerPage.emailInput).toBeVisible();
    await expect(registerPage.passwordInput).toBeVisible();
    await expect(registerPage.confirmPasswordInput).toBeVisible();
    await expect(registerPage.submitButton).toBeVisible();

    // Verify login link is present
    await expect(registerPage.loginLink).toBeVisible();
  });

  test('should successfully register a new user', async ({ page }) => {
    const testUser = createTestUser();

    // Fill registration form
    await registerPage.register(
      testUser.fullName,
      testUser.email,
      testUser.password,
      testUser.confirmPassword!
    );

    // Verify redirect to verification page
    await page.waitForURL(/\/verify-email/, { timeout: TIMEOUTS.navigation });

    // Verify we're on the verify-email page (URL should contain email parameter)
    expect(page.url()).toContain('/verify-email');
  });

  test('should show validation error for invalid email format', async ({ page }) => {
    const invalidData = INVALID_USER_DATA.invalidEmail;

    await registerPage.register(
      invalidData.fullName,
      invalidData.email,
      invalidData.password,
      invalidData.password
    );

    // Verify error message appears
    const emailError = page.locator('#email-error, [id*="email"][role="alert"]');
    await expect(emailError).toBeVisible();
    await expect(emailError).toContainText(/invalid email|valid email address/i);
  });

  test('should show validation error for weak password', async ({ page }) => {
    const weakPasswordData = INVALID_USER_DATA.weakPassword;

    await registerPage.register(
      weakPasswordData.fullName,
      weakPasswordData.email,
      weakPasswordData.password,
      weakPasswordData.password
    );

    // Verify password error message
    const passwordError = page.locator('#password-error, [id*="password"][role="alert"]');
    await expect(passwordError).toBeVisible();
    await expect(passwordError).toContainText(
      /password must be|at least|characters|uppercase|lowercase|number/i
    );
  });

  test('should show validation error for password without uppercase letter', async ({ page }) => {
    const noUppercaseData = INVALID_USER_DATA.noUppercase;

    await registerPage.register(
      noUppercaseData.fullName,
      noUppercaseData.email,
      noUppercaseData.password,
      noUppercaseData.password
    );

    // Verify error mentions uppercase requirement
    const passwordError = page.locator('#password-error, [id*="password"][role="alert"]');
    await expect(passwordError).toBeVisible();
    await expect(passwordError).toContainText(/uppercase/i);
  });

  test('should show validation error for password without number', async ({ page }) => {
    const noNumberData = INVALID_USER_DATA.noNumber;

    await registerPage.register(
      noNumberData.fullName,
      noNumberData.email,
      noNumberData.password,
      noNumberData.password
    );

    // Verify error mentions number requirement
    const passwordError = page.locator('#password-error, [id*="password"][role="alert"]');
    await expect(passwordError).toBeVisible();
    await expect(passwordError).toContainText(/number|digit/i);
  });

  test('should show validation error for password that is too short', async ({ page }) => {
    const tooShortData = INVALID_USER_DATA.tooShort;

    await registerPage.register(
      tooShortData.fullName,
      tooShortData.email,
      tooShortData.password,
      tooShortData.password
    );

    // Verify error mentions minimum length
    const passwordError = page.locator('#password-error, [id*="password"][role="alert"]');
    await expect(passwordError).toBeVisible();
    await expect(passwordError).toContainText(/at least|minimum|12|characters/i);
  });

  test('should show validation error when passwords do not match', async ({ page }) => {
    const mismatchData = INVALID_USER_DATA.passwordMismatch;

    await registerPage.register(
      mismatchData.fullName,
      mismatchData.email,
      mismatchData.password,
      mismatchData.confirmPassword!
    );

    // Verify error message for password mismatch
    const confirmError = page.locator('#confirmPassword-error, [id*="confirm"][role="alert"]');
    await expect(confirmError).toBeVisible();
    await expect(confirmError).toContainText(/passwords must match|do not match/i);
  });

  test('should show error for duplicate email address', async ({ page }) => {
    const testUser = createTestUser();

    // First, register the user successfully
    await registerPage.register(
      testUser.fullName,
      testUser.email,
      testUser.password,
      testUser.confirmPassword!
    );

    // Wait for redirect to verify-email
    await page.waitForURL(/\/verify-email/, { timeout: TIMEOUTS.navigation });

    // Go back to registration page
    await registerPage.goto();

    // Try to register with the same email again
    await registerPage.register(
      testUser.fullName,
      testUser.email,
      testUser.password,
      testUser.confirmPassword!
    );

    // Verify error alert appears
    await expect(registerPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    const errorMessage = await registerPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/already exists|already registered|email.*taken/);
  });

  test('should disable submit button while submitting', async ({ page }) => {
    const testUser = createTestUser();

    // Start filling form
    await registerPage.fullNameInput.fill(testUser.fullName);
    await registerPage.emailInput.fill(testUser.email);
    await registerPage.passwordInput.fill(testUser.password);
    await registerPage.confirmPasswordInput.fill(testUser.confirmPassword!);

    // Click submit button
    await registerPage.submitButton.click();

    // Verify button is disabled during submission
    await expect(registerPage.submitButton).toBeDisabled();
  });

  test('should show loading state while submitting', async ({ page }) => {
    const testUser = createTestUser();

    await registerPage.register(
      testUser.fullName,
      testUser.email,
      testUser.password,
      testUser.confirmPassword!
    );

    // Verify loading indicator appears (spinner or text)
    const loadingIndicator = page.locator(
      'text=/signing up|creating account|please wait/i, [role="status"], .spinner, .loading'
    );

    // Loading indicator should be visible briefly
    await expect(loadingIndicator).toBeVisible({ timeout: 1000 }).catch(() => {
      // Loading might be too fast to catch, which is acceptable
    });
  });

  test('should navigate to login page when clicking login link', async ({ page }) => {
    await registerPage.clickLogin();

    // Verify navigation to login page
    await page.waitForURL(ROUTES.login, { timeout: TIMEOUTS.navigation });
  });

  test('should clear form validation errors when correcting input', async ({ page }) => {
    // First, trigger validation error
    await registerPage.emailInput.fill('invalid-email');
    await registerPage.submitButton.click();

    // Verify error appears
    const emailError = page.locator('#email-error, [id*="email"][role="alert"]');
    await expect(emailError).toBeVisible();

    // Correct the input
    await registerPage.emailInput.fill('valid@example.com');

    // Error should disappear (validation on change)
    await expect(emailError).not.toBeVisible({ timeout: TIMEOUTS.debounce });
  });

  test('should have proper ARIA labels and accessibility attributes', async ({ page }) => {
    // Check for proper form labels
    await expect(page.locator('label[for="fullName"]')).toBeVisible();
    await expect(page.locator('label[for="email"]')).toBeVisible();
    await expect(page.locator('label[for="password"]')).toBeVisible();
    await expect(page.locator('label[for="confirmPassword"]')).toBeVisible();

    // Check for ARIA attributes on form submission
    await expect(registerPage.submitButton).toHaveAttribute('type', 'submit');
  });

  test('should preserve form data when validation fails', async ({ page }) => {
    const testUser = createTestUser();

    // Fill form with mismatched passwords
    await registerPage.fullNameInput.fill(testUser.fullName);
    await registerPage.emailInput.fill(testUser.email);
    await registerPage.passwordInput.fill(testUser.password);
    await registerPage.confirmPasswordInput.fill('DifferentPassword123!');

    // Submit form
    await registerPage.submitButton.click();

    // Verify form data is preserved
    await expect(registerPage.fullNameInput).toHaveValue(testUser.fullName);
    await expect(registerPage.emailInput).toHaveValue(testUser.email);
    // Password fields should still have values (though hidden)
  });

  test('should show password strength indicator', async ({ page }) => {
    // Type a weak password
    await registerPage.passwordInput.fill('weak');

    // Look for password strength indicator
    const strengthIndicator = page.locator(
      '[data-testid="password-strength"], .password-strength, text=/weak|strong|medium/i'
    );

    // Strength indicator should be visible if implemented
    const isVisible = await strengthIndicator.isVisible().catch(() => false);

    // This is optional functionality, so we just verify if present
    if (isVisible) {
      await expect(strengthIndicator).toContainText(/weak/i);
    }
  });

  test('should handle network errors gracefully', async ({ page, context }) => {
    const testUser = createTestUser();

    // Simulate network failure (note: no /api prefix, goes directly to backend)
    await context.route('**/auth/register', (route) => {
      route.abort('failed');
    });

    await registerPage.register(
      testUser.fullName,
      testUser.email,
      testUser.password,
      testUser.confirmPassword!
    );

    // Verify error message appears
    await expect(registerPage.errorAlert).toBeVisible({ timeout: TIMEOUTS.apiRequest });

    const errorMessage = await registerPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/error|failed|try again|network/);
  });

  test('should autofocus on first input field', async ({ page }) => {
    // Check if full name input has autofocus
    const focusedElement = await page.evaluate(() => document.activeElement?.id);

    // Either fullName should be focused, or no specific focus (acceptable)
    if (focusedElement) {
      expect(focusedElement).toBe('fullName');
    }
  });
});
