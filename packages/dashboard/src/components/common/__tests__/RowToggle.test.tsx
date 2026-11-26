// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowToggle } from '../RowToggle.js';

describe('RowToggle (Story 44-6 Test 2)', () => {
  it('toggles aria-expanded, mounts/unmounts expanded slot, and activates via keyboard', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <RowToggle label="Expand TAM-1" controlsId="row-tam-1" onToggle={onToggle}>
        <span>Child item details</span>
      </RowToggle>,
    );

    const button = screen.getByRole('button', { name: 'Expand TAM-1' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'row-tam-1');
    expect(screen.queryByText('Child item details')).not.toBeInTheDocument();

    // Keyboard activation (Enter) expands and mounts slot
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Child item details')).toBeInTheDocument();
    expect(onToggle).toHaveBeenCalledWith(true);

    // Keyboard activation (Space) collapses and unmounts slot
    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Child item details')).not.toBeInTheDocument();
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });
});
