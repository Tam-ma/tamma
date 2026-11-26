/**
 * AssigneePicker — assignee selector wired to GET /api/work-items/assignable
 * with honest degradation rendering (Story 44-6 AC7 / D10).
 *
 * When `source === 'tenant-membership'`, renders a one-line note that
 * repo-scoped eligibility is not yet configured. When `source === 'audience-resolver'`
 * (post-39-20), renders no note.
 */

import { useEffect, type JSX } from 'react';
import type { AssignableResponse } from '../../services/tracker/tracker-api-client.js';
import { useTrackerStore } from '../../stores/tracker/store.js';

export interface AssigneePickerProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Optional externally supplied assignable payload (useful in isolated tests/forms). */
  assignable?: AssignableResponse | null;
  disabled?: boolean;
  label?: string;
  id?: string;
  className?: string;
}

export function AssigneePicker({
  value,
  onChange,
  assignable: externalAssignable,
  disabled = false,
  label = 'Assignee',
  id = 'assignee-picker',
  className = '',
}: AssigneePickerProps): JSX.Element {
  const storeAssignable = useTrackerStore((s) => s.assignable);
  const storeLoading = useTrackerStore((s) => s.assignableLoading);
  const loadAssignable = useTrackerStore((s) => s.loadAssignable);

  const resolved = externalAssignable !== undefined ? externalAssignable : storeAssignable;

  useEffect(() => {
    if (externalAssignable === undefined && !storeAssignable && !storeLoading) {
      void loadAssignable();
    }
  }, [externalAssignable, storeAssignable, storeLoading, loadAssignable]);

  const members = resolved?.members ?? [];
  const source = resolved?.source;

  return (
    <div className={className} data-testid="assignee-picker">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-gray-600 dark:text-gray-400"
      >
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.userId} ({m.role})
          </option>
        ))}
      </select>

      {source === 'tenant-membership' && (
        <p
          data-testid="assignee-source-note"
          className="mt-1 text-xs text-amber-700 dark:text-amber-300"
        >
          Showing tenant members — repo-scoped eligibility is not yet configured.
        </p>
      )}

      {source === 'single-user' && (
        <p
          data-testid="assignee-source-note"
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
        >
          Single-user mode — showing the local owner account.
        </p>
      )}
    </div>
  );
}
