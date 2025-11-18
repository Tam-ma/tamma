import api from './api';
import {
  LoginCredentials,
  LoginResponse,
  RefreshTokenResponse,
  User,
} from '@/types/auth.types';

// Backend response types (different from frontend types)
interface BackendLoginResponse {
  message: string;
  user: any;
  accessToken: string;
  refreshToken: string;
}

export const authService = {
  /**
   * Login with email and password
   */
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await api.post<BackendLoginResponse>('/auth/login', credentials);

    // Transform backend response to match frontend expectations
    return {
      user: {
        id: response.data.user.id,
        email: response.data.user.email,
        name: response.data.user.fullName || response.data.user.full_name || response.data.user.email,
        role: 'user', // Default role
        emailVerified: response.data.user.emailVerified || response.data.user.email_verified || false,
        createdAt: response.data.user.createdAt || response.data.user.created_at,
        updatedAt: response.data.user.updatedAt || response.data.user.updated_at,
      },
      tokens: {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        expiresIn: 900, // 15 minutes default
        tokenType: 'Bearer',
      },
    };
  },

  /**
   * Logout and invalidate refresh token
   */
  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },

  /**
   * Refresh access token using refresh token (stored in HttpOnly cookie)
   */
  refreshToken: async (): Promise<RefreshTokenResponse> => {
    const response = await api.post<RefreshTokenResponse>('/auth/refresh');
    return response.data;
  },

  /**
   * Get current session information
   */
  getSession: async (): Promise<User> => {
    const response = await api.get<{ user: any }>('/auth/me');

    // Transform backend response to match frontend expectations
    return {
      id: response.data.user.id,
      email: response.data.user.email,
      name: response.data.user.fullName || response.data.user.full_name || response.data.user.email,
      role: 'user', // Default role
      emailVerified: response.data.user.emailVerified || response.data.user.email_verified || false,
      createdAt: response.data.user.createdAt || response.data.user.created_at,
      updatedAt: response.data.user.updatedAt || response.data.user.updated_at,
    };
  },

  /**
   * Validate current access token
   */
  validateToken: async (): Promise<boolean> => {
    try {
      await api.get('/auth/me');
      return true;
    } catch (error) {
      return false;
    }
  },
};
