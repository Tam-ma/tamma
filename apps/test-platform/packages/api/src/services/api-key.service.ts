/**
 * API Key management service
 * Handles API key generation, validation, and usage tracking
 */

import { eq, and, desc, gte, lte, or, like } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import {
  apiKeys,
  apiKeyUsage,
  type APIKey,
  type InsertAPIKey,
  type InsertAPIKeyUsage,
} from '../db/schema'
import {
  generateAPIKey,
  hashPassword,
  verifyPassword,
  generateId,
} from '../utils/crypto'
import { validateAPIKey, validateAPIKeyName, validateScopes, validateRateLimit, validateIPAddress } from '../utils/validation'

export interface APIKeyServiceContext {
  db: DrizzleD1Database<typeof import('../db/schema')>
}

export interface GenerateKeyOptions {
  userId: string
  name: string
  description?: string
  scopes: string[]
  rateLimit?: number
  expiresAt?: Date
  ipWhitelist?: string[]
}

export interface ListKeysOptions {
  userId: string
  status?: 'active' | 'inactive' | 'expired' | 'revoked'
  search?: string
  limit?: number
  offset?: number
}

export interface UpdateKeyOptions {
  name?: string
  description?: string
  scopes?: string[]
  rateLimit?: number
  status?: 'active' | 'inactive'
  ipWhitelist?: string[]
}

export interface TrackUsageOptions {
  keyId: string
  endpoint: string
  method: string
  statusCode: number
  responseTime?: number
  ipAddress?: string
}

export interface APIKeyWithStats extends APIKey {
  usageCount?: number
  lastUsedAt?: Date
}

export class APIKeyService {
  private db: DrizzleD1Database<typeof import('../db/schema')>

  constructor({ db }: APIKeyServiceContext) {
    this.db = db
  }

  /**
   * Generate a new API key
   */
  async generateKey(options: GenerateKeyOptions): Promise<{ key: APIKey; plainKey: string }> {
    const { userId, name, description, scopes, rateLimit = 1000, expiresAt, ipWhitelist } = options

    // Validate inputs
    const nameValidation = validateAPIKeyName(name)
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error)
    }

    const scopesValidation = validateScopes(scopes)
    if (!scopesValidation.valid) {
      throw new Error(scopesValidation.error)
    }

    const rateLimitValidation = validateRateLimit(rateLimit)
    if (!rateLimitValidation.valid) {
      throw new Error(rateLimitValidation.error)
    }

    // Validate IP whitelist if provided
    if (ipWhitelist && ipWhitelist.length > 0) {
      for (const ip of ipWhitelist) {
        const ipValidation = validateIPAddress(ip)
        if (!ipValidation.valid) {
          throw new Error(`Invalid IP address in whitelist: ${ip}`)
        }
      }
    }

    // Check expiration date
    if (expiresAt && expiresAt <= new Date()) {
      throw new Error('Expiration date must be in the future')
    }

    // Generate API key
    const { key: plainKey, prefix } = generateAPIKey('ak')

    // Hash the API key for storage
    const keyHash = await hashPassword(plainKey)

    // Create API key record
    const keyId = generateId()
    const newKey: InsertAPIKey = {
      id: keyId,
      userId,
      name,
      description: description || null,
      keyHash,
      keyPrefix: prefix,
      scopes: JSON.stringify(scopes),
      rateLimit,
      expiresAt: expiresAt || null,
      createdAt: new Date(),
      lastUsedAt: null,
      status: 'active',
      ipWhitelist: ipWhitelist ? JSON.stringify(ipWhitelist) : null,
    }

    await this.db.insert(apiKeys).values(newKey)

    // Fetch created key
    const createdKey = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .get()

    if (!createdKey) {
      throw new Error('Failed to create API key')
    }

    return { key: createdKey, plainKey }
  }

  /**
   * List API keys for a user
   */
  async listKeys(options: ListKeysOptions): Promise<{ keys: APIKeyWithStats[]; total: number }> {
    const { userId, status, search, limit = 20, offset = 0 } = options

    // Build query conditions
    const conditions = [eq(apiKeys.userId, userId)]

    if (status) {
      conditions.push(eq(apiKeys.status, status))
    }

    if (search) {
      conditions.push(
        or(
          like(apiKeys.name, `%${search}%`),
          like(apiKeys.description, `%${search}%`),
          like(apiKeys.keyPrefix, `%${search}%`)
        )
      )
    }

    // Get total count
    const countResult = await this.db
      .select({ count: apiKeys.id })
      .from(apiKeys)
      .where(and(...conditions))
      .all()

    const total = countResult.length

    // Get keys with pagination
    const keys = await this.db
      .select()
      .from(apiKeys)
      .where(and(...conditions))
      .orderBy(desc(apiKeys.createdAt))
      .limit(limit)
      .offset(offset)
      .all()

    // Add usage stats for each key
    const keysWithStats: APIKeyWithStats[] = await Promise.all(
      keys.map(async (key) => {
        const usageCount = await this.db
          .select({ count: apiKeyUsage.id })
          .from(apiKeyUsage)
          .where(eq(apiKeyUsage.apiKeyId, key.id))
          .all()

        return {
          ...key,
          usageCount: usageCount.length,
          lastUsedAt: key.lastUsedAt,
        }
      })
    )

    return { keys: keysWithStats, total }
  }

  /**
   * Get a specific API key
   */
  async getKey(keyId: string, userId: string): Promise<APIKeyWithStats | null> {
    const key = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .get()

    if (!key) {
      return null
    }

    // Get usage stats
    const usageCount = await this.db
      .select({ count: apiKeyUsage.id })
      .from(apiKeyUsage)
      .where(eq(apiKeyUsage.apiKeyId, key.id))
      .all()

    return {
      ...key,
      usageCount: usageCount.length,
      lastUsedAt: key.lastUsedAt,
    }
  }

  /**
   * Update an API key
   */
  async updateKey(keyId: string, userId: string, updates: UpdateKeyOptions): Promise<APIKey> {
    // Validate updates
    if (updates.name) {
      const nameValidation = validateAPIKeyName(updates.name)
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error)
      }
    }

    if (updates.scopes) {
      const scopesValidation = validateScopes(updates.scopes)
      if (!scopesValidation.valid) {
        throw new Error(scopesValidation.error)
      }
    }

    if (updates.rateLimit !== undefined) {
      const rateLimitValidation = validateRateLimit(updates.rateLimit)
      if (!rateLimitValidation.valid) {
        throw new Error(rateLimitValidation.error)
      }
    }

    if (updates.ipWhitelist && updates.ipWhitelist.length > 0) {
      for (const ip of updates.ipWhitelist) {
        const ipValidation = validateIPAddress(ip)
        if (!ipValidation.valid) {
          throw new Error(`Invalid IP address in whitelist: ${ip}`)
        }
      }
    }

    // Check if key exists and belongs to user
    const existingKey = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .get()

    if (!existingKey) {
      throw new Error('API key not found')
    }

    // Build update object
    const updateData: Partial<InsertAPIKey> = {}

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.scopes !== undefined) updateData.scopes = JSON.stringify(updates.scopes)
    if (updates.rateLimit !== undefined) updateData.rateLimit = updates.rateLimit
    if (updates.status !== undefined) updateData.status = updates.status
    if (updates.ipWhitelist !== undefined) {
      updateData.ipWhitelist = updates.ipWhitelist.length > 0
        ? JSON.stringify(updates.ipWhitelist)
        : null
    }

    // Update key
    await this.db
      .update(apiKeys)
      .set(updateData)
      .where(eq(apiKeys.id, keyId))

    // Return updated key
    const updatedKey = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .get()

    if (!updatedKey) {
      throw new Error('Failed to update API key')
    }

    return updatedKey
  }

  /**
   * Revoke an API key
   */
  async revokeKey(keyId: string, userId: string): Promise<void> {
    // Check if key exists and belongs to user
    const existingKey = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .get()

    if (!existingKey) {
      throw new Error('API key not found')
    }

    // Update status to revoked
    await this.db
      .update(apiKeys)
      .set({ status: 'revoked' })
      .where(eq(apiKeys.id, keyId))
  }

  /**
   * Validate an API key from request header
   */
  async validateKey(apiKey: string): Promise<{ valid: boolean; key?: APIKey; error?: string }> {
    // Validate format
    const formatValidation = validateAPIKey(apiKey)
    if (!formatValidation.valid) {
      return { valid: false, error: formatValidation.error }
    }

    // Extract prefix to narrow down search
    const prefix = apiKey.split('_')[0] + '_' + apiKey.split('_')[1].substring(0, 8)

    // Find keys with matching prefix
    const potentialKeys = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, prefix))
      .all()

    // Verify the key hash
    for (const key of potentialKeys) {
      const isValid = await verifyPassword(apiKey, key.keyHash)
      if (isValid) {
        // Check if key is active
        if (key.status !== 'active') {
          return { valid: false, error: `API key is ${key.status}` }
        }

        // Check if key is expired
        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
          // Update status to expired
          await this.db
            .update(apiKeys)
            .set({ status: 'expired' })
            .where(eq(apiKeys.id, key.id))

          return { valid: false, error: 'API key has expired' }
        }

        // Update last used timestamp
        await this.db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.id))

        return { valid: true, key }
      }
    }

    return { valid: false, error: 'Invalid API key' }
  }

  /**
   * Track API key usage
   */
  async trackUsage(options: TrackUsageOptions): Promise<void> {
    const { keyId, endpoint, method, statusCode, responseTime, ipAddress } = options

    // Create usage record
    const usageRecord: InsertAPIKeyUsage = {
      id: generateId(),
      apiKeyId: keyId,
      timestamp: new Date(),
      endpoint,
      method,
      statusCode,
      responseTime: responseTime || null,
      ipAddress: ipAddress || null,
    }

    await this.db.insert(apiKeyUsage).values(usageRecord)
  }

  /**
   * Get usage statistics for an API key
   */
  async getKeyUsage(
    keyId: string,
    userId: string,
    options?: {
      startDate?: Date
      endDate?: Date
      limit?: number
      offset?: number
    }
  ): Promise<{ usage: any[]; total: number }> {
    // Check if key belongs to user
    const key = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .get()

    if (!key) {
      throw new Error('API key not found')
    }

    const { startDate, endDate, limit = 100, offset = 0 } = options || {}

    // Build query conditions
    const conditions = [eq(apiKeyUsage.apiKeyId, keyId)]

    if (startDate) {
      conditions.push(gte(apiKeyUsage.timestamp, startDate))
    }

    if (endDate) {
      conditions.push(lte(apiKeyUsage.timestamp, endDate))
    }

    // Get total count
    const countResult = await this.db
      .select({ count: apiKeyUsage.id })
      .from(apiKeyUsage)
      .where(and(...conditions))
      .all()

    const total = countResult.length

    // Get usage records with pagination
    const usage = await this.db
      .select()
      .from(apiKeyUsage)
      .where(and(...conditions))
      .orderBy(desc(apiKeyUsage.timestamp))
      .limit(limit)
      .offset(offset)
      .all()

    return { usage, total }
  }

  /**
   * Check if IP address is whitelisted for a key
   */
  checkIPWhitelist(key: APIKey, ipAddress: string): boolean {
    if (!key.ipWhitelist) {
      return true // No whitelist means all IPs are allowed
    }

    try {
      const whitelist = JSON.parse(key.ipWhitelist) as string[]
      return whitelist.includes(ipAddress)
    } catch {
      return false
    }
  }

  /**
   * Check if key has required scope
   */
  hasScope(key: APIKey, requiredScope: string): boolean {
    try {
      const scopes = JSON.parse(key.scopes) as string[]
      return scopes.includes(requiredScope) || scopes.includes('admin:all')
    } catch {
      return false
    }
  }

  /**
   * Check rate limit for a key
   */
  async checkRateLimit(keyId: string, windowMinutes: number = 60): Promise<{ allowed: boolean; remaining: number }> {
    const key = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .get()

    if (!key) {
      return { allowed: false, remaining: 0 }
    }

    // Get usage count in the time window
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000)

    const usageCount = await this.db
      .select({ count: apiKeyUsage.id })
      .from(apiKeyUsage)
      .where(
        and(
          eq(apiKeyUsage.apiKeyId, keyId),
          gte(apiKeyUsage.timestamp, windowStart)
        )
      )
      .all()

    const used = usageCount.length
    const remaining = Math.max(0, key.rateLimit - used)

    return {
      allowed: used < key.rateLimit,
      remaining
    }
  }
}