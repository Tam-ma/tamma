/**
 * Display helpers for tracker vocabulary values (Story 44-6).
 */

import type { StatusKind } from '../monitoring/StatusBadge.js';
import type {
  BoardGroupBy,
  EstimateScale,
  ProjectAutomationMode,
  TriageIssueType,
  TriagePriority,
  WorkItemKind,
  WorkItemStatus,
} from '../../services/tracker/tracker-api-client.js';

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  'triage',
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
];

export const WORK_ITEM_KINDS: readonly WorkItemKind[] = ['epic', 'story', 'task', 'spike'];

export const TRIAGE_PRIORITIES: readonly TriagePriority[] = ['urgent', 'high', 'normal', 'low'];

export const TRIAGE_ISSUE_TYPES: readonly TriageIssueType[] = [
  'bug',
  'feature',
  'chore',
  'question',
  'security',
  'docs',
];

export const ESTIMATE_SCALES: readonly EstimateScale[] = [
  'not_used',
  'linear',
  'fibonacci',
  'exponential',
  't_shirt',
];

export const AUTOMATION_MODES: readonly ProjectAutomationMode[] = ['off', 'assist', 'auto'];

export const BOARD_GROUP_BY_OPTIONS: ReadonlyArray<{ value: BoardGroupBy; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'kind', label: 'Kind' },
  { value: 'priority', label: 'Priority' },
  { value: 'iteration', label: 'Iteration' },
];

const STATUS_LABELS: Record<WorkItemStatus, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_TONES: Record<WorkItemStatus, StatusKind> = {
  triage: 'gray',
  backlog: 'gray',
  ready: 'blue',
  in_progress: 'blue',
  in_review: 'yellow',
  blocked: 'red',
  done: 'green',
  cancelled: 'gray',
};

const KIND_LABELS: Record<WorkItemKind, string> = {
  epic: 'Epic',
  story: 'Story',
  task: 'Task',
  spike: 'Spike',
};

const PRIORITY_LABELS: Record<TriagePriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status as WorkItemStatus] ?? status;
}

export function statusTone(status: string): StatusKind {
  return STATUS_TONES[status as WorkItemStatus] ?? 'gray';
}

export function formatKindLabel(kind: string): string {
  return KIND_LABELS[kind as WorkItemKind] ?? kind;
}

export function formatPriorityLabel(priority: TriagePriority | null): string {
  if (!priority) return '—';
  return PRIORITY_LABELS[priority] ?? priority;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function isTrackerEventType(eventType: string): boolean {
  return (
    eventType.startsWith('WORKITEM.') ||
    eventType.startsWith('PROJECT.') ||
    eventType.startsWith('ITERATION.')
  );
}
