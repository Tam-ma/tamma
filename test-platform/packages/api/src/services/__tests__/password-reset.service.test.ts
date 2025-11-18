import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PasswordResetService } from '../password-reset.service'
import { getDatabase } from '../../../../../src/database/connection'

// Mock database connection
vi.mock('../../../../../src/database/connection', () => ({
  getDatabase: vi.fn(),
}))

describe('PasswordResetService', () => {
  let service: PasswordResetService
  let mockDb: any

  beforeEach(() => {
    service = new PasswordResetService()

    // Setup mock database
    mockDb = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      first: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      del: vi.fn(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
    }

    // Mock table selector
    const tableMock = (tableName: string) => {
      mockDb.tableName = tableName
      return mockDb
    }

    vi.mocked(getDatabase).mockResolvedValue(tableMock as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('generateToken', () => {
    it('should generate a token for an active user', async () => {
      const userId = 'user-123'
      const context = { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' }

      mockDb.first.mockResolvedValueOnce({ id: userId, status: 'active' }) // User exists
      mockDb.insert.mockResolvedValueOnce(undefined) // Token insert
      mockDb.first.mockResolvedValueOnce({ count: '0' }) // Token count check

      const token = await service.generateToken(userId, context)

      expect(token).toBeDefined()
      expect(token).toHaveLength(128) // 64 bytes in hex = 128 characters
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('should throw error for inactive user', async () => {
      const userId = 'user-123'

      mockDb.first.mockResolvedValueOnce({ id: userId, status: 'inactive' })

      await expect(service.generateToken(userId)).rejects.toThrow('User not found or inactive')
    })

    it('should enforce token limit', async () => {
      const userId = 'user-123'

      mockDb.first.mockResolvedValueOnce({ id: userId, status: 'active' }) // User exists
      mockDb.first.mockResolvedValueOnce({ count: '3' }) // Max tokens reached
      mockDb.orderBy.mockReturnThis()
      mockDb.limit.mockResolvedValueOnce([{ id: 'token-1' }]) // Tokens to invalidate
      mockDb.update.mockResolvedValueOnce(1) // Update old token
      mockDb.insert.mockResolvedValueOnce(undefined) // Insert new token

      const token = await service.generateToken(userId)

      expect(token).toBeDefined()
      expect(mockDb.update).toHaveBeenCalled()
    })
  })

  describe('validateToken', () => {
    it('should validate a valid token', async () => {
      const token = 'valid-token'
      const tokenRecord = {
        user_id: 'user-123',
        token,
        expires_at: new Date(Date.now() + 3600000),
        used_at: null,
      }
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        first_name: 'John',
        status: 'active',
      }

      mockDb.first.mockResolvedValueOnce(tokenRecord) // Token exists
      mockDb.first.mockResolvedValueOnce(user) // User exists

      const result = await service.validateToken(token)

      expect(result).toEqual({
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
      })
    })

    it('should reject expired token', async () => {
      const token = 'expired-token'

      mockDb.first.mockResolvedValueOnce(null) // Token not found or expired

      await expect(service.validateToken(token)).rejects.toThrow('Invalid or expired password reset token')
    })

    it('should reject already used token', async () => {
      const token = 'used-token'
      const tokenRecord = {
        user_id: 'user-123',
        token,
        expires_at: new Date(Date.now() + 3600000),
        used_at: new Date(Date.now() - 60000), // Used 1 minute ago
      }

      mockDb.first.mockResolvedValueOnce(tokenRecord)

      await expect(service.validateToken(token)).rejects.toThrow('This reset token has already been used')
    })
  })

  describe('checkRateLimit', () => {
    it('should allow request within rate limit', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'

      mockDb.first.mockResolvedValueOnce({ count: '1' }) // Email attempts
      mockDb.first.mockResolvedValueOnce({ count: '2' }) // IP attempts

      const result = await service.checkRateLimit(email, ipAddress)

      expect(result).toBe(true)
    })

    it('should block request exceeding rate limit by email', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'

      mockDb.first.mockResolvedValueOnce({ count: '3' }) // Email attempts (max reached)
      mockDb.first.mockResolvedValueOnce({ count: '1' }) // IP attempts

      const result = await service.checkRateLimit(email, ipAddress)

      expect(result).toBe(false)
    })

    it('should block request exceeding rate limit by IP', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'

      mockDb.first.mockResolvedValueOnce({ count: '1' }) // Email attempts
      mockDb.first.mockResolvedValueOnce({ count: '6' }) // IP attempts (max reached)

      const result = await service.checkRateLimit(email, ipAddress)

      expect(result).toBe(false)
    })
  })

  describe('checkPasswordHistory', () => {
    it('should accept password not in history', async () => {
      const userId = 'user-123'
      const passwordHash = 'new-hash'

      mockDb.orderBy.mockReturnThis()
      mockDb.limit.mockResolvedValueOnce([
        { password_hash: 'old-hash-1' },
        { password_hash: 'old-hash-2' },
      ])

      const result = await service.checkPasswordHistory(userId, passwordHash)

      expect(result).toBe(true)
    })

    it('should reject password found in history', async () => {
      const userId = 'user-123'
      const passwordHash = 'repeated-hash'

      mockDb.orderBy.mockReturnThis()
      mockDb.limit.mockResolvedValueOnce([
        { password_hash: 'old-hash-1' },
        { password_hash: 'repeated-hash' },
        { password_hash: 'old-hash-3' },
      ])

      const result = await service.checkPasswordHistory(userId, passwordHash)

      expect(result).toBe(false)
    })
  })

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens', async () => {
      mockDb.del.mockResolvedValueOnce(5)

      const result = await service.cleanupExpiredTokens()

      expect(result).toBe(5)
      expect(mockDb.del).toHaveBeenCalled()
    })

    it('should handle cleanup errors gracefully', async () => {
      mockDb.del.mockRejectedValueOnce(new Error('Database error'))

      const result = await service.cleanupExpiredTokens()

      expect(result).toBe(0)
    })
  })

  describe('useToken', () => {
    it('should mark token as used', async () => {
      const token = 'valid-token'
      const context = { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' }

      mockDb.update.mockResolvedValueOnce(1)

      await service.useToken(token, context)

      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          used_at: expect.any(Date),
          used_ip_address: context.ipAddress,
          used_user_agent: context.userAgent,
        })
      )
    })

    it('should throw error for invalid token', async () => {
      const token = 'invalid-token'

      mockDb.update.mockResolvedValueOnce(0)

      await expect(service.useToken(token)).rejects.toThrow('Invalid or already used reset token')
    })
  })

  describe('invalidateUserTokens', () => {
    it('should invalidate all active tokens for a user', async () => {
      const userId = 'user-123'

      mockDb.update.mockResolvedValueOnce(3)

      await service.invalidateUserTokens(userId)

      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          used_at: expect.any(Date),
          updated_at: expect.any(Date),
        })
      )
    })

    it('should handle errors gracefully', async () => {
      const userId = 'user-123'

      mockDb.update.mockRejectedValueOnce(new Error('Database error'))

      // Should not throw
      await service.invalidateUserTokens(userId)

      expect(mockDb.update).toHaveBeenCalled()
    })
  })

  describe('recordAttempt', () => {
    it('should record password reset attempt', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'
      const success = true
      const userAgent = 'Mozilla/5.0'

      mockDb.insert.mockResolvedValueOnce(undefined)

      await service.recordAttempt(email, ipAddress, success, userAgent)

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          email,
          ip_address: ipAddress,
          success,
          user_agent: userAgent,
        })
      )
    })

    it('should handle errors gracefully', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'

      mockDb.insert.mockRejectedValueOnce(new Error('Database error'))

      // Should not throw
      await service.recordAttempt(email, ipAddress, false)

      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  describe('addPasswordHistory', () => {
    it('should add password to history', async () => {
      const userId = 'user-123'
      const passwordHash = 'hash'
      const passwordSalt = 'salt'
      const context = {
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        changeReason: 'reset',
      }

      mockDb.insert.mockResolvedValueOnce(undefined)

      await service.addPasswordHistory(userId, passwordHash, passwordSalt, context)

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          password_hash: passwordHash,
          password_salt: passwordSalt,
          change_reason: 'reset',
        })
      )
    })
  })
})