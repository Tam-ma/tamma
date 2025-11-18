'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { authService } from '@/lib/services/auth.service';
import { tokenService } from '@/lib/services/token.service';
import {
  AuthState,
  AuthAction,
  LoginCredentials,
  User,
} from '@/types/auth.types';

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Auth reducer
const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, loading: true, error: null };
    
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        isAuthenticated: true,
        user: action.payload.user,
        accessToken: action.payload.accessToken,
        loading: false,
        error: null,
      };
    
    case 'LOGIN_ERROR':
      return {
        ...state,
        isAuthenticated: false,
        user: null,
        accessToken: null,
        loading: false,
        error: action.payload,
      };
    
    case 'LOGOUT':
      return {
        isAuthenticated: false,
        user: null,
        accessToken: null,
        loading: false,
        error: null,
      };
    
    case 'REFRESH_TOKEN_SUCCESS':
      return {
        ...state,
        accessToken: action.payload.accessToken,
        error: null,
      };
    
    case 'REFRESH_TOKEN_ERROR':
      return {
        ...state,
        isAuthenticated: false,
        user: null,
        accessToken: null,
        error: 'Session expired. Please sign in again.',
      };
    
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    
    default:
      return state;
  }
};

// Initial state
const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  accessToken: null,
  loading: true,
  error: null,
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Login function
  const login = useCallback(async (credentials: LoginCredentials) => {
    dispatch({ type: 'LOGIN_START' });

    try {
      const response = await authService.login(credentials);
      const { user, tokens } = response;

      // Store access token in memory
      tokenService.setAccessToken(tokens.accessToken);

      // Schedule automatic token refresh
      tokenService.scheduleTokenRefresh(tokens.expiresIn, async () => {
        await refreshToken();
      });

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: {
          user,
          accessToken: tokens.accessToken,
        },
      });
    } catch (error: unknown) {
      let errorMessage = 'An error occurred during login';
      
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { data?: { message?: string; error?: string }; status?: number } };
        if (axiosError.response?.status === 429) {
          errorMessage = 'Too many login attempts. Please try again later.';
        } else if (axiosError.response?.status === 401) {
          errorMessage = 'Invalid email or password';
        } else {
          errorMessage = axiosError.response?.data?.message || 
                        axiosError.response?.data?.error || 
                        errorMessage;
        }
      }

      dispatch({ type: 'LOGIN_ERROR', payload: errorMessage });
      throw error;
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear tokens and cancel scheduled refresh
      tokenService.clearTokens();
      dispatch({ type: 'LOGOUT' });
    }
  }, []);

  // Refresh token function
  const refreshToken = useCallback(async () => {
    try {
      const response = await authService.refreshToken();
      
      // Update access token
      tokenService.setAccessToken(response.accessToken);

      // Schedule next refresh
      tokenService.scheduleTokenRefresh(response.expiresIn, async () => {
        await refreshToken();
      });

      dispatch({
        type: 'REFRESH_TOKEN_SUCCESS',
        payload: { accessToken: response.accessToken },
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      dispatch({ type: 'REFRESH_TOKEN_ERROR' });
      
      // Redirect to login
      if (typeof window !== 'undefined') {
        const returnUrl = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?returnUrl=${returnUrl}`;
      }
    }
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  // Check session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const user = await authService.getSession();
        
        // Get access token from initial request (should be set by interceptor)
        const accessToken = tokenService.getAccessToken();
        
        if (accessToken) {
          dispatch({
            type: 'LOGIN_SUCCESS',
            payload: { user, accessToken },
          });

          // Schedule token refresh
          const timeUntilExpiration = tokenService.getTimeUntilExpiration(accessToken);
          if (timeUntilExpiration > 0) {
            tokenService.scheduleTokenRefresh(
              timeUntilExpiration / 1000, // Convert to seconds
              async () => {
                await refreshToken();
              }
            );
          }
        } else {
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch (error) {
        console.error('Session check error:', error);
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    checkSession();

    // Cleanup on unmount
    return () => {
      tokenService.cancelScheduledRefresh();
    };
  }, [refreshToken]);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refreshToken,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to use auth context
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};
