import { test, expect } from '@playwright/test';
import { generateEmail, generatePassword, generateWeakPassword } from '../helpers/test-data';

test.describe('User Registration', () => {
  test('should successfully register a new user with valid credentials', async ({ request, baseURL }) => {
    const userData = {
      email: generateEmail('register'),
      password: generatePassword(),
      firstName: 'John',
      lastName: 'Doe',
    };

    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('user');
    expect(data.user).toHaveProperty('id');
    expect(data.user.email).toBe(userData.email);
    expect(data.user.firstName).toBe(userData.firstName);
    expect(data.user.lastName).toBe(userData.lastName);
  });

  test('should reject registration with duplicate email', async ({ request, baseURL }) => {
    const userData = {
      email: generateEmail('duplicate'),
      password: generatePassword(),
      firstName: 'Jane',
      lastName: 'Smith',
    };

    // First registration
    await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    // Second registration with same email
    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error.toLowerCase()).toContain('email');
  });

  test('should reject registration with invalid email format', async ({ request, baseURL }) => {
    const userData = {
      email: 'invalid-email',
      password: generatePassword(),
      firstName: 'Test',
      lastName: 'User',
    };

    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('should reject registration with weak password', async ({ request, baseURL }) => {
    const userData = {
      email: generateEmail('weak-password'),
      password: generateWeakPassword(),
      firstName: 'Test',
      lastName: 'User',
    };

    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error.toLowerCase()).toContain('password');
  });

  test('should reject registration with missing required fields', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: {
        email: generateEmail('missing-fields'),
        // Missing password
      },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('should send email verification token after registration', async ({ request, baseURL }) => {
    const userData = {
      email: generateEmail('verification'),
      password: generatePassword(),
      firstName: 'Verify',
      lastName: 'Test',
    };

    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Check that email verification is pending
    expect(data.user.emailVerified).toBe(false);
  });

  test('should not expose sensitive data in registration response', async ({ request, baseURL }) => {
    const userData = {
      email: generateEmail('security'),
      password: generatePassword(),
      firstName: 'Security',
      lastName: 'Test',
    };

    const response = await request.post(`${baseURL}/api/auth/register`, {
      data: userData,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Should not return password, password hash, or salt
    expect(data.user).not.toHaveProperty('password');
    expect(data.user).not.toHaveProperty('passwordHash');
    expect(data.user).not.toHaveProperty('passwordSalt');
    expect(data.user).not.toHaveProperty('password_hash');
    expect(data.user).not.toHaveProperty('password_salt');
  });
});
