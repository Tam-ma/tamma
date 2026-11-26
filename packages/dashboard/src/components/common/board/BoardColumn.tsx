/**
 * BoardColumn — reusable droppable + sortable column container for a Kanban
 * board (Story 44-6 AC6 / AC12 / D7).
 */

import type { JSX, ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { toColumnDroppableId } from './BoardDragContext.js';

export interface BoardColumnProps {
  columnKey: string;
  label: string;
  totalCount: number;
  itemIds: string[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  emptyLabel?: string;
  children: ReactNode;
}

export function BoardColumn({
  columnKey,
  label,
  totalCount,
  itemIds,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  emptyLabel = 'No items',
  children,
}: BoardColumnProps): JSX.Element {
  const droppableId = toColumnDroppableId(columnKey);
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: 'column', columnKey },
  });

  return (
    <section
      ref={setNodeRef}
      role="region"
      aria-label={`${label} column (${totalCount})`}
      data-testid={`board-column-${columnKey}`}
      data-column-key={columnKey}
      className={`flex w-72 shrink-0 flex-col rounded-lg border transition-colors ${
        isOver
          ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30'
          : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'
      }`}
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {label}
        </h2>
        <span
          data-testid={`board-column-count-${columnKey}`}
          className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
        >
          {totalCount}
        </span>
      </header>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div
          role="list"
          aria-label={`${label} items`}
          className="flex min-h-[120px] flex-1 flex-col gap-2 p-2"
        >
          {itemIds.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">
              {emptyLabel}
            </p>
          ) : (
            children
          )}
        </div>
      </SortableContext>

      {hasMore && onLoadMore && (
        <div className="border-t border-gray-200 p-2 dark:border-gray-700">
          <button
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
            data-testid={`board-column-load-more-${columnKey}`}
            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}
