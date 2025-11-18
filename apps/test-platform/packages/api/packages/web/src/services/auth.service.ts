import apiClient, { getErrorMessage } from './api'

export interface RegisterData {
  email: string
  password: string
  fullName?: string
}

export interface LoginData {
  email: string
  password: string
  rememberMe?: boolean
}

export interface ForgotPasswordData {
  email: string
}

export interface ResetPasswordData {
  token: string
  password: string
}

export interface ChangePasswordData {
  currentPassword: string
  newPassword: string
}

export interface User {
  id: string
  email: string
  fullName?: string
  createdAt: string
  emailVerified: boolean
}

export interface AuthResponse {
  user: User
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

/**
 * Authentication service for user management
 */
class AuthService {
  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/register', data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/verify-email', { token })
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/resend-verification', { email })
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Login user
   */
  async login(data: LoginData): Promise<AuthResponse> {
    try {
      const response = await apiClient.post('/auth/login', data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/logout')
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<AuthResponse> {
    try {
      const response = await apiClient.post('/auth/refresh')
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(data: ForgotPasswordData): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/forgot-password', data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(data: ResetPasswordData): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/reset-password', data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Change password (authenticated)
   */
  async changePassword(data: ChangePasswordData): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/change-password', data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<User> {
    try {
      const response = await apiClient.get('/auth/me')
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }
}

export const authService = new AuthService()
