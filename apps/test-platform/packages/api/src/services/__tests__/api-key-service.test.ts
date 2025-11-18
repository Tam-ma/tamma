/**
 * API Key Service Tests
 * Comprehensive tests for API key generation, validation, and management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiKeyService } from '../api-key-service';
import { getDatabase } from '../../../../../src/database/connection';

// Mock the database connection
vi.mock('../../../../../src/database/connection');

// Mock the logger
vi.mock('../../../../../src/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ApiKeyService', () => {
  let mockDb: any;

  beforeEach(() => {
    // Setup mock database
    mockDb = {
      insert: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      first: vi.fn(),
      select: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      increment: vi.fn().mockReturnThis(),
    };

    // Mock the table function
    const tableFn = vi.fn((tableName: string) => mockDb);
    tableFn.raw = vi.fn();

    vi.mocked(getDatabase).mockResolvedValue(tableFn as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('should generate a new API key with secure hashing', async () => {
      // Mock database operations
      mockDb.insert.mockResolvedValue(undefined);
      mockDb.first.mockResolvedValue({
        id: 'test-key-id',
        key_id: 'tp_test123',
        key_hash: 'hashed-key',
        key_prefix: 'tp_test',
        user_id: 'user-123',
        name: 'Test API Key',
        key_type: 'personal',
        permissions: '[]',
        scopes: '[]',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await apiKeyService.generateApiKey(
        'user-123',
        {
          name: 'Test API Key',
          description: 'Test key for unit tests',
          keyType: 'personal',
          permissions: ['read', 'write'],
          scopes: ['api:read', 'api:write'],
        },
        'org-456'
      );

      expect(result).toBeDefined();
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey).toMatch(/^tp_/); // Should start with prefix
      expect(result.keyData).toBeDefined();
      expect(result.keyData.name).toBe('Test API Key');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should set default expiry date if not provided', async () => {
      mockDb.insert.mockResolvedValue(undefined);
      mockDb.first.mockResolvedValue({
        id: 'test-key-id',
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });

      await apiKeyService.generateApiKey(
        'user-123',
        {
          name: 'Test API Key',
        }
      );

      const insertCall = mockDb.insert.mock.calls[0][0];
      expect(insertCall.expires_at).toBeDefined();
      expect(insertCall.expires_at).toBeInstanceOf(Date);
    });
  });

  describe('validateApiKey', () => {
    it('should validate a correct API key', async () => {
      const testKey = 'tp_testkey123456789';

      mockDb.first.mockResolvedValue({
        id: 'key-123',
        key_hash: apiKeyService['hashApiKey'](testKey), // Access private method for testing
        key_prefix: 'tp_testkey',
        user_id: 'user-123',
        status: 'active',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        permissions: '["read"]',
        scopes: '["api:read"]',
        usage_count: 10,
        usage_limit: 100,
      });

      const result = await apiKeyService.validateApiKey(testKey);

      expect(result.isValid).toBe(true);
      expect(result.keyData).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should reject an expired API key', async () => {
      mockDb.first.mockResolvedValue({
        id: 'key-123',
        key_hash: 'valid-hash',
        key_prefix: 'tp_test',
        status: 'active',
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      });

      const result = await apiKeyService.validateApiKey('tp_testkey123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('API key has expired');
    });

    it('should reject an invalid API key', async () => {
      mockDb.first.mockResolvedValue(null);

      const result = await apiKeyService.validateApiKey('tp_invalidkey');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should check IP restrictions', async () => {
      mockDb.first.mockResolvedValue({
        id: 'key-123',
        key_hash: 'valid-hash',
        key_prefix: 'tp_test',
        status: 'active',
        allowed_ips: '192.168.1.1,10.0.0.1',
      });

      const result = await apiKeyService.validateApiKey('tp_testkey123', {
        ipAddress: '192.168.1.2', // Not in allowed list
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('IP address not allowed');
    });

    it('should check usage limits', async () => {
      mockDb.first.mockResolvedValue({
        id: 'key-123',
        key_hash: 'valid-hash',
        key_prefix: 'tp_test',
        status: 'active',
        usage_count: 100,
        usage_limit: 100,
      });

      const result = await apiKeyService.validateApiKey('tp_testkey123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('API key usage limit exceeded');
    });
  });

  describe('getUserApiKeys', () => {
    it('should return all API keys for a user', async () => {
      const mockKeys = [
        {
          id: 'key-1',
          key_id: 'tp_key1',
          name: 'Key 1',
          permissions: '["read"]',
          scopes: '["api:read"]',
        },
        {
          id: 'key-2',
          key_id: 'tp_key2',
          name: 'Key 2',
          permissions: '["write"]',
          scopes: '["api:write"]',
        },
      ];

      mockDb.select.mockResolvedValue(mockKeys);

      const keys = await apiKeyService.getUserApiKeys('user-123');

      expect(keys).toHaveLength(2);
      expect(keys[0].permissions).toEqual(['read']); // Should be parsed
      expect(keys[1].scopes).toEqual(['api:write']); // Should be parsed
    });

    it('should filter by organization if provided', async () => {
      mockDb.select.mockResolvedValue([]);

      await apiKeyService.getUserApiKeys('user-123', 'org-456');

      expect(mockDb.where).toHaveBeenCalledWith('user_id', 'user-123');
      expect(mockDb.where).toHaveBeenCalledWith('organization_id', 'org-456');
    });
  });

  describe('updateApiKey', () => {
    it('should update an API key', async () => {
      mockDb.first.mockResolvedValue({
        id: 'key-123',
        user_id: 'user-123',
        name: 'Old Name',
      });

      mockDb.update.mockResolvedValue(undefined);

      const result = await apiKeyService.updateApiKey(
        'key-123',
        'user-123',
        {
          name: 'New Name',
          permissions: ['read', 'write'],
        }
      );

      expect(mockDb.update).toHaveBeenCalled();
      const updateCall = mockDb.update.mock.calls[0][0];
      expect(updateCall.permissions).toBe('["read","write"]'); // Should be stringified
    });

    it('should throw error if key not found', async () => {
      mockDb.first.mockResolvedValue(null);

      await expect(
        apiKeyService.updateApiKey('key-123', 'user-123', { name: 'New Name' })
      ).rejects.toThrow('API key not found');
    });

    it('should throw error if user does not own the key', async () => {
      mockDb.first.mockResolvedValue({
        id: 'key-123',
        user_id: 'other-user',
        organization_id: 'org-123',
      });

      await expect(
        apiKeyService.updateApiKey('key-123', 'user-123', { name: 'New Name' })
      ).rejects.toThrow('Access denied');
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an API key', async () => {
      mockDb.first.mockResolvedValue({
        id: 'key-123',
        user_id: 'user-123',
      });

      mockDb.update.mockResolvedValue(undefined);

      await apiKeyService.revokeApiKey('key-123', 'user-123');

      expect(mockDb.update).toHaveBeenCalledWith({
        status: 'revoked',
        updated_at: expect.any(Date),
      });
    });

    it('should throw error if key not found', async () => {
      mockDb.first.mockResolvedValue(null);

      await expect(
        apiKeyService.revokeApiKey('key-123', 'user-123')
      ).rejects.toThrow('API key not found');
    });
  });

  describe('rotateApiKey', () => {
    it('should rotate an API key', async () => {
      const oldKey = {
        id: 'old-key',
        user_id: 'user-123',
        name: 'Original Key',
        key_type: 'personal',
        permissions: '["read"]',
        scopes: '["api:read"]',
      };

      mockDb.first
        .mockResolvedValueOnce(oldKey) // Get old key
        .mockResolvedValueOnce({ // New key after creation
          id: 'new-key',
          name: 'Original Key (Rotated)',
        });

      mockDb.update.mockResolvedValue(undefined);
      mockDb.insert.mockResolvedValue(undefined);

      const result = await apiKeyService.rotateApiKey('old-key', 'user-123');

      expect(result.apiKey).toBeDefined();
      expect(result.keyData.name).toContain('(Rotated)');

      // Old key should be revoked
      expect(mockDb.update).toHaveBeenCalledWith({
        status: 'revoked',
        updated_at: expect.any(Date),
      });
    });
  });

  describe('security', () => {
    it('should use HMAC-SHA256 for hashing', () => {
      const apiKey = 'tp_testsecretkey';
      const hash1 = apiKeyService['hashApiKey'](apiKey);
      const hash2 = apiKeyService['hashApiKey'](apiKey);

      expect(hash1).toBe(hash2); // Deterministic
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex output
      expect(hash1).not.toBe(apiKey); // Not plain text
    });

    it('should generate cryptographically secure keys', () => {
      const key1 = apiKeyService['generateSecureKey']();
      const key2 = apiKeyService['generateSecureKey']();

      expect(key1).not.toBe(key2); // Unique
      expect(key1).toMatch(/^tp_/); // Has prefix
      expect(key1.length).toBeGreaterThan(50); // Sufficient length
    });
  });
});