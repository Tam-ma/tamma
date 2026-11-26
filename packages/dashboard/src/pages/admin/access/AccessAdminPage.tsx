/**
 * AccessAdminPage — `/admin/access` admin UI for managing tenant teams, team
 * membership, repository visibility (`tenant` | `restricted`), and direct/team
 * repository access grants (Story 39-20 AC1 / AC2).
 */

import { useState, type JSX } from 'react';
import { ErrorBanner } from '../../../components/monitoring/ErrorBanner.js';
import { useCurrentUser } from '../../../hooks/admin/useCurrentUser.js';
import { useRepoAccess } from '../../../hooks/admin/useRepoAccess.js';
import { useTeams } from '../../../hooks/admin/useTeams.js';
import type {
  RepoAccessLevel,
  RepoVisibility,
  TeamMemberRole,
} from '../../../services/admin/access-api-client.js';

export interface AccessAdminPageProps {
  /** Optional explicit tenant id override (defaults to active tenant or 'default'). */
  tenantId?: string;
}

const INPUT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export function AccessAdminPage({ tenantId: explicitTenantId }: AccessAdminPageProps = {}): JSX.Element {
  const { isAdmin } = useCurrentUser();
  const tenantId = explicitTenantId ?? 'active';

  const [tab, setTab] = useState<'teams' | 'repos'>('teams');
  const [teamName, setTeamName] = useState('');
  const [defaultRole, setDefaultRole] = useState<TeamMemberRole>('member');
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [grantGranteeType, setGrantGranteeType] = useState<'team' | 'user'>('team');
  const [grantGranteeId, setGrantGranteeId] = useState('');
  const [grantLevel, setGrantLevel] = useState<RepoAccessLevel>('contribute');
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    teams,
    loading: teamsLoading,
    error: teamsError,
    createTeam,
    deleteTeam,
  } = useTeams(tenantId);

  const {
    repos,
    grantsByRepo,
    loading: reposLoading,
    error: reposError,
    loadGrants,
    setVisibility,
    saveGrant,
    revokeGrant,
  } = useRepoAccess(tenantId);

  const handleCreateTeam = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setActionError(null);
    try {
      await createTeam(teamName.trim(), defaultRole);
      setTeamName('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create team');
    }
  };

  const handleVisibilityToggle = async (
    repoId: string,
    visibility: RepoVisibility,
  ): Promise<void> => {
    setActionError(null);
    try {
      await setVisibility(repoId, visibility);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update visibility');
    }
  };

  const handleSelectRepo = async (repoId: string): Promise<void> => {
    setSelectedRepoId(repoId);
    setActionError(null);
    try {
      await loadGrants(repoId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load grants');
    }
  };

  const handleSaveGrant = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedRepoId || !grantGranteeId.trim()) return;
    setActionError(null);
    try {
      await saveGrant(
        selectedRepoId,
        grantGranteeType === 'team'
          ? { teamId: grantGranteeId.trim() }
          : { userId: grantGranteeId.trim() },
        grantLevel,
      );
      setGrantGranteeId('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save grant');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Teams &amp; Repository Access
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Organize members into teams and control per-repository visibility and access grants.
        </p>
      </div>

      {(actionError || teamsError || reposError) && (
        <ErrorBanner
          message={actionError ?? teamsError ?? reposError ?? ''}
          onDismiss={() => setActionError(null)}
        />
      )}

      <div role="tablist" aria-label="Access management tabs" className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'teams'}
          onClick={() => setTab('teams')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'teams'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400'
          }`}
        >
          Teams ({teams.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'repos'}
          onClick={() => setTab('repos')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'repos'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400'
          }`}
        >
          Repo Access ({repos.length})
        </button>
      </div>

      {tab === 'teams' && (
        <section aria-label="Teams management" className="space-y-4">
          {isAdmin && (
            <form
              onSubmit={(e) => void handleCreateTeam(e)}
              data-testid="create-team-form"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <input
                type="text"
                aria-label="Team name"
                placeholder="New team name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
                className={INPUT_CLASS}
              />
              <select
                aria-label="Default member role"
                value={defaultRole}
                onChange={(e) => setDefaultRole(e.target.value as TeamMemberRole)}
                className={INPUT_CLASS}
              >
                <option value="member">Default: member</option>
                <option value="maintainer">Default: maintainer</option>
              </select>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Team
              </button>
            </form>
          )}

          {teamsLoading && teams.length === 0 ? (
            <p className="text-sm text-gray-500">Loading teams…</p>
          ) : teams.length === 0 ? (
            <p className="text-sm text-gray-500">No teams created yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
              {teams.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t.memberCount} member(s) · default role: {t.defaultMemberRole}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteTeam(t.id)}
                      className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'repos' && (
        <section aria-label="Repository access management" className="space-y-4">
          {reposLoading && repos.length === 0 ? (
            <p className="text-sm text-gray-500">Loading repositories…</p>
          ) : repos.length === 0 ? (
            <p className="text-sm text-gray-500">No repositories registered yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
              {repos.map((repo) => (
                <li key={repo.id} className="space-y-3 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {repo.repoFullName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Platform: {repo.platformKind} · Visibility: {repo.visibility}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <select
                          aria-label={`Visibility for ${repo.repoFullName}`}
                          value={repo.visibility}
                          onChange={(e) =>
                            void handleVisibilityToggle(repo.id, e.target.value as RepoVisibility)
                          }
                          className={INPUT_CLASS}
                        >
                          <option value="tenant">tenant</option>
                          <option value="restricted">restricted</option>
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSelectRepo(repo.id)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
                      >
                        Manage Grants
                      </button>
                    </div>
                  </div>

                  {selectedRepoId === repo.id && (
                    <div
                      data-testid={`repo-grants-panel-${repo.id}`}
                      className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50"
                    >
                      <h3 className="mb-2 text-xs font-semibold uppercase text-gray-600 dark:text-gray-300">
                        Access Grants
                      </h3>
                      {(grantsByRepo[repo.id] ?? []).length === 0 ? (
                        <p className="mb-2 text-xs text-gray-500">No explicit grants yet.</p>
                      ) : (
                        <ul className="mb-3 space-y-1 text-xs">
                          {(grantsByRepo[repo.id] ?? []).map((g) => (
                            <li key={g.id} className="flex items-center justify-between">
                              <span>
                                {g.teamId ? `Team ${g.teamId}` : `User ${g.userId}`} —{' '}
                                <strong>{g.accessLevel}</strong>
                              </span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => void revokeGrant(repo.id, g.id)}
                                  className="text-red-600 hover:underline dark:text-red-400"
                                >
                                  Revoke
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {isAdmin && (
                        <form
                          onSubmit={(e) => void handleSaveGrant(e)}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <select
                            aria-label="Grantee type"
                            value={grantGranteeType}
                            onChange={(e) =>
                              setGrantGranteeType(e.target.value as 'team' | 'user')
                            }
                            className={INPUT_CLASS}
                          >
                            <option value="team">Team</option>
                            <option value="user">User</option>
                          </select>
                          <input
                            type="text"
                            aria-label="Grantee ID"
                            placeholder="User or team UUID"
                            value={grantGranteeId}
                            onChange={(e) => setGrantGranteeId(e.target.value)}
                            required
                            className={INPUT_CLASS}
                          />
                          <select
                            aria-label="Access level"
                            value={grantLevel}
                            onChange={(e) => setGrantLevel(e.target.value as RepoAccessLevel)}
                            className={INPUT_CLASS}
                          >
                            <option value="read">read</option>
                            <option value="contribute">contribute</option>
                            <option value="admin">admin</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                          >
                            Save Grant
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
