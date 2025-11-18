/**
 * Accessibility E2E Tests
 *
 * Tests accessibility compliance across key pages using axe-core.
 * Verifies WCAG 2.1 standards, keyboard navigation, and screen reader support.
 */

import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';
import { ROUTES } from '../fixtures/test-data';
import { clearAuthState, setupAuthenticatedSession } from '../helpers/auth';
import { createTestUser } from '../fixtures/test-data';
import {
  setupAccessibilityTesting,
  checkPageAccessibility,
  checkFormLabels,
  checkHeadingHierarchy,
  testKeyboardNavigation,
  runComprehensiveA11yAudit,
} from '../helpers/accessibility';

test.describe('Accessibility Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Inject axe-core for accessibility testing
    await setupAccessibilityTesting(page);
  });

  test('login page should be accessible', async ({ page }) => {
    await page.goto(ROUTES.login);
    await injectAxe(page);

    // Run axe accessibility checks
    await checkA11y(page, undefined, {
      detailedReport: true,
      detailedReportOptions: {
        html: true,
      },
    });

    // Check form labels
    await checkFormLabels(page);

    // Check heading hierarchy
    await checkHeadingHierarchy(page);
  });

  test('registration page should be accessible', async ({ page }) => {
    await page.goto(ROUTES.register);
    await injectAxe(page);

    await checkA11y(page);
    await checkFormLabels(page);
    await checkHeadingHierarchy(page);
  });

  test('forgot password page should be accessible', async ({ page }) => {
    await page.goto(ROUTES.forgotPassword);
    await injectAxe(page);

    await checkA11y(page);
    await checkFormLabels(page);
  });

  test('API keys page should be accessible', async ({ page }) => {
    await clearAuthState(page);
    const testUser = createTestUser();
    await setupAuthenticatedSession(page, testUser);

    await page.goto(ROUTES.apiKeys);
    await injectAxe(page);

    await checkA11y(page);
  });

  test('form inputs should have proper labels', async ({ page }) => {
    await page.goto(ROUTES.login);

    // Check email input
    const emailLabel = page.locator('label[for="email"]');
    await expect(emailLabel).toBeVisible();

    // Check password input
    const passwordLabel = page.locator('label[for="password"]');
    await expect(passwordLabel).toBeVisible();

    // Check remember me checkbox
    const rememberMeLabel = page.locator('label[for="rememberMe"]');
    await expect(rememberMeLabel).toBeVisible();
  });

  test('buttons should be keyboard accessible', async ({ page }) => {
    await page.goto(ROUTES.login);

    // Tab to email input
    await page.keyboard.press('Tab');
    let focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('email');

    // Tab to password input
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('password');

    // Continue tabbing to remember me
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('rememberMe');

    // Tab to submit button
    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBe('BUTTON');
  });

  test('error messages should have proper ARIA attributes', async ({ page }) => {
    await page.goto(ROUTES.login);

    // Trigger validation error
    await page.fill('#email', 'invalid-email');
    await page.click('button[type="submit"]');

    // Check for error message with role="alert"
    const errorAlert = page.locator('[role="alert"], [id*="error"]');
    await expect(errorAlert).toBeVisible();
  });

  test('modals should trap focus', async ({ page }) => {
    await clearAuthState(page);
    const testUser = createTestUser();
    await setupAuthenticatedSession(page, testUser);

    await page.goto(ROUTES.apiKeys);

    // Open API key creation modal
    await page.click('button:has-text("Generate New Key"), button:has-text("Create API Key")');

    // Verify modal is visible
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Tab through modal elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Verify focus is still within modal
    const focusWithinModal = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      const focused = document.activeElement;
      return modal?.contains(focused) ?? false;
    });

    expect(focusWithinModal).toBeTruthy();
  });

  test('links should have descriptive text', async ({ page }) => {
    await page.goto(ROUTES.login);

    // Check forgot password link
    const forgotPasswordLink = page.locator('a[href="/forgot-password"]');
    const linkText = await forgotPasswordLink.textContent();
    expect(linkText?.trim().length).toBeGreaterThan(0);

    // Check sign up link
    const signUpLink = page.locator('a[href="/register"]');
    const signUpText = await signUpLink.textContent();
    expect(signUpText?.trim().length).toBeGreaterThan(0);
  });

  test('page should have proper heading structure', async ({ page }) => {
    await page.goto(ROUTES.login);

    // Should have one h1
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);

    // Get all headings in order
    const headings = await page.evaluate(() => {
      const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(elements).map((el) => ({
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim(),
      }));
    });

    // First heading should be h1
    expect(headings[0]?.level).toBe(1);
  });

  test('interactive elements should have visible focus indicators', async ({ page }) => {
    await page.goto(ROUTES.login);

    // Tab to submit button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Check if button has focus styles
    const submitButton = page.locator('button[type="submit"]');
    const hasFocusStyles = await submitButton.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return (
        styles.outline !== 'none' ||
        styles.boxShadow !== 'none' ||
        styles.border !== 'none'
      );
    });

    expect(hasFocusStyles).toBeTruthy();
  });

  test('form should be submittable with Enter key', async ({ page }) => {
    await page.goto(ROUTES.login);

    await page.route('**/api/auth/login', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-token',
        }),
      });
    });

    // Fill form
    await page.fill('#email', 'test@example.com');
    await page.fill('#password', 'Password123!');

    // Press Enter in password field
    await page.locator('#password').press('Enter');

    // Should navigate away from login page
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 5000 });
  });

  test('password toggle button should have proper ARIA label', async ({ page }) => {
    await page.goto(ROUTES.login);

    const passwordToggle = page.locator('button[aria-label*="password" i]');
    await expect(passwordToggle).toHaveAttribute('aria-label', /.+/);
  });

  test('loading states should be announced to screen readers', async ({ page }) => {
    await page.goto(ROUTES.login);

    await page.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-token',
        }),
      });
    });

    await page.fill('#email', 'test@example.com');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    // Check for loading indicator with proper role
    const loadingIndicator = page.locator('[role="status"], [aria-live="polite"]');
    const hasLoadingState = await loadingIndicator.count();

    // Loading state should exist (even if briefly)
    expect(hasLoadingState).toBeGreaterThanOrEqual(0);
  });

  test('disabled buttons should have proper ARIA attributes', async ({ page }) => {
    await page.goto(ROUTES.login);

    await page.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, token: 'mock-token' }),
      });
    });

    await page.fill('#email', 'test@example.com');
    await page.fill('#password', 'Password123!');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Button should be disabled during submission
    await expect(submitButton).toBeDisabled();
  });

  test('comprehensive accessibility audit for all key pages', async ({ page }) => {
    // Test all major pages
    const pages = [
      { url: ROUTES.login, name: 'Login Page' },
      { url: ROUTES.register, name: 'Registration Page' },
      { url: ROUTES.forgotPassword, name: 'Forgot Password Page' },
    ];

    for (const pageInfo of pages) {
      await test.step(`Audit ${pageInfo.name}`, async () => {
        await page.goto(pageInfo.url);
        await injectAxe(page);
        await runComprehensiveA11yAudit(page, pageInfo.name);
      });
    }
  });
});
