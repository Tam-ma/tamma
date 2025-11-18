import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import { passwordService } from '@/services/password.service';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

// Mock password service
vi.mock('@/services/password.service', () => ({
  passwordService: {
    validateToken: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe('ResetPasswordPage', () => {
  const mockPush = vi.fn();
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue({ push: mockPush });
    (useSearchParams as any).mockReturnValue({ get: mockGet });
  });

  it('should redirect to error page when token is missing', async () => {
    mockGet.mockReturnValue(null);

    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/reset-error');
    });
  });

  it('should validate token on mount', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });

    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(passwordService.validateToken).toHaveBeenCalledWith(token);
    });
  });

  it('should redirect to error page when token is invalid', async () => {
    const token = 'invalid-token';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: false });

    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/reset-error');
    });
  });

  it('should render form when token is valid', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });

    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/New password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm password/)).toBeInTheDocument();
  });

  it('should show password requirements checklist', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/New password/);
    await user.type(passwordInput, 'test');

    await waitFor(() => {
      expect(screen.getByText(/Password requirements:/)).toBeInTheDocument();
    });
  });

  it('should show password strength meter when typing', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/New password/);
    await user.type(passwordInput, 'TestPassword');

    await waitFor(() => {
      expect(screen.getByText('Password strength:')).toBeInTheDocument();
    });
  });

  it('should show error when passwords do not match', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/New password/);
    const confirmInput = screen.getByLabelText(/Confirm password/);
    const submitButton = screen.getByRole('button', { name: /Reset Password/ });

    await user.type(passwordInput, 'TestPassword123!');
    await user.type(confirmInput, 'DifferentPassword123!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Passwords don't match/)).toBeInTheDocument();
    });
  });

  it('should successfully reset password with valid input', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });
    (passwordService.resetPassword as any).mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/New password/);
    const confirmInput = screen.getByLabelText(/Confirm password/);
    const submitButton = screen.getByRole('button', { name: /Reset Password/ });

    await user.type(passwordInput, 'TestPassword123!');
    await user.type(confirmInput, 'TestPassword123!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(passwordService.resetPassword).toHaveBeenCalledWith(token, 'TestPassword123!');
      expect(mockPush).toHaveBeenCalledWith('/auth/reset-success');
    });
  });

  it('should disable submit button when form is invalid', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });

    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /Reset Password/ });
    expect(submitButton).toBeDisabled();
  });

  it('should show loading state during submission', async () => {
    const token = 'valid-token-123';
    mockGet.mockReturnValue(token);
    (passwordService.validateToken as any).mockResolvedValue({ valid: true });
    (passwordService.resetPassword as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(screen.getByText('Reset your password')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/New password/);
    const confirmInput = screen.getByLabelText(/Confirm password/);
    const submitButton = screen.getByRole('button', { name: /Reset Password/ });

    await user.type(passwordInput, 'TestPassword123!');
    await user.type(confirmInput, 'TestPassword123!');
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });
});
