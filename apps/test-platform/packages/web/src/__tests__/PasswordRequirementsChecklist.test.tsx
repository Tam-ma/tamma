import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PasswordRequirementsChecklist } from '@/components/auth/PasswordRequirementsChecklist';

describe('PasswordRequirementsChecklist', () => {
  it('should not render when password is empty', () => {
    const { container } = render(<PasswordRequirementsChecklist password="" />);
    expect(container.firstChild).toBeNull();
  });

  it('should render all requirements when password is provided', () => {
    render(<PasswordRequirementsChecklist password="a" />);

    expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument();
    expect(screen.getByText(/Uppercase letter/)).toBeInTheDocument();
    expect(screen.getByText(/Lowercase letter/)).toBeInTheDocument();
    expect(screen.getByText(/Number/)).toBeInTheDocument();
    expect(screen.getByText(/Special character/)).toBeInTheDocument();
  });

  it('should show check icon for met requirements', () => {
    render(<PasswordRequirementsChecklist password="abcdefghijklm" />);

    const checkIcons = screen.getAllByLabelText('Requirement met');
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  it('should show X icon for unmet requirements', () => {
    render(<PasswordRequirementsChecklist password="a" />);

    const xIcons = screen.getAllByLabelText('Requirement not met');
    expect(xIcons.length).toBeGreaterThan(0);
  });

  it('should validate minimum length requirement', () => {
    const { rerender } = render(<PasswordRequirementsChecklist password="short" />);
    let requirement = screen.getByText(/At least 12 characters/);
    expect(requirement).toHaveClass('text-gray-500');

    rerender(<PasswordRequirementsChecklist password="verylongpassword" />);
    requirement = screen.getByText(/At least 12 characters/);
    expect(requirement).toHaveClass('text-green-600');
  });

  it('should validate uppercase letter requirement', () => {
    const { rerender } = render(<PasswordRequirementsChecklist password="lowercase" />);
    let requirement = screen.getByText(/Uppercase letter/);
    expect(requirement).toHaveClass('text-gray-500');

    rerender(<PasswordRequirementsChecklist password="Uppercase" />);
    requirement = screen.getByText(/Uppercase letter/);
    expect(requirement).toHaveClass('text-green-600');
  });

  it('should validate lowercase letter requirement', () => {
    const { rerender } = render(<PasswordRequirementsChecklist password="UPPERCASE" />);
    let requirement = screen.getByText(/Lowercase letter/);
    expect(requirement).toHaveClass('text-gray-500');

    rerender(<PasswordRequirementsChecklist password="lowercase" />);
    requirement = screen.getByText(/Lowercase letter/);
    expect(requirement).toHaveClass('text-green-600');
  });

  it('should validate number requirement', () => {
    const { rerender } = render(<PasswordRequirementsChecklist password="noNumber" />);
    let requirement = screen.getByText(/Number/);
    expect(requirement).toHaveClass('text-gray-500');

    rerender(<PasswordRequirementsChecklist password="hasNumber123" />);
    requirement = screen.getByText(/Number/);
    expect(requirement).toHaveClass('text-green-600');
  });

  it('should validate special character requirement', () => {
    const { rerender } = render(<PasswordRequirementsChecklist password="noSpecial" />);
    let requirement = screen.getByText(/Special character/);
    expect(requirement).toHaveClass('text-gray-500');

    rerender(<PasswordRequirementsChecklist password="hasSpecial!" />);
    requirement = screen.getByText(/Special character/);
    expect(requirement).toHaveClass('text-green-600');
  });

  it('should display title text', () => {
    render(<PasswordRequirementsChecklist password="test" />);
    expect(screen.getByText('Password requirements:')).toBeInTheDocument();
  });

  it('should mark all requirements as met for strong password', () => {
    render(<PasswordRequirementsChecklist password="StrongPassword123!" />);

    const checkIcons = screen.getAllByLabelText('Requirement met');
    expect(checkIcons).toHaveLength(5);
  });
});
