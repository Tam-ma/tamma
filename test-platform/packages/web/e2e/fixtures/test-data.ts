/**
 * Test Data Fixtures
 *
 * Contains reusable test data for E2E tests including user credentials,
 * API key configurations, and mock tokens.
 */

import { faker } from '@faker-js/faker';

/**
 * Generate a unique email address for testing
 */
export function generateTestEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${timestamp}-${random}@example.com`;
}

/**
 * Generate a strong password that meets validation requirements
 */
export function generateStrongPassword(): string {
  // At least 12 characters, 1 uppercase, 1 lowercase, 1 number, 1 special char
  return `Test${faker.internet.password({ length: 8, memorable: false })}@123`;
}

/**
 * Test user data for registration and login
 */
export interface TestUser {
  email: string;
  password: string;
  fullName: string;
  confirmPassword?: string;
}

/**
 * Create a test user with valid data
 */
export function createTestUser(overrides?: Partial<TestUser>): TestUser {
  const password = generateStrongPassword();
  return {
    email: generateTestEmail(),
    password,
    confirmPassword: password,
    fullName: faker.person.fullName(),
    ...overrides,
  };
}

/**
 * Pre-defined test users for specific scenarios
 */
export const TEST_USERS = {
  valid: createTestUser({
    email: 'valid.user@example.com',
    password: 'ValidPassword123!',
    fullName: 'Valid User',
  }),

  unverified: createTestUser({
    email: 'unverified@example.com',
    password: 'ValidPassword123!',
    fullName: 'Unverified User',
  }),

  admin: createTestUser({
    email: 'admin@example.com',
    password: 'AdminPassword123!',
    fullName: 'Admin User',
  }),
};

/**
 * Invalid user data for edge case testing
 */
export const INVALID_USER_DATA = {
  invalidEmail: {
    email: 'not-an-email',
    password: 'ValidPassword123!',
    fullName: 'Invalid Email User',
  },

  weakPassword: {
    email: generateTestEmail(),
    password: 'weak',
    fullName: 'Weak Password User',
  },

  noUppercase: {
    email: generateTestEmail(),
    password: 'nouppercasepassword123!',
    fullName: 'No Uppercase User',
  },

  noNumber: {
    email: generateTestEmail(),
    password: 'NoNumberPassword!',
    fullName: 'No Number User',
  },

  tooShort: {
    email: generateTestEmail(),
    password: 'Short1!',
    fullName: 'Short Password User',
  },

  passwordMismatch: {
    email: generateTestEmail(),
    password: 'ValidPassword123!',
    confirmPassword: 'DifferentPassword123!',
    fullName: 'Mismatch User',
  },
};

/**
 * API Key test data
 */
export interface TestAPIKey {
  name: string;
  description: string;
  scopes: string[];
  rateLimit: number;
  expiresInDays: number;
}

/**
 * Create test API key data
 */
export function createTestAPIKey(overrides?: Partial<TestAPIKey>): TestAPIKey {
  return {
    name: `Test Key ${Date.now()}`,
    description: faker.lorem.sentence(),
    scopes: ['read:benchmarks', 'write:benchmarks'],
    rateLimit: 1000,
    expiresInDays: 90,
    ...overrides,
  };
}

/**
 * Pre-defined API key configurations
 */
export const TEST_API_KEYS = {
  basic: createTestAPIKey({
    name: 'Basic Test Key',
    description: 'A basic test API key',
    scopes: ['read:benchmarks'],
    rateLimit: 100,
    expiresInDays: 30,
  }),

  fullAccess: createTestAPIKey({
    name: 'Full Access Key',
    description: 'API key with full access',
    scopes: [
      'read:benchmarks',
      'write:benchmarks',
      'read:models',
      'write:models',
      'read:usage',
    ],
    rateLimit: 10000,
    expiresInDays: 365,
  }),

  limited: createTestAPIKey({
    name: 'Limited Access Key',
    description: 'API key with limited access',
    scopes: ['read:benchmarks'],
    rateLimit: 50,
    expiresInDays: 7,
  }),
};

/**
 * Mock verification tokens
 */
export const MOCK_TOKENS = {
  validVerification: 'valid-verification-token-123456',
  expiredVerification: 'expired-verification-token-123456',
  invalidVerification: 'invalid-verification-token-123456',

  validPasswordReset: 'valid-reset-token-123456',
  expiredPasswordReset: 'expired-reset-token-123456',
  invalidPasswordReset: 'invalid-reset-token-123456',
};

/**
 * Common test credentials for reuse across tests
 */
export const TEST_CREDENTIALS = {
  email: 'test@example.com',
  password: 'TestPassword123!',
  newPassword: 'NewTestPassword123!',
};

/**
 * API endpoint paths
 */
export const API_ENDPOINTS = {
  register: '/api/auth/register',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  verifyEmail: '/api/auth/verify-email',
  forgotPassword: '/api/auth/forgot-password',
  resetPassword: '/api/auth/reset-password',

  // API Keys
  apiKeys: '/api/api-keys',
  createKey: '/api/api-keys/create',
  revokeKey: (id: string) => `/api/api-keys/${id}/revoke`,
  updateKey: (id: string) => `/api/api-keys/${id}`,
  getKeyUsage: (id: string) => `/api/api-keys/${id}/usage`,
};

/**
 * Page routes
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  verifyEmail: '/verify-email',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  dashboard: '/dashboard',
  apiKeys: '/settings/api-keys',
};

/**
 * Test timeouts (in milliseconds)
 */
export const TIMEOUTS = {
  navigation: 5000,
  apiRequest: 10000,
  animation: 1000,
  debounce: 500,
};

/**
 * Accessibility test configuration
 */
export const A11Y_CONFIG = {
  rules: {
    // Disable color contrast checks in dev environment
    'color-contrast': { enabled: false },
  },
};

/**
 * Visual regression test configuration
 */
export const VISUAL_CONFIG = {
  threshold: 0.1, // 10% difference threshold
  maxDiffPixelRatio: 0.05, // 5% of pixels can be different
};
