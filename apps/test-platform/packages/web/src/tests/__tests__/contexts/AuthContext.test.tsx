import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import * as authService from '@/lib/services/auth.service';
import * as tokenService from '@/lib/services/token.service';

// Mock services
vi.mock('@/lib/services/auth.service');
vi.mock('@/lib/services/token.service');

function TestComponent() {
  const { isAuthenticated, user, loading, login, logout } = useAuth();
  
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'not-loading'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>
      <div data-testid="user">{user ? user.name : 'no-user'}</div>
      <button onClick={() => login({ email: 'test@example.com', password: 'password' })}>
        Login
      </button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock token service
    vi.mocked(tokenService.tokenService.setAccessToken).mockImplementation(() => {});
    vi.mocked(tokenService.tokenService.clearTokens).mockImplementation(() => {});
    vi.mocked(tokenService.tokenService.scheduleTokenRefresh).mockImplementation(() => {});
    vi.mocked(tokenService.tokenService.cancelScheduledRefresh).mockImplementation(() => {});
    vi.mocked(tokenService.tokenService.getTimeUntilExpiration).mockReturnValue(900000);
  });

  it('should throw error when useAuth is used outside AuthProvider', () => {
    // Suppress console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => render(<TestComponent />)).toThrow(
      'useAuth must be used within an AuthProvider'
    );
    
    consoleError.mockRestore();
  });

  it('should provide initial unauthenticated state', async () => {
    vi.mocked(authService.authService.getSession).mockRejectedValue(new Error('Not authenticated'));
    
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
    });
    
    expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
    expect(screen.getByTestId('user')).toHaveTextContent('no-user');
  });

  it('should handle successful login', async () => {
    vi.mocked(authService.authService.getSession).mockRejectedValue(new Error('Not authenticated'));
    
    const mockLoginResponse = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
      tokens: {
        accessToken: 'access-token',
        expiresIn: 900,
        tokenType: 'Bearer',
      },
    };
    
    vi.mocked(authService.authService.login).mockResolvedValue(mockLoginResponse);
    
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
    });
    
    const loginButton = screen.getByText('Login');
    loginButton.click();
    
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('user')).toHaveTextContent('Test User');
    });
    
    expect(tokenService.tokenService.setAccessToken).toHaveBeenCalledWith('access-token');
    expect(tokenService.tokenService.scheduleTokenRefresh).toHaveBeenCalled();
  });

  it('should handle login error', async () => {
    vi.mocked(authService.authService.getSession).mockRejectedValue(new Error('Not authenticated'));
    vi.mocked(authService.authService.login).mockRejectedValue({
      response: {
        status: 401,
        data: { message: 'Invalid credentials' },
      },
    });
    
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
    });
    
    const loginButton = screen.getByText('Login');
    loginButton.click();
    
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
    });
    
    expect(tokenService.tokenService.setAccessToken).not.toHaveBeenCalled();
  });

  it('should handle logout', async () => {
    vi.mocked(authService.authService.getSession).mockResolvedValue({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });
    
    vi.mocked(tokenService.tokenService.getAccessToken).mockReturnValue('access-token');
    vi.mocked(authService.authService.logout).mockResolvedValue();
    
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
    });
    
    const logoutButton = screen.getByText('Logout');
    logoutButton.click();
    
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      expect(screen.getByTestId('user')).toHaveTextContent('no-user');
    });
    
    expect(tokenService.tokenService.clearTokens).toHaveBeenCalled();
    expect(authService.authService.logout).toHaveBeenCalled();
  });
});
