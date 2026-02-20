/**
 * API Key Service
 * Handles generation, validation, and management of API keys
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { addDays, addMonths } from 'date-fns';
import { getDatabase } from '../../../../src/database/connection';
import { logger } from '../../../../src/observability/logger';
import { ApiError } from '../utils/api-error';

export interface ApiKeyData {
  id: string;
  key_id: string;
  key_hash: string;
  key_prefix: string;
  user_id: string;
  organization_id?: string;
  name: string;
  description?: string;
  key_type: 'personal' | 'service' | 'integration';
  permissions: any;
  scopes: string[];
  allowed_ips?: string;
  allowed_domains?: string;
  status: 'active' | 'inactive' | 'revoked' | 'expired';
  expires_at?: Date;
  usage_count: number;
  usage_limit?: number;
  usage_reset_at?: Date;
  require_mfa: boolean;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  last_used_at?: Date;
  last_used_ip?: string;
  last_used_user_agent?: string;
}

export interface ApiKeyGenerationOptions {
  name: string;
  description?: string;
  keyType?: 'personal' | 'service' | 'integration';
  permissions?: string[];
  scopes?: string[];
  allowedIps?: string[];
  allowedDomains?: string[];
  expiresAt?: Date;
  usageLimit?: number;
  requireMfa?: boolean;
}

export class ApiKeyService {
  private readonly KEY_LENGTH = 48;
  private readonly KEY_PREFIX = 'tp_';
  private readonly KEY_PREFIX_LENGTH = 8;
  private readonly DEFAULT_EXPIRY_DAYS = 365;

  /**
   * Generate a new API key with secure hashing
   */
  async generateApiKey(
    userId: string,
    options: ApiKeyGenerationOptions,
    organizationId?: string,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<{
    apiKey: string;
    keyData: ApiKeyData;
  }> {
    try {
      // Generate secure API key
      const apiKey = this.generateSecureKey();
      const keyHash = this.hashApiKey(apiKey);
      const keyPrefix = apiKey.substring(0, this.KEY_PREFIX.length + this.KEY_PREFIX_LENGTH);
      const keyId = `key_${Date.now()}_${randomBytes(8).toString('hex')}`;

      // Set default expiry if not provided
      const expiresAt = options.expiresAt || addDays(new Date(), this.DEFAULT_EXPIRY_DAYS);

      const db = await getDatabase();

      // Store API key in database
      const keyData = {
        id: keyId,
        key_id: keyPrefix + '_' + randomBytes(4).toString('hex'),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        user_id: userId,
        organization_id: organizationId,
        name: options.name,
        description: options.description,
        key_type: options.keyType || 'personal',
        permissions: JSON.stringify(options.permissions || []),
        scopes: JSON.stringify(options.scopes || []),
        allowed_ips: options.allowedIps?.join(','),
        allowed_domains: options.allowedDomains?.join(','),
        status: 'active',
        expires_at: expiresAt,
        usage_count: 0,
        usage_limit: options.usageLimit,
        usage_reset_at: addMonths(new Date(), 1), // Reset monthly
        require_mfa: options.requireMfa || false,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: userId,
        created_from_ip: context?.ipAddress,
        created_from_user_agent: context?.userAgent,
      };

      await db('api_keys').insert(keyData);

      const fullKeyData = await this.getApiKeyById(keyId);

      // Emit event for audit trail
      await this.emitEvent('API_KEY.CREATED', {
        keyId: keyData.id,
        keyPrefix: keyData.key_prefix,
        userId,
        organizationId,
        name: options.name,
        keyType: keyData.key_type,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      logger.info('API key generated', {
        keyId: keyData.id,
        keyPrefix: keyData.key_prefix,
        userId,
        organizationId,
        name: options.name,
      });

      return {
        apiKey, // Return the full key only once
        keyData: fullKeyData!,
      };
    } catch (error) {
      logger.error('Failed to generate API key', { error, userId, options });
      throw new ApiError(500, 'Failed to generate API key');
    }
  }

  /**
   * Validate an API key
   */
  async validateApiKey(
    apiKey: string,
    context?: {
      ipAddress?: string;
      userAgent?: string;
      domain?: string;
    }
  ): Promise<{
    isValid: boolean;
    keyData?: ApiKeyData;
    error?: string;
  }> {
    try {
      // Extract key prefix for quick lookup
      const keyPrefix = apiKey.substring(0, this.KEY_PREFIX.length + this.KEY_PREFIX_LENGTH);

      const db = await getDatabase();

      // Find API key by prefix
      const keyData = await db('api_keys')
        .where('key_prefix', keyPrefix)
        .where('status', 'active')
        .first();

      if (!keyData) {
        return { isValid: false, error: 'Invalid API key' };
      }

      // Check expiry
      if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
        await this.updateKeyStatus(keyData.id, 'expired');
        return { isValid: false, error: 'API key has expired' };
      }

      // Verify key hash
      const isValidHash = await this.verifyApiKeyHash(apiKey, keyData.key_hash);
      if (!isValidHash) {
        return { isValid: false, error: 'Invalid API key' };
      }

      // Check IP restrictions
      if (keyData.allowed_ips && context?.ipAddress) {
        const allowedIps = keyData.allowed_ips.split(',').map((ip: string) => ip.trim());
        if (!allowedIps.includes(context.ipAddress)) {
          await this.recordFailedAttempt(keyData.id, context.ipAddress, 'IP_NOT_ALLOWED');
          return { isValid: false, error: 'IP address not allowed' };
        }
      }

      // Check domain restrictions
      if (keyData.allowed_domains && context?.domain) {
        const allowedDomains = keyData.allowed_domains.split(',').map((domain: string) => domain.trim());
        if (!allowedDomains.includes(context.domain)) {
          await this.recordFailedAttempt(keyData.id, context.ipAddress, 'DOMAIN_NOT_ALLOWED');
          return { isValid: false, error: 'Domain not allowed' };
        }
      }

      // Check usage limits
      if (keyData.usage_limit && keyData.usage_count >= keyData.usage_limit) {
        return { isValid: false, error: 'API key usage limit exceeded' };
      }

      // Update usage statistics
      await this.updateUsageStats(keyData.id, context);

      // Parse JSON fields
      keyData.permissions = typeof keyData.permissions === 'string'
        ? JSON.parse(keyData.permissions)
        : keyData.permissions;
      keyData.scopes = typeof keyData.scopes === 'string'
        ? JSON.parse(keyData.scopes)
        : keyData.scopes;

      logger.debug('API key validated successfully', {
        keyId: keyData.id,
        keyPrefix: keyData.key_prefix,
        userId: keyData.user_id,
        ipAddress: context?.ipAddress,
      });

      return { isValid: true, keyData };
    } catch (error) {
      logger.error('API key validation failed', { error, keyPrefix: apiKey.substring(0, 11) });
      return { isValid: false, error: 'API key validation failed' };
    }
  }

  /**
   * Get user's API keys
   */
  async getUserApiKeys(userId: string, organizationId?: string): Promise<ApiKeyData[]> {
    try {
      const db = await getDatabase();
      const query = db('api_keys').where('user_id', userId).orderBy('created_at', 'desc');

      if (organizationId) {
        query.where('organization_id', organizationId);
      }

      const keys = await query.select([
        'id',
        'key_id',
        'key_prefix',
        'name',
        'description',
        'key_type',
        'permissions',
        'scopes',
        'allowed_ips',
        'allowed_domains',
        'status',
        'expires_at',
        'usage_count',
        'usage_limit',
        'require_mfa',
        'created_at',
        'updated_at',
        'last_used_at',
        'last_used_ip',
        'organization_id',
      ]);

      // Parse JSON fields
      return keys.map(key => ({
        ...key,
        permissions: typeof key.permissions === 'string' ? JSON.parse(key.permissions) : key.permissions,
        scopes: typeof key.scopes === 'string' ? JSON.parse(key.scopes) : key.scopes,
      }));
    } catch (error) {
      logger.error('Failed to get user API keys', { error, userId });
      throw new ApiError(500, 'Failed to get API keys');
    }
  }

  /**
   * Update an API key
   */
  async updateApiKey(
    keyId: string,
    userId: string,
    updates: Partial<ApiKeyUpdate>,
    organizationId?: string
  ): Promise<ApiKeyData> {
    try {
      const keyData = await this.getApiKeyById(keyId);
      if (!keyData) {
        throw new ApiError(404, 'API key not found');
      }

      if (keyData.user_id !== userId) {
        // Check if user has admin permissions in the organization
        if (!organizationId || keyData.organization_id !== organizationId) {
          throw new ApiError(403, 'Access denied');
        }
      }

      const db = await getDatabase();

      // Prepare update data
      const updateData: any = {
        ...updates,
        updated_at: new Date(),
      };

      // Convert arrays to JSON strings if needed
      if (updates.permissions) {
        updateData.permissions = JSON.stringify(updates.permissions);
      }
      if (updates.scopes) {
        updateData.scopes = JSON.stringify(updates.scopes);
      }
      if (updates.allowedIps) {
        updateData.allowed_ips = updates.allowedIps.join(',');
      }
      if (updates.allowedDomains) {
        updateData.allowed_domains = updates.allowedDomains.join(',');
      }

      // Remove undefined fields
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      await db('api_keys').where('id', keyId).update(updateData);

      const updatedKey = await this.getApiKeyById(keyId);

      // Emit event for audit trail
      await this.emitEvent('API_KEY.UPDATED', {
        keyId,
        userId,
        updates: Object.keys(updates),
        organizationId,
      });

      logger.info('API key updated', {
        keyId,
        userId,
        updates: Object.keys(updates),
      });

      return updatedKey!;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Failed to update API key', { error, keyId, userId });
      throw new ApiError(500, 'Failed to update API key');
    }
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(keyId: string, userId: string, organizationId?: string): Promise<void> {
    try {
      const keyData = await this.getApiKeyById(keyId);
      if (!keyData) {
        throw new ApiError(404, 'API key not found');
      }

      if (keyData.user_id !== userId) {
        // Check admin permissions
        if (!organizationId || keyData.organization_id !== organizationId) {
          throw new ApiError(403, 'Access denied');
        }
      }

      await this.updateKeyStatus(keyId, 'revoked');

      // Emit event for audit trail
      await this.emitEvent('API_KEY.REVOKED', {
        keyId,
        userId,
        organizationId,
      });

      logger.info('API key revoked', {
        keyId,
        userId,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Failed to revoke API key', { error, keyId, userId });
      throw new ApiError(500, 'Failed to revoke API key');
    }
  }

  /**
   * Rotate an API key
   */
  async rotateApiKey(
    keyId: string,
    userId: string,
    organizationId?: string
  ): Promise<{
    apiKey: string;
    keyData: ApiKeyData;
  }> {
    try {
      const oldKeyData = await this.getApiKeyById(keyId);
      if (!oldKeyData) {
        throw new ApiError(404, 'API key not found');
      }

      if (oldKeyData.user_id !== userId) {
        if (!organizationId || oldKeyData.organization_id !== organizationId) {
          throw new ApiError(403, 'Access denied');
        }
      }

      // Revoke old key
      await this.updateKeyStatus(keyId, 'revoked');

      // Generate new key with same settings
      const newKey = await this.generateApiKey(
        userId,
        {
          name: oldKeyData.name + ' (Rotated)',
          description: oldKeyData.description,
          keyType: oldKeyData.key_type,
          permissions: typeof oldKeyData.permissions === 'string'
            ? JSON.parse(oldKeyData.permissions)
            : oldKeyData.permissions,
          scopes: typeof oldKeyData.scopes === 'string'
            ? JSON.parse(oldKeyData.scopes)
            : oldKeyData.scopes,
          allowedIps: oldKeyData.allowed_ips?.split(','),
          allowedDomains: oldKeyData.allowed_domains?.split(','),
          expiresAt: oldKeyData.expires_at,
          usageLimit: oldKeyData.usage_limit,
          requireMfa: oldKeyData.require_mfa,
        },
        organizationId
      );

      // Emit event for audit trail
      await this.emitEvent('API_KEY.ROTATED', {
        oldKeyId: keyId,
        newKeyId: newKey.keyData.id,
        userId,
        organizationId,
      });

      logger.info('API key rotated', {
        oldKeyId: keyId,
        newKeyId: newKey.keyData.id,
        userId,
      });

      return newKey;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Failed to rotate API key', { error, keyId, userId });
      throw new ApiError(500, 'Failed to rotate API key');
    }
  }

  /**
   * Generate a cryptographically secure API key
   */
  private generateSecureKey(): string {
    const key = randomBytes(this.KEY_LENGTH).toString('base64url');
    return this.KEY_PREFIX + key;
  }

  /**
   * Hash an API key using scrypt (computationally expensive to resist brute-force)
   * Format: salt:derivedKey (both hex-encoded)
   */
  private hashApiKey(apiKey: string): string {
    const salt = randomBytes(32).toString('hex');
    const derivedKey = scryptSync(apiKey, salt, 64, {
      N: 32768,  // CPU/memory cost parameter (2^15, OWASP recommended minimum)
      r: 8,      // Block size
      p: 2,      // Parallelization
      maxmem: 64 * 1024 * 1024, // 64 MB memory limit
    }).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  /**
   * Verify an API key against its scrypt hash using timing-safe comparison
   */
  private async verifyApiKeyHash(apiKey: string, storedHash: string): Promise<boolean> {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) {
      return false;
    }
    const derivedKey = scryptSync(apiKey, salt, 64, {
      N: 32768,
      r: 8,
      p: 2,
      maxmem: 64 * 1024 * 1024,
    });
    const storedKeyBuffer = Buffer.from(key, 'hex');
    if (derivedKey.length !== storedKeyBuffer.length) {
      return false;
    }
    return timingSafeEqual(derivedKey, storedKeyBuffer);
  }

  /**
   * Get API key by ID
   */
  private async getApiKeyById(keyId: string): Promise<ApiKeyData | null> {
    const db = await getDatabase();
    const key = await db('api_keys').where('id', keyId).first();
    if (!key) return null;

    // Parse JSON fields
    return {
      ...key,
      permissions: typeof key.permissions === 'string' ? JSON.parse(key.permissions) : key.permissions,
      scopes: typeof key.scopes === 'string' ? JSON.parse(key.scopes) : key.scopes,
    };
  }

  /**
   * Update API key status
   */
  private async updateKeyStatus(keyId: string, status: string): Promise<void> {
    const db = await getDatabase();
    await db('api_keys').where('id', keyId).update({
      status,
      updated_at: new Date(),
    });
  }

  /**
   * Update usage statistics for an API key
   */
  private async updateUsageStats(
    keyId: string,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<void> {
    const db = await getDatabase();
    await db('api_keys').where('id', keyId).increment('usage_count', 1).update({
      last_used_at: new Date(),
      last_used_ip: context?.ipAddress,
      last_used_user_agent: context?.userAgent,
      updated_at: new Date(),
    });
  }

  /**
   * Record a failed attempt to use an API key
   */
  private async recordFailedAttempt(
    keyId: string,
    ipAddress?: string,
    reason?: string
  ): Promise<void> {
    // This could be implemented to track failed attempts for security monitoring
    logger.warn('API key failed attempt', {
      keyId,
      ipAddress,
      reason,
    });

    // Could store in a separate table for security audit
    const db = await getDatabase();
    await db('events').insert({
      entity_type: 'api_key',
      entity_id: keyId,
      event_type: 'API_KEY_FAILED_ATTEMPT',
      event_data: JSON.stringify({ ipAddress, reason }),
      created_at: new Date(),
    });
  }

  /**
   * Emit an event for audit trail
   */
  private async emitEvent(eventType: string, data: any): Promise<void> {
    try {
      const db = await getDatabase();
      await db('events').insert({
        entity_type: 'api_key',
        entity_id: data.keyId || data.newKeyId,
        event_type: eventType,
        event_data: JSON.stringify(data),
        created_at: new Date(),
        user_id: data.userId,
      });
    } catch (error) {
      logger.error('Failed to emit event', { error, eventType, data });
    }
  }
}

interface ApiKeyUpdate {
  name?: string;
  description?: string;
  permissions?: string[];
  scopes?: string[];
  allowedIps?: string[];
  allowedDomains?: string[];
  expiresAt?: Date;
  usageLimit?: number;
  requireMfa?: boolean;
  status?: string;
}

// Export singleton instance
export const apiKeyService = new ApiKeyService();