/**
 * useRepoAccess — hook for managing repository visibility and access grants
 * (Story 39-20).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  accessApi,
  type RegisteredRepoDto,
  type RepoAccessGrantDto,
  type RepoAccessLevel,
  type RepoVisibility,
} from '../../services/admin/access-api-client.js';

export function useRepoAccess(tenantId: string | null) {
  const [repos, setRepos] = useState<RegisteredRepoDto[]>([]);
  const [grantsByRepo, setGrantsByRepo] = useState<Record<string, RepoAccessGrantDto[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      setRepos([]);
      setGrantsByRepo({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await accessApi.listRepos(tenantId);
      setRepos(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGrants = useCallback(
    async (repoId: string) => {
      if (!tenantId) return;
      const grants = await accessApi.listGrants(tenantId, repoId);
      setGrantsByRepo((prev) => ({ ...prev, [repoId]: grants }));
    },
    [tenantId],
  );

  const setVisibility = useCallback(
    async (repoId: string, visibility: RepoVisibility) => {
      if (!tenantId) return;
      const updated = await accessApi.updateRepoVisibility(tenantId, repoId, visibility);
      setRepos((prev) => prev.map((r) => (r.id === repoId ? updated : r)));
    },
    [tenantId],
  );

  const saveGrant = useCallback(
    async (
      repoId: string,
      grantee: { userId?: string | null; teamId?: string | null },
      accessLevel: RepoAccessLevel,
    ) => {
      if (!tenantId) return;
      await accessApi.upsertGrant(tenantId, repoId, {
        userId: grantee.userId ?? null,
        teamId: grantee.teamId ?? null,
        accessLevel,
      });
      await loadGrants(repoId);
    },
    [tenantId, loadGrants],
  );

  const revokeGrant = useCallback(
    async (repoId: string, grantId: string) => {
      if (!tenantId) return;
      await accessApi.revokeGrant(tenantId, repoId, grantId);
      await loadGrants(repoId);
    },
    [tenantId, loadGrants],
  );

  return {
    repos,
    grantsByRepo,
    loading,
    error,
    reload: load,
    loadGrants,
    setVisibility,
    saveGrant,
    revokeGrant,
  };
}
