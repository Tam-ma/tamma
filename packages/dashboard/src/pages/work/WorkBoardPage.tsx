/**
 * WorkBoardPage — `/work/board` cross-container Kanban board
 * (Story 44-6 AC1 / AC3 / AC4 / AC12 / D4 / D5 / D7 / D8 / D12).
 *
 * - Renders the server's columns verbatim, including empty ones (D4).
 * - Cross-container drag calls `POST /api/work-items/{id}/status`;
 *   within-column drag calls `POST /api/work-items/{id}/move` with `(afterId, beforeId)`.
 * - Optimistic drag with 409 rollback to server truth + non-blocking notice (D5).
 * - Per-column keyset "Load more" using column `nextCursor`.
 * - Keyboard drag-and-drop AND non-pointer status selector on each card (AC12).
 * - Refetches on window focus; no SignalR (D12).
 */

import { useCallback, useEffect, useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  BoardCard,
  BoardColumn,
  BoardDragContext,
  type BoardColumnDescriptor,
  type BoardDropResult,
} from '../../components/common/board/index.js';
import { EmptyState } from '../../components/monitoring/EmptyState.js';
import { ErrorBanner } from '../../components/monitoring/ErrorBanner.js';
import {
  BOARD_GROUP_BY_OPTIONS,
  formatKindLabel,
  formatPriorityLabel,
  formatStatusLabel,
  WORK_ITEM_STATUSES,
} from '../../components/work/work-format.js';
import type { BoardGroupBy, WorkItemResponse, WorkItemStatus } from '../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../stores/tracker/store.js';

const SELECT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';

export function WorkBoardPage(): JSX.Element {
  const projects = useTrackerStore((s) => s.projects);
  const selectedProjectId = useTrackerStore((s) => s.selectedProjectId);
  const boardGroupBy = useTrackerStore((s) => s.boardGroupBy);
  const board = useTrackerStore((s) => s.board);
  const boardLoading = useTrackerStore((s) => s.boardLoading);
  const boardError = useTrackerStore((s) => s.boardError);
  const boardNotice = useTrackerStore((s) => s.boardNotice);
  const columnLoading = useTrackerStore((s) => s.columnLoading);

  const loadProjects = useTrackerStore((s) => s.loadProjects);
  const setSelectedProjectId = useTrackerStore((s) => s.setSelectedProjectId);
  const setBoardGroupBy = useTrackerStore((s) => s.setBoardGroupBy);
  const dismissBoardNotice = useTrackerStore((s) => s.dismissBoardNotice);
  const loadBoard = useTrackerStore((s) => s.loadBoard);
  const loadMoreColumn = useTrackerStore((s) => s.loadMoreColumn);
  const moveCardOnBoard = useTrackerStore((s) => s.moveCardOnBoard);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      void loadBoard(selectedProjectId);
    }
  }, [selectedProjectId, boardGroupBy, loadBoard]);

  // D12: polling-on-focus rather than SignalR until audience resolver lands.
  useEffect(() => {
    const onFocus = (): void => {
      if (selectedProjectId) {
        void loadBoard(selectedProjectId);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedProjectId, loadBoard]);

  const itemLookup = useMemo(() => {
    const map = new Map<string, WorkItemResponse>();
    for (const col of board?.columns ?? []) {
      for (const item of col.items) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [board]);

  const columnDescriptors = useMemo<BoardColumnDescriptor[]>(
    () =>
      (board?.columns ?? []).map((col) => ({
        key: col.key,
        itemIds: col.items.map((it) => it.id),
      })),
    [board],
  );

  const handleDragEnd = useCallback(
    (result: BoardDropResult) => {
      void moveCardOnBoard(result);
    },
    [moveCardOnBoard],
  );

  const handleDirectStatusChange = useCallback(
    (item: WorkItemResponse, nextStatus: WorkItemStatus) => {
      if (item.status === nextStatus) return;
      void moveCardOnBoard({
        itemId: item.id,
        fromColumnKey: item.status,
        toColumnKey: nextStatus,
        afterId: null,
        beforeId: null,
      });
    },
    [moveCardOnBoard],
  );

  const renderOverlay = useCallback(
    (activeId: string) => {
      const item = itemLookup.get(activeId);
      if (!item) return null;
      return (
        <div className="w-64 rounded-md border border-blue-400 bg-white p-3 shadow-lg dark:border-blue-500 dark:bg-gray-900">
          <div className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">
            {item.key}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {item.title}
          </div>
        </div>
      );
    },
    [itemLookup],
  );

  const showAssigneeCapNote =
    board?.groupBy === 'assignee' &&
    (board.columnCap !== null || board.foldedColumnCount > 0);

  return (
    <div className="mx-auto max-w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Work Board</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Drag cards across columns to change status, or reorder within a column.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Board project"
            value={selectedProjectId ?? ''}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className={SELECT_CLASS}
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} — {p.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Group board by"
            value={boardGroupBy}
            onChange={(e) => setBoardGroupBy(e.target.value as BoardGroupBy)}
            className={SELECT_CLASS}
          >
            {BOARD_GROUP_BY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Group by: {opt.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void loadBoard()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Refresh
          </button>

          <Link
            to="/work"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            List View
          </Link>
        </div>
      </div>

      {boardNotice && (
        <div
          role="status"
          data-testid="board-notice"
          className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
        >
          <span>{boardNotice}</span>
          <button
            type="button"
            onClick={dismissBoardNotice}
            aria-label="Dismiss notice"
            className="rounded px-2 py-0.5 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50"
          >
            Dismiss
          </button>
        </div>
      )}

      {showAssigneeCapNote && board && (
        <div
          role="note"
          data-testid="assignee-board-cap-note"
          className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
        >
          Assignee board is capped at the top {board.columnCap ?? 30} assignees
          {board.foldedColumnCount > 0
            ? ` — ${board.foldedColumnCount} additional assignee(s) folded into "Other".`
            : '.'}
        </div>
      )}

      {boardError && (
        <div className="mb-4">
          <ErrorBanner message={boardError} onRetry={() => void loadBoard()} />
        </div>
      )}

      {boardLoading && !board && !boardError && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading board…</p>
      )}

      {!boardLoading && !board && !boardError && (
        <EmptyState
          title="Select a project"
          description="Choose a project above or create one under Work Projects to view its board."
        />
      )}

      {board && (
        <BoardDragContext
          columns={columnDescriptors}
          onDragEnd={handleDragEnd}
          renderOverlay={renderOverlay}
        >
          <div
            data-testid="work-board-columns"
            className="flex gap-4 overflow-x-auto pb-4"
          >
            {board.columns.map((col) => (
              <BoardColumn
                key={col.key}
                columnKey={col.key}
                label={col.label}
                totalCount={col.totalCount}
                itemIds={col.items.map((it) => it.id)}
                hasMore={col.hasMore}
                loadingMore={Boolean(columnLoading[col.key])}
                onLoadMore={() => void loadMoreColumn(col.key)}
              >
                {col.items.map((item) => (
                  <BoardCard
                    key={item.id}
                    itemId={item.id}
                    columnKey={col.key}
                    ariaLabel={`${item.key}: ${item.title}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={`/work/${encodeURIComponent(item.key)}`}
                        className="font-mono text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
                      >
                        {item.key}
                      </Link>
                      <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {formatKindLabel(item.kind)}
                      </span>
                    </div>

                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                      {item.title}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>Priority: {formatPriorityLabel(item.priority)}</span>
                      {board.groupBy === 'status' && (
                        <select
                          aria-label={`Change status for ${item.key}`}
                          value={item.status}
                          onChange={(e) =>
                            handleDirectStatusChange(item, e.target.value as WorkItemStatus)
                          }
                          className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                          {WORK_ITEM_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {formatStatusLabel(s)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </BoardCard>
                ))}
              </BoardColumn>
            ))}
          </div>
        </BoardDragContext>
      )}
    </div>
  );
}
