/**
 * Token Service
 * Manages access tokens in memory (never localStorage for security)
 * Refresh tokens are handled via HttpOnly cookies by the server
 */

let accessToken: string | null = null;
let tokenRefreshTimer: NodeJS.Timeout | null = null;

export const tokenService = {
  /**
   * Set access token in memory
   */
  setAccessToken: (token: string): void => {
    accessToken = token;
  },

  /**
   * Get current access token
   */
  getAccessToken: (): string | null => {
    return accessToken;
  },

  /**
   * Clear all tokens from memory
   */
  clearTokens: (): void => {
    accessToken = null;
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
    }
  },

  /**
   * Check if a JWT token is expired
   */
  isTokenExpired: (token: string): boolean => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expirationTime = payload.exp * 1000; // Convert to milliseconds
      return Date.now() >= expirationTime;
    } catch (error) {
      console.error('Error parsing token:', error);
      return true;
    }
  },

  /**
   * Get token expiration time in seconds
   */
  getTokenExpirationTime: (token: string): number | null => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp;
    } catch (error) {
      console.error('Error parsing token:', error);
      return null;
    }
  },

  /**
   * Get time until token expiration in milliseconds
   */
  getTimeUntilExpiration: (token: string): number => {
    const expirationTime = tokenService.getTokenExpirationTime(token);
    if (!expirationTime) return 0;
    
    const timeUntilExpiration = (expirationTime * 1000) - Date.now();
    return Math.max(0, timeUntilExpiration);
  },

  /**
   * Schedule automatic token refresh before expiration
   * Refreshes at 75% of token lifetime (e.g., 11.25 minutes for 15-minute tokens)
   */
  scheduleTokenRefresh: (
    expiresIn: number,
    refreshCallback: () => Promise<void>
  ): void => {
    // Clear any existing timer
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
    }

    // Schedule refresh at 75% of token lifetime
    const refreshTime = expiresIn * 0.75 * 1000; // Convert to milliseconds

    tokenRefreshTimer = setTimeout(async () => {
      try {
        await refreshCallback();
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }, refreshTime);
  },

  /**
   * Cancel scheduled token refresh
   */
  cancelScheduledRefresh: (): void => {
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
    }
  },

  /**
   * Check if token needs refresh (5 minutes before expiration)
   */
  shouldRefreshToken: (token: string): boolean => {
    const timeUntilExpiration = tokenService.getTimeUntilExpiration(token);
    const fiveMinutesInMs = 5 * 60 * 1000;
    return timeUntilExpiration <= fiveMinutesInMs && timeUntilExpiration > 0;
  },
};
