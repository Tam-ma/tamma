/**
 * Email Verification Service Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emailVerificationService } from '../../services/email-verification.service';
import { getDatabase } from '../../../../../src/database/connection';

// Mock the database module
vi.mock('../../../../../src/database/connection', () => ({
  getDatabase: vi.fn()
}));

describe('EmailVerificationService', () => {
  let mockDb: any;

  beforeEach(() => {
    // Setup mock database
    mockDb = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      first: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      del: vi.fn(),
      select: vi.fn().mockReturnThis(),
      transaction: vi.fn((callback) => callback(mockDb))
    };

    mockDb.mockImplementation((table: string) => ({
      ...mockDb,
      _table: table
    }));

    vi.mocked(getDatabase).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateToken', () => {
    it('should generate a unique token for a user', async () => {
      const userId = 'test-user-123';

      mockDb.where.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.update.mockResolvedValue(1);
      mockDb.insert.mockResolvedValue([{ id: 'token-123' }]);

      const token = await emailVerificationService.generateToken(userId);

      expect(token).toBeTruthy();
      expect(token).toHaveLength(64); // 32 bytes in hex
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should invalidate existing tokens before generating new one', async () => {
      const userId = 'test-user-123';

      mockDb.where.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.update.mockResolvedValue(1);
      mockDb.insert.mockResolvedValue([{ id: 'token-123' }]);

      await emailVerificationService.generateToken(userId);

      // Verify that update was called to invalidate existing tokens
      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          used_at: expect.any(Date),
          updated_at: expect.any(Date)
        })
      );
    });
  });

  describe('verifyToken', () => {
    it('should successfully verify a valid token', async () => {
      const token = 'valid-token-123';
      const userId = 'user-123';
      const email = 'test@example.com';

      // Mock token lookup
      mockDb.where.mockImplementation((field: string, value?: any) => {
        if (field === 'token') {
          return mockDb;
        }
        return mockDb;
      });
      mockDb.andWhere.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        id: 'token-id',
        user_id: userId,
        token: token,
        expires_at: new Date(Date.now() + 3600000)
      });

      // Mock user lookup
      mockDb.first.mockResolvedValueOnce({
        id: userId,
        email: email,
        email_verified: false
      });

      const result = await emailVerificationService.verifyToken(token);

      expect(result).toEqual({
        userId: userId,
        email: email
      });
    });

    it('should reject expired tokens', async () => {
      const token = 'expired-token-123';

      mockDb.where.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.first.mockResolvedValue(null);

      await expect(emailVerificationService.verifyToken(token))
        .rejects.toThrow('Invalid or expired verification token');
    });

    it('should reject already used tokens', async () => {
      const token = 'used-token-123';

      mockDb.where.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.first.mockResolvedValue(null);

      await expect(emailVerificationService.verifyToken(token))
        .rejects.toThrow('Invalid or expired verification token');
    });

    it('should reject if email is already verified', async () => {
      const token = 'valid-token-123';

      mockDb.where.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        id: 'token-id',
        user_id: 'user-123',
        token: token,
        expires_at: new Date(Date.now() + 3600000)
      });

      mockDb.first.mockResolvedValueOnce({
        id: 'user-123',
        email: 'test@example.com',
        email_verified: true
      });

      await expect(emailVerificationService.verifyToken(token))
        .rejects.toThrow('Email already verified');
    });
  });

  describe('resendVerificationToken', () => {
    it('should generate a new token for unverified user', async () => {
      const email = 'test@example.com';
      const userId = 'user-123';

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        id: userId,
        email: email,
        email_verified: false
      });

      // No recent token
      mockDb.first.mockResolvedValueOnce(null);

      mockDb.andWhere.mockReturnThis();
      mockDb.update.mockResolvedValue(1);
      mockDb.insert.mockResolvedValue([{ id: 'new-token' }]);

      const token = await emailVerificationService.resendVerificationToken(email);

      expect(token).toBeTruthy();
      expect(token).toHaveLength(64);
    });

    it('should reject if user not found', async () => {
      const email = 'nonexistent@example.com';

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue(null);

      await expect(emailVerificationService.resendVerificationToken(email))
        .rejects.toThrow('User not found');
    });

    it('should reject if email already verified', async () => {
      const email = 'verified@example.com';

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue({
        id: 'user-123',
        email: email,
        email_verified: true
      });

      await expect(emailVerificationService.resendVerificationToken(email))
        .rejects.toThrow('Email already verified');
    });

    it('should enforce rate limiting', async () => {
      const email = 'test@example.com';

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        id: 'user-123',
        email: email,
        email_verified: false
      });

      // Recent token exists
      mockDb.first.mockResolvedValueOnce({
        id: 'recent-token',
        created_at: new Date()
      });

      await expect(emailVerificationService.resendVerificationToken(email))
        .rejects.toThrow('Please wait before requesting another verification email');
    });
  });

  describe('getVerificationStatus', () => {
    it('should return verification status for a user', async () => {
      const userId = 'user-123';

      mockDb.where.mockReturnThis();
      mockDb.select.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        email_verified: true,
        email_verified_at: new Date('2024-01-01')
      });

      mockDb.andWhere.mockReturnThis();
      mockDb.first.mockResolvedValueOnce(null);

      const status = await emailVerificationService.getVerificationStatus(userId);

      expect(status).toEqual({
        verified: true,
        verifiedAt: expect.any(Date),
        pendingToken: false
      });
    });

    it('should indicate pending token if exists', async () => {
      const userId = 'user-123';

      mockDb.where.mockReturnThis();
      mockDb.select.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        email_verified: false,
        email_verified_at: null
      });

      mockDb.andWhere.mockReturnThis();
      mockDb.first.mockResolvedValueOnce({
        id: 'pending-token',
        expires_at: new Date(Date.now() + 3600000)
      });

      const status = await emailVerificationService.getVerificationStatus(userId);

      expect(status).toEqual({
        verified: false,
        verifiedAt: null,
        pendingToken: true
      });
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens', async () => {
      mockDb.where.mockReturnThis();
      mockDb.orWhere.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.del.mockResolvedValue(5);

      const deletedCount = await emailVerificationService.cleanupExpiredTokens();

      expect(deletedCount).toBe(5);
      expect(mockDb.del).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockDb.where.mockReturnThis();
      mockDb.orWhere.mockReturnThis();
      mockDb.andWhere.mockReturnThis();
      mockDb.del.mockRejectedValue(new Error('Database error'));

      const deletedCount = await emailVerificationService.cleanupExpiredTokens();

      expect(deletedCount).toBe(0);
    });
  });
});