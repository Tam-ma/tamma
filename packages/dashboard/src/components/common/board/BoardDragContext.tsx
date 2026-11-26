/**
 * BoardDragContext — transport-agnostic cross-container drag-and-drop wrapper
 * built on @dnd-kit/core (Story 44-6 AC6 / AC12 / D7 / D8).
 *
 * Uses PointerSensor + KeyboardSensor, closestCorners collision detection, and
 * a portalled DragOverlay so cards are never clipped by column overflow.
 */

import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';

export interface BoardColumnDescriptor {
  key: string;
  itemIds: string[];
}

export interface BoardDropResult {
  itemId: string;
  fromColumnKey: string;
  toColumnKey: string;
  afterId: string | null;
  beforeId: string | null;
}

export interface BoardDragContextProps {
  columns: BoardColumnDescriptor[];
  onDragEnd: (result: BoardDropResult) => void;
  renderOverlay?: (activeItemId: string) => ReactNode;
  children: ReactNode;
}

export const COLUMN_DROPPABLE_PREFIX = 'board-column:';

export function toColumnDroppableId(columnKey: string): string {
  return `${COLUMN_DROPPABLE_PREFIX}${columnKey}`;
}

export function fromColumnDroppableId(id: UniqueIdentifier): string | null {
  const s = String(id);
  return s.startsWith(COLUMN_DROPPABLE_PREFIX)
    ? s.slice(COLUMN_DROPPABLE_PREFIX.length)
    : null;
}

/**
 * Pure computation mapping a @dnd-kit (activeId, overId) pair against the
 * current board columns into transport-agnostic (itemId, fromColumnKey,
 * toColumnKey, afterId, beforeId) neighbour placement.
 */
export function computeBoardDropResult(
  columns: BoardColumnDescriptor[],
  activeId: string,
  overId: string,
): BoardDropResult | null {
  const sourceCol = columns.find((c) => c.itemIds.includes(activeId));
  if (!sourceCol) return null;

  const explicitColKey = fromColumnDroppableId(overId);
  const targetCol =
    explicitColKey !== null
      ? columns.find((c) => c.key === explicitColKey)
      : columns.find((c) => c.itemIds.includes(overId));

  if (!targetCol) return null;

  const isSameColumn = sourceCol.key === targetCol.key;
  if (isSameColumn && activeId === overId) {
    return null;
  }

  // Dropping directly onto a column container appends at the end of that column.
  if (explicitColKey !== null) {
    const remaining = targetCol.itemIds.filter((id) => id !== activeId);
    const lastId = remaining.length > 0 ? remaining[remaining.length - 1]! : null;
    if (isSameColumn && sourceCol.itemIds[sourceCol.itemIds.length - 1] === activeId) {
      return null;
    }
    return {
      itemId: activeId,
      fromColumnKey: sourceCol.key,
      toColumnKey: targetCol.key,
      afterId: lastId,
      beforeId: null,
    };
  }

  // Dropping onto another card inside targetCol.
  const remaining = targetCol.itemIds.filter((id) => id !== activeId);
  const overIndexInTarget = targetCol.itemIds.indexOf(overId);
  const activeIndexInSource = sourceCol.itemIds.indexOf(activeId);

  if (isSameColumn) {
    // Reorder within the same column: if dragging downward, place AFTER overId;
    // if dragging upward, place BEFORE overId.
    const overIndexInRemaining = remaining.indexOf(overId);
    if (overIndexInRemaining === -1) return null;

    if (activeIndexInSource < overIndexInTarget) {
      return {
        itemId: activeId,
        fromColumnKey: sourceCol.key,
        toColumnKey: targetCol.key,
        afterId: overId,
        beforeId: remaining[overIndexInRemaining + 1] ?? null,
      };
    }
    return {
      itemId: activeId,
      fromColumnKey: sourceCol.key,
      toColumnKey: targetCol.key,
      afterId: overIndexInRemaining > 0 ? remaining[overIndexInRemaining - 1]! : null,
      beforeId: overId,
    };
  }

  // Cross-column drop onto a specific card: place before that card.
  const overIdx = remaining.indexOf(overId);
  return {
    itemId: activeId,
    fromColumnKey: sourceCol.key,
    toColumnKey: targetCol.key,
    afterId: overIdx > 0 ? remaining[overIdx - 1]! : null,
    beforeId: overIdx >= 0 ? overId : null,
  };
}

/**
 * Column-aware keyboard coordinate getter (AC12 / D8).
 *
 * Allows keyboard users to grab a card (Space/Enter), move vertically between
 * cards with Up/Down, and jump horizontally across columns (including empty
 * columns) with Left/Right, then drop with Space/Enter.
 */
export function createBoardKeyboardCoordinateGetter(
  columns: BoardColumnDescriptor[],
): KeyboardCoordinateGetter {
  return (event, { currentCoordinates, context }) => {
    const directions = new Set<string>([
      KeyboardCode.Down,
      KeyboardCode.Up,
      KeyboardCode.Left,
      KeyboardCode.Right,
    ]);
    if (!directions.has(event.code)) return undefined;

    event.preventDefault();

    const { droppableRects, over, active } = context;
    if (!active) return undefined;

    const currentTargetId = String(over?.id ?? active.id);
    const currentColKey =
      fromColumnDroppableId(currentTargetId) ??
      columns.find((c) => c.itemIds.includes(currentTargetId))?.key;
    const currentColIndex = columns.findIndex((c) => c.key === currentColKey);
    if (currentColIndex === -1) return undefined;

    let nextId: string | null = null;

    if (event.code === KeyboardCode.Left || event.code === KeyboardCode.Right) {
      const step = event.code === KeyboardCode.Right ? 1 : -1;
      const targetCol = columns[currentColIndex + step];
      if (!targetCol) return currentCoordinates;
      nextId = targetCol.itemIds[0] ?? toColumnDroppableId(targetCol.key);
    } else {
      const col = columns[currentColIndex]!;
      const idx = col.itemIds.indexOf(currentTargetId);
      const step = event.code === KeyboardCode.Down ? 1 : -1;
      if (idx === -1) {
        nextId = col.itemIds[0] ?? toColumnDroppableId(col.key);
      } else {
        const nextItemIdx = Math.max(0, Math.min(col.itemIds.length - 1, idx + step));
        nextId = col.itemIds[nextItemIdx] ?? toColumnDroppableId(col.key);
      }
    }

    if (!nextId) return currentCoordinates;
    const targetRect = droppableRects.get(nextId);
    if (targetRect) {
      return {
        x: targetRect.left + targetRect.width / 2,
        y: targetRect.top + targetRect.height / 2,
      };
    }

    return currentCoordinates;
  };
}

export function BoardDragContext({
  columns,
  onDragEnd,
  renderOverlay,
  children,
}: BoardDragContextProps): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);

  const coordinateGetter = useMemo(
    () => createBoardKeyboardCoordinateGetter(columns),
    [columns],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      if (!event.over) return;
      const result = computeBoardDropResult(
        columns,
        String(event.active.id),
        String(event.over.id),
      );
      if (result) {
        onDragEnd(result);
      }
    },
    [columns, onDragEnd],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const overlayNode =
    activeId && renderOverlay ? (
      <DragOverlay>
        <>{renderOverlay(activeId)}</>
      </DragOverlay>
    ) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <>{children}</>
      {typeof document !== 'undefined' && overlayNode
        ? createPortal(overlayNode, document.body)
        : overlayNode}
    </DndContext>
  );
}
