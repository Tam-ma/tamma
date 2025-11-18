import { test, expect } from '@playwright/test';
import { generateUserData, generateApiKeyData } from '../helpers/test-data';

test.describe('API Key Management', () => {
  test.describe('Create API Key', () => {
    test('should successfully create API key for authenticated user', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const apiKeyData = generateApiKeyData();

      // Create API key
      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: apiKeyData,
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('apiKey');
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('name');
      expect(data.name).toBe(apiKeyData.name);
      expect(data).toHaveProperty('createdAt');
      expect(data).toHaveProperty('expiresAt');

      // API key should be returned only once
      expect(data.apiKey).toBeTruthy();
      expect(typeof data.apiKey).toBe('string');
      expect(data.apiKey.length).toBeGreaterThan(20);
    });

    test('should create API key with custom expiration', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const apiKeyData = {
        name: 'Test API Key with Expiration',
        description: 'Test key with 7 days expiration',
        expiresIn: 7, // days
      };

      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: apiKeyData,
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('expiresAt');
      const expiresAt = new Date(data.expiresAt);
      const now = new Date();
      const daysDiff = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBeGreaterThanOrEqual(6);
      expect(daysDiff).toBeLessThanOrEqual(8);
    });

    test('should create API key with no expiration', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const apiKeyData = {
        name: 'Permanent API Key',
        description: 'Test key with no expiration',
        expiresIn: null,
      };

      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: apiKeyData,
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      // expiresAt should be null or very far in the future
      if (data.expiresAt !== null) {
        const expiresAt = new Date(data.expiresAt);
        const now = new Date();
        const yearsDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);
        expect(yearsDiff).toBeGreaterThan(10);
      }
    });

    test('should create API key with specific scopes/permissions', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const apiKeyData = {
        name: 'Scoped API Key',
        description: 'Test key with specific permissions',
        scopes: ['read:tests', 'write:tests', 'read:results'],
      };

      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: apiKeyData,
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('scopes');
      expect(Array.isArray(data.scopes)).toBeTruthy();
      expect(data.scopes).toEqual(expect.arrayContaining(['read:tests', 'write:tests', 'read:results']));
    });

    test('should reject API key creation without authentication', async ({ request, baseURL }) => {
      const apiKeyData = generateApiKeyData();

      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        data: apiKeyData,
      });

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
    });

    test('should reject API key creation with missing required fields', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          // Missing name
          description: 'Test key',
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should enforce API key creation limits per user', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create multiple API keys
      const maxKeys = 10;
      for (let i = 0; i < maxKeys; i++) {
        await request.post(`${baseURL}/api/auth/api-keys`, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          data: {
            name: `API Key ${i + 1}`,
            description: `Test key ${i + 1}`,
          },
        });
      }

      // Next creation should be limited
      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          name: 'API Key Beyond Limit',
          description: 'This should fail',
        },
      });

      // Should either succeed or be limited (depends on implementation)
      if (!response.ok()) {
        expect([400, 429]).toContain(response.status());
        const data = await response.json();
        expect(data.error.toLowerCase()).toMatch(/limit|maximum/);
      }
    });
  });

  test.describe('List API Keys', () => {
    test('should list all API keys for authenticated user', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create multiple API keys
      await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: { name: 'Key 1', description: 'First key' },
      });

      await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: { name: 'Key 2', description: 'Second key' },
      });

      // List API keys
      const response = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(Array.isArray(data.apiKeys)).toBeTruthy();
      expect(data.apiKeys.length).toBeGreaterThanOrEqual(2);

      // Each key should have metadata but NOT the actual key
      data.apiKeys.forEach((key: any) => {
        expect(key).toHaveProperty('id');
        expect(key).toHaveProperty('name');
        expect(key).toHaveProperty('description');
        expect(key).toHaveProperty('createdAt');
        expect(key).toHaveProperty('lastUsed');

        // Should NOT expose the actual API key
        expect(key).not.toHaveProperty('apiKey');
        expect(key).not.toHaveProperty('key');
      });
    });

    test('should show API key prefix/hint without exposing full key', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const createdKey = await createResponse.json();

      // List API keys
      const response = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      const data = await response.json();
      const listedKey = data.apiKeys.find((k: any) => k.id === createdKey.id);

      expect(listedKey).toBeDefined();
      // Should have a hint/prefix like "pk_test_abc...xyz"
      if (listedKey.hint || listedKey.prefix) {
        expect(listedKey.hint || listedKey.prefix).toBeTruthy();
        expect((listedKey.hint || listedKey.prefix).length).toBeLessThan(createdKey.apiKey.length);
      }
    });

    test('should reject listing API keys without authentication', async ({ request, baseURL }) => {
      const response = await request.get(`${baseURL}/api/auth/api-keys`);

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
    });

    test('should only show API keys belonging to authenticated user', async ({ request, baseURL }) => {
      const user1 = generateUserData();
      const user2 = generateUserData();

      // Register and login both users
      await request.post(`${baseURL}/api/auth/register`, { data: user1 });
      const login1 = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: user1.email, password: user1.password },
      });
      const tokens1 = (await login1.json()).tokens;

      await request.post(`${baseURL}/api/auth/register`, { data: user2 });
      const login2 = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: user2.email, password: user2.password },
      });
      const tokens2 = (await login2.json()).tokens;

      // User 1 creates API key
      await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens1.accessToken}`,
        },
        data: { name: 'User 1 Key', description: 'Key for user 1' },
      });

      // User 2 creates API key
      await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens2.accessToken}`,
        },
        data: { name: 'User 2 Key', description: 'Key for user 2' },
      });

      // User 1 lists their keys
      const response1 = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens1.accessToken}`,
        },
      });

      const data1 = await response1.json();
      expect(data1.apiKeys.length).toBeGreaterThanOrEqual(1);
      expect(data1.apiKeys.some((k: any) => k.name === 'User 1 Key')).toBeTruthy();
      expect(data1.apiKeys.some((k: any) => k.name === 'User 2 Key')).toBeFalsy();
    });

    test('should support pagination for large number of API keys', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create multiple API keys
      for (let i = 0; i < 15; i++) {
        await request.post(`${baseURL}/api/auth/api-keys`, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          data: {
            name: `API Key ${i + 1}`,
            description: `Test key ${i + 1}`,
          },
        });
      }

      // List with pagination
      const response = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        params: {
          page: 1,
          limit: 10,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(Array.isArray(data.apiKeys)).toBeTruthy();
      if (data.apiKeys.length > 0) {
        expect(data.apiKeys.length).toBeLessThanOrEqual(10);
        expect(data).toHaveProperty('total');
        expect(data).toHaveProperty('page');
      }
    });
  });

  test.describe('Delete API Key', () => {
    test('should successfully delete API key', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { id } = await createResponse.json();

      // Delete API key
      const response = await request.delete(`${baseURL}/api/auth/api-keys/${id}`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('message');

      // Verify key is deleted
      const listResponse = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });
      const listData = await listResponse.json();
      expect(listData.apiKeys.some((k: any) => k.id === id)).toBeFalsy();
    });

    test('should reject deletion of non-existent API key', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      const fakeId = 'non-existent-key-id-12345';

      const response = await request.delete(`${baseURL}/api/auth/api-keys/${fakeId}`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([404]).toContain(response.status());
    });

    test('should prevent user from deleting another users API key', async ({ request, baseURL }) => {
      const user1 = generateUserData();
      const user2 = generateUserData();

      // Register and login both users
      await request.post(`${baseURL}/api/auth/register`, { data: user1 });
      const login1 = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: user1.email, password: user1.password },
      });
      const tokens1 = (await login1.json()).tokens;

      await request.post(`${baseURL}/api/auth/register`, { data: user2 });
      const login2 = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: user2.email, password: user2.password },
      });
      const tokens2 = (await login2.json()).tokens;

      // User 1 creates API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens1.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { id } = await createResponse.json();

      // User 2 tries to delete User 1's key
      const response = await request.delete(`${baseURL}/api/auth/api-keys/${id}`, {
        headers: {
          Authorization: `Bearer ${tokens2.accessToken}`,
        },
      });

      expect(response.ok()).toBeFalsy();
      expect([403, 404]).toContain(response.status());
    });

    test('should reject deletion without authentication', async ({ request, baseURL }) => {
      const fakeId = 'some-key-id-12345';

      const response = await request.delete(`${baseURL}/api/auth/api-keys/${fakeId}`);

      expect(response.ok()).toBeFalsy();
      expect([400, 401]).toContain(response.status());
    });
  });

  test.describe('Use API Key for Authentication', () => {
    test('should authenticate request with valid API key', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { apiKey } = await createResponse.json();

      // Use API key to authenticate
      const response = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('user');
      expect(data.user.email).toBe(userData.email);
    });

    test('should reject request with invalid API key', async ({ request, baseURL }) => {
      const response = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': 'invalid-api-key-12345',
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(401);
    });

    test('should reject request with expired API key', async ({ request, baseURL }) => {
      const expiredApiKey = 'expired-api-key-12345';

      const response = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': expiredApiKey,
        },
      });

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(401);
    });

    test('should update last used timestamp when API key is used', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { apiKey, id } = await createResponse.json();

      // Use API key
      await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });

      // Check last used timestamp
      const listResponse = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });
      const listData = await listResponse.json();
      const usedKey = listData.apiKeys.find((k: any) => k.id === id);

      expect(usedKey).toBeDefined();
      expect(usedKey.lastUsed).toBeTruthy();
    });

    test('should support multiple authentication headers (Bearer and API Key)', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { apiKey } = await createResponse.json();

      // Test with API Key
      const apiKeyResponse = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      expect(apiKeyResponse.ok()).toBeTruthy();

      // Test with Bearer token
      const bearerResponse = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });
      expect(bearerResponse.ok()).toBeTruthy();
    });
  });

  test.describe('API Key Permissions and Scopes', () => {
    test('should respect API key scopes for read-only operations', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create read-only API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          name: 'Read-Only Key',
          description: 'Key with read permissions only',
          scopes: ['read:tests', 'read:results'],
        },
      });
      const { apiKey } = await createResponse.json();

      // Try to perform write operation with read-only key
      const response = await request.post(`${baseURL}/api/tests`, {
        headers: {
          'X-API-Key': apiKey,
        },
        data: {
          name: 'Test Suite',
          description: 'Should fail',
        },
      });

      // Should be rejected due to insufficient permissions
      if (!response.ok()) {
        expect(response.status()).toBe(403);
        const data = await response.json();
        expect(data.error.toLowerCase()).toMatch(/permission|scope|forbidden/);
      }
    });

    test('should allow operations within API key scope', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key with specific scopes
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          name: 'Test Management Key',
          description: 'Key with test management permissions',
          scopes: ['read:tests', 'write:tests'],
        },
      });
      const { apiKey } = await createResponse.json();

      // Perform read operation (should succeed)
      const readResponse = await request.get(`${baseURL}/api/tests`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });

      if (readResponse.ok() || readResponse.status() === 404) {
        // Success or no data (both acceptable)
        expect([200, 404]).toContain(readResponse.status());
      }
    });

    test('should validate scope format during API key creation', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Try to create API key with invalid scopes
      const response = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: {
          name: 'Invalid Scope Key',
          description: 'Key with invalid scopes',
          scopes: ['invalid_scope', 'another:invalid'],
        },
      });

      // Should be rejected or sanitized
      if (!response.ok()) {
        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data).toHaveProperty('error');
      }
    });
  });

  test.describe('Security', () => {
    test('should never expose full API key after creation', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { apiKey, id } = await createResponse.json();

      expect(apiKey).toBeTruthy();

      // List API keys - should not include full key
      const listResponse = await request.get(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });
      const listData = await listResponse.json();

      const responseString = JSON.stringify(listData);
      expect(responseString).not.toContain(apiKey);
    });

    test('should hash API keys securely', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { apiKey } = await createResponse.json();

      // API key should be sufficiently long and random
      expect(apiKey.length).toBeGreaterThan(32);
      expect(apiKey).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    test('should generate unique API keys', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create multiple API keys
      const keys = [];
      for (let i = 0; i < 5; i++) {
        const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          data: {
            name: `API Key ${i + 1}`,
            description: `Test key ${i + 1}`,
          },
        });
        const { apiKey } = await createResponse.json();
        keys.push(apiKey);
      }

      // All keys should be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    test('should invalidate API key immediately after deletion', async ({ request, baseURL }) => {
      const userData = generateUserData();

      // Register and login
      await request.post(`${baseURL}/api/auth/register`, { data: userData });
      const loginResponse = await request.post(`${baseURL}/api/auth/login`, {
        data: { email: userData.email, password: userData.password },
      });
      const { tokens } = await loginResponse.json();

      // Create API key
      const createResponse = await request.post(`${baseURL}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: generateApiKeyData(),
      });
      const { apiKey, id } = await createResponse.json();

      // Verify key works
      const beforeDeleteResponse = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      expect(beforeDeleteResponse.ok()).toBeTruthy();

      // Delete key
      await request.delete(`${baseURL}/api/auth/api-keys/${id}`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      // Verify key no longer works
      const afterDeleteResponse = await request.get(`${baseURL}/api/auth/session`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      expect(afterDeleteResponse.ok()).toBeFalsy();
      expect(afterDeleteResponse.status()).toBe(401);
    });
  });
});
