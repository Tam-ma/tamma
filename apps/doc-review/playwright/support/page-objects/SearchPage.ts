import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Search Page Object
 * Represents the search interface and interactions
 */
export class SearchPage extends BasePage {
  // Locators
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly searchResults: Locator;
  readonly filterTypeSelect: Locator;
  readonly filterDocPathInput: Locator;
  readonly filterStatusSelect: Locator;
  readonly paginationNext: Locator;
  readonly paginationPrev: Locator;
  readonly resultItems: Locator;

  constructor(page: Page) {
    super(page);

    this.searchInput = page.getByPlaceholder(/search/i);
    this.searchButton = page.getByRole('button', { name: /search/i });
    this.searchResults = page.getByTestId('search-results');
    this.filterTypeSelect = page.getByLabel(/content type/i);
    this.filterDocPathInput = page.getByLabel(/document path/i);
    this.filterStatusSelect = page.getByLabel(/status/i);
    this.paginationNext = page.getByRole('button', { name: /next/i });
    this.paginationPrev = page.getByRole('button', { name: /previous/i });
    this.resultItems = page.getByTestId('search-result-item');
  }

  /**
   * Navigate to search page
   */
  async navigate() {
    await this.goto('/search');
    await this.waitForPageLoad();
  }

  /**
   * Perform a search
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Filter by content type
   */
  async filterByType(type: string) {
    await this.filterTypeSelect.selectOption(type);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Filter by document path
   */
  async filterByDocPath(docPath: string) {
    await this.filterDocPathInput.fill(docPath);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Filter by status
   */
  async filterByStatus(status: string) {
    await this.filterStatusSelect.selectOption(status);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get search result count
   */
  async getResultCount(): Promise<number> {
    const count = await this.resultItems.count();
    return count;
  }

  /**
   * Get result at index
   */
  getResultAt(index: number): Locator {
    return this.resultItems.nth(index);
  }

  /**
   * Get all result titles
   */
  async getResultTitles(): Promise<string[]> {
    const titles: string[] = [];
    const count = await this.resultItems.count();

    for (let i = 0; i < count; i++) {
      const title = await this.resultItems.nth(i).getByTestId('result-title').textContent();
      if (title) titles.push(title.trim());
    }

    return titles;
  }

  /**
   * Click on result at index
   */
  async clickResult(index: number) {
    await this.resultItems.nth(index).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Go to next page
   */
  async nextPage() {
    await this.paginationNext.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Go to previous page
   */
  async prevPage() {
    await this.paginationPrev.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Check if results are visible
   */
  async hasResults(): Promise<boolean> {
    return await this.searchResults.isVisible();
  }

  /**
   * Check if no results message is visible
   */
  async hasNoResults(): Promise<boolean> {
    return await this.page.getByText(/no results found/i).isVisible();
  }
}
