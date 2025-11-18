import { test as base } from '@playwright/test';
import { APIRequestContext } from '@playwright/test';

type AuthUser = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
};

type AuthFixtures = {
  authenticatedUser: AuthUser;
  apiContext: APIRequestContext;
};

/**
 * Fixture for authenticated user
 * Automatically creates a user, logs them in, and provides access tokens
 */
export const test = base.extend<AuthFixtures>({
  authenticatedUser: async ({ request, baseURL }, use) => {
    const timestamp = Date.now();
    const user: AuthUser = {
      email: `test-${timestamp}@example.com`,
      password: 'TestPassword123!@#',
      firstName: 'Test',
      lastName: 'User',
    };

    // Register user
    const registerResponse = await request.post(`${baseURL}/api/auth/register`, {
      data: {
        email: user.email,
        password: user.password,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });

    if (!registerResponse.ok()) {
      throw new Error(`Failed to register user: ${await registerResponse.text()}`);
    }

    const registerData = await registerResponse.json();
    user.userId = registerData.user?.id;

    // For e2e tests, we need to bypass email verification
    // In production, this would require clicking the verification email
    // For now, we'll directly verify the email using a test endpoint or database update
    // TODO: Add test-only endpoint to verify email or update database directly

    // Login user
    const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: user.email,
        password: user.password,
      },
    });

    if (!loginResponse.ok()) {
      throw new Error(`Failed to login user: ${await loginResponse.text()}`);
    }

    const loginData = await loginResponse.json();
    user.accessToken = loginData.tokens?.accessToken;
    user.refreshToken = loginData.tokens?.refreshToken;
    user.userId = loginData.user?.id;

    // Provide authenticated user to test
    await use(user);

    // Cleanup: Logout and delete user (optional)
    try {
      await request.post(`${baseURL}/api/auth/logout`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
        data: {
          refreshToken: user.refreshToken,
        },
      });
    } catch (error) {
      console.warn('Failed to logout user during cleanup:', error);
    }
  },

  apiContext: async ({ request, authenticatedUser }, use) => {
    // Create API context with authentication headers
    const context = await request.newContext({
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      extraHTTPHeaders: {
        Authorization: `Bearer ${authenticatedUser.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    await use(context);
    await context.dispose();
  },
});

export { expect } from '@playwright/test';
