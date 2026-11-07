/**
 * AcceptanceRulesAdminPage (Story 39-5)
 *
 * Admin page for the configurable acceptance policy. Lists the effective rules
 * per document type with default-vs-override provenance, and edits the autonomy
 * dial (range published by GET /api/actions/dial), bounds, escalation criteria, always-escalate classes, reviewer
 * selection, and decision/routing guidance. Mirrors ConventionsAdminPage.
 *
 * RBAC: wrapped in AdminGuard so only admin/owner reach it; the API additionally
 * enforces acceptance-rules:manage on writes (members 403).
 */

import { useEffect, useState, type JSX } from 'react';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner.js';
import { RulesTable } from '../../../components/acceptance-rules/RulesTable.js';
import { RulesEditDialog } from '../../../components/acceptance-rules/RulesEditDialog.js';
import { useAcceptanceRules } from '../../../hooks/admin/useAcceptanceRules.js';
import type { ResolvedAcceptanceRules } from '../../../services/admin/acceptance-rules-api-client.js';
import {
  actionsPolicyApi,
  type AutonomyDialInfo,
} from '../../../services/admin/actions-policy-api-client.js';

export function AcceptanceRulesAdminPage(): JSX.Element {
  const { rows, loading, error, reload, upsert, reset } = useAcceptanceRules();
  const [selected, setSelected] = useState<ResolvedAcceptanceRules | null>(null);
  // Story 43-1 AC4: the dial range is server-owned; fetch it once for the editor.
  const [dial, setDial] = useState<AutonomyDialInfo | null>(null);
  const [dialError, setDialError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadDial = async () => {
      try {
        const d = await actionsPolicyApi.getDial();
        if (!cancelled) setDial(d);
      } catch (err) {
        if (!cancelled) setDialError(err instanceof Error ? err.message : 'request failed');
      }
    };
    void loadDial();
    return () => {
      cancelled = true;
    };
  }, []);

  const openEditor = (documentTypeKey: string) => {
    const row = rows.find((r) => r.documentTypeKey === documentTypeKey) ?? null;
    setSelected(row);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Acceptance Rules</h1>
      <p className="text-sm text-gray-500 mb-6 dark:text-gray-400">
        Configure how autonomous Tamma is per document type — the autonomy dial,
        revision/repair bounds, escalation criteria, always-escalate classes, reviewer
        selection, and the decision/routing guidance the orchestrator reads. A deployment
        with no overrides runs on the shipped defaults.
      </p>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
          <div className="font-medium mb-1">Failed to load acceptance rules</div>
          <div className="mb-3">{error}</div>
          <button
            type="button"
            onClick={() => void reload()}
            className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-300 bg-white rounded-md hover:bg-red-100 dark:bg-gray-800 dark:text-red-300 dark:border-red-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <RulesTable rows={rows} onRowClick={openEditor} />
      )}

      {selected && (
        <RulesEditDialog
          resolved={selected}
          dial={dial}
          dialError={dialError}
          onSave={upsert}
          onReset={reset}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
