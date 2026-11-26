/**
 * WorkItemTimeline — chronological DCB event stream for one work item
 * (Story 44-6 AC5 / D9).
 *
 * Interleaves tracker events (WORKITEM.*, PROJECT.*, ITERATION.*) with foreign
 * workflow families (DOCUMENT.*, APPROVAL.*, ESCALATION.*) sharing the same
 * `issueId`. Foreign families are rendered read-only and visibly labelled as
 * "Workflow activity".
 */

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { WorkItemTimelineEventResponse } from '../../services/tracker/tracker-api-client.js';
import { formatTimestamp, isTrackerEventType } from './work-format.js';

export interface WorkItemTimelineProps {
  events: WorkItemTimelineEventResponse[];
  issueId?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

function extractRunId(evt: WorkItemTimelineEventResponse): string | null {
  const fromMeta = evt.metadata?.workflowInstanceId ?? evt.metadata?.runId;
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;
  const fromData = evt.data?.workflowInstanceId ?? evt.data?.runId;
  if (typeof fromData === 'string' && fromData.length > 0) return fromData;
  return null;
}

function summarizePayload(evt: WorkItemTimelineEventResponse): string | null {
  const data = evt.data ?? {};
  if (typeof data.from === 'string' && typeof data.to === 'string') {
    const actor = typeof data.actor === 'string' ? ` (by ${data.actor})` : '';
    return `${data.from} → ${data.to}${actor}`;
  }
  if (typeof data.title === 'string' && data.title.length > 0) {
    return data.title;
  }
  if (typeof data.reason === 'string' && data.reason.length > 0) {
    return data.reason;
  }
  if (typeof data.documentType === 'string' && data.documentType.length > 0) {
    return `Document: ${data.documentType}`;
  }
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  return JSON.stringify(data);
}

export function WorkItemTimeline({
  events,
  issueId,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: WorkItemTimelineProps): JSX.Element {
  return (
    <section aria-label="Work item timeline" data-testid="work-item-timeline">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Timeline</h2>
        {issueId && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Join key: <code className="font-mono">{issueId}</code>
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No timeline events recorded yet.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {events.map((evt) => {
            const isTracker = isTrackerEventType(evt.type);
            const summary = summarizePayload(evt);
            const runId = !isTracker ? extractRunId(evt) : null;

            return (
              <li
                key={evt.id}
                data-testid={`timeline-event-${evt.id}`}
                data-event-family={isTracker ? 'tracker' : 'workflow'}
                className={
                  isTracker
                    ? 'rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900'
                    : 'rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-800/60 dark:bg-indigo-950/30'
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {evt.type}
                    </code>
                    {!isTracker && (
                      <span
                        data-testid={`workflow-activity-badge-${evt.id}`}
                        className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200"
                      >
                        Workflow activity
                      </span>
                    )}
                  </div>
                  <time
                    dateTime={evt.createdAt}
                    className="text-xs text-gray-500 dark:text-gray-400"
                  >
                    #{evt.sequenceNumber} · {formatTimestamp(evt.createdAt)}
                  </time>
                </div>

                {summary && (
                  <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{summary}</p>
                )}

                {runId && (
                  <div className="mt-1.5">
                    <Link
                      to={`/runs/${encodeURIComponent(runId)}`}
                      className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      View workflow run →
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && onLoadMore && (
        <div className="mt-3">
          <button
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {loadingMore ? 'Loading more events…' : 'Load more events'}
          </button>
        </div>
      )}
    </section>
  );
}
