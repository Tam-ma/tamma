import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePasswordPage from '@/pages/settings/ChangePasswordPage';
import { passwordService } from '@/services/password.service';

// Mock password service
vi.mock('@/services/password.service', () => ({
  passwordService: {
    changePassword: vi.fn(),
  },
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the change password form', () => {
    render(<ChangePasswordPage />);

    expect(screen.getByText('Change Password')).toBeInTheDocument();
    expect(screen.getByLabelText(/Current password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/New password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm new password/)).toBeInTheDocument();
  });

  it('should show password strength meter when typing new password', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const newPasswordInput = screen.getByLabelText(/New password/);
    await user.type(newPasswordInput, 'TestPassword');

    await waitFor(() => {
      expect(screen.getByText('Password strength:')).toBeInTheDocument();
    });
  });

  it('should show password requirements checklist', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const newPasswordInput = screen.getByLabelText(/New password/);
    await user.type(newPasswordInput, 'test');

    await waitFor(() => {
      expect(screen.getByText(/Password requirements:/)).toBeInTheDocument();
    });
  });

  it('should validate that current password is required', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const newPasswordInput = screen.getByLabelText(/New password/);
    const confirmPasswordInput = screen.getByLabelText(/Confirm new password/);
    const submitButton = screen.getByRole('button', { name: /Change Password/ });

    await user.type(newPasswordInput, 'TestPassword123!');
    await user.type(confirmPasswordInput, 'TestPassword123!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Current password is required/)).toBeInTheDocument();
    });
  });

  it('should validate that new passwords match', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const currentPasswordInput = screen.getByLabelText(/Current password/);
    const newPasswordInput = screen.getByLabelText(/New password/);
    const confirmPasswordInput = screen.getByLabelText(/Confirm new password/);
    const submitButton = screen.getByRole('button', { name: /Change Password/ });

    await user.type(currentPasswordInput, 'OldPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');
    await user.type(confirmPasswordInput, 'DifferentPassword123!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Passwords don't match/)).toBeInTheDocument();
    });
  });

  it('should successfully change password with valid input', async () => {
    (passwordService.changePassword as any).mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const currentPasswordInput = screen.getByLabelText(/Current password/);
    const newPasswordInput = screen.getByLabelText(/New password/);
    const confirmPasswordInput = screen.getByLabelText(/Confirm new password/);
    const submitButton = screen.getByRole('button', { name: /Change Password/ });

    await user.type(currentPasswordInput, 'OldPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');
    await user.type(confirmPasswordInput, 'NewPassword123!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(passwordService.changePassword).toHaveBeenCalledWith(
        'OldPassword123!',
        'NewPassword123!'
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Password changed successfully!/)).toBeInTheDocument();
    });
  });

  it('should show error message on failure', async () => {
    const errorMessage = 'Current password is incorrect';
    (passwordService.changePassword as any).mockRejectedValue(new Error(errorMessage));

    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const currentPasswordInput = screen.getByLabelText(/Current password/);
    const newPasswordInput = screen.getByLabelText(/New password/);
    const confirmPasswordInput = screen.getByLabelText(/Confirm new password/);
    const submitButton = screen.getByRole('button', { name: /Change Password/ });

    await user.type(currentPasswordInput, 'WrongPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');
    await user.type(confirmPasswordInput, 'NewPassword123!');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to change password/)).toBeInTheDocument();
    });
  });

  it('should clear form on cancel', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const currentPasswordInput = screen.getByLabelText(/Current password/) as HTMLInputElement;
    const newPasswordInput = screen.getByLabelText(/New password/) as HTMLInputElement;
    const cancelButton = screen.getByRole('button', { name: /Cancel/ });

    await user.type(currentPasswordInput, 'OldPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');

    expect(currentPasswordInput.value).toBe('OldPassword123!');
    expect(newPasswordInput.value).toBe('NewPassword123!');

    await user.click(cancelButton);

    await waitFor(() => {
      expect(currentPasswordInput.value).toBe('');
      expect(newPasswordInput.value).toBe('');
    });
  });

  it('should display security tips', () => {
    render(<ChangePasswordPage />);

    expect(screen.getByText(/Security tips:/)).toBeInTheDocument();
    expect(
      screen.getByText(/Use a unique password that you do not use on other websites/)
    ).toBeInTheDocument();
  });

  it('should disable submit button when form is invalid', async () => {
    render(<ChangePasswordPage />);

    const submitButton = screen.getByRole('button', { name: /Change Password/ });
    expect(submitButton).toBeDisabled();
  });

  it('should enable submit button when form is valid', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const currentPasswordInput = screen.getByLabelText(/Current password/);
    const newPasswordInput = screen.getByLabelText(/New password/);
    const confirmPasswordInput = screen.getByLabelText(/Confirm new password/);
    const submitButton = screen.getByRole('button', { name: /Change Password/ });

    await user.type(currentPasswordInput, 'OldPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');
    await user.type(confirmPasswordInput, 'NewPassword123!');

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should show loading state during submission', async () => {
    (passwordService.changePassword as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const user = userEvent.setup();
    render(<ChangePasswordPage />);

    const currentPasswordInput = screen.getByLabelText(/Current password/);
    const newPasswordInput = screen.getByLabelText(/New password/);
    const confirmPasswordInput = screen.getByLabelText(/Confirm new password/);
    const submitButton = screen.getByRole('button', { name: /Change Password/ });

    await user.type(currentPasswordInput, 'OldPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');
    await user.type(confirmPasswordInput, 'NewPassword123!');
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });
});
