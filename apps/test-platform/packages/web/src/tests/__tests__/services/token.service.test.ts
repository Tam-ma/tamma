import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenService } from '@/lib/services/token.service';

describe('tokenService', () => {
  beforeEach(() => {
    tokenService.clearTokens();
  });

  afterEach(() => {
    tokenService.clearTokens();
  });

  describe('setAccessToken and getAccessToken', () => {
    it('should store and retrieve access token', () => {
      const token = 'test-token';
      tokenService.setAccessToken(token);
      expect(tokenService.getAccessToken()).toBe(token);
    });

    it('should return null when no token is set', () => {
      expect(tokenService.getAccessToken()).toBeNull();
    });
  });

  describe('clearTokens', () => {
    it('should clear the access token', () => {
      tokenService.setAccessToken('test-token');
      tokenService.clearTokens();
      expect(tokenService.getAccessToken()).toBeNull();
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for valid token', () => {
      // Create token that expires in 1 hour
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const payload = { exp: futureExp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.isTokenExpired(token)).toBe(false);
    });

    it('should return true for expired token', () => {
      // Create token that expired 1 hour ago
      const pastExp = Math.floor(Date.now() / 1000) - 3600;
      const payload = { exp: pastExp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.isTokenExpired(token)).toBe(true);
    });

    it('should return true for invalid token', () => {
      expect(tokenService.isTokenExpired('invalid-token')).toBe(true);
    });
  });

  describe('getTokenExpirationTime', () => {
    it('should return expiration time from token', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const payload = { exp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.getTokenExpirationTime(token)).toBe(exp);
    });

    it('should return null for invalid token', () => {
      expect(tokenService.getTokenExpirationTime('invalid-token')).toBeNull();
    });
  });

  describe('getTimeUntilExpiration', () => {
    it('should return time until expiration in milliseconds', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const payload = { exp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      const timeUntilExpiration = tokenService.getTimeUntilExpiration(token);
      expect(timeUntilExpiration).toBeGreaterThan(3599000);
      expect(timeUntilExpiration).toBeLessThanOrEqual(3600000);
    });

    it('should return 0 for expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const payload = { exp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.getTimeUntilExpiration(token)).toBe(0);
    });
  });

  describe('shouldRefreshToken', () => {
    it('should return true when token expires in less than 5 minutes', () => {
      const exp = Math.floor(Date.now() / 1000) + 240; // 4 minutes
      const payload = { exp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.shouldRefreshToken(token)).toBe(true);
    });

    it('should return false when token has more than 5 minutes until expiration', () => {
      const exp = Math.floor(Date.now() / 1000) + 600; // 10 minutes
      const payload = { exp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.shouldRefreshToken(token)).toBe(false);
    });

    it('should return false for expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const payload = { exp };
      const token = \`header.\${btoa(JSON.stringify(payload))}.signature\`;
      
      expect(tokenService.shouldRefreshToken(token)).toBe(false);
    });
  });

  describe('scheduleTokenRefresh', () => {
    it('should schedule token refresh callback', async () => {
      vi.useFakeTimers();
      const callback = vi.fn().mockResolvedValue(undefined);
      
      tokenService.scheduleTokenRefresh(1000, callback); // 1000 seconds
      
      // Should refresh at 75% of lifetime (750 seconds)
      vi.advanceTimersByTime(750000);
      
      await vi.runAllTimersAsync();
      
      expect(callback).toHaveBeenCalledTimes(1);
      
      vi.useRealTimers();
    });
  });
});
