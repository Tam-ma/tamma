import { randomBytes } from 'crypto'
import { addHours, isAfter } from 'date-fns'
import { getDatabase } from '../../../../src/database/connection'

export interface PasswordResetToken {
  id: string
  user_id: string
  token: string
  expires_at: Date
  created_at: Date
  used_at?: Date
  ip_address?: string
  user_agent?: string
}

export interface PasswordResetContext {
  ipAddress?: string
  userAgent?: string
}

export class PasswordResetService {
  private readonly TOKEN_EXPIRY_HOURS = 2
  private readonly TOKEN_LENGTH = 64
  private readonly MAX_ACTIVE_TOKENS = 3
  private readonly RATE_LIMIT_WINDOW_HOURS = 1
  private readonly MAX_RESET_ATTEMPTS = 3

  async generateToken(userId: string, context?: PasswordResetContext): Promise<string> {
    try {
      const db = await getDatabase()

      // Check user exists and is active
      const user = await db('users').where('id', userId).where('status', 'active').first()

      if (!user) {
        throw new Error('User not found or inactive')
      }

      // Clean up old tokens
      await this.cleanupExpiredTokens()

      // Check token limit
      await this.enforceTokenLimit(userId)

      // Generate secure random token
      const token = randomBytes(this.TOKEN_LENGTH).toString('hex')
      const expiresAt = addHours(new Date(), this.TOKEN_EXPIRY_HOURS)

      // Store token in database
      await db('password_reset_tokens').insert({
        user_id: userId,
        token,
        expires_at: expiresAt,
        ip_address: context?.ipAddress,
        user_agent: context?.userAgent,
        created_at: new Date(),
      })

      console.log('Password reset token generated', {
        userId,
        tokenPrefix: token.substring(0, 8),
        expiresAt,
        ipAddress: context?.ipAddress,
      })

      return token
    } catch (error) {
      console.error('Failed to generate password reset token', { error, userId })
      throw new Error('Failed to generate reset token')
    }
  }

  async validateToken(token: string): Promise<{
    userId: string
    email: string
    firstName: string
  }> {
    try {
      const db = await getDatabase()

      // Find valid token
      const tokenRecord = await db('password_reset_tokens')
        .where('token', token)
        .whereNull('used_at')
        .where('expires_at', '>', new Date())
        .first()

      if (!tokenRecord) {
        throw new Error('Invalid or expired password reset token')
      }

      // Get user
      const user = await db('users')
        .where('id', tokenRecord.user_id)
        .where('status', 'active')
        .first()

      if (!user) {
        throw new Error('User not found or inactive')
      }

      // Check if token was used recently (prevent replay attacks)
      if (tokenRecord.used_at) {
        const timeSinceUsed = new Date().getTime() - new Date(tokenRecord.used_at).getTime()
        if (timeSinceUsed < 5 * 60 * 1000) {
          // 5 minutes
          throw new Error('This reset token has already been used')
        }
      }

      console.log('Password reset token validated', {
        userId: user.id,
        email: user.email,
        tokenPrefix: token.substring(0, 8),
      })

      return {
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        throw error
      }
      console.error('Password reset token validation failed', {
        error,
        token: token.substring(0, 8),
      })
      throw new Error('Invalid or expired password reset token')
    }
  }

  async useToken(token: string, context?: PasswordResetContext): Promise<void> {
    try {
      const db = await getDatabase()

      // Mark token as used
      const updated = await db('password_reset_tokens')
        .where('token', token)
        .whereNull('used_at')
        .update({
          used_at: new Date(),
          used_ip_address: context?.ipAddress,
          used_user_agent: context?.userAgent,
          updated_at: new Date(),
        })

      if (updated === 0) {
        throw new Error('Invalid or already used reset token')
      }

      console.log('Password reset token used', {
        tokenPrefix: token.substring(0, 8),
        ipAddress: context?.ipAddress,
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        throw error
      }
      console.error('Failed to use password reset token', { error, token: token.substring(0, 8) })
      throw new Error('Failed to process reset token')
    }
  }

  async invalidateUserTokens(userId: string): Promise<void> {
    try {
      const db = await getDatabase()

      const invalidatedCount = await db('password_reset_tokens')
        .where('user_id', userId)
        .whereNull('used_at')
        .update({
          used_at: new Date(),
          updated_at: new Date(),
        })

      if (invalidatedCount > 0) {
        console.log('User password reset tokens invalidated', {
          userId,
          invalidatedCount,
        })
      }
    } catch (error) {
      console.error('Failed to invalidate user password reset tokens', { error, userId })
    }
  }

  async getUserActiveTokens(userId: string): Promise<PasswordResetToken[]> {
    try {
      const db = await getDatabase()
      return await db('password_reset_tokens')
        .where('user_id', userId)
        .whereNull('used_at')
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
    } catch (error) {
      console.error('Failed to get user active reset tokens', { error, userId })
      return []
    }
  }

  async cleanupExpiredTokens(): Promise<number> {
    try {
      const db = await getDatabase()
      const deletedCount = await db('password_reset_tokens')
        .where('expires_at', '<', new Date())
        .del()

      if (deletedCount > 0) {
        console.log('Cleaned up expired password reset tokens', {
          deletedCount,
        })
      }

      return deletedCount
    } catch (error) {
      console.error('Failed to cleanup expired password reset tokens', { error })
      return 0
    }
  }

  async checkRateLimit(email: string, ipAddress: string): Promise<boolean> {
    try {
      const db = await getDatabase()
      const windowStart = addHours(new Date(), -this.RATE_LIMIT_WINDOW_HOURS)

      // Check by email
      const emailAttempts = await db('password_reset_attempts')
        .where('email', email)
        .where('attempted_at', '>', windowStart)
        .count('* as count')
        .first()

      // Check by IP
      const ipAttempts = await db('password_reset_attempts')
        .where('ip_address', ipAddress)
        .where('attempted_at', '>', windowStart)
        .count('* as count')
        .first()

      const emailCount = parseInt(emailAttempts?.count || '0')
      const ipCount = parseInt(ipAttempts?.count || '0')

      return emailCount < this.MAX_RESET_ATTEMPTS && ipCount < this.MAX_RESET_ATTEMPTS * 2
    } catch (error) {
      console.error('Failed to check rate limit', { error, email, ipAddress })
      return true // Allow on error
    }
  }

  async recordAttempt(
    email: string,
    ipAddress: string,
    success: boolean,
    userAgent?: string
  ): Promise<void> {
    try {
      const db = await getDatabase()
      await db('password_reset_attempts').insert({
        email,
        ip_address: ipAddress,
        attempted_at: new Date(),
        success,
        user_agent: userAgent,
      })
    } catch (error) {
      console.error('Failed to record password reset attempt', { error, email, ipAddress })
    }
  }

  async addPasswordHistory(
    userId: string,
    passwordHash: string,
    passwordSalt: string,
    context?: PasswordResetContext & { changeReason?: string }
  ): Promise<void> {
    try {
      const db = await getDatabase()
      await db('password_history').insert({
        user_id: userId,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        created_at: new Date(),
        changed_by_ip: context?.ipAddress,
        changed_by_user_agent: context?.userAgent,
        change_reason: context?.changeReason || 'reset',
      })
    } catch (error) {
      console.error('Failed to add password history', { error, userId })
    }
  }

  async checkPasswordHistory(
    userId: string,
    passwordHash: string,
    limit: number = 5
  ): Promise<boolean> {
    try {
      const db = await getDatabase()
      const history = await db('password_history')
        .where('user_id', userId)
        .orderBy('created_at', 'desc')
        .limit(limit)

      // Check if password matches any recent passwords
      for (const record of history) {
        if (record.password_hash === passwordHash) {
          return false // Password was used recently
        }
      }

      return true // Password is acceptable
    } catch (error) {
      console.error('Failed to check password history', { error, userId })
      return true // Allow on error
    }
  }

  private async enforceTokenLimit(userId: string): Promise<void> {
    try {
      const db = await getDatabase()
      const activeTokens = await db('password_reset_tokens')
        .where('user_id', userId)
        .whereNull('used_at')
        .where('expires_at', '>', new Date())
        .count('* as count')
        .first()

      const count = parseInt(activeTokens?.count || '0')

      if (count >= this.MAX_ACTIVE_TOKENS) {
        // Invalidate oldest tokens
        const tokensToInvalidate = await db('password_reset_tokens')
          .where('user_id', userId)
          .whereNull('used_at')
          .where('expires_at', '>', new Date())
          .orderBy('created_at', 'asc')
          .limit(count - this.MAX_ACTIVE_TOKENS + 1)

        for (const token of tokensToInvalidate) {
          await db('password_reset_tokens').where('id', token.id).update({
            used_at: new Date(),
            updated_at: new Date(),
          })
        }

        console.log('Invalidated excess password reset tokens', {
          userId,
          invalidatedCount: tokensToInvalidate.length,
        })
      }
    } catch (error) {
      console.error('Failed to enforce password reset token limit', { error, userId })
    }
  }
}

export const passwordResetService = new PasswordResetService()