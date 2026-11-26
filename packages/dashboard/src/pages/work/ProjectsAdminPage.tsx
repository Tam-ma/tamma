/**
 * ProjectsAdminPage — `/work/projects` tenant-admin project management UI
 * (Story 44-6 AC1, guarded by TenantAdminGuard in router.tsx).
 */

import { useEffect, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/common/ConfirmDialog.js';
import { EmptyState } from '../../components/monitoring/EmptyState.js';
import { ErrorBanner } from '../../components/monitoring/ErrorBanner.js';
import { AUTOMATION_MODES, ESTIMATE_SCALES } from '../../components/work/work-format.js';
import {
  TrackerApiError,
  type EstimateScale,
  type ProjectAutomationMode,
  type ProjectResponse,
} from '../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../stores/tracker/store.js';

const INPUT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export function ProjectsAdminPage(): JSX.Element {
  const projects = useTrackerStore((s) => s.projects);
  const loading = useTrackerStore((s) => s.projectsLoading);
  const error = useTrackerStore((s) => s.projectsError);
  const loadProjects = useTrackerStore((s) => s.loadProjects);
  const createProject = useTrackerStore((s) => s.createProject);
  const patchProject = useTrackerStore((s) => s.patchProject);
  const deleteProject = useTrackerStore((s) => s.deleteProject);

  const [includeArchived, setIncludeArchived] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [estimateScale, setEstimateScale] = useState<EstimateScale>('not_used');
  const [automationMode, setAutomationMode] = useState<ProjectAutomationMode>('off');
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectResponse | null>(null);

  useEffect(() => {
    void loadProjects(includeArchived);
  }, [includeArchived, loadProjects]);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!key.trim() || !name.trim()) return;
    setActionError(null);
    try {
      await createProject({
        key: key.trim().toUpperCase(),
        name: name.trim(),
        estimateScale,
        automationMode,
      });
      setKey('');
      setName('');
      setEstimateScale('not_used');
      setAutomationMode('off');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create project');
    }
  };

  const handleAutomationChange = async (
    project: ProjectResponse,
    mode: ProjectAutomationMode,
  ): Promise<void> => {
    setActionError(null);
    try {
      await patchProject(project.id, { automationMode: mode }, project.version);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update automation mode');
    }
  };

  const handleArchiveToggle = async (project: ProjectResponse): Promise<void> => {
    setActionError(null);
    try {
      await patchProject(project.id, { archived: project.archivedAt === null }, project.version);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update archive state');
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await deleteProject(deleteTarget.id, deleteTarget.version);
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof TrackerApiError && err.status === 409 && err.body?.workItems) {
        const keys = err.body.workItems.map((w) => w.key).join(', ');
        setActionError(`${err.message} Blocking items: ${keys}`);
      } else {
        setActionError(err instanceof Error ? err.message : 'Failed to delete project');
      }
      setDeleteTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Work Projects</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage tracker projects, estimate scales, and autonomous-loop opt-in mode.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived
          </label>
          <Link
            to="/work"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
          >
            Back to Work
          </Link>
        </div>
      </div>

      {(error || actionError) && (
        <ErrorBanner
          message={actionError ?? error ?? ''}
          onDismiss={() => setActionError(null)}
        />
      )}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
      >
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          New Project
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <input
            type="text"
            aria-label="Project key"
            placeholder="Key (e.g. TAM)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            className={INPUT_CLASS}
          />
          <input
            type="text"
            aria-label="Project name"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={`${INPUT_CLASS} sm:col-span-2`}
          />
          <select
            aria-label="Estimate scale"
            value={estimateScale}
            onChange={(e) => setEstimateScale(e.target.value as EstimateScale)}
            className={INPUT_CLASS}
          >
            {ESTIMATE_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                Scale: {scale}
              </option>
            ))}
          </select>
          <select
            aria-label="Automation mode"
            value={automationMode}
            onChange={(e) => setAutomationMode(e.target.value as ProjectAutomationMode)}
            className={INPUT_CLASS}
          >
            {AUTOMATION_MODES.map((m) => (
              <option key={m} value={m}>
                Loop: {m}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Create Project
          </button>
        </div>
      </form>

      {loading && projects.length === 0 ? (
        <p className="text-sm text-gray-500">Loading projects…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first tracker project above."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-gray-500">
                  Key
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-gray-500">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-gray-500">
                  Scale
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-gray-500">
                  Automation
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold">{p.key}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                    {p.archivedAt && (
                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                    {p.estimateScale}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      aria-label={`Automation mode for ${p.key}`}
                      value={p.automationMode}
                      onChange={(e) =>
                        void handleAutomationChange(p, e.target.value as ProjectAutomationMode)
                      }
                      className={INPUT_CLASS}
                    >
                      {AUTOMATION_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleArchiveToggle(p)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
                      >
                        {p.archivedAt ? 'Unarchive' : 'Archive'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(p)}
                        className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete project"
        message={
          deleteTarget
            ? `Delete project ${deleteTarget.key} (${deleteTarget.name})? Projects containing work items cannot be deleted.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
