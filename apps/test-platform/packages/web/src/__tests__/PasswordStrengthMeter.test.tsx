import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';

describe('PasswordStrengthMeter', () => {
  it('should not render when password is empty', () => {
    const { container } = render(<PasswordStrengthMeter password="" />);
    expect(container.firstChild).toBeNull();
  });

  it('should show "Weak" for passwords with few requirements met', () => {
    render(<PasswordStrengthMeter password="abc" />);
    expect(screen.getByText('Weak')).toBeInTheDocument();
  });

  it('should show "Fair" for passwords with 3 requirements met', () => {
    render(<PasswordStrengthMeter password="Abc123" />);
    expect(screen.getByText('Fair')).toBeInTheDocument();
  });

  it('should show "Good" for passwords with 4 requirements met', () => {
    render(<PasswordStrengthMeter password="Abc123456789" />);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('should show "Strong" for passwords meeting all requirements', () => {
    render(<PasswordStrengthMeter password="Abc123456789!" />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('should display password strength label', () => {
    render(<PasswordStrengthMeter password="test" />);
    expect(screen.getByText('Password strength:')).toBeInTheDocument();
  });

  it('should apply correct color classes based on strength', () => {
    const { rerender } = render(<PasswordStrengthMeter password="weak" />);
    let strengthText = screen.getByText('Weak');
    expect(strengthText).toHaveClass('text-red-600');

    rerender(<PasswordStrengthMeter password="Abc123" />);
    strengthText = screen.getByText('Fair');
    expect(strengthText).toHaveClass('text-yellow-600');

    rerender(<PasswordStrengthMeter password="Abc123456789" />);
    strengthText = screen.getByText('Good');
    expect(strengthText).toHaveClass('text-blue-600');

    rerender(<PasswordStrengthMeter password="Abc123456789!" />);
    strengthText = screen.getByText('Strong');
    expect(strengthText).toHaveClass('text-green-600');
  });
});
