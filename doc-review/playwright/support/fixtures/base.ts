import { test as base } from '@playwright/test';

/**
 * Base test fixture with custom extensions
 */
export const test = base.extend({
  // Auto-capture console logs on failure
  page: async ({ page }, use, testInfo) => {
    const logs: string[] = [];
    const errors: string[] = [];

    page.on('console', (msg) => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', (error) => {
      errors.push(`[PAGE ERROR] ${error.message}`);
    });

    await use(page);

    // Save logs on failure
    if (testInfo.status !== testInfo.expectedStatus) {
      const logsPath = `${testInfo.outputDir}/console-logs.txt`;
      const errorsPath = `${testInfo.outputDir}/page-errors.txt`;

      if (logs.length > 0) {
        const fs = await import('fs');
        fs.writeFileSync(logsPath, logs.join('\n'));
        testInfo.attachments.push({
          name: 'console-logs',
          contentType: 'text/plain',
          path: logsPath,
        });
      }

      if (errors.length > 0) {
        const fs = await import('fs');
        fs.writeFileSync(errorsPath, errors.join('\n'));
        testInfo.attachments.push({
          name: 'page-errors',
          contentType: 'text/plain',
          path: errorsPath,
        });
      }
    }
  },
});

export { expect } from '@playwright/test';
