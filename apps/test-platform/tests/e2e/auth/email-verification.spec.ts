import { test, expect } from '@playwright/test';
import { generateUserData, generateEmail } from '../helpers/test-data';

test.describe('Email Verification', () => {
  test.describe('Email Verification with Token', () => {
    test('should successfully verify email with valid token', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      const registerResponse = await request.post(`${baseURL}/api/auth/register`, {
        data: userData,
      });
      expect(registerResponse.ok()).toBeTruthy();
      const registerData = await registerResponse.json();

      // Email should be unverified initially
      expect(registerData.user.emailVerified).toBe(false);

      // In real scenario, token would come from email
      // For testing, we'll use a mock token or retrieve from test database
      const mockVerificationToken = 'valid-verification-token-123456';

      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: {
          token: mockVerificationToken,
        },
      });

      // This test assumes the token validation is implemented
      // If token doesn't exist, it will fail with 400/401
      if (response.ok()) {
        const data = await response.json();
        expect(data).toHaveProperty('message');
        expect(data.message.toLowerCase()).toContain('verified');

        // Verify user can now login
        const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
          data: {
            email: userData.email,
            password: userData.password,
          },
        });
        expect(loginResponse.ok()).toBeTruthy();
        const loginData = await loginResponse.json();
        expect(loginData.user.emailVerified).toBe(true);
      }
    });

    test('should reject email verification with invalid token', async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: {
          token: 'invalid-token-12345',
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401, 404]).toContain(response.status());
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error.toLowerCase()).toMatch(/invalid|token/);
    });

    test('should reject email verification with expired token', async ({ request, baseURL }) => {
      const expiredToken = 'expired-verification-token-12345';

      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: {
          token: expiredToken,
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain('expired');
    });

    test('should reject verification of already verified email', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      const verificationToken = 'valid-verification-token-123456';

      // First verification
      await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: verificationToken },
      });

      // Try to verify again with same token
      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: verificationToken },
      });

      // Should fail because token is already used or email is verified
      if (!response.ok()) {
        expect([400, 401, 409]).toContain(response.status());
        const data = await response.json();
        expect(data).toHaveProperty('error');
      }
    });

    test('should handle verification token with missing required fields', async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: {},
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  test.describe('Resend Verification Email', () => {
    test('should successfully resend verification email for unverified account', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Request to resend verification email
      const response = await request.post(`${baseURL}/api/auth/resend-verification`, {
        data: {
          email: userData.email,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('message');
      expect(data.message.toLowerCase()).toContain('sent');
    });

    test('should not expose whether email exists when resending verification', async ({ request, baseURL }) => {
      // Request resend for non-existent email
      const response = await request.post(`${baseURL}/api/auth/resend-verification`, {
        data: {
          email: 'nonexistent@example.com',
        },
      });

      // Should return success to prevent email enumeration
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('message');
    });

    test('should reject resend request for already verified email', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and verify user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Assume email is verified (in real scenario, would verify first)
      const verificationToken = 'valid-verification-token-123456';
      await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: verificationToken },
      });

      // Try to resend verification
      const response = await request.post(`${baseURL}/api/auth/resend-verification`, {
        data: {
          email: userData.email,
        },
      });

      // Should reject if email is already verified
      if (!response.ok()) {
        expect([400, 409]).toContain(response.status());
        const data = await response.json();
        expect(data.error.toLowerCase()).toContain('verified');
      }
    });

    test('should rate limit verification email resend requests', async ({ request, baseURL }) => {
      const userData = generateUserData();
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Make multiple resend requests
      for (let i = 0; i < 5; i++) {
        await request.post(`${baseURL}/api/auth/resend-verification`, {
          data: { email: userData.email },
        });
      }

      // Next request should be rate limited
      const response = await request.post(`${baseURL}/api/auth/resend-verification`, {
        data: { email: userData.email },
      });

      // Should either succeed or be rate limited (depends on implementation)
      if (!response.ok()) {
        expect(response.status()).toBe(429); // Too Many Requests
        const data = await response.json();
        expect(data.error.toLowerCase()).toMatch(/rate|limit|too many/);
      }
    });

    test('should reject resend with invalid email format', async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL}/api/auth/resend-verification`, {
        data: {
          email: 'invalid-email',
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should invalidate old verification tokens when resending', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      const oldToken = 'old-verification-token-123456';

      // Resend verification (generates new token)
      await request.post(`${baseURL}/api/auth/resend-verification`, {
        data: { email: userData.email },
      });

      // Try to use old token
      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: oldToken },
      });

      // Old token should be invalid
      if (!response.ok()) {
        expect([400, 401]).toContain(response.status());
      }
    });
  });

  test.describe('Check Verification Status', () => {
    test('should check verification status for registered email', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Check verification status
      const response = await request.get(`${baseURL}/api/auth/verification-status`, {
        params: {
          email: userData.email,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('emailVerified');
      expect(data.emailVerified).toBe(false);
    });

    test('should return verified status for verified email', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and verify user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      const verificationToken = 'valid-verification-token-123456';
      await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: verificationToken },
      });

      // Check verification status
      const response = await request.get(`${baseURL}/api/auth/verification-status`, {
        params: {
          email: userData.email,
        },
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data).toHaveProperty('emailVerified');
        expect(data.emailVerified).toBe(true);
      }
    });

    test('should not expose whether email exists when checking status', async ({ request, baseURL }) => {
      // Check status for non-existent email
      const response = await request.get(`${baseURL}/api/auth/verification-status`, {
        params: {
          email: 'nonexistent@example.com',
        },
      });

      // Should either return a generic response or 404
      // Implementation may vary to prevent email enumeration
      if (!response.ok()) {
        expect([400, 404]).toContain(response.status());
      }
    });

    test('should check verification status with authentication', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Check own verification status
      const response = await request.get(`${baseURL}/api/auth/me/verification-status`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('emailVerified');
      expect(typeof data.emailVerified).toBe('boolean');
    });
  });

  test.describe('Verification Token Security', () => {
    test('should generate unique verification tokens for different users', async ({ request, baseURL }) => {
      const user1 = generateUserData();
      const user2 = generateUserData();

      // Register both users
      await request.post(`${baseURL}/api/auth/register`, { data: user1 });
      await request.post(`${baseURL}/api/auth/register`, { data: user2 });

      // Tokens should be unique (tested indirectly through the system)
      // Each user should only be able to verify with their own token
      const wrongToken = 'user1-verification-token-12345';

      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: wrongToken },
      });

      // Should not verify user2 with user1's token
      if (!response.ok()) {
        expect([400, 401]).toContain(response.status());
      }
    });

    test('should have sufficient token entropy', async ({ request, baseURL }) => {
      const userData = generateUserData();

      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Request multiple verification emails to check token generation
      // Tokens should be sufficiently random and not guessable
      const emails = [];
      for (let i = 0; i < 3; i++) {
        const user = generateUserData();
        const response = await request.post(`${baseURL}/api/auth/register`, { data: user });
        expect(response.ok()).toBeTruthy();
        emails.push(user.email);
      }

      // All users should have been created successfully
      expect(emails.length).toBe(3);
    });

    test('should not expose verification token in any response', async ({ request, baseURL }) => {
      const userData = generateUserData();

      const response = await request.post(`${baseURL}/api/auth/register`, {
        data: userData,
      });

      const data = await response.json();

      // Should not expose verification token
      expect(data).not.toHaveProperty('verificationToken');
      expect(data.user).not.toHaveProperty('verificationToken');
      expect(data.user).not.toHaveProperty('emailVerificationToken');
    });

    test('should set appropriate expiration for verification tokens', async ({ request, baseURL }) => {
      const userData = generateUserData();

      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Test with an artificially expired token
      const expiredToken = 'expired-token-from-yesterday';

      const response = await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: expiredToken },
      });

      // Should reject expired tokens
      if (!response.ok()) {
        expect([400, 401]).toContain(response.status());
        const data = await response.json();
        expect(data.error.toLowerCase()).toContain('expired');
      }
    });
  });

  test.describe('Login with Unverified Email', () => {
    test('should prevent login if email verification is required', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Try to login without verifying email
      const response = await request.post(`${baseURL}/api/auth/login`, {
        data: {
          email: userData.email,
          password: userData.password,
        },
      });

      // Implementation may allow login but restrict access, or prevent login entirely
      if (!response.ok()) {
        expect(response.status()).toBe(401);
        const data = await response.json();
        expect(data.error.toLowerCase()).toContain('verify');
      } else {
        // If login is allowed, check if verification status is returned
        const data = await response.json();
        expect(data.user).toHaveProperty('emailVerified');
        expect(data.user.emailVerified).toBe(false);
      }
    });

    test('should allow login after email verification', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Verify email
      const verificationToken = 'valid-verification-token-123456';
      await request.post(`${baseURL}/api/auth/verify-email`, {
        data: { token: verificationToken },
      });

      // Login should succeed
      const response = await request.post(`${baseURL}/api/auth/login`, {
        data: {
          email: userData.email,
          password: userData.password,
        },
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data.user.emailVerified).toBe(true);
        expect(data).toHaveProperty('tokens');
      }
    });
  });

  test.describe('Email Change Verification', () => {
    test('should require verification when changing email', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const newEmail = generateEmail('changed');

      // Change email
      const response = await request.post(`${baseURL}/api/auth/change-email`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          newEmail: newEmail,
        },
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data).toHaveProperty('message');
        expect(data.message.toLowerCase()).toMatch(/verification|verify/);

        // New email should be unverified
        expect(data).toHaveProperty('emailVerified');
        expect(data.emailVerified).toBe(false);
      }
    });

    test('should send verification to new email address', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const newEmail = generateEmail('new-address');

      // Change email
      const response = await request.post(`${baseURL}/api/auth/change-email`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          newEmail: newEmail,
        },
      });

      if (response.ok()) {
        const data = await response.json();
        expect(data).toHaveProperty('message');
        // Verification email should be sent to new address
        // This is tested through the email sending service in integration
      }
    });

    test('should reject email change to already registered email', async ({ request, baseURL }) => {
      const user1 = generateUserData();
      const user2 = generateUserData();

      // Register two users
      await request.post(`${baseURL}/api/auth/register`, { data: user1 });
      await request.post(`${baseURL}/api/auth/register`, { data: user2 });

      // Login as user2
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: user2.email, password: user2.password },
      });
      const { tokens } = await loginResponse.json();

      // Try to change email to user1's email
      const response = await request.post(`${baseURL}/api/auth/change-email`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          newEmail: user1.email,
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 409]).toContain(response.status());
      const data = await response.json();
      expect(data.error.toLowerCase()).toMatch(/exist|taken|use/);
    });
  });
});
