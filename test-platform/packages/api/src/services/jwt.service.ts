import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import { getDatabase } from '../../../../src/database/connection';

export interface JWTPayload {
  sub: string; // User ID
  email: string;
  organizationId?: string;
  role: string;
  permissions: string[];
  tokenId: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface UserTokenData {
  id: string;
  email: string;
  organizationId?: string;
  role: string;
  permissions: string[];
}

export class JWTService {
  private privateKey: string;
  private publicKey: string;
  private readonly ACCESS_TOKEN_EXPIRY = '15m';
  private readonly REFRESH_TOKEN_EXPIRY = '7d';
  private readonly ISSUER = process.env.JWT_ISSUER || 'test-platform';
  private readonly AUDIENCE = process.env.JWT_AUDIENCE || 'test-platform-users';

  constructor() {
    try {
      // Load RSA keys
      const keyPath = process.env.JWT_KEY_PATH || join(process.cwd(), 'keys');
      this.privateKey = readFileSync(join(keyPath, 'private.pem'), 'utf8');
      this.publicKey = readFileSync(join(keyPath, 'public.pem'), 'utf8');
    } catch (error) {
      console.error('Failed to load JWT keys', { error });
      throw new Error('JWT keys not found. Please generate RSA keys.');
    }
  }

  /**
   * Generate a token pair (access and refresh tokens)
   */
  async generateTokenPair(user: UserTokenData): Promise<TokenPair> {
    try {
      const tokenId = this.generateTokenId();
      const now = Math.floor(Date.now() / 1000);

      // Access token payload
      const accessPayload: JWTPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId,
        role: user.role,
        permissions: user.permissions,
        tokenId,
        type: 'access',
        iat: now,
      };

      // Refresh token payload
      const refreshPayload: JWTPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId,
        role: user.role,
        permissions: user.permissions,
        tokenId,
        type: 'refresh',
        iat: now,
      };

      // Generate tokens
      const accessToken = jwt.sign(accessPayload, this.privateKey, {
        algorithm: 'RS256',
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
        issuer: this.ISSUER,
        audience: this.AUDIENCE,
      });

      const refreshToken = jwt.sign(refreshPayload, this.privateKey, {
        algorithm: 'RS256',
        expiresIn: this.REFRESH_TOKEN_EXPIRY,
        issuer: this.ISSUER,
        audience: this.AUDIENCE,
      });

      // Store refresh token in database
      await this.storeRefreshToken(user.id, tokenId, refreshToken);

      console.log('Token pair generated', {
        userId: user.id,
        tokenId,
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
      });

      return {
        accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes in seconds
        tokenType: 'Bearer',
      };
    } catch (error) {
      console.error('Failed to generate token pair', { error, userId: user.id });
      throw new Error('Failed to generate authentication tokens');
    }
  }

  /**
   * Verify a JWT token
   */
  async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, this.publicKey, {
        algorithms: ['RS256'],
        issuer: this.ISSUER,
        audience: this.AUDIENCE,
      }) as JWTPayload;

      // Check if token is blacklisted
      if (await this.isTokenBlacklisted(decoded.tokenId)) {
        throw new Error('Token has been revoked');
      }

      return decoded;
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      } else {
        console.error('Token verification failed', { error });
        throw new Error(error.message || 'Token verification failed');
      }
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenPair> {
    try {
      // Verify refresh token
      const payload = await this.verifyToken(refreshToken);

      if (payload.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if refresh token exists in database
      const storedToken = await this.getStoredRefreshToken(payload.sub, payload.tokenId);
      if (!storedToken || storedToken.revoked_at) {
        throw new Error('Refresh token has been revoked');
      }

      // Get current user data
      const user = await this.getUserById(payload.sub);
      if (!user) {
        throw new Error('User not found');
      }

      // Get user permissions
      const permissions = await this.getUserPermissions(user.id, user.organization_id);

      // Revoke old refresh token
      await this.revokeRefreshToken(payload.sub, payload.tokenId);

      // Generate new token pair
      return await this.generateTokenPair({
        id: user.id,
        email: user.email,
        organizationId: user.organization_id,
        role: user.role || 'user',
        permissions,
      });
    } catch (error: any) {
      console.error('Token refresh failed', { error });
      throw new Error(error.message || 'Failed to refresh token');
    }
  }

  /**
   * Revoke a specific token
   */
  async revokeToken(tokenId: string, userId: string): Promise<void> {
    try {
      // Add to blacklist
      await this.blacklistToken(tokenId, userId);

      // Revoke refresh token
      await this.revokeRefreshToken(userId, tokenId);

      console.log('Token revoked', { tokenId, userId });
    } catch (error) {
      console.error('Failed to revoke token', { error, tokenId, userId });
      throw new Error('Failed to revoke token');
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    try {
      const db = await getDatabase();

      // Revoke all refresh tokens for user
      await db('refresh_tokens')
        .where('user_id', userId)
        .whereNull('revoked_at')
        .update({
          revoked_at: new Date(),
          updated_at: new Date(),
        });

      console.log('All user tokens revoked', { userId });
    } catch (error) {
      console.error('Failed to revoke all user tokens', { error, userId });
      throw new Error('Failed to revoke all tokens');
    }
  }

  /**
   * Decode a token without verification (use with caution)
   */
  decodeToken(token: string): JWTPayload | null {
    try {
      return jwt.decode(token) as JWTPayload;
    } catch {
      return null;
    }
  }

  /**
   * Generate a unique token ID
   */
  private generateTokenId(): string {
    return `tok_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Store refresh token in database
   */
  private async storeRefreshToken(userId: string, tokenId: string, token: string): Promise<void> {
    const db = await getDatabase();

    await db('refresh_tokens').insert({
      id: tokenId,
      user_id: userId,
      token_hash: this.hashToken(token),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      created_at: new Date(),
    });
  }

  /**
   * Get stored refresh token from database
   */
  private async getStoredRefreshToken(userId: string, tokenId: string): Promise<any> {
    const db = await getDatabase();

    return await db('refresh_tokens')
      .where('user_id', userId)
      .where('id', tokenId)
      .first();
  }

  /**
   * Revoke a refresh token
   */
  private async revokeRefreshToken(userId: string, tokenId: string): Promise<void> {
    const db = await getDatabase();

    await db('refresh_tokens')
      .where('user_id', userId)
      .where('id', tokenId)
      .update({
        revoked_at: new Date(),
        updated_at: new Date(),
      });
  }

  /**
   * Add token to blacklist
   */
  private async blacklistToken(tokenId: string, userId: string): Promise<void> {
    const db = await getDatabase();

    await db('token_blacklist').insert({
      token_id: tokenId,
      user_id: userId,
      blacklisted_at: new Date(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    }).onConflict('token_id').ignore(); // Ignore if already blacklisted
  }

  /**
   * Check if token is blacklisted
   */
  private async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    const db = await getDatabase();

    const result = await db('token_blacklist')
      .where('token_id', tokenId)
      .first();

    return !!result;
  }

  /**
   * Hash a token for secure storage
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Get user by ID from database
   */
  private async getUserById(userId: string): Promise<any> {
    const db = await getDatabase();

    return await db('users')
      .where('id', userId)
      .where('status', 'active')
      .first();
  }

  /**
   * Get user permissions
   */
  private async getUserPermissions(userId: string, organizationId?: string): Promise<string[]> {
    const db = await getDatabase();

    // For now, return basic permissions based on role
    // This can be expanded to include role-based and custom permissions
    const user = await db('users').where('id', userId).first();

    if (!user) return [];

    // Basic role-based permissions
    const rolePermissions: { [key: string]: string[] } = {
      admin: ['*'],
      user: ['read:self', 'update:self'],
      viewer: ['read:self'],
    };

    return rolePermissions[user.role || 'user'] || [];
  }
}

// Export singleton instance
export const jwtService = new JWTService();