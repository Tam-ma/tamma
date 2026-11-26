// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkBoardPage } from '../WorkBoardPage.js';
import {
  trackerApi,
  TrackerApiError,
  type BoardResponse,
  type ProjectResponse,
  type WorkItemResponse,
} from '../../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../../stores/tracker/store.js';

const PROJECT: ProjectResponse = {
  id: 'proj-1',
  key: 'TAM',
  name: 'Tamma Core',
  description: null,
  repositoryId: null,
  estimateScale: 'fibonacci',
  nextNumber: 5,
  archivedAt: null,
  createdByUserId: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  version: 1,
  automationMode: 'off',
};

function makeItem(overrides: Partial<WorkItemResponse> & { id: string; key: string; title: string }): WorkItemResponse {
  return {
    projectId: PROJECT.id,
    previousKeys: [],
    number: 1,
    kind: 'task',
    status: 'backlog',
    statusCategory: 'backlog',
    priority: 'normal',
    issueType: 'feature',
    description: null,
    parentId: null,
    iterationId: null,
    rank: '0|hzzzzz:',
    siblingRank: '0|hzzzzz:',
    assigneeUserId: null,
    createdByUserId: null,
    estimate: null,
    externalRef: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    version: 2,
    ...overrides,
  };
}

function makeSevenColumnBoard(): BoardResponse {
  return {
    projectId: PROJECT.id,
    groupBy: 'status',
    perColumnLimit: 25,
    columnCap: null,
    foldedColumnCount: 0,
    columns: [
      {
        key: 'triage',
        label: 'Triage',
        items: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
      },
      {
        key: 'backlog',
        label: 'Backlog',
        items: [
          makeItem({ id: 'item-1', key: 'TAM-1', title: 'First backlog card', status: 'backlog' }),
          makeItem({ id: 'item-2', key: 'TAM-2', title: 'Second backlog card', status: 'backlog' }),
        ],
        totalCount: 2,
        hasMore: false,
        nextCursor: null,
      },
      {
        key: 'ready',
        label: 'Ready',
        items: [makeItem({ id: 'item-3', key: 'TAM-3', title: 'Ready card', status: 'ready' })],
        totalCount: 1,
        hasMore: false,
        nextCursor: null,
      },
      {
        key: 'in_progress',
        label: 'In Progress',
        items: [
          makeItem({ id: 'item-4', key: 'TAM-4', title: 'Active card', status: 'in_progress' }),
        ],
        totalCount: 1,
        hasMore: false,
        nextCursor: null,
      },
      {
        key: 'in_review',
        label: 'In Review',
        items: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
      },
      {
        key: 'blocked',
        label: 'Blocked',
        items: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
      },
      {
        key: 'done',
        label: 'Done',
        items: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
      },
    ],
  };
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/work/board']}>
      <WorkBoardPage />
    </MemoryRouter>,
  );
}

describe('WorkBoardPage (Story 44-6 Tests 5, 6, 7, 8)', () => {
  beforeEach(() => {
    useTrackerStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders_all_columns_including_empty_ones (Test 5 / AC3 / D4)', async () => {
    vi.spyOn(trackerApi, 'listProjects').mockResolvedValue([PROJECT]);
    vi.spyOn(trackerApi, 'getBoard').mockResolvedValue(makeSevenColumnBoard());

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId('board-column-triage')).toBeInTheDocument();
    });

    for (const key of ['triage', 'backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'done']) {
      expect(screen.getByTestId(`board-column-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('board-column-count-triage')).toHaveTextContent('0');
    expect(screen.getByTestId('board-column-count-backlog')).toHaveTextContent('2');
    expect(screen.getByTestId('board-column-count-done')).toHaveTextContent('0');
  });

  it('409_reverts_the_card (Test 6 / AC4 / D5)', async () => {
    const initialBoard = makeSevenColumnBoard();
    vi.spyOn(trackerApi, 'listProjects').mockResolvedValue([PROJECT]);
    const getBoardSpy = vi.spyOn(trackerApi, 'getBoard').mockResolvedValue(initialBoard);
    const setStatusSpy = vi
      .spyOn(trackerApi, 'setStatus')
      .mockRejectedValue(
        new TrackerApiError(409, 'Version conflict', {
          code: 'TRACKER.CONCURRENCY_CONFLICT',
          retryable: true,
        }),
      );

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId('board-card-item-1')).toBeInTheDocument();
    });

    // Simulate optimistic cross-column drag of item-1 from backlog -> in_progress
    await act(async () => {
      await useTrackerStore.getState().moveCardOnBoard({
        itemId: 'item-1',
        fromColumnKey: 'backlog',
        toColumnKey: 'in_progress',
        afterId: null,
        beforeId: null,
      });
    });

    expect(setStatusSpy).toHaveBeenCalledWith('item-1', 'in_progress', 2);

    // Card MUST be back in origin column (backlog), NOT in in_progress, and NOT duplicated
    await waitFor(() => {
      expect(screen.getByTestId('board-notice')).toHaveTextContent(/Conflict updating TAM-1/i);
    });

    const backlogCol = screen.getByTestId('board-column-backlog');
    const inProgressCol = screen.getByTestId('board-column-in_progress');
    expect(within(backlogCol).getByTestId('board-card-item-1')).toBeInTheDocument();
    expect(within(inProgressCol).queryByTestId('board-card-item-1')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('board-card-item-1')).toHaveLength(1);
    // D5: background refetch issued after rollback
    expect(getBoardSpy).toHaveBeenCalledTimes(2);
  });

  it('cross_column_drag_calls_status_and_within_column_calls_move (Test 7 / AC3)', async () => {
    vi.spyOn(trackerApi, 'listProjects').mockResolvedValue([PROJECT]);
    vi.spyOn(trackerApi, 'getBoard').mockResolvedValue(makeSevenColumnBoard());

    const movedCard = makeItem({
      id: 'item-1',
      key: 'TAM-1',
      title: 'First backlog card',
      status: 'backlog',
      version: 3,
    });
    const statusCard = makeItem({
      id: 'item-1',
      key: 'TAM-1',
      title: 'First backlog card',
      status: 'ready',
      version: 4,
    });

    const moveSpy = vi.spyOn(trackerApi, 'move').mockResolvedValue(movedCard);
    const statusSpy = vi.spyOn(trackerApi, 'setStatus').mockResolvedValue(statusCard);

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId('board-card-item-1')).toBeInTheDocument();
    });

    // Within-column drag -> POST /api/work-items/{id}/move
    await act(async () => {
      await useTrackerStore.getState().moveCardOnBoard({
        itemId: 'item-1',
        fromColumnKey: 'backlog',
        toColumnKey: 'backlog',
        afterId: 'item-2',
        beforeId: null,
      });
    });

    expect(moveSpy).toHaveBeenCalledWith('item-1', { afterId: 'item-2', beforeId: null }, 2);
    expect(statusSpy).not.toHaveBeenCalled();

    // Cross-column drag -> POST /api/work-items/{id}/status with updated version 3
    await act(async () => {
      await useTrackerStore.getState().moveCardOnBoard({
        itemId: 'item-1',
        fromColumnKey: 'backlog',
        toColumnKey: 'ready',
        afterId: null,
        beforeId: null,
      });
    });

    expect(statusSpy).toHaveBeenCalledWith('item-1', 'ready', 3);
  });

  it('assignee_board_shows_the_cap (Test 8 / D4)', async () => {
    const assigneeBoard: BoardResponse = {
      projectId: PROJECT.id,
      groupBy: 'assignee',
      perColumnLimit: 25,
      columnCap: 30,
      foldedColumnCount: 4,
      columns: [
        {
          key: 'user-1',
          label: 'user-1',
          items: [makeItem({ id: 'item-1', key: 'TAM-1', title: 'Assigned task', assigneeUserId: 'user-1' })],
          totalCount: 1,
          hasMore: false,
          nextCursor: null,
        },
        {
          key: 'other',
          label: 'Other',
          items: [makeItem({ id: 'item-2', key: 'TAM-2', title: 'Folded task', assigneeUserId: 'user-99' })],
          totalCount: 4,
          hasMore: false,
          nextCursor: null,
        },
      ],
    };

    vi.spyOn(trackerApi, 'listProjects').mockResolvedValue([PROJECT]);
    vi.spyOn(trackerApi, 'getBoard').mockResolvedValue(assigneeBoard);

    useTrackerStore.getState().setBoardGroupBy('assignee');
    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId('board-column-other')).toBeInTheDocument();
    });

    const note = screen.getByTestId('assignee-board-cap-note');
    expect(note).toHaveTextContent(/top 30 assignees/i);
    expect(note).toHaveTextContent(/4 additional assignee/i);
  });
});
