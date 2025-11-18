import { test, expect } from '@playwright/test';
import { generateUserData } from '../helpers/test-data';

test.describe('User Logout', () => {
  test('should successfully logout with valid access token', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register and login
    await request.post(`${baseURL}/api/auth/register`, { data: userData });
    const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const { tokens } = await loginResponse.json();

    // Logout
    const response = await request.post(`${baseURL}/api/auth/logout`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      data: {
        refreshToken: tokens.refreshToken,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('message');
  });

  test('should invalidate access token after logout', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register and login
    await request.post(`${baseURL}/api/auth/register`, { data: userData });
    const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const { tokens } = await loginResponse.json();

    // Logout
    await request.post(`${baseURL}/api/auth/logout`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      data: {
        refreshToken: tokens.refreshToken,
      },
    });

    // Try to use the same token
    const response = await request.get(`${baseURL}/api/auth/session`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);
  });

  test('should invalidate refresh token after logout', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register and login
    await request.post(`${baseURL}/api/auth/register`, { data: userData });
    const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const { tokens } = await loginResponse.json();

    // Logout
    await request.post(`${baseURL}/api/auth/logout`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      data: {
        refreshToken: tokens.refreshToken,
      },
    });

    // Try to refresh using the same refresh token
    const response = await request.post(`${baseURL}/api/auth/refresh`, {
      data: {
        refreshToken: tokens.refreshToken,
      },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);
  });

  test('should successfully logout from all devices', async ({ request, baseURL }) => {
    const userData = generateUserData();

    // Register and login multiple times (simulate multiple devices)
    await request.post(`${baseURL}/api/auth/register`, { data: userData });

    const login1 = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const tokens1 = (await login1.json()).tokens;

    const login2 = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const tokens2 = (await login2.json()).tokens;

    // Logout from all devices using first token
    const response = await request.post(`${baseURL}/api/auth/logout-all`, {
      headers: {
        Authorization: `Bearer ${tokens1.accessToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();

    // Both tokens should be invalid
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

  test('should reject logout without authorization header', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/auth/logout`, {
      data: {},
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);
  });

  test('should reject logout with invalid token', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/auth/logout`, {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
      data: {},
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);
  });
});
