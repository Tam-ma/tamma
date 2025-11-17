import api from './api';
import {
  LoginCredentials,
  LoginResponse,
  RefreshTokenResponse,
  User,
} from '@/types/auth.types';

export const authService = {
  /**
   * Login with email and password
   */
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/api/auth/login', credentials);
    return response.data;
  },

  /**
   * Logout and invalidate refresh token
   */
  logout: async (): Promise<void> => {
    await api.post('/api/auth/logout');
  },

  /**
   * Refresh access token using refresh token (stored in HttpOnly cookie)
   */
  refreshToken: async (): Promise<RefreshTokenResponse> => {
    const response = await api.post<RefreshTokenResponse>('/api/auth/refresh');
    return response.data;
  },

  /**
   * Get current session information
   */
  getSession: async (): Promise<User> => {
    const response = await api.get<{ user: User }>('/api/auth/session');
    return response.data.user;
  },

  /**
   * Validate current access token
   */
  validateToken: async (): Promise<boolean> => {
    try {
      await api.get('/api/auth/validate');
      return true;
    } catch (error) {
      return false;
    }
  },
};
