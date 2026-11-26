/**
 * WorkItemDetailPage — `/work/:key` detail view with single-field inline PATCH,
 * parent/children navigation via `RowToggle`, and chronological timeline
 * (Story 44-6 AC1 / AC5 / AC7 / D9).
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RowToggle } from '../../components/common/RowToggle.js';
import { ErrorBanner } from '../../components/monitoring/ErrorBanner.js';
import { StatusBadge } from '../../components/monitoring/StatusBadge.js';
import { AssigneePicker } from '../../components/work/AssigneePicker.js';
import { WorkItemTimeline } from '../../components/work/WorkItemTimeline.js';
import {
  formatKindLabel,
  formatPriorityLabel,
  formatStatusLabel,
  formatTimestamp,
  statusTone,
  TRIAGE_ISSUE_TYPES,
  TRIAGE_PRIORITIES,
  WORK_ITEM_KINDS,
  WORK_ITEM_STATUSES,
} from '../../components/work/work-format.js';
import {
  trackerApi,
  type IterationResponse,
  type PatchWorkItemRequest,
  type TriageIssueType,
  type TriagePriority,
  type WorkItemKind,
  type WorkItemResponse,
  type WorkItemStatus,
  type WorkItemSubtreeNodeResponse,
  type WorkItemTimelineResponse,
} from '../../services/tracker/tracker-api-client.js';

const INPUT_CLASS =
  'w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export function WorkItemDetailPage(): JSX.Element {
  const { key } = useParams<{ key: string }>();

  const [item, setItem] = useState<WorkItemResponse | null>(null);
  const [parentItem, setParentItem] = useState<WorkItemResponse | null>(null);
  const [subtree, setSubtree] = useState<WorkItemSubtreeNodeResponse[]>([]);
  const [timeline, setTimeline] = useState<WorkItemTimelineResponse | null>(null);
  const [iterations, setIterations] = useState<IterationResponse[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingMoreTimeline, setLoadingMoreTimeline] = useState(false);

  // Inline edit drafts for text inputs
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(() => new Set());

  const loadAll = useCallback(async (): Promise<void> => {
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await trackerApi.getByKey(key);
      setItem(loaded);
      setTitleDraft(loaded.title);
      setDescDraft(loaded.description ?? '');

      const [subRes, tlRes, iterRes, parentRes] = await Promise.all([
        trackerApi.getSubtree(loaded.id).catch(() => null),
        trackerApi.getTimeline(loaded.id).catch(() => null),
        trackerApi.listIterations(loaded.projectId).catch(() => []),
        loaded.parentId
          ? trackerApi.getWorkItem(loaded.parentId).catch(() => null)
          : Promise.resolve(null),
      ]);

      setSubtree(subRes?.items ?? []);
      setTimeline(tlRes);
      setIterations(iterRes);
      setParentItem(parentRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work item');
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Single-field PATCH (Story 44-2 AC3 / Story 44-6 AC5): sends ONLY the edited key.
  const patchSingleField = async <K extends keyof PatchWorkItemRequest>(
    field: K,
    value: PatchWorkItemRequest[K],
  ): Promise<void> => {
    if (!item) return;
    setSavingField(field);
    setSaveError(null);
    try {
      const patch = { [field]: value } as PatchWorkItemRequest;
      const updated = await trackerApi.patchWorkItem(item.id, patch, item.version);
      setItem(updated);
      setTitleDraft(updated.title);
      setDescDraft(updated.description ?? '');
      const tl = await trackerApi.getTimeline(updated.id).catch(() => null);
      if (tl) setTimeline(tl);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : `Failed to update ${field}`);
    } finally {
      setSavingField(null);
    }
  };

  const handleStatusChange = async (nextStatus: WorkItemStatus): Promise<void> => {
    if (!item || item.status === nextStatus) return;
    setSavingField('status');
    setSaveError(null);
    try {
      const updated = await trackerApi.setStatus(item.id, nextStatus, item.version);
      setItem(updated);
      const tl = await trackerApi.getTimeline(updated.id).catch(() => null);
      if (tl) setTimeline(tl);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSavingField(null);
    }
  };

  const handleAssign = async (userId: string | null): Promise<void> => {
    if (!item) return;
    setSavingField('assignee');
    setSaveError(null);
    try {
      const updated = await trackerApi.assign(item.id, userId, item.version);
      setItem(updated);
      const tl = await trackerApi.getTimeline(updated.id).catch(() => null);
      if (tl) setTimeline(tl);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update assignee');
    } finally {
      setSavingField(null);
    }
  };

  const handleLoadMoreTimeline = async (): Promise<void> => {
    if (!item || !timeline?.hasMore || timeline.nextCursor === null || loadingMoreTimeline) return;
    setLoadingMoreTimeline(true);
    try {
      const page = await trackerApi.getTimeline(item.id, { cursor: timeline.nextCursor });
      setTimeline((prev) =>
        prev
          ? {
              ...page,
              events: [...prev.events, ...page.events],
            }
          : page,
      );
    } finally {
      setLoadingMoreTimeline(false);
    }
  };

  const directChildren = useMemo(
    () => subtree.filter((n) => n.parentId === item?.id),
    [subtree, item?.id],
  );

  const childrenOf = useCallback(
    (parentId: string) => subtree.filter((n) => n.parentId === parentId),
    [subtree],
  );

  const toggleChild = (childId: string): void => {
    setExpandedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  };

  if (loading && !item) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading work item…</p>;
  }

  if (error || !item) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorBanner message={error ?? 'Work item not found'} onRetry={() => void loadAll()} />
        <div className="mt-4">
          <Link to="/work" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            ← Back to Work Items
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Link to="/work" className="hover:text-blue-600 dark:hover:text-blue-400">
            Work Items
          </Link>
          <span>/</span>
          {parentItem && (
            <>
              <Link
                to={`/work/${encodeURIComponent(parentItem.key)}`}
                data-testid="parent-work-item-link"
                className="font-mono text-blue-600 hover:underline dark:text-blue-400"
              >
                {parentItem.key}
              </Link>
              <span>/</span>
            </>
          )}
          <code className="font-mono font-semibold text-gray-900 dark:text-gray-100">
            {item.key}
          </code>
        </div>
        <Link
          to="/work/board"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Open Board
        </Link>
      </div>

      {saveError && (
        <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
      )}

      {/* Title inline editor */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        {editingTitle ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (titleDraft.trim() && titleDraft.trim() !== item.title) {
                void patchSingleField('title', titleDraft.trim()).then(() => setEditingTitle(false));
              } else {
                setEditingTitle(false);
              }
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              aria-label="Edit title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className={INPUT_CLASS}
              autoFocus
            />
            <button
              type="submit"
              disabled={savingField === 'title'}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTitleDraft(item.title);
                setEditingTitle(false);
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-200"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{item.title}</h1>
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Edit title
            </button>
          </div>
        )}

        {/* Description inline editor */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Description
            </span>
            {!editingDesc && (
              <button
                type="button"
                onClick={() => setEditingDesc(true)}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Edit description
              </button>
            )}
          </div>
          {editingDesc ? (
            <div className="space-y-2">
              <textarea
                aria-label="Edit description"
                rows={4}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                className={INPUT_CLASS}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={savingField === 'description'}
                  onClick={() =>
                    void patchSingleField(
                      'description',
                      descDraft.trim() === '' ? null : descDraft,
                    ).then(() => setEditingDesc(false))
                  }
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Save description
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDescDraft(item.description ?? '');
                    setEditingDesc(false);
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
              {item.description || 'No description.'}
            </p>
          )}
        </div>

        {/* Metadata fields — each emits a single-field mutation */}
        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 sm:grid-cols-3 dark:border-gray-700">
          <div>
            <label
              htmlFor="detail-status"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              Status
            </label>
            <select
              id="detail-status"
              aria-label="Status"
              value={item.status}
              disabled={savingField === 'status'}
              onChange={(e) => void handleStatusChange(e.target.value as WorkItemStatus)}
              className={`mt-1 ${INPUT_CLASS}`}
            >
              {WORK_ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {formatStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="detail-kind"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              Kind
            </label>
            <select
              id="detail-kind"
              aria-label="Kind"
              value={item.kind}
              disabled={savingField === 'kind'}
              onChange={(e) => void patchSingleField('kind', e.target.value as WorkItemKind)}
              className={`mt-1 ${INPUT_CLASS}`}
            >
              {WORK_ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {formatKindLabel(k)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="detail-priority"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              Priority
            </label>
            <select
              id="detail-priority"
              aria-label="Priority"
              value={item.priority ?? ''}
              disabled={savingField === 'priority'}
              onChange={(e) =>
                void patchSingleField(
                  'priority',
                  e.target.value === '' ? null : (e.target.value as TriagePriority),
                )
              }
              className={`mt-1 ${INPUT_CLASS}`}
            >
              <option value="">Unprioritised</option>
              {TRIAGE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {formatPriorityLabel(p)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="detail-issue-type"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              Issue Type
            </label>
            <select
              id="detail-issue-type"
              aria-label="Issue Type"
              value={item.issueType ?? ''}
              disabled={savingField === 'issueType'}
              onChange={(e) =>
                void patchSingleField(
                  'issueType',
                  e.target.value === '' ? null : (e.target.value as TriageIssueType),
                )
              }
              className={`mt-1 ${INPUT_CLASS}`}
            >
              <option value="">None</option>
              {TRIAGE_ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="detail-iteration"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              Iteration
            </label>
            <select
              id="detail-iteration"
              aria-label="Iteration"
              value={item.iterationId ?? ''}
              disabled={savingField === 'iterationId'}
              onChange={(e) =>
                void patchSingleField('iterationId', e.target.value === '' ? null : e.target.value)
              }
              className={`mt-1 ${INPUT_CLASS}`}
            >
              <option value="">Backlog (none)</option>
              {iterations.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.status})
                </option>
              ))}
            </select>
          </div>

          <AssigneePicker
            value={item.assigneeUserId}
            disabled={savingField === 'assignee'}
            onChange={(userId) => void handleAssign(userId)}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span>Version: v{item.version}</span>
          <span>Created: {formatTimestamp(item.createdAt)}</span>
          <span>Updated: {formatTimestamp(item.updatedAt)}</span>
        </div>
      </div>

      {/* Children hierarchy */}
      <section
        aria-label="Child work items"
        className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
      >
        <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          Children ({directChildren.length})
        </h2>
        {directChildren.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No child items.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {directChildren.map((child) => {
              const grandChildren = childrenOf(child.id);
              const isExpanded = expandedChildren.has(child.id);
              return (
                <li key={child.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {grandChildren.length > 0 && (
                        <RowToggle
                          expanded={isExpanded}
                          onToggle={() => toggleChild(child.id)}
                          label={`Toggle sub-items of ${child.key}`}
                          controlsId={`subtree-${child.id}`}
                        />
                      )}
                      <Link
                        to={`/work/${encodeURIComponent(child.key)}`}
                        className="font-mono text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
                      >
                        {child.key}
                      </Link>
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {child.title}
                      </span>
                    </div>
                    <StatusBadge status={statusTone(child.status)}>
                      {formatStatusLabel(child.status)}
                    </StatusBadge>
                  </div>
                  {isExpanded && grandChildren.length > 0 && (
                    <ul
                      id={`subtree-${child.id}`}
                      className="mt-2 ml-8 space-y-1 border-l border-gray-200 pl-3 dark:border-gray-700"
                    >
                      {grandChildren.map((gc) => (
                        <li key={gc.id} className="flex items-center justify-between text-xs">
                          <Link
                            to={`/work/${encodeURIComponent(gc.key)}`}
                            className="font-mono text-blue-700 hover:underline dark:text-blue-400"
                          >
                            {gc.key} — {gc.title}
                          </Link>
                          <span className="text-gray-500">{formatStatusLabel(gc.status)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Timeline (tracker + foreign workflow families) */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <WorkItemTimeline
          events={timeline?.events ?? []}
          issueId={timeline?.issueId ?? item.key}
          hasMore={timeline?.hasMore ?? false}
          loadingMore={loadingMoreTimeline}
          onLoadMore={() => void handleLoadMoreTimeline()}
        />
      </div>
    </div>
  );
}
