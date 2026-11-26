/**
 * RowToggle — reusable accessible expand/collapse chevron control for table and
 * tree rows (Story 44-6 AC6 / D6; shared with Epic 43-7).
 */

import { useState, type JSX, type ReactNode } from 'react';

export interface RowToggleProps {
  /** Controlled expanded state. Omit for uncontrolled mode. */
  expanded?: boolean;
  /** Initial expanded state when uncontrolled. */
  defaultExpanded?: boolean;
  /** Called when the user toggles the control. */
  onToggle?: (nextExpanded: boolean) => void;
  /** Accessible label describing the row being toggled. */
  label: string;
  /** Optional id of the controlled expanded region (`aria-controls`). */
  controlsId?: string;
  /** Optional expanded content slot rendered only when expanded. */
  children?: ReactNode;
  className?: string;
}

export function RowToggle({
  expanded: controlledExpanded,
  defaultExpanded = false,
  onToggle,
  label,
  controlsId,
  children,
  className = '',
}: RowToggleProps): JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = controlledExpanded !== undefined;
  const isExpanded = isControlled ? controlledExpanded : internalExpanded;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    const next = !isExpanded;
    if (!isControlled) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={isExpanded}
        aria-controls={controlsId}
        aria-label={label}
        data-testid="row-toggle"
        className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isExpanded && children != null && (
        <div id={controlsId} data-testid="row-toggle-content">
          {children}
        </div>
      )}
    </span>
  );
}
