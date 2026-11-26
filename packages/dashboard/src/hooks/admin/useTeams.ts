/**
 * useTeams — hook for managing tenant teams and team membership (Story 39-20).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  accessApi,
  type TeamDto,
  type TeamMemberRole,
} from '../../services/admin/access-api-client.js';

export function useTeams(tenantId: string | null) {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      setTeams([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await accessApi.listTeams(tenantId);
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTeam = useCallback(
    async (name: string, defaultMemberRole: TeamMemberRole = 'member') => {
      if (!tenantId) return;
      await accessApi.createTeam(tenantId, { name, defaultMemberRole });
      await load();
    },
    [tenantId, load],
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      if (!tenantId) return;
      await accessApi.deleteTeam(tenantId, teamId);
      await load();
    },
    [tenantId, load],
  );

  const addMember = useCallback(
    async (teamId: string, userId: string, role: TeamMemberRole = 'member') => {
      if (!tenantId) return;
      await accessApi.addTeamMember(tenantId, teamId, { userId, role });
      await load();
    },
    [tenantId, load],
  );

  const removeMember = useCallback(
    async (teamId: string, userId: string) => {
      if (!tenantId) return;
      await accessApi.removeTeamMember(tenantId, teamId, userId);
      await load();
    },
    [tenantId, load],
  );

  return { teams, loading, error, reload: load, createTeam, deleteTeam, addMember, removeMember };
}
