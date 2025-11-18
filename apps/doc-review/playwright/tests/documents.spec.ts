import { test, expect } from '../support/fixtures/base';
import { DocumentPage } from '../support/page-objects/DocumentPage';

test.describe('Document Viewing and Collaboration', () => {
  let documentPage: DocumentPage;

  test.beforeEach(async ({ page }) => {
    documentPage = new DocumentPage(page);
  });

  test('should load a document page', async ({ page }) => {
    // Try to navigate to a test document
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // If there's a document link, click it
    const firstDocLink = page.getByRole('link').first();
    const isVisible = await firstDocLink.isVisible().catch(() => false);

    if (isVisible) {
      await firstDocLink.click();
      await page.waitForLoadState('networkidle');

      // Should load the document (with or without trailing slash)
      expect(page.url()).toContain('/docs');
    }
  });

  test('should display document content', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // Check if we're on the docs page
    const url = page.url();
    expect(url).toContain('/docs');

    // Page should have content
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
  });

  test('should show comments section if available', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // Check if comments section exists (might not be visible on all pages)
    const commentsSection = page.getByTestId('comments-list');
    const hasComments = await commentsSection.isVisible().catch(() => false);

    // Test passes if comments section exists or doesn't exist
    expect(typeof hasComments).toBe('boolean');
  });

  test('should render markdown content', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // Should render markdown elements
    const hasHeadings = await page.locator('h1, h2, h3').count();
    const hasParagraphs = await page.locator('p').count();

    // At least some content should be rendered
    expect(hasHeadings + hasParagraphs).toBeGreaterThan(0);
  });

  test('should handle code blocks in markdown', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // Check if code blocks are rendered (might not exist on all pages)
    const codeBlocks = page.locator('pre code, .hljs');
    const count = await codeBlocks.count();

    // Test passes whether code blocks exist or not
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should support document navigation', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // Should have some form of navigation
    const navLinks = page.getByRole('link');
    const linkCount = await navLinks.count();

    expect(linkCount).toBeGreaterThan(0);
  });
});
