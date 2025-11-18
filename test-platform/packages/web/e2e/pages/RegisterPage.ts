/**
 * Register Page Object Model
 *
 * Encapsulates interactions with the registration page.
 */

import { Page, Locator } from '@playwright/test';
import { ROUTES } from '../fixtures/test-data';

export class RegisterPage {
  readonly page: Page;
  readonly fullNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;
  readonly loginLink: Locator;
  readonly errorAlert: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fullNameInput = page.locator('#fullName');
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    this.confirmPasswordInput = page.locator('#confirmPassword');
    this.submitButton = page.locator('button[type="submit"]');
    this.loginLink = page.locator('a[href="/login"]');
    this.errorAlert = page.locator('.bg-red-50[role="alert"]');
    this.successMessage = page.locator('text=/success|registered|check your email/i');
  }

  async goto() {
    await this.page.goto(ROUTES.register);
  }

  async register(fullName: string, email: string, password: string, confirmPassword: string) {
    await this.fullNameInput.fill(fullName);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword);
    await this.submitButton.click();
  }

  async clickLogin() {
    await this.loginLink.click();
  }

  async getErrorMessage(): Promise<string> {
    return await this.errorAlert.textContent() || '';
  }

  async isSuccessMessageVisible(): Promise<boolean> {
    return await this.successMessage.isVisible();
  }
}
