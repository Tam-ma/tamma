import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authService } from '../auth.service'
import { passwordResetService } from '../password-reset.service'
import { emailService } from '../email.service'
import { getDatabase } from '../../../../../src/database/connection'
import * as bcrypt from 'bcryptjs'

// Mock dependencies
vi.mock('../../../../../src/database/connection', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../password-reset.service', () => ({
  passwordResetService: {
    checkRateLimit: vi.fn(),
    recordAttempt: vi.fn(),
    invalidateUserTokens: vi.fn(),
    generateToken: vi.fn(),
    validateToken: vi.fn(),
    useToken: vi.fn(),
    checkPasswordHistory: vi.fn(),
    addPasswordHistory: vi.fn(),
  },
}))

vi.mock('../email.service', () => ({
  emailService: {
    sendPasswordResetEmail: vi.fn(),
    sendPasswordChangedNotification: vi.fn(),
  },
}))

vi.mock('bcryptjs', () => ({
  hash: vi.fn(),
  compare: vi.fn(),
  genSalt: vi.fn(),
}))

describe('AuthService - Password Management', () => {
  let mockDb: any

  beforeEach(() => {
    // Setup mock database
    mockDb = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      first: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      del: vi.fn(),
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

  describe('requestPasswordReset', () => {
    it('should send reset email for active user', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'
      const userAgent = 'Mozilla/5.0'
      const user = {
        id: 'user-123',
        email,
        first_name: 'John',
        status: 'active',
      }

      vi.mocked(passwordResetService.checkRateLimit).mockResolvedValueOnce(true)
      mockDb.first.mockResolvedValueOnce(user)
      vi.mocked(passwordResetService.generateToken).mockResolvedValueOnce('reset-token')

      await authService.requestPasswordReset(email, ipAddress, userAgent)

      expect(passwordResetService.invalidateUserTokens).toHaveBeenCalledWith(user.id)
      expect(passwordResetService.generateToken).toHaveBeenCalledWith(user.id, { ipAddress, userAgent })
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(email, 'reset-token', user.first_name)
      expect(passwordResetService.recordAttempt).toHaveBeenCalledWith(email, ipAddress, true, userAgent)
    })

    it('should not reveal if user does not exist', async () => {
      const email = 'nonexistent@example.com'
      const ipAddress = '192.168.1.1'

      vi.mocked(passwordResetService.checkRateLimit).mockResolvedValueOnce(true)
      mockDb.first.mockResolvedValueOnce(null) // User not found

      await authService.requestPasswordReset(email, ipAddress)

      expect(passwordResetService.generateToken).not.toHaveBeenCalled()
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(passwordResetService.recordAttempt).toHaveBeenCalledWith(email, ipAddress, false, undefined)
    })

    it('should throw error when rate limit exceeded', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'

      vi.mocked(passwordResetService.checkRateLimit).mockResolvedValueOnce(false)

      await expect(authService.requestPasswordReset(email, ipAddress)).rejects.toThrow(
        'Too many password reset requests'
      )

      expect(passwordResetService.recordAttempt).toHaveBeenCalledWith(email, ipAddress, false, undefined)
    })

    it('should not send email for inactive user', async () => {
      const email = 'test@example.com'
      const ipAddress = '192.168.1.1'
      const user = {
        id: 'user-123',
        email,
        status: 'inactive',
      }

      vi.mocked(passwordResetService.checkRateLimit).mockResolvedValueOnce(true)
      mockDb.first.mockResolvedValueOnce(user)

      await authService.requestPasswordReset(email, ipAddress)

      expect(passwordResetService.generateToken).not.toHaveBeenCalled()
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(passwordResetService.recordAttempt).toHaveBeenCalledWith(email, ipAddress, false, undefined)
    })
  })

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const token = 'valid-token'
      const newPassword = 'NewSecurePass123!'
      const ipAddress = '192.168.1.1'
      const userAgent = 'Mozilla/5.0'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
      }

      vi.mocked(passwordResetService.validateToken).mockResolvedValueOnce(tokenData)
      vi.mocked(passwordResetService.checkPasswordHistory).mockResolvedValueOnce(true)
      vi.mocked(bcrypt.genSalt).mockResolvedValueOnce('salt' as any)
      vi.mocked(bcrypt.hash).mockResolvedValueOnce('hashed-password' as any)
      mockDb.update.mockResolvedValueOnce(1)

      await authService.resetPassword(token, newPassword, ipAddress, userAgent)

      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          password_hash: 'hashed-password',
          password_salt: 'salt',
        })
      )
      expect(passwordResetService.useToken).toHaveBeenCalledWith(token, { ipAddress, userAgent })
      expect(passwordResetService.invalidateUserTokens).toHaveBeenCalledWith(tokenData.userId)
      expect(emailService.sendPasswordChangedNotification).toHaveBeenCalledWith(
        tokenData.email,
        tokenData.firstName,
        { ipAddress, userAgent }
      )
    })

    it('should reject weak password', async () => {
      const token = 'valid-token'
      const weakPassword = '123456'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
      }

      vi.mocked(passwordResetService.validateToken).mockResolvedValueOnce(tokenData)

      await expect(authService.resetPassword(token, weakPassword)).rejects.toThrow(
        'Password does not meet security requirements'
      )
    })

    it('should reject password from history', async () => {
      const token = 'valid-token'
      const newPassword = 'NewSecurePass123!'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
      }

      vi.mocked(passwordResetService.validateToken).mockResolvedValueOnce(tokenData)
      vi.mocked(bcrypt.genSalt).mockResolvedValueOnce('salt' as any)
      vi.mocked(bcrypt.hash).mockResolvedValueOnce('hashed-password' as any)
      vi.mocked(passwordResetService.checkPasswordHistory).mockResolvedValueOnce(false) // Password in history

      await expect(authService.resetPassword(token, newPassword)).rejects.toThrow(
        'This password has been used recently'
      )
    })
  })

  describe('changePassword', () => {
    it('should change password for authenticated user', async () => {
      const userId = 'user-123'
      const currentPassword = 'CurrentPass123!'
      const newPassword = 'NewSecurePass456!'
      const ipAddress = '192.168.1.1'
      const user = {
        id: userId,
        email: 'test@example.com',
        first_name: 'John',
        password_hash: 'current-hash',
      }

      mockDb.first.mockResolvedValueOnce(user)
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true) // Current password valid
      vi.mocked(passwordResetService.checkPasswordHistory).mockResolvedValueOnce(true)
      vi.mocked(bcrypt.genSalt).mockResolvedValueOnce('salt' as any)
      vi.mocked(bcrypt.hash).mockResolvedValueOnce('new-hash' as any)
      mockDb.update.mockResolvedValueOnce(1)

      await authService.changePassword(userId, currentPassword, newPassword, ipAddress)

      expect(bcrypt.compare).toHaveBeenCalledWith(currentPassword, user.password_hash)
      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          password_hash: 'new-hash',
          password_salt: 'salt',
        })
      )
      expect(passwordResetService.addPasswordHistory).toHaveBeenCalled()
      expect(emailService.sendPasswordChangedNotification).toHaveBeenCalled()
    })

    it('should reject incorrect current password', async () => {
      const userId = 'user-123'
      const currentPassword = 'WrongPassword'
      const newPassword = 'NewSecurePass456!'
      const user = {
        id: userId,
        password_hash: 'current-hash',
      }

      mockDb.first.mockResolvedValueOnce(user)
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false) // Wrong password

      await expect(authService.changePassword(userId, currentPassword, newPassword)).rejects.toThrow(
        'Current password is incorrect'
      )
    })

    it('should reject change for non-existent user', async () => {
      const userId = 'non-existent'
      const currentPassword = 'CurrentPass123!'
      const newPassword = 'NewPass456!'

      mockDb.first.mockResolvedValueOnce(null)

      await expect(authService.changePassword(userId, currentPassword, newPassword)).rejects.toThrow(
        'User not found'
      )
    })
  })

  describe('checkPasswordStrength', () => {
    it('should accept strong password', async () => {
      const password = 'SecureP@ssw0rd123!'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(true)
      expect(result.score).toBeGreaterThanOrEqual(5)
      expect(result.feedback).toHaveLength(0)
    })

    it('should reject short password', async () => {
      const password = 'Short1!'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password must be at least 8 characters long')
    })

    it('should reject password without uppercase', async () => {
      const password = 'lowercase123!'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password should contain at least one uppercase letter')
    })

    it('should reject password without lowercase', async () => {
      const password = 'UPPERCASE123!'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password should contain at least one lowercase letter')
    })

    it('should reject password without numbers', async () => {
      const password = 'NoNumbers!@'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password should contain at least one number')
    })

    it('should reject password without special characters', async () => {
      const password = 'NoSpecialChars123'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password should contain at least one special character')
    })

    it('should reject common passwords', async () => {
      const password = 'Password123!'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password contains common patterns')
    })

    it('should reject password with repeating characters', async () => {
      const password = 'Passsword123!'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password contains repeating characters')
    })

    it('should reject password with sequential characters', async () => {
      const password = 'Abc123!@#xyz'

      const result = await authService.checkPasswordStrength(password)

      expect(result.isStrong).toBe(false)
      expect(result.feedback).toContain('Password contains sequential characters')
    })
  })

  describe('hashPassword', () => {
    it('should hash password with salt', async () => {
      const password = 'SecurePassword123!'

      vi.mocked(bcrypt.genSalt).mockResolvedValueOnce('generated-salt' as any)
      vi.mocked(bcrypt.hash).mockResolvedValueOnce('hashed-password' as any)

      const result = await authService.hashPassword(password)

      expect(bcrypt.genSalt).toHaveBeenCalledWith(12)
      expect(bcrypt.hash).toHaveBeenCalledWith(password, 'generated-salt')
      expect(result).toEqual({
        hash: 'hashed-password',
        salt: 'generated-salt',
      })
    })
  })

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'SecurePassword123!'
      const passwordHash = 'hashed-password'

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true)

      const result = await authService.verifyPassword(password, passwordHash)

      expect(bcrypt.compare).toHaveBeenCalledWith(password, passwordHash)
      expect(result).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const password = 'WrongPassword'
      const passwordHash = 'hashed-password'

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false)

      const result = await authService.verifyPassword(password, passwordHash)

      expect(bcrypt.compare).toHaveBeenCalledWith(password, passwordHash)
      expect(result).toBe(false)
    })
  })
})