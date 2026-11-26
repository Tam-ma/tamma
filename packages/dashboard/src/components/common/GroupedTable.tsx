/**
 * GroupedTable — generic column-grouped table with collapsible group headers,
 * per-group counts, empty-group preservation, and portable `DataTableColumn<T>`
 * definitions (Story 44-6 AC6 / D6; shared with Epic 43-7).
 */

import { Fragment, useState, type JSX, type ReactNode } from 'react';
import type { DataTableColumn } from '../monitoring/DataTable.js';
import { RowToggle } from './RowToggle.js';

export interface TableGroup<T> {
  key: string;
  label: string;
  count: number;
  rows: T[];
}

export interface GroupedTableProps<T> {
  columns: DataTableColumn<T>[];
  groups: TableGroup<T>[];
  getRowId?: (row: T, index: number) => string;
  defaultCollapsedKeys?: string[];
  onRowClick?: (row: T) => void;
  /** Optional row-level expander: when supplied, each row renders a RowToggle. */
  renderExpandedRow?: (row: T) => ReactNode;
  /** Optional predicate to limit which rows show a RowToggle. Defaults to all rows. */
  isRowExpandable?: (row: T) => boolean;
  emptyGroupMessage?: string;
  className?: string;
}

const ALIGN_CLASS: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function GroupedTable<T>({
  columns,
  groups,
  getRowId,
  defaultCollapsedKeys = [],
  onRowClick,
  renderExpandedRow,
  isRowExpandable,
  emptyGroupMessage = 'No items in this group.',
  className = '',
}: GroupedTableProps<T>): JSX.Element {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(defaultCollapsedKeys),
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  const hasRowExpander = renderExpandedRow !== undefined;
  const totalColSpan = columns.length + (hasRowExpander ? 1 : 0);

  const toggleGroup = (key: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleRow = (rowId: string): void => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  return (
    <div
      data-testid="grouped-table"
      className={`overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}
    >
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {hasRowExpander && (
              <th scope="col" className="w-10 px-2 py-2.5">
                <span className="sr-only">Expand</span>
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 ${
                  ALIGN_CLASS[col.align ?? 'left']
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <Fragment key={group.key}>
                <tr
                  data-testid={`grouped-table-group-${group.key}`}
                  className="bg-gray-50/80 dark:bg-gray-800/60"
                >
                  <td colSpan={totalColSpan} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white"
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                      >
                        ▸
                      </span>
                      <span>{group.label}</span>
                      <span
                        data-testid={`grouped-table-count-${group.key}`}
                        className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                      >
                        {group.count}
                      </span>
                    </button>
                  </td>
                </tr>

                {!isCollapsed && group.rows.length === 0 && (
                  <tr data-testid={`grouped-table-empty-${group.key}`}>
                    <td
                      colSpan={totalColSpan}
                      className="px-6 py-3 text-xs italic text-gray-400 dark:text-gray-500"
                    >
                      {emptyGroupMessage}
                    </td>
                  </tr>
                )}

                {!isCollapsed &&
                  group.rows.map((row, idx) => {
                    const rowId = getRowId ? getRowId(row, idx) : `${group.key}-${idx}`;
                    const canExpand = hasRowExpander && (isRowExpandable ? isRowExpandable(row) : true);
                    const isRowExpanded = canExpand && expandedRows.has(rowId);

                    return (
                      <Fragment key={rowId}>
                        <tr
                          onClick={onRowClick ? () => onRowClick(row) : undefined}
                          className={
                            onRowClick
                              ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                              : undefined
                          }
                        >
                          {hasRowExpander && (
                            <td className="px-2 py-2.5 align-middle">
                              {canExpand && (
                                <RowToggle
                                  expanded={isRowExpanded}
                                  onToggle={() => toggleRow(rowId)}
                                  label={`Toggle details for row ${rowId}`}
                                  controlsId={`grouped-row-detail-${rowId}`}
                                />
                              )}
                            </td>
                          )}
                          {columns.map((col) => (
                            <td
                              key={col.key}
                              className={`px-4 py-2.5 text-gray-700 dark:text-gray-300 ${
                                ALIGN_CLASS[col.align ?? 'left']
                              }`}
                            >
                              {col.render ? col.render(row) : String(col.accessor?.(row) ?? '')}
                            </td>
                          ))}
                        </tr>
                        {isRowExpanded && renderExpandedRow && (
                          <tr
                            id={`grouped-row-detail-${rowId}`}
                            data-testid={`grouped-row-expanded-${rowId}`}
                            className="bg-gray-50/40 dark:bg-gray-900/40"
                          >
                            <td colSpan={totalColSpan} className="px-6 py-3">
                              {renderExpandedRow(row)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
