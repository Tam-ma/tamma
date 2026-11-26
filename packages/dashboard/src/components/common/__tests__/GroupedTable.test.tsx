// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupedTable, type TableGroup } from '../GroupedTable.js';
import type { DataTableColumn } from '../../monitoring/DataTable.js';

interface SampleRow {
  id: string;
  title: string;
}

const COLUMNS: DataTableColumn<SampleRow>[] = [
  { key: 'id', header: 'ID', accessor: (r) => r.id },
  { key: 'title', header: 'Title', accessor: (r) => r.title },
];

const GROUPS: TableGroup<SampleRow>[] = [
  {
    key: 'ready',
    label: 'Ready',
    count: 2,
    rows: [
      { id: 'TAM-1', title: 'First task' },
      { id: 'TAM-2', title: 'Second task' },
    ],
  },
  {
    key: 'blocked',
    label: 'Blocked',
    count: 0,
    rows: [],
  },
];

describe('GroupedTable (Story 44-6 Test 1)', () => {
  it('renders groups with headers and counts, collapses rows, and preserves empty groups', async () => {
    const user = userEvent.setup();
    render(
      <GroupedTable
        columns={COLUMNS}
        groups={GROUPS}
        getRowId={(r) => r.id}
        emptyGroupMessage="Nothing blocked"
      />,
    );

    // Headers + counts render for both populated and empty groups
    expect(screen.getByTestId('grouped-table-group-ready')).toBeInTheDocument();
    expect(screen.getByTestId('grouped-table-count-ready')).toHaveTextContent('2');
    expect(screen.getByTestId('grouped-table-group-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('grouped-table-count-blocked')).toHaveTextContent('0');

    // Populated rows and empty group placeholder render
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
    expect(screen.getByTestId('grouped-table-empty-blocked')).toHaveTextContent('Nothing blocked');

    // Collapsing "Ready" hides its rows
    const readyButton = screen.getByRole('button', { name: /Ready/i });
    expect(readyButton).toHaveAttribute('aria-expanded', 'true');
    await user.click(readyButton);
    expect(readyButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('First task')).not.toBeInTheDocument();
    expect(screen.queryByText('Second task')).not.toBeInTheDocument();

    // Expanding brings them back
    await user.click(readyButton);
    expect(screen.getByText('First task')).toBeInTheDocument();
  });
});
