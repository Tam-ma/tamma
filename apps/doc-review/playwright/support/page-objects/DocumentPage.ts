import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Document Page Object
 * Represents a document view with collaboration features
 */
export class DocumentPage extends BasePage {
  // Locators
  readonly documentTitle: Locator;
  readonly documentContent: Locator;
  readonly addCommentButton: Locator;
  readonly commentsList: Locator;
  readonly commentInput: Locator;
  readonly submitCommentButton: Locator;
  readonly addSuggestionButton: Locator;
  readonly suggestionsList: Locator;
  readonly discussionsList: Locator;

  constructor(page: Page) {
    super(page);

    this.documentTitle = page.getByTestId('document-title');
    this.documentContent = page.getByTestId('document-content');
    this.addCommentButton = page.getByRole('button', { name: /add comment/i });
    this.commentsList = page.getByTestId('comments-list');
    this.commentInput = page.getByPlaceholder(/write a comment/i);
    this.submitCommentButton = page.getByRole('button', { name: /submit comment/i });
    this.addSuggestionButton = page.getByRole('button', { name: /suggest edit/i });
    this.suggestionsList = page.getByTestId('suggestions-list');
    this.discussionsList = page.getByTestId('discussions-list');
  }

  /**
   * Navigate to a document
   */
  async navigateToDocument(documentId: string) {
    await this.goto(`/docs/${documentId}`);
    await this.waitForPageLoad();
  }

  /**
   * Add a comment
   */
  async addComment(text: string) {
    await this.addCommentButton.click();
    await this.commentInput.fill(text);
    await this.submitCommentButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get comment count
   */
  async getCommentCount(): Promise<number> {
    const comments = this.commentsList.locator('[data-testid="comment-item"]');
    return await comments.count();
  }

  /**
   * Get latest comment text
   */
  async getLatestCommentText(): Promise<string> {
    const comments = this.commentsList.locator('[data-testid="comment-item"]');
    const count = await comments.count();
    if (count === 0) return '';
    const text = await comments.nth(count - 1).textContent();
    return text?.trim() || '';
  }

  /**
   * Check if document is loaded
   */
  async isDocumentLoaded(): Promise<boolean> {
    return await this.documentContent.isVisible();
  }
}
