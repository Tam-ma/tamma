import crypto from 'crypto';
import { getDatabase } from '../../../../src/database/connection';

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  revoked_at?: Date;
  last_used_at?: Date;
  device_info?: string;
  ip_address?: string;
}

export interface RefreshTokenContext {
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class RefreshTokenService {
  private readonly MAX_ACTIVE_TOKENS = 5;
  private readonly TOKEN_REUSE_DETECTION_WINDOW = 30 * 60 * 1000; // 30 minutes
  private readonly REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Create a new refresh token
   */
  async createRefreshToken(
    userId: string,
    tokenId: string,
    token: string,
    context?: RefreshTokenContext
  ): Promise<void> {
    try {
      const db = await getDatabase();

      // Clean up old expired tokens
      await this.cleanupExpiredTokens();

      // Check if user has too many active tokens
      await this.enforceTokenLimit(userId);

      // Store new refresh token
      await db('refresh_tokens').insert({
        id: tokenId,
        user_id: userId,
        token_hash: this.hashToken(token),
        expires_at: new Date(Date.now() + this.REFRESH_TOKEN_TTL),
        device_info: context?.deviceInfo || context?.userAgent,
        ip_address: context?.ipAddress,
        created_at: new Date(),
      });

      console.log('Refresh token created', {
        userId,
        tokenId,
        deviceInfo: context?.deviceInfo,
        ipAddress: context?.ipAddress,
      });
    } catch (error) {
      console.error('Failed to create refresh token', { error, userId });
      throw new Error('Failed to create refresh token');
    }
  }

  /**
   * Validate a refresh token
   */
  async validateRefreshToken(
    userId: string,
    tokenId: string,
    token: string
  ): Promise<RefreshTokenRecord> {
    try {
      const db = await getDatabase();

      const storedToken = await db('refresh_tokens')
        .where('user_id', userId)
        .where('id', tokenId)
        .first();

      if (!storedToken) {
        throw new Error('Refresh token not found');
      }

      if (storedToken.revoked_at) {
        // Possible token reuse attack - revoke all user tokens
        await this.detectTokenReuse(userId, tokenId);
        throw new Error('Refresh token has been revoked');
      }

      if (new Date() > new Date(storedToken.expires_at)) {
        throw new Error('Refresh token has expired');
      }

      // Verify token hash
      if (storedToken.token_hash !== this.hashToken(token)) {
        // Possible token reuse attack
        await this.revokeAllUserTokens(userId, 'Invalid token hash detected');
        throw new Error('Invalid refresh token');
      }

      // Update last used timestamp
      await db('refresh_tokens')
        .where('id', tokenId)
        .update({
          last_used_at: new Date(),
          updated_at: new Date(),
        });

      return storedToken;
    } catch (error: any) {
      console.error('Refresh token validation failed', { error, userId, tokenId });
      throw new Error(error.message || 'Invalid refresh token');
    }
  }

  /**
   * Rotate a refresh token (revoke old, create new)
   */
  async rotateRefreshToken(
    userId: string,
    oldTokenId: string,
    oldToken: string,
    newTokenId: string,
    newToken: string,
    context?: RefreshTokenContext
  ): Promise<void> {
    try {
      const db = await getDatabase();

      // Start transaction for atomic rotation
      await db.transaction(async (trx) => {
        // Validate old token
        const storedToken = await trx('refresh_tokens')
          .where('user_id', userId)
          .where('id', oldTokenId)
          .first();

        if (!storedToken || storedToken.revoked_at) {
          throw new Error('Invalid refresh token for rotation');
        }

        // Revoke old token
        await trx('refresh_tokens')
          .where('id', oldTokenId)
          .update({
            revoked_at: new Date(),
            revoked_reason: 'Rotated',
            updated_at: new Date(),
          });

        // Create new token
        await trx('refresh_tokens').insert({
          id: newTokenId,
          user_id: userId,
          token_hash: this.hashToken(newToken),
          expires_at: new Date(Date.now() + this.REFRESH_TOKEN_TTL),
          device_info: context?.deviceInfo || context?.userAgent || storedToken.device_info,
          ip_address: context?.ipAddress || storedToken.ip_address,
          created_at: new Date(),
        });
      });

      console.log('Refresh token rotated', {
        userId,
        oldTokenId,
        newTokenId,
        deviceInfo: context?.deviceInfo,
        ipAddress: context?.ipAddress,
      });
    } catch (error) {
      console.error('Refresh token rotation failed', { error, userId });
      throw new Error('Failed to rotate refresh token');
    }
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(tokenId: string, reason?: string): Promise<void> {
    try {
      const db = await getDatabase();

      await db('refresh_tokens')
        .where('id', tokenId)
        .update({
          revoked_at: new Date(),
          revoked_reason: reason || 'Manual revocation',
          updated_at: new Date(),
        });

      console.log('Refresh token revoked', { tokenId, reason });
    } catch (error) {
      console.error('Failed to revoke refresh token', { error, tokenId });
      throw new Error('Failed to revoke refresh token');
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId: string, reason?: string): Promise<void> {
    try {
      const db = await getDatabase();

      await db('refresh_tokens')
        .where('user_id', userId)
        .whereNull('revoked_at')
        .update({
          revoked_at: new Date(),
          revoked_reason: reason || 'All tokens revoked',
          updated_at: new Date(),
        });

      console.log('All user refresh tokens revoked', {
        userId,
        reason,
      });
    } catch (error) {
      console.error('Failed to revoke all user tokens', { error, userId });
      throw new Error('Failed to revoke all tokens');
    }
  }

  /**
   * Get active tokens for a user
   */
  async getUserActiveTokens(userId: string): Promise<RefreshTokenRecord[]> {
    try {
      const db = await getDatabase();

      return await db('refresh_tokens')
        .where('user_id', userId)
        .whereNull('revoked_at')
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc');
    } catch (error) {
      console.error('Failed to get user active tokens', { error, userId });
      return [];
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const db = await getDatabase();

      const deletedCount = await db('refresh_tokens')
        .where('expires_at', '<', new Date())
        .del();

      if (deletedCount > 0) {
        console.log('Cleaned up expired refresh tokens', {
          deletedCount,
        });
      }

      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup expired tokens', { error });
      return 0;
    }
  }

  /**
   * Detect potential token reuse attack
   */
  private async detectTokenReuse(userId: string, tokenId: string): Promise<void> {
    try {
      const db = await getDatabase();

      // Check if this token was recently used
      const recentUse = await db('refresh_tokens')
        .where('id', tokenId)
        .where('last_used_at', '>', new Date(Date.now() - this.TOKEN_REUSE_DETECTION_WINDOW))
        .first();

      if (recentUse) {
        // Possible token reuse attack - revoke all user tokens
        await this.revokeAllUserTokens(userId, 'Token reuse detected - possible security breach');

        // Log security event
        console.error('SECURITY: Token reuse detected', {
          userId,
          tokenId,
          lastUsed: recentUse.last_used_at,
        });
      }
    } catch (error) {
      console.error('Failed to detect token reuse', { error, userId, tokenId });
    }
  }

  /**
   * Enforce maximum token limit per user
   */
  private async enforceTokenLimit(userId: string): Promise<void> {
    try {
      const db = await getDatabase();

      const activeTokens = await db('refresh_tokens')
        .where('user_id', userId)
        .whereNull('revoked_at')
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'asc');

      if (activeTokens.length >= this.MAX_ACTIVE_TOKENS) {
        // Revoke oldest tokens
        const tokensToRevoke = activeTokens.slice(
          0,
          activeTokens.length - this.MAX_ACTIVE_TOKENS + 1
        );

        for (const token of tokensToRevoke) {
          await this.revokeRefreshToken(token.id, 'Token limit exceeded');
        }

        console.log('Revoked excess refresh tokens', {
          userId,
          revokedCount: tokensToRevoke.length,
        });
      }
    } catch (error) {
      console.error('Failed to enforce token limit', { error, userId });
    }
  }

  /**
   * Get token statistics for a user
   */
  async getUserTokenStats(userId: string): Promise<{
    activeTokens: number;
    revokedTokens: number;
    expiredTokens: number;
    lastActivity?: Date;
  }> {
    try {
      const db = await getDatabase();

      const stats = await db('refresh_tokens')
        .where('user_id', userId)
        .select(
          db.raw('COUNT(CASE WHEN revoked_at IS NULL AND expires_at > NOW() THEN 1 END) as active_tokens'),
          db.raw('COUNT(CASE WHEN revoked_at IS NOT NULL THEN 1 END) as revoked_tokens'),
          db.raw('COUNT(CASE WHEN expires_at <= NOW() THEN 1 END) as expired_tokens'),
          db.raw('MAX(last_used_at) as last_activity')
        )
        .first();

      return {
        activeTokens: parseInt(stats.active_tokens) || 0,
        revokedTokens: parseInt(stats.revoked_tokens) || 0,
        expiredTokens: parseInt(stats.expired_tokens) || 0,
        lastActivity: stats.last_activity ? new Date(stats.last_activity) : undefined,
      };
    } catch (error) {
      console.error('Failed to get user token stats', { error, userId });
      return {
        activeTokens: 0,
        revokedTokens: 0,
        expiredTokens: 0,
      };
    }
  }

  /**
   * Hash a token for secure storage
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

// Export singleton instance
export const refreshTokenService = new RefreshTokenService();