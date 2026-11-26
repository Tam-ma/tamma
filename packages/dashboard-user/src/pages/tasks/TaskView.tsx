/**
 * TaskView — /tasks (Story 39-19 AC3 / AC4 / AC5 / D7 / D8 / D10)
 *
 * Scoped inbox of decisions, reviews, approvals, and clarifications assigned
 * to the authenticated user (server-enforced via Story 39-20's resolver).
 *   - Displays task type, subject document + lineage link (Story 39-11),
 *     workflow, age, assigned role, and autonomy context string.
 *   - Acting on a task posts directly to Story 39-8's idempotent resume surface
 *     (`POST /api/documents/decisions/{sessionId}/resume`).
 *   - 404/409 from resume removes the row with an honest "already completed" notice.
 *   - Subscribes to `/hubs/user` `task-assigned` notifications for live refresh,
 *     and stays 100% functional via REST even when the real-time channel is offline.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError } from '../../api/client';
import {
  listTasks,
  submitTaskDecision,
  type DecisionKind,
  type TaskViewItem,
} from '../../api/tasks';
import type { UserChannel } from '../../api/userChannel';
import { useUserChannel } from '../../hooks/useUserChannel';

function formatAge(isoTimestamp: string): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const DECISION_KINDS: Array<{ value: DecisionKind; label: string }> = [
  { value: 'accept', label: 'Accept' },
  { value: 'request-revision', label: 'Request revision' },
  { value: 'reject', label: 'Reject' },
  { value: 'escalate', label: 'Escalate' },
];

export interface TaskViewProps {
  /** Optional channel factory override for tests. */
  channelFactory?: () => UserChannel;
}

export function TaskView({ channelFactory }: TaskViewProps = {}): JSX.Element {
  const [tasks, setTasks] = useState<TaskViewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeTask, setActiveTask] = useState<TaskViewItem | null>(null);
  const [decisionKind, setDecisionKind] = useState<DecisionKind>('accept');
  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await listTasks(false);
      setTasks(resp?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  const { connectionState } = useUserChannel({
    channelFactory,
    onReconnect: () => {
      void refresh();
    },
    onTaskUpdate: () => {
      void refresh();
    },
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDecisionModal = (task: TaskViewItem): void => {
    setActiveTask(task);
    setDecisionKind('accept');
    setNotes('');
    setFeedback('');
    setError(null);
  };

  const handleSubmitDecision = async (): Promise<void> => {
    if (!activeTask || submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    const sessionId = activeTask.sessionId;
    try {
      await submitTaskDecision(sessionId, {
        kind: decisionKind,
        ...(decisionKind === 'request-revision' && notes.trim() ? { notes: notes.trim() } : {}),
        ...((decisionKind === 'reject' || decisionKind === 'escalate') && notes.trim()
          ? { reason: notes.trim() }
          : {}),
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      });
      setTasks((prev) => prev.filter((t) => t.sessionId !== sessionId));
      setActiveTask(null);
      setNotice(`Decision '${decisionKind}' submitted.`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        // Idempotent single completion: someone else already resolved this gate.
        setTasks((prev) => prev.filter((t) => t.sessionId !== sessionId));
        setActiveTask(null);
        setNotice('This task was already completed by another user and has been removed from your inbox.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit decision');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Decisions, reviews, approvals, and clarifications waiting for your action.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connectionState !== 'connected' && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
              Live updates offline — manual refresh available
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {notice !== null && (
        <div
          role="status"
          data-testid="task-notice"
          className="p-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded-md"
        >
          {notice}
        </div>
      )}

      {error !== null && (
        <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 rounded-md">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-500">No pending tasks in your inbox.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Subject / Lineage</th>
                <th className="px-3 py-2 text-left">Workflow</th>
                <th className="px-3 py-2 text-left">Age</th>
                <th className="px-3 py-2 text-left">Autonomy context</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map((task) => (
                <tr key={task.sessionId} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">
                    <div>{task.taskType}</div>
                    <div className="text-xs text-gray-500">
                      role: {task.assignedRole} ({task.eligibilityBasis})
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    <div>{task.documentType ?? 'document'}</div>
                    {task.lineageUrl && (
                      <a
                        href={task.lineageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-700 hover:underline"
                      >
                        View lineage ({task.issueId})
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {task.correlationId ?? task.issueId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                    {formatAge(task.assignedAt)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {task.autonomyContext ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openDecisionModal(task)}
                      className="px-3 py-1 text-xs font-medium bg-gray-900 text-white rounded hover:bg-gray-800"
                    >
                      Act
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTask !== null && (
        <div
          role="dialog"
          aria-labelledby="task-decision-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-md space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="task-decision-title" className="text-lg font-medium text-gray-900">
                Submit decision
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setActiveTask(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-gray-600">
              {activeTask.issueId ?? activeTask.sessionId} — {activeTask.documentType ?? activeTask.taskType}
            </p>

            <label className="block text-xs text-gray-700">
              Decision
              <select
                aria-label="Decision kind"
                value={decisionKind}
                onChange={(e) => setDecisionKind(e.target.value as DecisionKind)}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                {DECISION_KINDS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {decisionKind !== 'accept' && (
              <label className="block text-xs text-gray-700">
                Notes / Reason
                <textarea
                  aria-label="Notes or reason"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                />
              </label>
            )}

            <label className="block text-xs text-gray-700">
              Feedback (optional)
              <textarea
                aria-label="Feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveTask(null)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmitDecision()}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit decision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
