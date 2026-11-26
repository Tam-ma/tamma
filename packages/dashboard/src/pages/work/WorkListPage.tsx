/**
 * WorkListPage — `/work` keyset-paged list of tracker work items
 * (Story 44-6 AC1 / AC2 / AC7 / D10).
 *
 * Reuses `DataTable` with keyset cursor paging (never offset), multi-axis
 * filters, and honest visibility-mode notice when `visibilityMode === 'tenant'`.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/monitoring/DataTable.js';
import { EmptyState } from '../../components/monitoring/EmptyState.js';
import { ErrorBanner } from '../../components/monitoring/ErrorBanner.js';
import { StatusBadge } from '../../components/monitoring/StatusBadge.js';
import {
  formatKindLabel,
  formatPriorityLabel,
  formatStatusLabel,
  statusTone,
  WORK_ITEM_KINDS,
  WORK_ITEM_STATUSES,
} from '../../components/work/work-format.js';
import {
  trackerApi,
  type WorkItemKind,
  type WorkItemResponse,
  type WorkItemStatus,
} from '../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../stores/tracker/store.js';

const SELECT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';

export function WorkListPage(): JSX.Element {
  const navigate = useNavigate();

  const projects = useTrackerStore((s) => s.projects);
  const iterations = useTrackerStore((s) => s.iterations);
  const assignable = useTrackerStore((s) => s.assignable);
  const items = useTrackerStore((s) => s.listItems);
  const nextCursor = useTrackerStore((s) => s.listNextCursor);
  const visibilityMode = useTrackerStore((s) => s.listVisibilityMode);
  const loading = useTrackerStore((s) => s.listLoading);
  const loadingMore = useTrackerStore((s) => s.listLoadingMore);
  const error = useTrackerStore((s) => s.listError);
  const filters = useTrackerStore((s) => s.filters);

  const loadProjects = useTrackerStore((s) => s.loadProjects);
  const loadAssignable = useTrackerStore((s) => s.loadAssignable);
  const loadIterations = useTrackerStore((s) => s.loadIterations);
  const setFilters = useTrackerStore((s) => s.setFilters);
  const loadWorkItems = useTrackerStore((s) => s.loadWorkItems);
  const loadMoreWorkItems = useTrackerStore((s) => s.loadMoreWorkItems);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<WorkItemKind>('task');
  const [newProjectId, setNewProjectId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
    void loadAssignable();
  }, [loadProjects, loadAssignable]);

  useEffect(() => {
    if (filters.projectId) {
      void loadIterations(filters.projectId);
    }
  }, [filters.projectId, loadIterations]);

  useEffect(() => {
    void loadWorkItems();
  }, [
    filters.projectId,
    filters.statuses,
    filters.kinds,
    filters.assigneeUserId,
    filters.iterationId,
    filters.q,
    loadWorkItems,
  ]);

  const iterationById = useMemo(
    () => new Map(iterations.map((i) => [i.id, i.name])),
    [iterations],
  );

  const columns = useMemo<DataTableColumn<WorkItemResponse>[]>(
    () => [
      {
        key: 'key',
        header: 'Key',
        accessor: (w) => w.key,
        render: (w) => (
          <code className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
            {w.key}
          </code>
        ),
        sortable: true,
      },
      {
        key: 'title',
        header: 'Title',
        accessor: (w) => w.title,
        render: (w) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">{w.title}</span>
        ),
        sortable: true,
      },
      {
        key: 'kind',
        header: 'Kind',
        accessor: (w) => w.kind,
        render: (w) => formatKindLabel(w.kind),
        sortable: true,
      },
      {
        key: 'status',
        header: 'Status',
        accessor: (w) => w.status,
        render: (w) => (
          <StatusBadge status={statusTone(w.status)}>{formatStatusLabel(w.status)}</StatusBadge>
        ),
        sortable: true,
      },
      {
        key: 'priority',
        header: 'Priority',
        accessor: (w) => w.priority ?? '',
        render: (w) => formatPriorityLabel(w.priority),
        sortable: true,
      },
      {
        key: 'assignee',
        header: 'Assignee',
        accessor: (w) => w.assigneeUserId ?? '',
        render: (w) => w.assigneeUserId ?? 'Unassigned',
      },
      {
        key: 'iteration',
        header: 'Iteration',
        accessor: (w) => (w.iterationId ? iterationById.get(w.iterationId) ?? w.iterationId : ''),
        render: (w) =>
          w.iterationId ? iterationById.get(w.iterationId) ?? w.iterationId : '—',
      },
    ],
    [iterationById],
  );

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const targetProjectId = newProjectId || filters.projectId || projects[0]?.id;
    if (!targetProjectId || !newTitle.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      await trackerApi.createWorkItem({
        projectId: targetProjectId,
        title: newTitle.trim(),
        kind: newKind,
      });
      setNewTitle('');
      setShowCreate(false);
      await loadWorkItems();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create work item');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Work Items</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Track epics, stories, tasks, and spikes across your projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/work/board"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Board
          </Link>
          <Link
            to="/work/projects"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Projects
          </Link>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showCreate ? 'Cancel' : 'New Work Item'}
          </button>
        </div>
      </div>

      {visibilityMode === 'tenant' && (
        <div
          role="note"
          data-testid="tenant-visibility-note"
          className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
        >
          Tenant-wide view — showing all work items in this tenant (per-user visibility scoping is
          not yet configured).
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-900"
        >
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Create Work Item
          </h2>
          {createError && (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">{createError}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select
              aria-label="New item project"
              value={newProjectId || filters.projectId || projects[0]?.id || ''}
              onChange={(e) => setNewProjectId(e.target.value)}
              className={SELECT_CLASS}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="New item kind"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as WorkItemKind)}
              className={SELECT_CLASS}
            >
              {WORK_ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {formatKindLabel(k)}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="New item title"
              placeholder="Title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={creating || !newTitle.trim()}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Multi-axis filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Project filter"
          value={filters.projectId}
          onChange={(e) => setFilters({ projectId: e.target.value, iterationId: '' })}
          className={SELECT_CLASS}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} — {p.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Status filter"
          value={filters.statuses[0] ?? ''}
          onChange={(e) =>
            setFilters({
              statuses: e.target.value ? [e.target.value as WorkItemStatus] : [],
            })
          }
          className={SELECT_CLASS}
        >
          <option value="">All statuses</option>
          {WORK_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {formatStatusLabel(s)}
            </option>
          ))}
        </select>

        <select
          aria-label="Kind filter"
          value={filters.kinds[0] ?? ''}
          onChange={(e) =>
            setFilters({
              kinds: e.target.value ? [e.target.value as WorkItemKind] : [],
            })
          }
          className={SELECT_CLASS}
        >
          <option value="">All kinds</option>
          {WORK_ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {formatKindLabel(k)}
            </option>
          ))}
        </select>

        <select
          aria-label="Assignee filter"
          value={filters.assigneeUserId}
          onChange={(e) => setFilters({ assigneeUserId: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">All assignees</option>
          {(assignable?.members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.userId}
            </option>
          ))}
        </select>

        <select
          aria-label="Iteration filter"
          value={filters.iterationId}
          onChange={(e) => setFilters({ iterationId: e.target.value })}
          disabled={!filters.projectId}
          className={`${SELECT_CLASS} disabled:opacity-50`}
        >
          <option value="">All iterations</option>
          {iterations.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name} ({it.status})
            </option>
          ))}
        </select>

        <input
          type="search"
          aria-label="Search work items"
          placeholder="Search titles…"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={() => void loadWorkItems()} />
        </div>
      )}

      {loading && items.length === 0 && !error && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading work items…</p>
      )}

      {!loading && items.length === 0 && !error && (
        <EmptyState
          title="No work items found"
          description="Create a work item or adjust your filters to see matching items."
        />
      )}

      {items.length > 0 && (
        <>
          <DataTable
            columns={columns}
            rows={items}
            getRowId={(w) => w.id}
            pageSize={Math.max(items.length, 100)}
            filterable={false}
            onRowClick={(w) => navigate(`/work/${encodeURIComponent(w.key)}`)}
            emptyTitle="No work items"
            emptyMessage="No items match the current filters."
          />

          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMoreWorkItems()}
                data-testid="work-list-load-more"
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {loadingMore ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
