import { beforeEach, afterEach, vi } from 'vitest';
import { cleanupTestDatabase } from './helpers/db-helpers';

/**
 * Global test setup
 * Runs before each test to ensure clean state
 */
beforeEach(async () => {
  // Clear all mocks before each test
  vi.clearAllMocks();

  // Reset modules to ensure fresh imports
  vi.resetModules();
});

/**
 * Global test teardown
 * Runs after each test to clean up resources
 */
afterEach(async () => {
  // Clean up test database
  await cleanupTestDatabase();

  // Restore all mocks
  vi.restoreAllMocks();
});

/**
 * Mock crypto.randomUUID for deterministic IDs in tests
 */
let idCounter = 0;

// Only mock if not already available (Node.js 19+ has built-in crypto)
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => {
        idCounter++;
        return `test-uuid-${idCounter.toString().padStart(3, '0')}`;
      },
      subtle: {},
      getRandomValues: (arr: any) => arr,
    },
    writable: true,
    configurable: true,
  });
} else {
  // Override randomUUID for deterministic tests
  const originalRandomUUID = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => {
    idCounter++;
    return `test-uuid-${idCounter.toString().padStart(3, '0')}`;
  };
}

/**
 * Mock console methods to reduce noise in test output
 * Uncomment to enable console output in tests
 */
// global.console = {
//   ...console,
//   log: vi.fn(),
//   debug: vi.fn(),
//   info: vi.fn(),
//   warn: vi.fn(),
//   error: vi.fn(),
// };
