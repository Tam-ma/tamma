/**
 * BoardCard — reusable sortable card inside a BoardColumn, with accessible
 * keyboard drag handle (Story 44-6 AC6 / AC12 / D7 / D8).
 */

import type { JSX, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface BoardCardProps {
  itemId: string;
  columnKey: string;
  /** Accessible label for the card & its keyboard drag handle. */
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}

export function BoardCard({
  itemId,
  columnKey,
  ariaLabel,
  children,
  className = '',
}: BoardCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemId,
    data: { type: 'card', columnKey },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      aria-label={ariaLabel}
      data-testid={`board-card-${itemId}`}
      data-item-id={itemId}
      className={`rounded-md border border-gray-200 bg-white p-3 shadow-xs transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-900 ${className}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${ariaLabel}`}
          data-testid={`board-card-handle-${itemId}`}
          className="mt-0.5 shrink-0 cursor-grab rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 active:cursor-grabbing touch-none dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
