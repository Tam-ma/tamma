/**
 * API Key Authentication Middleware Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono, Context } from 'hono';
import { apiKeyAuth, requirePermissions, requireScopes, withRateLimit } from '../api-key-auth';
import { apiKeyService } from '../../services/api-key-service';

// Mock the API key service
vi.mock('../../services/api-key-service', () => ({
  apiKeyService: {
    validateApiKey: vi.fn(),
  },
}));

// Mock the logger
vi.mock('../../../../../src/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('API Key Authentication Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    vi.clearAllMocks();
  });

  describe('apiKeyAuth', () => {
    it('should authenticate valid API key from Authorization header', async () => {
      const mockKeyData = {
        id: 'key-123',
        key_id: 'tp_key123',
        user_id: 'user-456',
        organization_id: 'org-789',
        permissions: ['read', 'write'],
        scopes: ['api:read'],
        key_type: 'personal',
      };

      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: mockKeyData as any,
      });

      app.use('/*', apiKeyAuth({ required: true }));
      app.get('/test', (c) => {
        const apiKey = c.get('apiKey');
        const user = c.get('user');
        return c.json({ apiKey, user });
      });

      const res = await app.request('/test', {
        headers: {
          'Authorization': 'Bearer tp_testkey123456',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.apiKey.userId).toBe('user-456');
      expect(body.user.sub).toBe('user-456');
    });

    it('should authenticate valid API key from X-API-Key header', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: [],
          scopes: [],
          key_type: 'service',
        } as any,
      });

      app.use('/*', apiKeyAuth({ required: true }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(200);
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        'tp_testkey123456',
        expect.objectContaining({
          ipAddress: expect.any(String),
        })
      );
    });

    it('should reject invalid API key', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: false,
        error: 'Invalid API key',
      });

      app.use('/*', apiKeyAuth({ required: true }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'Authorization': 'Bearer invalid_key',
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Invalid API key');
    });

    it('should return 401 when API key is required but not provided', async () => {
      app.use('/*', apiKeyAuth({ required: true }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('API key is required');
    });

    it('should allow request when API key is optional and not provided', async () => {
      app.use('/*', apiKeyAuth({ required: false }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(200);
    });

    it('should check permissions when specified', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: ['read'], // Missing 'write' permission
          scopes: [],
          key_type: 'personal',
        } as any,
      });

      app.use('/*', apiKeyAuth({
        required: true,
        checkPermissions: ['read', 'write'],
      }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Insufficient permissions');
    });

    it('should check scopes when specified', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: [],
          scopes: ['api:read'], // Missing 'api:write' scope
          key_type: 'personal',
        } as any,
      });

      app.use('/*', apiKeyAuth({
        required: true,
        checkScopes: ['api:read', 'api:write'],
      }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Insufficient scopes');
    });

    it('should extract domain from Origin header', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: [],
          scopes: [],
          key_type: 'personal',
        } as any,
      });

      app.use('/*', apiKeyAuth({ required: true }));
      app.get('/test', (c) => c.json({ success: true }));

      await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
          'Origin': 'https://example.com',
        },
      });

      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        'tp_testkey123456',
        expect.objectContaining({
          domain: 'example.com',
        })
      );
    });
  });

  describe('requirePermissions', () => {
    it('should create middleware requiring specific permissions', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: ['admin', 'write'],
          scopes: [],
          key_type: 'personal',
        } as any,
      });

      app.use('/*', requirePermissions(['admin', 'write']));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('requireScopes', () => {
    it('should create middleware requiring specific scopes', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: [],
          scopes: ['api:read', 'api:write'],
          key_type: 'personal',
        } as any,
      });

      app.use('/*', requireScopes(['api:read']));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('withRateLimit', () => {
    it('should apply rate limiting', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockResolvedValue({
        isValid: true,
        keyData: {
          id: 'key-123',
          key_id: 'tp_key123',
          user_id: 'user-456',
          permissions: [],
          scopes: [],
          key_type: 'personal',
        } as any,
      });

      app.use('/*', withRateLimit(10)); // 10 requests per hour
      app.get('/test', (c) => c.json({ success: true }));

      // Make multiple requests
      for (let i = 0; i < 10; i++) {
        const res = await app.request('/test', {
          headers: {
            'X-API-Key': 'tp_testkey123456',
          },
        });
        expect(res.status).toBe(200);
      }

      // 11th request should be rate limited
      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Rate limit exceeded');
    });
  });

  describe('error handling', () => {
    it('should handle service errors gracefully', async () => {
      vi.mocked(apiKeyService.validateApiKey).mockRejectedValue(
        new Error('Database connection error')
      );

      app.use('/*', apiKeyAuth({ required: true }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        headers: {
          'X-API-Key': 'tp_testkey123456',
        },
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Authentication failed');
    });
  });
});