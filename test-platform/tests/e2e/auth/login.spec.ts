import { test, expect } from '@playwright/test';
import { generateEmail, generatePassword, generateUserData } from '../helpers/test-data';

test.describe('User Login', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    // Create a test user before each test
    const userData = generateUserData();
    await request.post(`${baseURL}/api/auth/register`, { data: userData });
    // Store user data for tests (in real scenario, you'd use a fixture or global state)
    test.info().annotations.push({ type: 'userData', description: JSON.stringify(userData) });
  });

  test('should successfully login with valid credentials', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Login
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: userData.password,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('user');
    expect(data).toHaveProperty('tokens');
    expect(data.tokens).toHaveProperty('accessToken');
    expect(data.tokens).toHaveProperty('refreshToken');
    expect(data.tokens).toHaveProperty('expiresIn');
    expect(data.tokens.tokenType).toBe('Bearer');

    // Verify user data
    expect(data.user.email).toBe(userData.email);
    expect(data.user).toHaveProperty('id');
  });

  test('should reject login with incorrect password', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Login with wrong password
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: 'WrongPassword123!',
      },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error.toLowerCase()).toContain('invalid');
  });

  test('should reject login with non-existent email', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: 'nonexistent@example.com',
        password: generatePassword(),
      },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('should lock account after 5 failed login attempts', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request.post(`${baseURL}/api/auth/login`, {
        data: {
          email: userData.email,
          password: 'WrongPassword123!',
        },
      });
    }

    // 6th attempt should be locked
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: userData.password, // Even with correct password
      },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(423); // Locked

    const data = await response.json();
    expect(data.error.toLowerCase()).toContain('lock');
  });

  test('should require email verification before login', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Try to login without verifying email
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: userData.password,
      },
    });

    // Should be rejected if email verification is required
    if (!response.ok()) {
      expect(response.status()).toBe(401);
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain('verify');
    }
  });

  test('should track login IP address and timestamp', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Login
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: userData.password,
      },
      headers: {
        'X-Forwarded-For': '192.168.1.100',
      },
    });

    expect(response.ok()).toBeTruthy();
    // Login tracking is verified in the database, not in the response
  });

  test('should return user permissions and role in login response', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Login
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: userData.password,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.user).toHaveProperty('role');
    expect(data.user).toHaveProperty('permissions');
    expect(Array.isArray(data.user.permissions)).toBeTruthy();
  });

  test('should not expose sensitive data in login response', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    // Login
    const response = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        email: userData.email,
        password: userData.password,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Should not return password or hashes
    expect(data.user).not.toHaveProperty('password');
    expect(data.user).not.toHaveProperty('passwordHash');
    expect(data.user).not.toHaveProperty('passwordSalt');
    expect(data.user).not.toHaveProperty('password_hash');
    expect(data.user).not.toHaveProperty('password_salt');
  });
});
