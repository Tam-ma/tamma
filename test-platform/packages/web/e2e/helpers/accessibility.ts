/**
 * Accessibility Testing Helper
 *
 * Provides utilities for accessibility testing using axe-core.
 * Tests WCAG 2.1 compliance and common accessibility issues.
 */

import { Page } from '@playwright/test';
import { injectAxe, checkA11y, getViolations, reportViolations } from 'axe-playwright';
import { A11Y_CONFIG } from '../fixtures/test-data';

/**
 * Injects axe-core into the page for accessibility testing
 *
 * @param page - Playwright page instance
 */
export async function setupAccessibilityTesting(page: Page): Promise<void> {
  await injectAxe(page);
}

/**
 * Runs accessibility checks on the current page
 *
 * @param page - Playwright page instance
 * @param options - Optional configuration for accessibility checks
 * @returns Promise that resolves when checks are complete
 */
export async function checkPageAccessibility(
  page: Page,
  options?: {
    detailedReport?: boolean;
    detailedReportOptions?: {
      html?: boolean;
    };
    axeOptions?: {
      rules?: Record<string, { enabled: boolean }>;
      runOnly?: string[] | { type: string; values: string[] };
    };
  }
): Promise<void> {
  await checkA11y(
    page,
    undefined,
    {
      detailedReport: options?.detailedReport ?? false,
      detailedReportOptions: options?.detailedReportOptions ?? { html: false },
      axeOptions: options?.axeOptions ?? A11Y_CONFIG,
    }
  );
}

/**
 * Gets accessibility violations for the current page
 *
 * @param page - Playwright page instance
 * @returns Promise that resolves with array of violations
 */
export async function getAccessibilityViolations(page: Page): Promise<any[]> {
  const violations = await getViolations(page, undefined, A11Y_CONFIG);
  return violations;
}

/**
 * Checks accessibility for a specific element
 *
 * @param page - Playwright page instance
 * @param selector - CSS selector for the element to check
 */
export async function checkElementAccessibility(
  page: Page,
  selector: string
): Promise<void> {
  await checkA11y(page, selector, {
    detailedReport: false,
    axeOptions: A11Y_CONFIG,
  });
}

/**
 * Verifies keyboard navigation works for interactive elements
 *
 * @param page - Playwright page instance
 * @param selector - CSS selector for the element to test
 */
export async function testKeyboardNavigation(
  page: Page,
  selector: string
): Promise<void> {
  const element = page.locator(selector);

  // Tab to the element
  await page.keyboard.press('Tab');

  // Verify element is focused
  const isFocused = await element.evaluate((el) => el === document.activeElement);

  if (!isFocused) {
    throw new Error(`Element ${selector} is not keyboard accessible`);
  }

  // Try to activate with Enter
  await page.keyboard.press('Enter');

  // For buttons, also try Space
  const tagName = await element.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'button') {
    await page.keyboard.press('Space');
  }
}

/**
 * Verifies that all images have alt text
 *
 * @param page - Playwright page instance
 */
export async function checkImageAltText(page: Page): Promise<void> {
  const imagesWithoutAlt = await page.locator('img:not([alt])').count();

  if (imagesWithoutAlt > 0) {
    throw new Error(`Found ${imagesWithoutAlt} images without alt text`);
  }
}

/**
 * Verifies that form inputs have associated labels
 *
 * @param page - Playwright page instance
 */
export async function checkFormLabels(page: Page): Promise<void> {
  const inputsWithoutLabels = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input, select, textarea');
    const missing: string[] = [];

    inputs.forEach((input) => {
      const id = input.getAttribute('id');
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledBy = input.getAttribute('aria-labelledby');

      if (!id && !ariaLabel && !ariaLabelledBy) {
        missing.push(input.tagName + (id ? `#${id}` : ''));
      } else if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (!label && !ariaLabel && !ariaLabelledBy) {
          missing.push(`${input.tagName}#${id}`);
        }
      }
    });

    return missing;
  });

  if (inputsWithoutLabels.length > 0) {
    throw new Error(
      `Found inputs without labels: ${inputsWithoutLabels.join(', ')}`
    );
  }
}

/**
 * Verifies color contrast ratios meet WCAG standards
 *
 * @param page - Playwright page instance
 */
export async function checkColorContrast(page: Page): Promise<void> {
  await checkA11y(page, undefined, {
    axeOptions: {
      runOnly: ['color-contrast'],
    },
  });
}

/**
 * Verifies heading hierarchy (h1, h2, h3, etc.) is correct
 *
 * @param page - Playwright page instance
 */
export async function checkHeadingHierarchy(page: Page): Promise<void> {
  const headings = await page.evaluate(() => {
    const headingElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    return Array.from(headingElements).map((h) => ({
      level: parseInt(h.tagName[1]),
      text: h.textContent?.trim() || '',
    }));
  });

  if (headings.length === 0) {
    return; // No headings to check
  }

  // Check for h1
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count === 0) {
    throw new Error('Page should have at least one h1 heading');
  }

  if (h1Count > 1) {
    console.warn('Page has multiple h1 headings, consider using only one');
  }

  // Check hierarchy
  let previousLevel = 0;
  for (const heading of headings) {
    if (heading.level > previousLevel + 1 && previousLevel !== 0) {
      console.warn(
        `Heading hierarchy skip detected: h${previousLevel} to h${heading.level}`
      );
    }
    previousLevel = heading.level;
  }
}

/**
 * Verifies ARIA attributes are used correctly
 *
 * @param page - Playwright page instance
 */
export async function checkAriaAttributes(page: Page): Promise<void> {
  await checkA11y(page, undefined, {
    axeOptions: {
      runOnly: ['aria-valid-attr', 'aria-valid-attr-value', 'aria-required-attr'],
    },
  });
}

/**
 * Tests focus management (focus trap in modals, etc.)
 *
 * @param page - Playwright page instance
 * @param modalSelector - CSS selector for the modal
 */
export async function testModalFocusTrap(
  page: Page,
  modalSelector: string
): Promise<void> {
  const modal = page.locator(modalSelector);
  await modal.waitFor({ state: 'visible' });

  // Get all focusable elements in modal
  const focusableElements = await modal.locator(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ).count();

  if (focusableElements === 0) {
    throw new Error('Modal has no focusable elements');
  }

  // Tab through all elements
  for (let i = 0; i < focusableElements + 1; i++) {
    await page.keyboard.press('Tab');
  }

  // Verify focus is still within modal
  const focusedElement = await page.evaluate((selector) => {
    const modal = document.querySelector(selector);
    const focused = document.activeElement;
    return modal?.contains(focused) ?? false;
  }, modalSelector);

  if (!focusedElement) {
    throw new Error('Focus escaped modal - focus trap not working correctly');
  }
}

/**
 * Verifies skip links are present and functional
 *
 * @param page - Playwright page instance
 */
export async function checkSkipLinks(page: Page): Promise<void> {
  const skipLink = page.locator('a[href*="#main"], a:has-text("Skip to")').first();
  const count = await skipLink.count();

  if (count === 0) {
    console.warn('No skip link found - consider adding for keyboard users');
    return;
  }

  // Verify skip link is keyboard accessible
  await page.keyboard.press('Tab');
  const isVisible = await skipLink.isVisible();

  if (!isVisible) {
    console.warn('Skip link is not visible when focused');
  }
}

/**
 * Runs a comprehensive accessibility audit on a page
 *
 * @param page - Playwright page instance
 * @param pageName - Name of the page for reporting
 */
export async function runComprehensiveA11yAudit(
  page: Page,
  pageName: string = 'Unknown Page'
): Promise<void> {
  console.log(`Running comprehensive accessibility audit for: ${pageName}`);

  // Run axe-core checks
  await setupAccessibilityTesting(page);
  await checkPageAccessibility(page, { detailedReport: true });

  // Run custom checks
  try {
    await checkImageAltText(page);
  } catch (error) {
    console.warn(`Image alt text issues on ${pageName}:`, error);
  }

  try {
    await checkFormLabels(page);
  } catch (error) {
    console.warn(`Form label issues on ${pageName}:`, error);
  }

  try {
    await checkHeadingHierarchy(page);
  } catch (error) {
    console.warn(`Heading hierarchy issues on ${pageName}:`, error);
  }

  try {
    await checkSkipLinks(page);
  } catch (error) {
    console.warn(`Skip link issues on ${pageName}:`, error);
  }

  console.log(`Accessibility audit complete for: ${pageName}`);
}
