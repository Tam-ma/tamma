// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { AssigneePicker } from '../AssigneePicker.js';
import type { AssignableResponse } from '../../../services/tracker/tracker-api-client.js';

describe('AssigneePicker (Story 44-6 Tests 11 & 12 / AC7 / D10)', () => {
  it('membership_fallback_is_labelled_and_non_empty (Test 11)', () => {
    const assignable: AssignableResponse = {
      source: 'tenant-membership',
      members: [
        { userId: 'u-alice', role: 'admin' },
        { userId: 'u-bob', role: 'member' },
      ],
    };

    render(<AssigneePicker value={null} onChange={vi.fn()} assignable={assignable} />);

    // Picker is populated with all tenant members plus Unassigned
    const select = screen.getByLabelText('Assignee');
    expect(select.querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /u-alice/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /u-bob/i })).toBeInTheDocument();

    // Degradation note explicitly explains repo-scoped eligibility is not configured
    const note = screen.getByTestId('assignee-source-note');
    expect(note).toHaveTextContent(/repo-scoped eligibility is not yet configured/i);
  });

  it('resolver_source_shows_no_note (Test 12)', () => {
    const assignable: AssignableResponse = {
      source: 'audience-resolver',
      members: [{ userId: 'u-alice', role: 'admin' }],
    };

    render(<AssigneePicker value="u-alice" onChange={vi.fn()} assignable={assignable} />);

    expect(screen.getByRole('option', { name: /u-alice/i })).toBeInTheDocument();
    expect(screen.queryByTestId('assignee-source-note')).not.toBeInTheDocument();
  });
});
