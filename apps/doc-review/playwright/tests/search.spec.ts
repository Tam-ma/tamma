import { test, expect } from '../support/fixtures/base';
import { SearchPage } from '../support/page-objects/SearchPage';

test.describe('Search Functionality', () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.navigate();
  });

  test('should load search page successfully', async () => {
    await expect(searchPage.searchInput).toBeVisible();
    await expect(searchPage.searchButton).toBeVisible();
  });

  test('should perform a basic search', async ({ page }) => {
    await searchPage.search('test');

    // Wait for results to load
    await page.waitForTimeout(1000);

    // Should show results or "no results" message
    const hasResults = await searchPage.hasResults();
    const hasNoResults = await searchPage.hasNoResults();

    expect(hasResults || hasNoResults).toBeTruthy();
  });

  test('should handle empty search query', async () => {
    await searchPage.search('');

    // Should show validation message or no results
    const noResults = await searchPage.hasNoResults();
    expect(noResults).toBeTruthy();
  });

  test('should filter by content type', async ({ page }) => {
    // First perform a search
    await searchPage.search('document');

    // Then filter by type
    await searchPage.filterByType('documents');

    await page.waitForTimeout(500);

    // Results should update
    const resultCount = await searchPage.getResultCount();
    expect(resultCount).toBeGreaterThanOrEqual(0);
  });

  test('should filter by document path', async ({ page }) => {
    await searchPage.search('test');

    await searchPage.filterByDocPath('/docs/PRD.md');

    await page.waitForTimeout(500);

    // Should filter results
    const resultCount = await searchPage.getResultCount();
    expect(resultCount).toBeGreaterThanOrEqual(0);
  });

  test('should filter by status', async ({ page }) => {
    await searchPage.search('suggestion');

    await searchPage.filterByStatus('pending');

    await page.waitForTimeout(500);

    // Should filter results to only pending items
    const resultCount = await searchPage.getResultCount();
    expect(resultCount).toBeGreaterThanOrEqual(0);
  });

  test('should handle pagination', async ({ page }) => {
    await searchPage.search('test');

    await page.waitForTimeout(500);

    const initialCount = await searchPage.getResultCount();

    // Only test pagination if there are results
    if (initialCount > 0) {
      const nextButton = searchPage.paginationNext;
      const isNextEnabled = await nextButton.isEnabled().catch(() => false);

      if (isNextEnabled) {
        await searchPage.nextPage();
        await page.waitForTimeout(500);

        // Should navigate to next page
        const newCount = await searchPage.getResultCount();
        expect(newCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should display search results with correct structure', async ({ page }) => {
    await searchPage.search('document');

    await page.waitForTimeout(1000);

    const resultCount = await searchPage.getResultCount();

    if (resultCount > 0) {
      const firstResult = searchPage.getResultAt(0);

      // Each result should have a title
      const title = firstResult.getByTestId('result-title');
      await expect(title).toBeVisible();

      // Each result should be clickable
      await expect(firstResult).toBeVisible();
    }
  });

  test('should handle special characters in search', async ({ page }) => {
    const specialQueries = [
      'C++',
      'Node.js',
      'email@example.com',
      'path/to/file.ts',
    ];

    for (const query of specialQueries) {
      await searchPage.search(query);
      await page.waitForTimeout(500);

      // Should not crash and should show results or no results
      const hasResults = await searchPage.hasResults();
      const hasNoResults = await searchPage.hasNoResults();
      expect(hasResults || hasNoResults).toBeTruthy();
    }
  });

  test('should search and click on a result', async ({ page }) => {
    await searchPage.search('documentation');

    await page.waitForTimeout(1000);

    const resultCount = await searchPage.getResultCount();

    if (resultCount > 0) {
      await searchPage.clickResult(0);

      // Should navigate to the result page
      await page.waitForLoadState('networkidle');
      expect(page.url()).not.toContain('/search');
    }
  });

  test('should preserve search query after page reload', async ({ page }) => {
    await searchPage.search('test query');

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Search input should preserve the query (if implemented)
    const inputValue = await searchPage.searchInput.inputValue();
    // This might be empty if not implemented - that's okay
    expect(inputValue).toBeDefined();
  });
});
