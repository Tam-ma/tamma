/**
 * Test data generators and utilities
 */

export function generateEmail(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${prefix}-${timestamp}-${random}@example.com`;
}

export function generatePassword(): string {
  return 'TestPassword123!@#';
}

export function generateStrongPassword(): string {
  const length = 16;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

export function generateWeakPassword(): string {
  return 'weak';
}

export function generateUserData() {
  return {
    email: generateEmail(),
    password: generatePassword(),
    firstName: 'Test',
    lastName: 'User',
  };
}

export function generateOrganizationData() {
  const timestamp = Date.now();
  return {
    name: `Test Org ${timestamp}`,
    description: 'Test organization for e2e testing',
    settings: {
      allowPublicSignup: false,
      requireEmailVerification: true,
    },
  };
}

export function generateApiKeyData() {
  const timestamp = Date.now();
  return {
    name: `Test API Key ${timestamp}`,
    description: 'Test API key for e2e testing',
    expiresIn: 30, // days
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeout: number = 10000,
  interval: number = 500
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Retry an operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
