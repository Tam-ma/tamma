/**
 * Story 39-19 — REST client for the Task View inbox projection + Story 39-8's
 * idempotent document-decision resume surface:
 *   GET  /api/tasks
 *   GET  /api/tasks/{sessionId}
 *   POST /api/documents/decisions/{sessionId}/resume
 */

import { apiClient, type ApiClient } from './client';

export type TaskType = 'acceptance_decision' | 'review' | 'approval' | 'clarification';
export type DecisionKind = 'accept' | 'request-revision' | 'reject' | 'escalate';

export interface TaskViewItem {
  sessionId: string;
  taskType: TaskType | string;
  documentType: string | null;
  documentId: string | null;
  issueId: string | null;
  correlationId: string | null;
  repoKey: string | null;
  assignedRole: string;
  eligibilityBasis: string;
  autonomyContext: string | null;
  rulesReference: string | null;
  assignedAt: string;
  status: 'pending' | 'completed' | string;
  lineageUrl: string | null;
}

export interface TaskListResponse {
  items: TaskViewItem[];
  count: number;
}

export interface DecisionRequest {
  kind: DecisionKind;
  notes?: string;
  reason?: string;
  detail?: string;
  feedback?: string;
}

export interface DecisionResumeResponse {
  resumed: boolean;
  workflowInstanceId?: string | null;
  kind: string;
  channel: string;
}

export async function listTasks(
  includeCompleted = false,
  client: ApiClient = apiClient,
): Promise<TaskListResponse> {
  const qs = includeCompleted ? '?includeCompleted=true' : '';
  return client.get<TaskListResponse>(`/api/tasks${qs}`);
}

export async function getTask(
  sessionId: string,
  client: ApiClient = apiClient,
): Promise<TaskViewItem> {
  return client.get<TaskViewItem>(`/api/tasks/${encodeURIComponent(sessionId)}`);
}

export async function submitTaskDecision(
  sessionId: string,
  request: DecisionRequest,
  client: ApiClient = apiClient,
): Promise<DecisionResumeResponse> {
  return client.post<DecisionResumeResponse>(
    `/api/documents/decisions/${encodeURIComponent(sessionId)}/resume`,
    request,
  );
}
