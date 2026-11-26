/**
 * Tracker API Client (Story 44-6)
 *
 * Typed HTTP client for the native work-item tracker, communicating with:
 * - /api/projects — project CRUD & board projection
 * - /api/work-items — keyset-paged list, CRUD, status, assign, move, parent, subtree, timeline
 * - /api/iterations — iteration CRUD & item commitment
 * - /api/tracker/preferences — principal-scoped tracker preferences
 *
 * The client shapes match the DTO records in
 * `apps/tamma-elsa/src/Tamma.Api/Dtos/Tracker/TrackerDtos.cs` exactly — keep them in sync.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export interface TrackerErrorBody {
  error?: string;
  code?: string;
  retryable?: boolean;
  expectedVersion?: number;
  actualVersion?: number;
  workItems?: Array<{ id: string; key: string; title: string }>;
  children?: Array<{ id: string; key: string; title: string }>;
  truncated?: boolean;
}

export class TrackerApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retryable: boolean | undefined;
  readonly body: TrackerErrorBody | undefined;

  constructor(status: number, message: string, body?: TrackerErrorBody) {
    super(message);
    this.name = 'TrackerApiError';
    this.status = status;
    this.code = body?.code;
    this.retryable = body?.retryable;
    this.body = body;
  }
}

function formatIfMatch(ifMatch?: number | string): Record<string, string> {
  if (ifMatch === undefined) return {};
  if (typeof ifMatch === 'number') return { 'If-Match': `"${ifMatch}"` };
  return { 'If-Match': ifMatch };
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as TrackerErrorBody;
    throw new TrackerApiError(response.status, body.error ?? `HTTP ${response.status}`, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// === Closed Wire Vocabularies (keep in sync with Tamma.Core/Tracking/*.cs) ===

export type WorkItemKind = 'epic' | 'story' | 'task' | 'spike';

export type WorkItemStatus =
  | 'triage'
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type WorkItemStatusCategory =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

export type TriagePriority = 'urgent' | 'high' | 'normal' | 'low';

export type TriageIssueType = 'bug' | 'feature' | 'chore' | 'question' | 'security' | 'docs';

export type EstimateScale = 'not_used' | 'linear' | 'fibonacci' | 'exponential' | 't_shirt';

export type ProjectAutomationMode = 'off' | 'assist' | 'auto';

export type BoardGroupBy = 'status' | 'assignee' | 'kind' | 'priority' | 'iteration';

export type IterationStatus = 'planned' | 'active' | 'closed';

export type VisibilityMode = 'tenant' | 'per-user';

export type AssignableSource = 'audience-resolver' | 'tenant-membership' | 'single-user';

// === DTOs (keep in sync with Tamma.Api/Dtos/Tracker/TrackerDtos.cs) ===

export interface ProjectResponse {
  id: string;
  key: string;
  name: string;
  description: string | null;
  repositoryId: string | null;
  estimateScale: EstimateScale;
  nextNumber: number;
  archivedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  automationMode: ProjectAutomationMode;
}

export interface CreateProjectRequest {
  key: string;
  name: string;
  description?: string | null;
  repositoryId?: string | null;
  estimateScale?: EstimateScale;
  automationMode?: ProjectAutomationMode;
}

/** Tri-state PATCH: omit a key to leave it unchanged, pass null to clear it. */
export interface PatchProjectRequest {
  name?: string;
  description?: string | null;
  repositoryId?: string | null;
  estimateScale?: EstimateScale;
  automationMode?: ProjectAutomationMode;
  archived?: boolean;
}

export interface WorkItemResponse {
  id: string;
  projectId: string;
  key: string;
  previousKeys: string[];
  number: number;
  kind: WorkItemKind;
  status: WorkItemStatus;
  statusCategory: WorkItemStatusCategory;
  priority: TriagePriority | null;
  issueType: TriageIssueType | null;
  title: string;
  description: string | null;
  parentId: string | null;
  iterationId: string | null;
  rank: string;
  siblingRank: string;
  assigneeUserId: string | null;
  createdByUserId: string | null;
  estimate: number | null;
  externalRef: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  version: number;
  childCount?: number;
  childCountByStatus?: Record<string, number> | null;
}

export interface WorkItemListResponse {
  items: WorkItemResponse[];
  nextCursor: string | null;
  visibilityMode: VisibilityMode;
}

export interface ListWorkItemsParams {
  projectId?: string | undefined;
  status?: WorkItemStatus[] | undefined;
  kind?: WorkItemKind[] | undefined;
  assigneeUserId?: string | undefined;
  iterationId?: string | undefined;
  parentId?: string | undefined;
  topLevel?: boolean | undefined;
  externalLinked?: boolean | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface CreateWorkItemRequest {
  projectId: string;
  title: string;
  kind: WorkItemKind;
  status?: WorkItemStatus;
  priority?: TriagePriority | null;
  issueType?: TriageIssueType | null;
  description?: string | null;
  parentId?: string | null;
  iterationId?: string | null;
  assigneeUserId?: string | null;
  estimate?: number | null;
}

/** Tri-state PATCH: include ONLY the edited field(s). */
export interface PatchWorkItemRequest {
  title?: string;
  description?: string | null;
  kind?: WorkItemKind;
  priority?: TriagePriority | null;
  issueType?: TriageIssueType | null;
  iterationId?: string | null;
  assigneeUserId?: string | null;
  estimate?: number | null;
}

export interface WorkItemSubtreeNodeResponse extends WorkItemResponse {
  depth: number;
  childCount: number;
  childCountByStatus: Record<string, number>;
}

export interface WorkItemSubtreeResponse {
  rootId: string;
  maxDepth: number;
  items: WorkItemSubtreeNodeResponse[];
}

export interface WorkItemTimelineEventResponse {
  id: string;
  sequenceNumber: number;
  type: string;
  createdAt: string;
  tags: Record<string, unknown>;
  metadata: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface WorkItemTimelineResponse {
  workItemId: string;
  issueId: string;
  events: WorkItemTimelineEventResponse[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface BoardColumnResponse {
  key: string;
  label: string;
  items: WorkItemResponse[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface BoardResponse {
  projectId: string;
  groupBy: BoardGroupBy;
  perColumnLimit: number;
  columnCap: number | null;
  foldedColumnCount: number;
  columns: BoardColumnResponse[];
}

export interface GetBoardParams {
  groupBy?: BoardGroupBy | undefined;
  iterationId?: string | undefined;
  assigneeId?: string | undefined;
  kind?: WorkItemKind[] | undefined;
  limit?: number | undefined;
  column?: string | undefined;
  cursor?: string | undefined;
}

export interface IterationResponse {
  id: string;
  projectId: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: IterationStatus;
  capacityPoints: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  carryOverMovedCount?: number | null;
  carryOverLeftCount?: number | null;
}

export interface CreateIterationRequest {
  name: string;
  startsOn?: string | null;
  endsOn?: string | null;
  status?: IterationStatus;
  capacityPoints?: number | null;
}

export interface PatchIterationRequest {
  name?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  status?: IterationStatus;
  capacityPoints?: number | null;
  carryOver?: 'to-backlog' | 'move-to' | 'leave';
  carryOverTargetIterationId?: string | null;
}

export interface CommitIterationItemsResponse {
  iterationId: string;
  committedCount: number;
  workItemIds: string[];
}

export interface IterationSummaryCategoryResponse {
  category: WorkItemStatusCategory;
  count: number;
  estimateSum: number;
}

export interface IterationSummaryResponse {
  iterationId: string;
  projectId: string;
  name: string;
  status: IterationStatus;
  estimateScale: EstimateScale;
  capacityPoints: number | null;
  committedCount: number;
  totalEstimate: number;
  byCategory: IterationSummaryCategoryResponse[];
}

export interface AssignableMemberResponse {
  userId: string;
  role: string;
}

export interface AssignableResponse {
  members: AssignableMemberResponse[];
  source: AssignableSource;
}

export interface TrackerPreferencesResponse {
  defaultProjectId: string | null;
  defaultKind: WorkItemKind | null;
  boardGroupBy: BoardGroupBy | null;
  source: 'principal-override' | 'system-default';
  version: number;
  updatedAt: string | null;
}

export interface UpsertTrackerPreferencesRequest {
  defaultProjectId: string | null;
  defaultKind: WorkItemKind | null;
  boardGroupBy: BoardGroupBy | null;
}

// === API Methods ===

export const trackerApi = {
  // Projects
  listProjects: (includeArchived = false) => {
    const qs = includeArchived ? '?includeArchived=true' : '';
    return fetchJSON<ProjectResponse[]>(`/projects${qs}`);
  },

  getProject: (projectId: string) =>
    fetchJSON<ProjectResponse>(`/projects/${encodeURIComponent(projectId)}`),

  createProject: (request: CreateProjectRequest) =>
    fetchJSON<ProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  patchProject: (projectId: string, patch: PatchProjectRequest, ifMatch?: number | string) =>
    fetchJSON<ProjectResponse>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify(patch),
    }),

  deleteProject: (projectId: string, ifMatch?: number | string) =>
    fetchJSON<void>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: formatIfMatch(ifMatch),
    }),

  // Work Items
  listWorkItems: (params?: ListWorkItemsParams) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.status && params.status.length > 0) qs.set('status', params.status.join(','));
    if (params?.kind && params.kind.length > 0) qs.set('kind', params.kind.join(','));
    if (params?.assigneeUserId) qs.set('assigneeUserId', params.assigneeUserId);
    if (params?.iterationId) qs.set('iterationId', params.iterationId);
    if (params?.parentId) qs.set('parentId', params.parentId);
    if (params?.topLevel !== undefined) qs.set('topLevel', String(params.topLevel));
    if (params?.externalLinked !== undefined) qs.set('externalLinked', String(params.externalLinked));
    if (params?.q) qs.set('q', params.q);
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return fetchJSON<WorkItemListResponse>(`/work-items${query ? `?${query}` : ''}`);
  },

  getWorkItem: (id: string) =>
    fetchJSON<WorkItemResponse>(`/work-items/${encodeURIComponent(id)}`),

  getByKey: (key: string) =>
    fetchJSON<WorkItemResponse>(`/work-items/by-key/${encodeURIComponent(key)}`),

  createWorkItem: (request: CreateWorkItemRequest) =>
    fetchJSON<WorkItemResponse>('/work-items', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  patchWorkItem: (id: string, patch: PatchWorkItemRequest, ifMatch?: number | string) =>
    fetchJSON<WorkItemResponse>(`/work-items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify(patch),
    }),

  deleteWorkItem: (id: string, ifMatch?: number | string) =>
    fetchJSON<void>(`/work-items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: formatIfMatch(ifMatch),
    }),

  setStatus: (id: string, status: WorkItemStatus, ifMatch?: number | string, actor?: string) =>
    fetchJSON<WorkItemResponse>(`/work-items/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify(actor !== undefined ? { status, actor } : { status }),
    }),

  assign: (id: string, assigneeUserId: string | null, ifMatch?: number | string) =>
    fetchJSON<WorkItemResponse>(`/work-items/${encodeURIComponent(id)}/assign`, {
      method: 'POST',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify({ assigneeUserId }),
    }),

  move: (
    id: string,
    placement: { afterId?: string | null; beforeId?: string | null },
    ifMatch?: number | string,
  ) =>
    fetchJSON<WorkItemResponse>(`/work-items/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify({
        afterId: placement.afterId ?? null,
        beforeId: placement.beforeId ?? null,
      }),
    }),

  setParent: (id: string, parentId: string | null, ifMatch?: number | string) =>
    fetchJSON<WorkItemResponse>(`/work-items/${encodeURIComponent(id)}/parent`, {
      method: 'POST',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify({ parentId }),
    }),

  getSubtree: (id: string) =>
    fetchJSON<WorkItemSubtreeResponse>(`/work-items/${encodeURIComponent(id)}/subtree`),

  getTimeline: (id: string, params?: { cursor?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.cursor !== undefined) qs.set('cursor', String(params.cursor));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return fetchJSON<WorkItemTimelineResponse>(
      `/work-items/${encodeURIComponent(id)}/timeline${query ? `?${query}` : ''}`,
    );
  },

  // Board
  getBoard: (projectId: string, params?: GetBoardParams) => {
    const qs = new URLSearchParams();
    if (params?.groupBy) qs.set('groupBy', params.groupBy);
    if (params?.iterationId) qs.set('iterationId', params.iterationId);
    if (params?.assigneeId) qs.set('assigneeId', params.assigneeId);
    if (params?.kind && params.kind.length > 0) qs.set('kind', params.kind.join(','));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.column) qs.set('column', params.column);
    if (params?.cursor) qs.set('cursor', params.cursor);
    const query = qs.toString();
    return fetchJSON<BoardResponse>(
      `/projects/${encodeURIComponent(projectId)}/board${query ? `?${query}` : ''}`,
    );
  },

  // Iterations
  listIterations: (projectId: string) =>
    fetchJSON<IterationResponse[]>(`/projects/${encodeURIComponent(projectId)}/iterations`),

  createIteration: (projectId: string, request: CreateIterationRequest) =>
    fetchJSON<IterationResponse>(`/projects/${encodeURIComponent(projectId)}/iterations`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  patchIteration: (id: string, patch: PatchIterationRequest, ifMatch?: number | string) =>
    fetchJSON<IterationResponse>(`/iterations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify(patch),
    }),

  commitItems: (iterationId: string, workItemIds: string[]) =>
    fetchJSON<CommitIterationItemsResponse>(
      `/iterations/${encodeURIComponent(iterationId)}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ workItemIds }),
      },
    ),

  uncommitItem: (iterationId: string, workItemId: string) =>
    fetchJSON<void>(
      `/iterations/${encodeURIComponent(iterationId)}/items/${encodeURIComponent(workItemId)}`,
      { method: 'DELETE' },
    ),

  getIterationSummary: (iterationId: string) =>
    fetchJSON<IterationSummaryResponse>(
      `/iterations/${encodeURIComponent(iterationId)}/summary`,
    ),

  // Assignable
  getAssignable: () => fetchJSON<AssignableResponse>('/work-items/assignable'),

  // Preferences
  getPreferences: () => fetchJSON<TrackerPreferencesResponse>('/tracker/preferences'),

  putPreferences: (request: UpsertTrackerPreferencesRequest, ifMatch?: number | string) =>
    fetchJSON<TrackerPreferencesResponse>('/tracker/preferences', {
      method: 'PUT',
      headers: formatIfMatch(ifMatch),
      body: JSON.stringify(request),
    }),

  deletePreferences: (ifMatch?: number | string) =>
    fetchJSON<{ message: string }>('/tracker/preferences', {
      method: 'DELETE',
      headers: formatIfMatch(ifMatch),
    }),
};
