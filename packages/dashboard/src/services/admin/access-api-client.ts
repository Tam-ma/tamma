/**
 * Access Admin API Client (Story 39-20 AC1 / AC2)
 *
 * Typed cookie-session HTTP client for tenant teams, team membership,
 * repository visibility, and repository access grants.
 * Keep in sync with `apps/tamma-elsa/src/Tamma.Api/Dtos/Access/AccessDtos.cs`.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

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
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export type TeamMemberRole = 'member' | 'maintainer';
export type RepoVisibility = 'tenant' | 'restricted';
export type RepoAccessLevel = 'read' | 'contribute' | 'admin';

export interface TeamMemberDto {
  id: string;
  teamId: string;
  userId: string;
  role: TeamMemberRole;
  createdAt: string;
}

export interface TeamDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  defaultMemberRole: TeamMemberRole;
  memberCount: number;
  members: TeamMemberDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredRepoDto {
  id: string;
  tenantId: string;
  platformKind: string;
  repoFullName: string;
  externalId: string | null;
  visibility: RepoVisibility;
  effectiveAccessLevel: RepoAccessLevel | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoAccessGrantDto {
  id: string;
  repositoryId: string;
  userId: string | null;
  teamId: string | null;
  accessLevel: RepoAccessLevel;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const accessApi = {
  listTeams: (tenantId: string) =>
    fetchJSON<TeamDto[]>(`/v1/orgs/${encodeURIComponent(tenantId)}/teams`),

  createTeam: (
    tenantId: string,
    body: { name: string; description?: string; defaultMemberRole?: TeamMemberRole },
  ) =>
    fetchJSON<TeamDto>(`/v1/orgs/${encodeURIComponent(tenantId)}/teams`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteTeam: (tenantId: string, teamId: string) =>
    fetchJSON<void>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/teams/${encodeURIComponent(teamId)}`,
      { method: 'DELETE' },
    ),

  addTeamMember: (
    tenantId: string,
    teamId: string,
    body: { userId: string; role?: TeamMemberRole },
  ) =>
    fetchJSON<TeamMemberDto>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/teams/${encodeURIComponent(teamId)}/members`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  updateTeamMemberRole: (
    tenantId: string,
    teamId: string,
    userId: string,
    role: TeamMemberRole,
  ) =>
    fetchJSON<TeamMemberDto>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PUT', body: JSON.stringify({ role }) },
    ),

  removeTeamMember: (tenantId: string, teamId: string, userId: string) =>
    fetchJSON<void>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

  listRepos: (tenantId: string) =>
    fetchJSON<RegisteredRepoDto[]>(`/v1/orgs/${encodeURIComponent(tenantId)}/repos`),

  updateRepoVisibility: (tenantId: string, repoId: string, visibility: RepoVisibility) =>
    fetchJSON<RegisteredRepoDto>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/repos/${encodeURIComponent(repoId)}/visibility`,
      { method: 'PUT', body: JSON.stringify({ visibility }) },
    ),

  listGrants: (tenantId: string, repoId: string) =>
    fetchJSON<RepoAccessGrantDto[]>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/repos/${encodeURIComponent(repoId)}/grants`,
    ),

  upsertGrant: (
    tenantId: string,
    repoId: string,
    body: { userId?: string | null; teamId?: string | null; accessLevel: RepoAccessLevel },
  ) =>
    fetchJSON<RepoAccessGrantDto>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/repos/${encodeURIComponent(repoId)}/grants`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  revokeGrant: (tenantId: string, repoId: string, grantId: string) =>
    fetchJSON<void>(
      `/v1/orgs/${encodeURIComponent(tenantId)}/repos/${encodeURIComponent(repoId)}/grants/${encodeURIComponent(grantId)}`,
      { method: 'DELETE' },
    ),
};
