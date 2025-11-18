import { test, expect } from '@playwright/test';

/**
 * Visual Regression Tests
 *
 * These tests capture screenshots and compare them against baseline images.
 * On first run, baseline images are created. Subsequent runs compare against baselines.
 *
 * To update baselines:
 *   pnpm test:e2e:update-snapshots
 *
 * Configuration in playwright.config.ts:
 *   - threshold: 0.2 (20% pixel difference tolerance)
 *   - maxDiffPixels: 100 (max number of different pixels)
 */

test.describe('Visual Regression - Homepage', () => {
  test('should match homepage layout', async ({ page }) => {
    await page.goto('/');

    // Wait for content to load
    await page.waitForLoadState('networkidle');

    // Take full page screenshot
    await expect(page).toHaveScreenshot('homepage-full.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match homepage header', async ({ page }) => {
    await page.goto('/');

    await page.waitForLoadState('networkidle');

    // Screenshot just the header
    const header = page.locator('header, nav').first();
    await expect(header).toHaveScreenshot('homepage-header.png', {
      animations: 'disabled',
    });
  });

  test('should match login button state', async ({ page }) => {
    await page.goto('/');

    const loginButton = page.getByRole('button', { name: /login|sign in/i }).first();
    await expect(loginButton).toHaveScreenshot('login-button.png', {
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Documents', () => {
  test('should match document listing page', async ({ page }) => {
    await page.goto('/docs');

    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('docs-listing.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match document viewer layout', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');
    await page.waitForSelector('article, .document-content', { timeout: 10000 });

    await expect(page).toHaveScreenshot('document-viewer.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match markdown rendering', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');
    await page.waitForSelector('article, .document-content', { timeout: 10000 });

    // Screenshot just the content area
    const content = page.locator('article, .document-content, main').first();
    await expect(content).toHaveScreenshot('markdown-content.png', {
      animations: 'disabled',
      mask: [page.locator('.comment-indicator, .timestamp')], // Mask dynamic elements
    });
  });

  test('should match code block syntax highlighting', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');
    await page.waitForSelector('pre code', { timeout: 5000 }).catch(() => {});

    const codeBlock = page.locator('pre code').first();
    if (await codeBlock.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(codeBlock).toHaveScreenshot('code-block-highlight.png', {
        animations: 'disabled',
      });
    }
  });
});

test.describe('Visual Regression - Navigation', () => {
  test('should match document navigation sidebar', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');

    // Screenshot navigation if present
    const navigation = page.locator('[data-testid="doc-navigation"], .document-nav, aside').first();
    if (await navigation.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(navigation).toHaveScreenshot('document-navigation.png', {
        animations: 'disabled',
      });
    }
  });

  test('should match table of contents', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');

    const toc = page.locator('[data-testid="table-of-contents"], .toc, .outline').first();
    if (await toc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(toc).toHaveScreenshot('table-of-contents.png', {
        animations: 'disabled',
      });
    }
  });
});

test.describe('Visual Regression - Comments UI', () => {
  test('should match comments panel', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');

    const commentsPanel = page.locator('[data-testid="comments-panel"], .comments-section').first();
    if (await commentsPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(commentsPanel).toHaveScreenshot('comments-panel.png', {
        animations: 'disabled',
        mask: [page.locator('.timestamp, .relative-time')], // Mask timestamps
      });
    }
  });

  test('should match comment thread', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');

    const commentThread = page.locator('[data-testid="comment-thread"], .comment-thread').first();
    if (await commentThread.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(commentThread).toHaveScreenshot('comment-thread.png', {
        animations: 'disabled',
        mask: [page.locator('.timestamp')],
      });
    }
  });
});

test.describe('Visual Regression - Suggestions UI', () => {
  test('should match suggestions panel', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');

    // Navigate to suggestions if available
    const suggestionsTab = page.getByRole('tab', { name: /suggestions/i }).first();
    if (await suggestionsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await suggestionsTab.click();
      await page.waitForTimeout(500);

      const suggestionsPanel = page.locator('[data-testid="suggestions-panel"], .suggestions-section').first();
      await expect(suggestionsPanel).toHaveScreenshot('suggestions-panel.png', {
        animations: 'disabled',
        mask: [page.locator('.timestamp')],
      });
    }
  });

  test('should match diff viewer', async ({ page }) => {
    await page.goto('/docs/architecture.md');

    await page.waitForLoadState('networkidle');

    const diffViewer = page.locator('[data-testid="diff-viewer"], .diff-view').first();
    if (await diffViewer.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(diffViewer).toHaveScreenshot('diff-viewer.png', {
        animations: 'disabled',
      });
    }
  });
});

test.describe('Visual Regression - Search UI', () => {
  test('should match search bar', async ({ page }) => {
    await page.goto('/docs');

    await page.waitForLoadState('networkidle');

    const searchBar = page.locator('input[type="search"], [role="searchbox"]').first();
    if (await searchBar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(searchBar).toHaveScreenshot('search-bar.png', {
        animations: 'disabled',
      });
    }
  });

  test('should match search results', async ({ page }) => {
    await page.goto('/search?q=architecture');

    await page.waitForLoadState('networkidle');

    // Wait for results
    await page.waitForSelector('[data-testid="search-results"], .search-results', { timeout: 5000 }).catch(() => {});

    await expect(page).toHaveScreenshot('search-results.png', {
      fullPage: true,
      animations: 'disabled',
      mask: [page.locator('.timestamp, .result-count')], // Mask dynamic content
    });
  });
});

test.describe('Visual Regression - Responsive Design', () => {
  test('should match mobile viewport - homepage', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('mobile-homepage.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match mobile viewport - document', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/docs/architecture.md');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('article, .document-content', { timeout: 10000 });

    await expect(page).toHaveScreenshot('mobile-document.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match tablet viewport - homepage', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('tablet-homepage.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match desktop viewport - document', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); // Full HD

    await page.goto('/docs/architecture.md');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('article, .document-content', { timeout: 10000 });

    await expect(page).toHaveScreenshot('desktop-document.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Dark Mode', () => {
  test('should match dark mode homepage', async ({ page }) => {
    // Enable dark mode via prefers-color-scheme
    await page.emulateMedia({ colorScheme: 'dark' });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('dark-mode-homepage.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match dark mode document', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });

    await page.goto('/docs/architecture.md');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('article, .document-content', { timeout: 10000 });

    await expect(page).toHaveScreenshot('dark-mode-document.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});

test.describe('Visual Regression - Error States', () => {
  test('should match 404 page', async ({ page }) => {
    await page.goto('/non-existent-page');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('404-page.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match error boundary', async ({ page }) => {
    // Try to trigger an error
    await page.goto('/docs/non-existent-document.md');
    await page.waitForLoadState('networkidle');

    // Error page or message should be visible
    await expect(page).toHaveScreenshot('error-page.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});
