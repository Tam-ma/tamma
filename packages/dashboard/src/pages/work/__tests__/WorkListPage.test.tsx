// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WorkListPage } from '../WorkListPage.js';
import {
  trackerApi,
  type WorkItemResponse,
} from '../../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../../stores/tracker/store.js';

function makeItem(id: string, key: string, title: string): WorkItemResponse {
  return {
    id,
    projectId: 'proj-1',
    key,
    previousKeys: [],
    number: 1,
    kind: 'story',
    status: 'ready',
    statusCategory: 'unstarted',
    priority: 'high',
    issueType: 'feature',
    title,
    description: null,
    parentId: null,
    iterationId: null,
    rank: '0|hzzzzz:',
    siblingRank: '0|hzzzzz:',
    assigneeUserId: null,
    createdByUserId: null,
    estimate: 3,
    externalRef: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    version: 1,
  };
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/work']}>
      <WorkListPage />
    </MemoryRouter>,
  );
}

describe('WorkListPage (Story 44-6 Tests 9 & 10)', () => {
  beforeEach(() => {
    useTrackerStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keyset_paging_uses_the_cursor (Test 9 / AC2)', async () => {
    const user = userEvent.setup();
    vi.spyOn(trackerApi, 'listProjects').mockResolvedValue([]);
    vi.spyOn(trackerApi, 'getAssignable').mockResolvedValue({
      members: [],
      source: 'audience-resolver',
    });

    const listSpy = vi
      .spyOn(trackerApi, 'listWorkItems')
      .mockResolvedValueOnce({
        items: [makeItem('id-1', 'TAM-1', 'Page one item')],
        nextCursor: 'cursor-page-2',
        visibilityMode: 'per-user',
      })
      .mockResolvedValueOnce({
        items: [makeItem('id-2', 'TAM-2', 'Page two item')],
        nextCursor: null,
        visibilityMode: 'per-user',
      });

    renderList();

    await waitFor(() => {
      expect(screen.getByText('Page one item')).toBeInTheDocument();
    });

    const loadMoreBtn = screen.getByTestId('work-list-load-more');
    await user.click(loadMoreBtn);

    await waitFor(() => {
      expect(screen.getByText('Page two item')).toBeInTheDocument();
    });

    expect(listSpy).toHaveBeenCalledTimes(2);
    const firstArgs = listSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondArgs = listSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(firstArgs).not.toHaveProperty('offset');
    expect(secondArgs).not.toHaveProperty('offset');
    expect(secondArgs.cursor).toBe('cursor-page-2');
  });

  it('tenant_visibility_note_is_shown (Test 10 / AC7 / D10)', async () => {
    vi.spyOn(trackerApi, 'listProjects').mockResolvedValue([]);
    vi.spyOn(trackerApi, 'getAssignable').mockResolvedValue({
      members: [],
      source: 'audience-resolver',
    });
    vi.spyOn(trackerApi, 'listWorkItems').mockResolvedValue({
      items: [makeItem('id-1', 'TAM-1', 'Tenant visible item')],
      nextCursor: null,
      visibilityMode: 'tenant',
    });

    renderList();

    await waitFor(() => {
      expect(screen.getByTestId('tenant-visibility-note')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tenant-visibility-note')).toHaveTextContent(/tenant-wide view/i);
  });
});
