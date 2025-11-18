import { api } from '@/lib/api';

export interface ResetPasswordRequestResponse {
  message: string;
  email?: string;
}

export interface ResetPasswordResponse {
  message: string;
  success: boolean;
}

export interface ChangePasswordResponse {
  message: string;
  success: boolean;
}

/**
 * Password management service
 * Handles all password-related API calls
 */
export const passwordService = {
  /**
   * Request a password reset email
   * @param email User's email address
   * @returns Promise with success message (generic for security)
   */
  requestReset: async (email: string): Promise<ResetPasswordRequestResponse> => {
    const response = await api.post<ResetPasswordRequestResponse>('/auth/password/reset-request', {
      email,
    });
    return response.data;
  },

  /**
   * Reset password using token from email
   * @param token Reset token from URL
   * @param newPassword New password
   * @returns Promise with success status
   */
  resetPassword: async (token: string, newPassword: string): Promise<ResetPasswordResponse> => {
    const response = await api.post<ResetPasswordResponse>('/auth/password/reset', {
      token,
      newPassword,
    });
    return response.data;
  },

  /**
   * Change password for authenticated user
   * @param currentPassword Current password
   * @param newPassword New password
   * @returns Promise with success status
   */
  changePassword: async (
    currentPassword: string,
    newPassword: string
  ): Promise<ChangePasswordResponse> => {
    const response = await api.post<ChangePasswordResponse>('/auth/password/change', {
      currentPassword,
      newPassword,
    });
    return response.data;
  },

  /**
   * Validate reset token
   * @param token Reset token from URL
   * @returns Promise with validation status
   */
  validateToken: async (token: string): Promise<{ valid: boolean }> => {
    try {
      const response = await api.get<{ valid: boolean }>(`/auth/password/validate-token`, {
        params: { token },
      });
      return response.data;
    } catch {
      return { valid: false };
    }
  },
};
