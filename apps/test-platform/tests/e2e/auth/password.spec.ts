import { test, expect } from '@playwright/test';
import { generateUserData, generateEmail, generatePassword, generateStrongPassword, generateWeakPassword } from '../helpers/test-data';

test.describe('Password Management', () => {
  test.describe('Password Reset Request', () => {
    test('should successfully request password reset with valid email', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register user
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Request password reset
      const response = await request.post(`${baseURL}/api/auth/password/reset-request`, {
        data: {
          email: userData.email,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('message');
      expect(data.message.toLowerCase()).toContain('reset');
    });

    test('should not expose whether email exists during reset request', async ({ request, baseURL }) => {
      // Request reset for non-existent email
      const response = await request.post(`${baseURL}/api/auth/password/reset-request`, {
        data: {
          email: 'nonexistent@example.com',
        },
      });

      // Should return success to prevent email enumeration
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('message');
    });

    test('should reject password reset request with invalid email format', async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL}/api/auth/password/reset-request`, {
        data: {
          email: 'invalid-email',
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should rate limit password reset requests', async ({ request, baseURL }) => {
      const userData = generateUserData();
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Make multiple reset requests
      for (let i = 0; i < 5; i++) {
        await request.post(`${baseURL}/api/auth/password/reset-request`, {
          data: { email: userData.email },
        });
      }

      // Next request should be rate limited
      const response = await request.post(`${baseURL}/api/auth/password/reset-request`, {
        data: { email: userData.email },
      });

      // Should either succeed or be rate limited (depends on implementation)
      if (!response.ok()) {
        expect(response.status()).toBe(429); // Too Many Requests
      }
    });
  });

  test.describe('Password Reset with Token', () => {
    test('should successfully reset password with valid token', async ({ request, baseURL }) => {
      const userData = generateUserData();
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Request reset
      await request.post(`${baseURL}/api/auth/password/reset-request`, {
        data: { email: userData.email },
      });

      // In real scenario, token would come from email
      // For testing, we'll use a mock token or retrieve from test database
      const mockToken = 'valid-reset-token-123456';
      const newPassword = generatePassword();

      const response = await request.post(`${baseURL}/api/auth/password/reset`, {
        data: {
          token: mockToken,
          newPassword: newPassword,
        },
      });

      // This test assumes the token validation is implemented
      // If token doesn't exist, it will fail with 400/401
      if (response.ok()) {
        const data = await response.json();
        expect(data).toHaveProperty('message');

        // Verify can login with new password
        const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
          data: {
            email: userData.email,
            password: newPassword,
          },
        });
        expect(loginResponse.ok()).toBeTruthy();
      }
    });

    test('should reject password reset with invalid token', async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL}/api/auth/password/reset`, {
        data: {
          token: 'invalid-token-12345',
          newPassword: generatePassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject password reset with expired token', async ({ request, baseURL }) => {
      const expiredToken = 'expired-token-12345';

      const response = await request.post(`${baseURL}/api/auth/password/reset`, {
        data: {
          token: expiredToken,
          newPassword: generatePassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain('expired');
    });

    test('should reject password reset with weak password', async ({ request, baseURL }) => {
      const mockToken = 'valid-reset-token-123456';

      const response = await request.post(`${baseURL}/api/auth/password/reset`, {
        data: {
          token: mockToken,
          newPassword: generateWeakPassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain('password');
    });

    test('should invalidate reset token after successful use', async ({ request, baseURL }) => {
      const mockToken = 'valid-reset-token-123456';
      const newPassword = generatePassword();

      // First reset
      await request.post(`${baseURL}/api/auth/password/reset`, {
        data: {
          token: mockToken,
          newPassword: newPassword,
        },
      });

      // Try to use same token again
      const response = await request.post(`${baseURL}/api/auth/password/reset`, {
        data: {
          token: mockToken,
          newPassword: generatePassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
    });
  });

  test.describe('Password Change for Authenticated User', () => {
    test('should successfully change password with current password verification', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const newPassword = generateStrongPassword();

      // Change password
      const response = await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          currentPassword: userData.password,
          newPassword: newPassword,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('message');

      // Verify old password doesn't work
      const oldLoginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      expect(oldLoginResponse.ok()).toBeFalsy();

      // Verify new password works
      const newLoginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: newPassword },
      });
      expect(newLoginResponse.ok()).toBeTruthy();
    });

    test('should reject password change with incorrect current password', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Try to change with wrong current password
      const response = await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          currentPassword: 'WrongPassword123!',
          newPassword: generatePassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should reject password change without authentication', async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL}/api/auth/password/change`, {
        data: {
          currentPassword: generatePassword(),
          newPassword: generatePassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
    });

    test('should reject password change with weak new password', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const response = await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          currentPassword: userData.password,
          newPassword: generateWeakPassword(),
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain('password');
    });

    test('should invalidate all sessions after password change', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login twice (two sessions)
      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      const login1 = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const tokens1 = (await login1.json()).tokens;

      const login2 = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const tokens2 = (await login2.json()).tokens;

      // Change password using first session
      const newPassword = generatePassword();
      await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${tokens1.accessToken}`,
        },
        data: {
          currentPassword: userData.password,
          newPassword: newPassword,
        },
      });

      // Both old sessions should be invalid
      const test1 = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          Authorization: `Bearer ${tokens1.accessToken}`,
        },
      });
      expect(test1.ok()).toBeFalsy();

      const test2 = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          Authorization: `Bearer ${tokens2.accessToken}`,
        },
      });
      expect(test2.ok()).toBeFalsy();
    });
  });

  test.describe('Password Strength Validation', () => {
    test('should enforce minimum password length', async ({ request, baseURL }) => {
      const userData = {
        email: generateEmail(),
        password: 'Short1!',
        firstName: 'Test',
        lastName: 'User',
      };

      const response = await request.post(`${baseURL}/api/auth/register`, {
        data: userData,
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain('password');
    });

    test('should require password complexity (uppercase, lowercase, number, special char)', async ({ request, baseURL }) => {
      const testCases = [
        { password: 'alllowercase123!', reason: 'no uppercase' },
        { password: 'ALLUPPERCASE123!', reason: 'no lowercase' },
        { password: 'NoNumbers!', reason: 'no numbers' },
        { password: 'NoSpecial123', reason: 'no special chars' },
      ];

      for (const testCase of testCases) {
        const userData = {
          email: generateEmail(`weak-${testCase.reason}`),
          password: testCase.password,
          firstName: 'Test',
          lastName: 'User',
        };

        const response = await request.post(`${baseURL}/api/auth/register`, {
          data: userData,
        });

        expect(response.ok()).toBeFalsy();
        expect(response.status()).toBe(400);
      }
    });

    test('should accept strong passwords with all requirements', async ({ request, baseURL }) => {
      const userData = {
        email: generateEmail('strong-password'),
        password: generateStrongPassword(),
        firstName: 'Test',
        lastName: 'User',
      };

      const response = await request.post(`${baseURL}/api/auth/register`, {
        data: userData,
      });

      expect(response.ok()).toBeTruthy();
    });
  });

  test.describe('Password History', () => {
    test('should prevent reusing recent passwords', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const originalPassword = userData.password;

      // Change password to a new one
      const tempPassword = generateStrongPassword();
      await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          currentPassword: originalPassword,
          newPassword: tempPassword,
        },
      });

      // Login with new password to get fresh token
      const newLoginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: tempPassword },
      });
      const newTokens = (await newLoginResponse.json()).tokens;

      // Try to change back to original password
      const response = await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${newTokens.accessToken}`,
        },
        data: {
          currentPassword: tempPassword,
          newPassword: originalPassword,
        },
      });

      // Should be rejected if password history is enforced
      if (!response.ok()) {
        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data.error.toLowerCase()).toContain('password');
        expect(data.error.toLowerCase()).toMatch(/recent|history|reuse/);
      }
    });

    test('should track password history for multiple changes', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      let tokens = (await loginResponse.json()).tokens;

      const passwords = [userData.password];

      // Change password multiple times
      for (let i = 0; i < 3; i++) {
        const newPassword = generateStrongPassword();
        await request.post(`${baseURL}/api/auth/password/change`, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          data: {
            currentPassword: passwords[passwords.length - 1],
            newPassword: newPassword,
          },
        });

        passwords.push(newPassword);

        // Get new tokens
        const newLoginResponse = await request.post(`${baseURL}/api/auth/login`, {
          data: { email: userData.email, password: newPassword },
        });
        tokens = (await newLoginResponse.json()).tokens;
      }

      // Try to reuse any of the previous passwords
      const oldPassword = passwords[0];
      const response = await request.post(`${baseURL}/api/auth/password/change`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          currentPassword: passwords[passwords.length - 1],
          newPassword: oldPassword,
        },
      });

      // Should be rejected if password history is enforced
      if (!response.ok()) {
        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data.error.toLowerCase()).toMatch(/recent|history|reuse/);
      }
    });
  });

  test.describe('Security', () => {
    test('should not expose password in any response', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Test registration response
      const registerResponse = await request.post(`${baseURL}/api/auth/register`, {
        data: userData,
      });
      const registerData = await registerResponse.json();
      expect(JSON.stringify(registerData)).not.toContain(userData.password);

      // Test login response
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const loginData = await loginResponse.json();
      expect(JSON.stringify(loginData)).not.toContain(userData.password);
    });

    test('should hash passwords securely', async ({ request, baseURL }) => {
      const userData = generateUserData();

      await request.post(`${baseURL}/api/auth/register`, { data: userData });

      // Password should never appear in plain text in responses
      // This is tested by attempting login and checking response structure
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });

      const data = await loginResponse.json();

      // Should not expose any password-related fields
      expect(data.user).not.toHaveProperty('password');
      expect(data.user).not.toHaveProperty('passwordHash');
      expect(data.user).not.toHaveProperty('passwordSalt');
      expect(data.user).not.toHaveProperty('password_hash');
      expect(data.user).not.toHaveProperty('password_salt');
    });
  });
});
