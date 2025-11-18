import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import authRoutes from '../auth.routes'
import { authService } from '../../services/auth.service'

// Mock auth service
vi.mock('../../services/auth.service', () => ({
  authService: {
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    validatePasswordResetToken: vi.fn(),
    changePassword: vi.fn(),
    checkPasswordStrength: vi.fn(),
  },
}))

describe('Auth Routes - Password Management', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.route('/auth', authRoutes)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /auth/password/reset-request', () => {
    it('should request password reset with valid email', async () => {
      vi.mocked(authService.requestPasswordReset).mockResolvedValueOnce(undefined)

      const response = await app.request('/auth/password/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
          'user-agent': 'Test Browser',
        },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toContain('If an account with this email exists')
      expect(authService.requestPasswordReset).toHaveBeenCalledWith(
        'test@example.com',
        '192.168.1.1',
        'Test Browser'
      )
    })

    it('should return validation error for invalid email', async () => {
      const response = await app.request('/auth/password/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'invalid-email',
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Validation failed')
    })

    it('should handle rate limiting', async () => {
      vi.mocked(authService.requestPasswordReset).mockRejectedValueOnce(
        new Error('Too many password reset requests')
      )

      const response = await app.request('/auth/password/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      })

      expect(response.status).toBe(429)
      const data = await response.json()
      expect(data.error).toContain('Too many')
    })

    it('should not reveal if user does not exist', async () => {
      vi.mocked(authService.requestPasswordReset).mockRejectedValueOnce(new Error('User not found'))

      const response = await app.request('/auth/password/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
        }),
      })

      expect(response.status).toBe(200) // Still returns 200
      const data = await response.json()
      expect(data.message).toContain('If an account with this email exists')
    })
  })

  describe('POST /auth/password/reset', () => {
    it('should reset password with valid token', async () => {
      vi.mocked(authService.resetPassword).mockResolvedValueOnce(undefined)

      const response = await app.request('/auth/password/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
        body: JSON.stringify({
          token: 'valid-reset-token',
          password: 'NewSecurePass123!',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toContain('Password has been reset successfully')
      expect(authService.resetPassword).toHaveBeenCalledWith(
        'valid-reset-token',
        'NewSecurePass123!',
        '192.168.1.1',
        undefined
      )
    })

    it('should reject weak password', async () => {
      const response = await app.request('/auth/password/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: 'valid-reset-token',
          password: '123', // Too short
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Validation failed')
    })

    it('should handle invalid token', async () => {
      vi.mocked(authService.resetPassword).mockRejectedValueOnce(
        new Error('Invalid or expired password reset token')
      )

      const response = await app.request('/auth/password/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: 'invalid-token',
          password: 'NewSecurePass123!',
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Invalid or expired')
    })
  })

  describe('POST /auth/password/validate-token', () => {
    it('should validate valid token', async () => {
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
      }

      vi.mocked(authService.validatePasswordResetToken).mockResolvedValueOnce(tokenData)

      const response = await app.request('/auth/password/validate-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: 'valid-reset-token',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.valid).toBe(true)
      expect(data.user).toEqual({
        email: tokenData.email,
        firstName: tokenData.firstName,
      })
    })

    it('should handle invalid token', async () => {
      vi.mocked(authService.validatePasswordResetToken).mockRejectedValueOnce(
        new Error('Invalid or expired token')
      )

      const response = await app.request('/auth/password/validate-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: 'invalid-token',
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Invalid or expired')
    })

    it('should reject empty token', async () => {
      const response = await app.request('/auth/password/validate-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: '',
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Validation failed')
    })
  })

  describe('POST /auth/password/change', () => {
    it('should change password for authenticated user', async () => {
      vi.mocked(authService.changePassword).mockResolvedValueOnce(undefined)

      // Create app with mock auth middleware
      const appWithAuth = new Hono()
      appWithAuth.use('*', async (c, next) => {
        c.set('userId', 'user-123')
        await next()
      })
      appWithAuth.route('/auth', authRoutes)

      const response = await appWithAuth.request('/auth/password/change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'CurrentPass123!',
          newPassword: 'NewSecurePass456!',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toContain('Password has been changed successfully')
      expect(authService.changePassword).toHaveBeenCalledWith(
        'user-123',
        'CurrentPass123!',
        'NewSecurePass456!',
        'unknown',
        undefined
      )
    })

    it('should reject unauthenticated request', async () => {
      const response = await app.request('/auth/password/change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'CurrentPass123!',
          newPassword: 'NewSecurePass456!',
        }),
      })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle incorrect current password', async () => {
      vi.mocked(authService.changePassword).mockRejectedValueOnce(
        new Error('Current password is incorrect')
      )

      // Create app with mock auth middleware
      const appWithAuth = new Hono()
      appWithAuth.use('*', async (c, next) => {
        c.set('userId', 'user-123')
        await next()
      })
      appWithAuth.route('/auth', authRoutes)

      const response = await appWithAuth.request('/auth/password/change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'WrongPassword',
          newPassword: 'NewSecurePass456!',
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Current password is incorrect')
    })
  })

  describe('POST /auth/password/check-strength', () => {
    it('should check password strength', async () => {
      const strengthResult = {
        isStrong: true,
        score: 8,
        feedback: [],
      }

      vi.mocked(authService.checkPasswordStrength).mockResolvedValueOnce(strengthResult)

      const response = await app.request('/auth/password/check-strength', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: 'SecureP@ssw0rd123!',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual(strengthResult)
    })

    it('should provide feedback for weak password', async () => {
      const strengthResult = {
        isStrong: false,
        score: 3,
        feedback: [
          'Password must be at least 8 characters long',
          'Password should contain at least one special character',
        ],
      }

      vi.mocked(authService.checkPasswordStrength).mockResolvedValueOnce(strengthResult)

      const response = await app.request('/auth/password/check-strength', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: 'weak',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.isStrong).toBe(false)
      expect(data.feedback).toHaveLength(2)
    })

    it('should require password parameter', async () => {
      const response = await app.request('/auth/password/check-strength', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Password is required')
    })
  })
})