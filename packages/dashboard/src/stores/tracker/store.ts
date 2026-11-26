/**
 * Tracker Zustand Store (Story 44-6 AC9 / D3 / D5)
 *
 * Holds projects, keyset-paged work-item list, board projection, filters,
 * assignable members, iterations, and optimistic-drag rollback snapshots.
 */

import { create } from 'zustand';
import {
  trackerApi,
  TrackerApiError,
  type AssignableResponse,
  type BoardGroupBy,
  type BoardResponse,
  type CreateProjectRequest,
  type IterationResponse,
  type PatchProjectRequest,
  type ProjectResponse,
  type VisibilityMode,
  type WorkItemKind,
  type WorkItemResponse,
  type WorkItemStatus,
} from '../../services/tracker/tracker-api-client.js';

export interface WorkListFilters {
  projectId: string;
  statuses: WorkItemStatus[];
  kinds: WorkItemKind[];
  assigneeUserId: string;
  iterationId: string;
  q: string;
}

export interface BoardDragInput {
  itemId: string;
  fromColumnKey: string;
  toColumnKey: string;
  afterId: string | null;
  beforeId: string | null;
}

interface OptimisticSnapshot {
  previousBoard: BoardResponse;
}

export interface TrackerState {
  // Projects
  projects: ProjectResponse[];
  projectsLoading: boolean;
  projectsError: string | null;
  loadProjects: (includeArchived?: boolean) => Promise<void>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectResponse>;
  patchProject: (projectId: string, patch: PatchProjectRequest, version: number) => Promise<ProjectResponse>;
  deleteProject: (projectId: string, version: number) => Promise<void>;

  // Work-item list (keyset-paged)
  listItems: WorkItemResponse[];
  listNextCursor: string | null;
  listVisibilityMode: VisibilityMode | null;
  listLoading: boolean;
  listLoadingMore: boolean;
  listError: string | null;
  filters: WorkListFilters;
  setFilters: (patch: Partial<WorkListFilters>) => void;
  resetFilters: () => void;
  loadWorkItems: () => Promise<void>;
  loadMoreWorkItems: () => Promise<void>;

  // Board
  selectedProjectId: string | null;
  boardGroupBy: BoardGroupBy;
  boardIterationId: string;
  board: BoardResponse | null;
  boardLoading: boolean;
  boardError: string | null;
  boardNotice: string | null;
  columnLoading: Record<string, boolean>;
  inFlight: Record<string, OptimisticSnapshot>;
  setSelectedProjectId: (projectId: string | null) => void;
  setBoardGroupBy: (groupBy: BoardGroupBy) => void;
  setBoardIterationId: (iterationId: string) => void;
  dismissBoardNotice: () => void;
  loadBoard: (projectId?: string) => Promise<void>;
  loadMoreColumn: (columnKey: string) => Promise<void>;
  moveCardOnBoard: (input: BoardDragInput) => Promise<void>;

  // Assignable & iterations
  assignable: AssignableResponse | null;
  assignableLoading: boolean;
  assignableError: string | null;
  loadAssignable: () => Promise<void>;
  iterations: IterationResponse[];
  loadIterations: (projectId: string) => Promise<void>;

  reset: () => void;
}

const DEFAULT_FILTERS: WorkListFilters = {
  projectId: '',
  statuses: [],
  kinds: [],
  assigneeUserId: '',
  iterationId: '',
  q: '',
};

const INITIAL_DATA = {
  projects: [] as ProjectResponse[],
  projectsLoading: false,
  projectsError: null as string | null,

  listItems: [] as WorkItemResponse[],
  listNextCursor: null as string | null,
  listVisibilityMode: null as VisibilityMode | null,
  listLoading: false,
  listLoadingMore: false,
  listError: null as string | null,
  filters: { ...DEFAULT_FILTERS },

  selectedProjectId: null as string | null,
  boardGroupBy: 'status' as BoardGroupBy,
  boardIterationId: '',
  board: null as BoardResponse | null,
  boardLoading: false,
  boardError: null as string | null,
  boardNotice: null as string | null,
  columnLoading: {} as Record<string, boolean>,
  inFlight: {} as Record<string, OptimisticSnapshot>,

  assignable: null as AssignableResponse | null,
  assignableLoading: false,
  assignableError: null as string | null,
  iterations: [] as IterationResponse[],
};

function applyOptimisticBoardMove(
  board: BoardResponse,
  input: BoardDragInput,
): { nextBoard: BoardResponse; movedItem: WorkItemResponse } | null {
  let movedItem: WorkItemResponse | null = null;
  for (const col of board.columns) {
    const found = col.items.find((it) => it.id === input.itemId);
    if (found) {
      movedItem = found;
      break;
    }
  }
  if (!movedItem) return null;

  const isCrossColumn = input.fromColumnKey !== input.toColumnKey;
  const updatedItem: WorkItemResponse =
    isCrossColumn && board.groupBy === 'status'
      ? { ...movedItem, status: input.toColumnKey as WorkItemStatus }
      : movedItem;

  const nextColumns = board.columns.map((col) => {
    const withoutMoved = col.items.filter((it) => it.id !== input.itemId);
    const removedHere = withoutMoved.length !== col.items.length;

    if (col.key !== input.toColumnKey) {
      return removedHere
        ? { ...col, items: withoutMoved, totalCount: Math.max(0, col.totalCount - 1) }
        : col;
    }

    // Insert into target column according to (afterId, beforeId)
    const targetItems = [...withoutMoved];
    let insertIndex = targetItems.length;
    if (input.beforeId) {
      const idx = targetItems.findIndex((it) => it.id === input.beforeId);
      if (idx !== -1) insertIndex = idx;
    } else if (input.afterId) {
      const idx = targetItems.findIndex((it) => it.id === input.afterId);
      if (idx !== -1) insertIndex = idx + 1;
    }
    targetItems.splice(insertIndex, 0, updatedItem);

    return {
      ...col,
      items: targetItems,
      totalCount: isCrossColumn ? col.totalCount + 1 : col.totalCount,
    };
  });

  return {
    nextBoard: { ...board, columns: nextColumns },
    movedItem,
  };
}

function replaceItemInBoard(board: BoardResponse, updated: WorkItemResponse): BoardResponse {
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      items: col.items.map((it) => (it.id === updated.id ? updated : it)),
    })),
  };
}

export const useTrackerStore = create<TrackerState>((set, get) => ({
  ...INITIAL_DATA,

  // Projects
  loadProjects: async (includeArchived = false) => {
    set({ projectsLoading: true, projectsError: null });
    try {
      const projects = await trackerApi.listProjects(includeArchived);
      set((state) => ({
        projects,
        projectsLoading: false,
        selectedProjectId: state.selectedProjectId ?? projects[0]?.id ?? null,
      }));
    } catch (err) {
      set({
        projectsError: err instanceof Error ? err.message : 'Failed to load projects',
        projectsLoading: false,
      });
    }
  },

  createProject: async (request) => {
    const created = await trackerApi.createProject(request);
    set((state) => ({ projects: [...state.projects, created] }));
    return created;
  },

  patchProject: async (projectId, patch, version) => {
    const updated = await trackerApi.patchProject(projectId, patch, version);
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? updated : p)),
    }));
    return updated;
  },

  deleteProject: async (projectId, version) => {
    await trackerApi.deleteProject(projectId, version);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
    }));
  },

  // List
  setFilters: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },

  loadWorkItems: async () => {
    const { filters } = get();
    set({ listLoading: true, listError: null });
    try {
      const res = await trackerApi.listWorkItems({
        projectId: filters.projectId || undefined,
        status: filters.statuses.length > 0 ? filters.statuses : undefined,
        kind: filters.kinds.length > 0 ? filters.kinds : undefined,
        assigneeUserId: filters.assigneeUserId || undefined,
        iterationId: filters.iterationId || undefined,
        q: filters.q.trim() || undefined,
      });
      set({
        listItems: res.items,
        listNextCursor: res.nextCursor,
        listVisibilityMode: res.visibilityMode,
        listLoading: false,
      });
    } catch (err) {
      set({
        listError: err instanceof Error ? err.message : 'Failed to load work items',
        listLoading: false,
      });
    }
  },

  loadMoreWorkItems: async () => {
    const { filters, listNextCursor, listLoadingMore } = get();
    if (!listNextCursor || listLoadingMore) return;
    set({ listLoadingMore: true, listError: null });
    try {
      const res = await trackerApi.listWorkItems({
        projectId: filters.projectId || undefined,
        status: filters.statuses.length > 0 ? filters.statuses : undefined,
        kind: filters.kinds.length > 0 ? filters.kinds : undefined,
        assigneeUserId: filters.assigneeUserId || undefined,
        iterationId: filters.iterationId || undefined,
        q: filters.q.trim() || undefined,
        cursor: listNextCursor,
      });
      set((state) => ({
        listItems: [...state.listItems, ...res.items],
        listNextCursor: res.nextCursor,
        listVisibilityMode: res.visibilityMode,
        listLoadingMore: false,
      }));
    } catch (err) {
      set({
        listError: err instanceof Error ? err.message : 'Failed to load more work items',
        listLoadingMore: false,
      });
    }
  },

  // Board
  setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),
  setBoardGroupBy: (boardGroupBy) => set({ boardGroupBy }),
  setBoardIterationId: (boardIterationId) => set({ boardIterationId }),
  dismissBoardNotice: () => set({ boardNotice: null }),

  loadBoard: async (explicitProjectId) => {
    const state = get();
    const projectId = explicitProjectId ?? state.selectedProjectId;
    if (!projectId) {
      set({ board: null, boardLoading: false });
      return;
    }
    set({ boardLoading: true, boardError: null });
    try {
      const board = await trackerApi.getBoard(projectId, {
        groupBy: state.boardGroupBy,
        iterationId: state.boardIterationId || undefined,
      });
      set({ board, boardLoading: false, selectedProjectId: projectId });
    } catch (err) {
      set({
        boardError: err instanceof Error ? err.message : 'Failed to load board',
        boardLoading: false,
      });
    }
  },

  loadMoreColumn: async (columnKey) => {
    const { board, boardGroupBy, boardIterationId, columnLoading } = get();
    if (!board || columnLoading[columnKey]) return;
    const col = board.columns.find((c) => c.key === columnKey);
    if (!col || !col.hasMore || !col.nextCursor) return;

    set((state) => ({
      columnLoading: { ...state.columnLoading, [columnKey]: true },
    }));
    try {
      const page = await trackerApi.getBoard(board.projectId, {
        groupBy: boardGroupBy,
        iterationId: boardIterationId || undefined,
        column: columnKey,
        cursor: col.nextCursor,
      });
      const updatedCol = page.columns.find((c) => c.key === columnKey);
      set((state) => {
        if (!state.board || !updatedCol) {
          return { columnLoading: { ...state.columnLoading, [columnKey]: false } };
        }
        return {
          board: {
            ...state.board,
            columns: state.board.columns.map((c) => {
              if (c.key !== columnKey) return c;
              const existingIds = new Set(c.items.map((i) => i.id));
              const appended = updatedCol.items.filter((i) => !existingIds.has(i.id));
              return {
                ...c,
                items: [...c.items, ...appended],
                hasMore: updatedCol.hasMore,
                nextCursor: updatedCol.nextCursor,
              };
            }),
          },
          columnLoading: { ...state.columnLoading, [columnKey]: false },
        };
      });
    } catch (err) {
      set((state) => ({
        boardNotice: err instanceof Error ? err.message : `Failed to load more in ${columnKey}`,
        columnLoading: { ...state.columnLoading, [columnKey]: false },
      }));
    }
  },

  moveCardOnBoard: async (input) => {
    const currentBoard = get().board;
    if (!currentBoard) return;

    const applied = applyOptimisticBoardMove(currentBoard, input);
    if (!applied) return;

    const { nextBoard, movedItem } = applied;
    const isCrossColumn = input.fromColumnKey !== input.toColumnKey;

    set((state) => ({
      board: nextBoard,
      boardNotice: null,
      inFlight: {
        ...state.inFlight,
        [input.itemId]: { previousBoard: currentBoard },
      },
    }));

    try {
      let serverItem: WorkItemResponse;
      if (isCrossColumn) {
        serverItem = await trackerApi.setStatus(
          input.itemId,
          input.toColumnKey as WorkItemStatus,
          movedItem.version,
        );
      } else {
        serverItem = await trackerApi.move(
          input.itemId,
          { afterId: input.afterId, beforeId: input.beforeId },
          movedItem.version,
        );
      }

      set((state) => {
        const rest = { ...state.inFlight };
        delete rest[input.itemId];
        return {
          board: state.board ? replaceItemInBoard(state.board, serverItem) : state.board,
          inFlight: rest,
        };
      });
    } catch (err) {
      const snapshot = get().inFlight[input.itemId];
      const isConflict = err instanceof TrackerApiError && err.status === 409;
      const notice = isConflict
        ? `Conflict updating ${movedItem.key}: another change landed first. The card was restored to server state.`
        : err instanceof Error
          ? `Failed to update ${movedItem.key}: ${err.message}`
          : `Failed to update ${movedItem.key}`;

      set((state) => {
        const rest = { ...state.inFlight };
        delete rest[input.itemId];
        return {
          board: snapshot ? snapshot.previousBoard : state.board,
          boardNotice: notice,
          inFlight: rest,
        };
      });

      if (isConflict) {
        // Refresh from server truth in background (D5: rollback + refetch, never retry)
        void trackerApi
          .getBoard(currentBoard.projectId, {
            groupBy: currentBoard.groupBy,
            iterationId: get().boardIterationId || undefined,
          })
          .then((freshBoard) => {
            set({ board: freshBoard });
          })
          .catch(() => {
            // Previous snapshot already restored; notice remains visible.
          });
      }
    }
  },

  // Assignable & iterations
  loadAssignable: async () => {
    set({ assignableLoading: true, assignableError: null });
    try {
      const assignable = await trackerApi.getAssignable();
      set({ assignable, assignableLoading: false });
    } catch (err) {
      set({
        assignableError: err instanceof Error ? err.message : 'Failed to load assignable members',
        assignableLoading: false,
      });
    }
  },

  loadIterations: async (projectId) => {
    try {
      const iterations = await trackerApi.listIterations(projectId);
      set({ iterations });
    } catch {
      set({ iterations: [] });
    }
  },

  reset: () => set({ ...INITIAL_DATA, filters: { ...DEFAULT_FILTERS }, columnLoading: {}, inFlight: {} }),
}));
