// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkItemDetailPage } from '../WorkItemDetailPage.js';
import {
  trackerApi,
  type WorkItemResponse,
} from '../../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../../stores/tracker/store.js';

const ITEM: WorkItemResponse = {
  id: 'wi-1',
  projectId: 'proj-1',
  key: 'TAM-42',
  previousKeys: [],
  number: 42,
  kind: 'story',
  status: 'ready',
  statusCategory: 'unstarted',
  priority: 'normal',
  issueType: 'feature',
  title: 'Original title',
  description: 'Original description',
  parentId: null,
  iterationId: null,
  rank: '0|hzzzzz:',
  siblingRank: '0|hzzzzz:',
  assigneeUserId: null,
  createdByUserId: null,
  estimate: 5,
  externalRef: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  closedAt: null,
  version: 7,
};

describe('WorkItemDetailPage (Story 44-6 Test 13 / AC5 / 44-2 AC3)', () => {
  beforeEach(() => {
    useTrackerStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inline_edit_sends_one_field (Test 13)', async () => {
    const user = userEvent.setup();
    vi.spyOn(trackerApi, 'getByKey').mockResolvedValue(ITEM);
    vi.spyOn(trackerApi, 'getSubtree').mockResolvedValue({
      rootId: ITEM.id,
      maxDepth: 6,
      items: [],
    });
    vi.spyOn(trackerApi, 'getTimeline').mockResolvedValue({
      workItemId: ITEM.id,
      issueId: ITEM.key,
      events: [],
      nextCursor: null,
      hasMore: false,
    });
    vi.spyOn(trackerApi, 'listIterations').mockResolvedValue([]);
    vi.spyOn(trackerApi, 'getAssignable').mockResolvedValue({
      members: [],
      source: 'audience-resolver',
    });

    const patchSpy = vi.spyOn(trackerApi, 'patchWorkItem').mockResolvedValue({
      ...ITEM,
      priority: 'urgent',
      version: 8,
    });

    render(
      <MemoryRouter initialEntries={['/work/TAM-42']}>
        <Routes>
          <Route path="/work/:key" element={<WorkItemDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Original title')).toBeInTheDocument();
    });

    // Change ONLY priority -> PATCH body MUST contain ONLY `{ priority: 'urgent' }`
    const prioritySelect = screen.getByLabelText('Priority');
    await user.selectOptions(prioritySelect, 'urgent');

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });

    const [id, patchBody, ifMatch] = patchSpy.mock.calls[0]!;
    expect(id).toBe('wi-1');
    expect(Object.keys(patchBody)).toEqual(['priority']);
    expect(patchBody).toEqual({ priority: 'urgent' });
    expect(ifMatch).toBe(7);
  });
});
