/**
 * Global Setup for Playwright Tests
 *
 * Runs once before all tests. Used for setting up test databases,
 * authentication states, and other global prerequisites.
 */

async function globalSetup() {
  console.log('🚀 Starting global test setup...');

  // Set up environment variables for testing
  process.env.NODE_ENV = 'test';
  process.env.NEXT_PUBLIC_API_URL = process.env.API_URL || 'http://localhost:8787';

  console.log('✅ Global setup complete');
}

export default globalSetup;
