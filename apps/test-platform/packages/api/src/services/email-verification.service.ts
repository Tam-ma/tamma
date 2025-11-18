/**
 * Email Verification Service
 * Handles email verification token generation and validation
 */

import { randomBytes } from 'crypto';
import { addHours } from 'date-fns';
import { getDatabase } from '../../../../src/database/connection';
import { ApiError } from '../utils/api-error';

export interface EmailVerificationToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
  used_at?: Date;
}

export class EmailVerificationService {
  private readonly TOKEN_EXPIRY_HOURS = 24;
  private readonly TOKEN_LENGTH = 32;

  /**
   * Generate a secure email verification token
   */
  async generateToken(userId: string): Promise<string> {
    try {
      const db = await getDatabase();

      // Generate secure random token
      const token = randomBytes(this.TOKEN_LENGTH).toString('hex');
      const expiresAt = addHours(new Date(), this.TOKEN_EXPIRY_HOURS);

      // Invalidate any existing unused tokens for this user
      await db('email_verification_tokens')
        .where('user_id', userId)
        .andWhere('used_at', null)
        .update({
          used_at: new Date(),
          updated_at: new Date()
        });

      // Store new token in database
      await db('email_verification_tokens').insert({
        user_id: userId,
        token,
        expires_at: expiresAt,
        created_at: new Date(),
        updated_at: new Date()
      });

      return token;
    } catch (error) {
      console.error('Failed to generate email verification token:', error);
      throw ApiError.internalServer('Failed to generate verification token');
    }
  }

  /**
   * Verify email verification token and mark email as verified
   */
  async verifyToken(token: string): Promise<{ userId: string; email: string }> {
    try {
      const db = await getDatabase();

      // Find valid token
      const tokenRecord = await db('email_verification_tokens')
        .where('token', token)
        .andWhere('used_at', null)
        .andWhere('expires_at', '>', new Date())
        .first();

      if (!tokenRecord) {
        throw ApiError.badRequest('Invalid or expired verification token');
      }

      // Get user
      const user = await db('users')
        .where('id', tokenRecord.user_id)
        .first();

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      if (user.email_verified) {
        throw ApiError.badRequest('Email already verified');
      }

      // Start transaction to ensure atomicity
      const result = await db.transaction(async (trx) => {
        // Mark token as used
        await trx('email_verification_tokens')
          .where('id', tokenRecord.id)
          .update({
            used_at: new Date(),
            updated_at: new Date()
          });

        // Update user email verification status
        await trx('users')
          .where('id', user.id)
          .update({
            email_verified: true,
            email_verified_at: new Date(),
            updated_at: new Date()
          });

        return {
          userId: user.id,
          email: user.email
        };
      });

      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Email verification failed:', error);
      throw ApiError.internalServer('Email verification failed');
    }
  }

  /**
   * Check if a user's email is verified
   */
  async isEmailVerified(userId: string): Promise<boolean> {
    try {
      const db = await getDatabase();

      const user = await db('users')
        .where('id', userId)
        .select('email_verified')
        .first();

      return user?.email_verified || false;
    } catch (error) {
      console.error('Failed to check email verification status:', error);
      return false;
    }
  }

  /**
   * Resend verification email for a user
   */
  async resendVerificationToken(email: string): Promise<string> {
    try {
      const db = await getDatabase();

      const user = await db('users')
        .where('email', email)
        .first();

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      if (user.email_verified) {
        throw ApiError.badRequest('Email already verified');
      }

      // Check for recent token generation (rate limiting)
      const recentToken = await db('email_verification_tokens')
        .where('user_id', user.id)
        .where('created_at', '>', new Date(Date.now() - 60000)) // 1 minute ago
        .first();

      if (recentToken) {
        throw ApiError.tooManyRequests('Please wait before requesting another verification email');
      }

      // Generate new token
      const token = await this.generateToken(user.id);

      return token;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Failed to resend verification email:', error);
      throw ApiError.internalServer('Failed to resend verification email');
    }
  }

  /**
   * Clean up expired tokens (should be run periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const db = await getDatabase();

      const deletedCount = await db('email_verification_tokens')
        .where('expires_at', '<', new Date())
        .orWhere('used_at', '!=', null)
        .andWhere('created_at', '<', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // 7 days old
        .del();

      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup expired tokens:', error);
      return 0;
    }
  }

  /**
   * Get verification status for a user
   */
  async getVerificationStatus(userId: string): Promise<{
    verified: boolean;
    verifiedAt?: Date;
    pendingToken: boolean;
  }> {
    try {
      const db = await getDatabase();

      const user = await db('users')
        .where('id', userId)
        .select('email_verified', 'email_verified_at')
        .first();

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      const pendingToken = await db('email_verification_tokens')
        .where('user_id', userId)
        .andWhere('used_at', null)
        .andWhere('expires_at', '>', new Date())
        .first();

      return {
        verified: user.email_verified,
        verifiedAt: user.email_verified_at,
        pendingToken: !!pendingToken
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Failed to get verification status:', error);
      throw ApiError.internalServer('Failed to get verification status');
    }
  }
}

export const emailVerificationService = new EmailVerificationService();