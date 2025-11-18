/**
 * Login Page Object Model
 *
 * Encapsulates interactions with the login page following Page Object Model pattern.
 * This provides a clean API for interacting with login functionality in tests.
 */

import { Page, Locator } from '@playwright/test';
import { ROUTES } from '../fixtures/test-data';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly submitButton: Locator;
  readonly forgotPasswordLink: Locator;
  readonly signUpLink: Locator;
  readonly errorAlert: Locator;
  readonly showPasswordButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    this.rememberMeCheckbox = page.locator('#rememberMe');
    this.submitButton = page.locator('button[type="submit"]');
    this.forgotPasswordLink = page.locator('a[href="/forgot-password"]');
    this.signUpLink = page.locator('a[href="/register"]');
    this.errorAlert = page.locator('[role="alert"]');
    this.showPasswordButton = page.locator('button[aria-label*="password" i]');
  }

  async goto() {
    await this.page.goto(ROUTES.login);
  }

  async login(email: string, password: string, rememberMe: boolean = false) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);

    if (rememberMe) {
      await this.rememberMeCheckbox.check();
    }

    await this.submitButton.click();
  }

  async togglePasswordVisibility() {
    await this.showPasswordButton.click();
  }

  async clickForgotPassword() {
    await this.forgotPasswordLink.click();
  }

  async clickSignUp() {
    await this.signUpLink.click();
  }

  async getErrorMessage(): Promise<string> {
    return await this.errorAlert.textContent() || '';
  }

  async isErrorVisible(): Promise<boolean> {
    return await this.errorAlert.isVisible();
  }
}
