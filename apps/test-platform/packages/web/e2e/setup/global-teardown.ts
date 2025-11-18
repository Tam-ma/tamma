/**
 * Global Teardown for Playwright Tests
 *
 * Runs once after all tests. Used for cleaning up test data,
 * closing connections, and other global cleanup tasks.
 */

async function globalTeardown() {
  console.log('🧹 Starting global test teardown...');

  // Clean up any global resources

  console.log('✅ Global teardown complete');
}

export default globalTeardown;
