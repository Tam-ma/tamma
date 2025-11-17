import { test, expect } from '@playwright/test';
import { generateUserData } from '../helpers/test-data';

test.describe('Token Refresh', () => {
  test('should successfully refresh access token with valid refresh token', async ({ request, baseURL }) => {
    const userData = generateUserData();
    await request.post(`${baseURL}/api/auth/register`, { data: userData });
    const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const { tokens } = await loginResponse.json();

    const response = await request.post(`${baseURL}/api/auth/refresh`, {
      data: { refreshToken: tokens.refreshToken },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.tokens).toHaveProperty('accessToken');
    expect(data.tokens).toHaveProperty('refreshToken');
    expect(data.tokens.accessToken).not.toBe(tokens.accessToken);
    expect(data.tokens.refreshToken).not.toBe(tokens.refreshToken);
  });

  test('should invalidate old refresh token after refresh', async ({ request, baseURL }) => {
    const userData = generateUserData();
    await request.post(`${baseURL}/api/auth/register`, { data: userData });
    const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: userData.email, password: userData.password },
    });
    const { tokens } = await loginResponse.json();

    await request.post(`${baseURL}/api/auth/refresh`, {
      data: { refreshToken: tokens.refreshToken },
    });

    const response = await request.post(`${baseURL}/api/auth/refresh`, {
      data: { refreshToken: tokens.refreshToken },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);
  });

  test('should reject refresh with invalid token', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/auth/refresh`, {
      data: { refreshToken: 'invalid-refresh-token' },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(401);
  });
});
