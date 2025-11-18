/**
 * API Keys Page Object Model
 *
 * Encapsulates interactions with the API keys management page.
 */

import { Page, Locator } from '@playwright/test';
import { ROUTES } from '../fixtures/test-data';

export class APIKeysPage {
  readonly page: Page;
  readonly generateKeyButton: Locator;
  readonly keysList: Locator;
  readonly searchInput: Locator;
  readonly filterDropdown: Locator;

  constructor(page: Page) {
    this.page = page;
    this.generateKeyButton = page.locator('button:has-text("Generate New Key"), button:has-text("Create API Key")');
    this.keysList = page.locator('[data-testid="api-keys-list"], .api-keys-list');
    this.searchInput = page.locator('input[placeholder*="Search" i]');
    this.filterDropdown = page.locator('select[name="filter"], [data-testid="status-filter"]');
  }

  async goto() {
    await this.page.goto(ROUTES.apiKeys);
    await this.page.waitForLoadState('networkidle');
  }

  async clickGenerateKey() {
    await this.generateKeyButton.click();
  }

  async searchKeys(query: string) {
    await this.searchInput.fill(query);
  }

  async filterByStatus(status: string) {
    await this.filterDropdown.selectOption(status);
  }

  async getKeyByName(name: string): Promise<Locator> {
    return this.page.locator(`[data-testid="api-key-row"]:has-text("${name}"), .api-key-item:has-text("${name}")`);
  }

  async getKeyCount(): Promise<number> {
    return await this.page.locator('[data-testid="api-key-row"], .api-key-item').count();
  }
}
