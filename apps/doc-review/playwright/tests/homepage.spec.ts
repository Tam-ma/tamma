import { test, expect } from '../support/fixtures/base';

test.describe('Homepage', () => {
  test('should load homepage successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Should have a title
    await expect(page).toHaveTitle(/doc-review/i);
  });

  test('should have main navigation elements', async ({ page }) => {
    await page.goto('/');

    // Should have navigation links (adjust selectors based on actual implementation)
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to docs section', async ({ page }) => {
    await page.goto('/');

    // Click on docs link if it exists
    const docsLink = page.getByRole('link', { name: /docs/i }).first();
    const isVisible = await docsLink.isVisible().catch(() => false);

    if (isVisible) {
      await docsLink.click();
      await page.waitForLoadState('networkidle');

      // Should navigate to docs page
      expect(page.url()).toContain('/docs');
    }
  });

  test('should handle 404 pages', async ({ page }) => {
    const response = await page.goto('/non-existent-page-12345');

    // Should show 404 status
    expect(response?.status()).toBe(404);
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Page should load without horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // Allow 1px tolerance
  });
});
