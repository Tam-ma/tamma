// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkItemTimeline } from '../WorkItemTimeline.js';
import type { WorkItemTimelineEventResponse } from '../../../services/tracker/tracker-api-client.js';

const EVENTS: WorkItemTimelineEventResponse[] = [
  {
    id: 'evt-1',
    sequenceNumber: 10,
    type: 'WORKITEM.STATUS_CHANGED.SUCCESS',
    createdAt: '2026-11-26T10:00:00Z',
    tags: { issueId: 'TAM-42' },
    metadata: {},
    data: { from: 'ready', to: 'in_progress', actor: 'loop' },
  },
  {
    id: 'evt-2',
    sequenceNumber: 11,
    type: 'DOCUMENT.ACCEPTED',
    createdAt: '2026-11-26T10:05:00Z',
    tags: { issueId: 'TAM-42' },
    metadata: { workflowInstanceId: 'wf-run-99' },
    data: { documentType: 'ImplementationPlan' },
  },
];

describe('WorkItemTimeline (Story 44-6 Test 14 / AC5 / D9)', () => {
  it('foreign_families_are_labelled_and_read_only', () => {
    render(
      <MemoryRouter>
        <WorkItemTimeline events={EVENTS} issueId="TAM-42" />
      </MemoryRouter>,
    );

    const trackerRow = screen.getByTestId('timeline-event-evt-1');
    expect(trackerRow).toHaveAttribute('data-event-family', 'tracker');
    expect(trackerRow).toHaveTextContent('ready → in_progress (by loop)');
    expect(within(trackerRow).queryByText(/Workflow activity/i)).not.toBeInTheDocument();

    const foreignRow = screen.getByTestId('timeline-event-evt-2');
    expect(foreignRow).toHaveAttribute('data-event-family', 'workflow');
    expect(within(foreignRow).getByTestId('workflow-activity-badge-evt-2')).toHaveTextContent(
      'Workflow activity',
    );
    expect(foreignRow).toHaveTextContent('DOCUMENT.ACCEPTED');
    // Read-only: zero buttons / mutation affordances inside foreign event rows
    expect(within(foreignRow).queryAllByRole('button')).toHaveLength(0);
    // Deep link to workflow run when workflowInstanceId is present
    expect(within(foreignRow).getByRole('link', { name: /View workflow run/i })).toHaveAttribute(
      'href',
      '/runs/wf-run-99',
    );
  });
});
